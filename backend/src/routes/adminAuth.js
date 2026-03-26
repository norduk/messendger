import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { query } from '../db/postgres.js';
import config from '../config/index.js';
import { updateUser, findUserByName, findUserById } from '../models/User.js';
import { verifyAdminApiKey, requireAdmin } from '../middleware/admin.js';
import { authenticate } from '../middleware/auth.js';

const findUserByIdWithPassword = async (id) => {
  const result = await query(
    'SELECT * FROM users WHERE id = $1',
    [id]
  );
  return result.rows[0];
};

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { name, password } = req.body;

    if (!name || !password) {
      return res.status(400).json({ error: 'Name and password required' });
    }

    const user = await findUserByName(name);
    if (!user || !user.is_admin) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    if (user.is_blocked) {
      return res.status(403).json({ error: 'Account is blocked' });
    }

    const token = jwt.sign(
      { userId: user.id, isAdmin: true },
      config.jwt.secret,
      { expiresIn: config.jwt.accessExpiresIn }
    );

    res.json({
      token,
      admin: {
        id: user.id,
        name: user.display_name,
        isAdmin: true
      }
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/profile', verifyAdminApiKey, authenticate, requireAdmin, async (req, res) => {
  res.json({
    admin: {
      id: req.user.id,
      name: req.user.display_name,
      email: req.user.email,
      createdAt: req.user.created_at
    }
  });
});

router.put('/profile', verifyAdminApiKey, authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (name && name !== req.user.display_name) {
      const existing = await findUserByName(name);
      if (existing && existing.id !== userId) {
        return res.status(400).json({ error: 'Name already taken' });
      }
    }

    if (currentPassword && newPassword) {
      if (newPassword.length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters' });
      }

      const userWithPassword = await findUserByIdWithPassword(userId);
      const validPassword = await bcrypt.compare(currentPassword, userWithPassword.password_hash);
      if (!validPassword) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }

      const passwordHash = await bcrypt.hash(newPassword, 12);
      await query(
        'UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1',
        [userId, passwordHash]
      );
    }

    if (name) {
      await query(
        'UPDATE users SET display_name = $2, updated_at = NOW() WHERE id = $1',
        [userId, name]
      );
    }

    const updatedUser = await findUserById(userId);
    res.json({
      admin: {
        id: updatedUser.id,
        name: updatedUser.display_name,
        email: updatedUser.email
      },
      message: 'Profile updated'
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.get('/storage', verifyAdminApiKey, authenticate, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.query;

    const dbSize = await query(`
      SELECT pg_size_pretty(pg_database_size(current_database())) as size
    `);

    let uploadSize = { rows: [{ size: '0 bytes' }] };
    try {
      const uploadDir = process.env.UPLOAD_DIR || '/app/uploads';
      if (fs.existsSync(uploadDir)) {
        const files = fs.readdirSync(uploadDir);
        let totalBytes = 0;
        for (const file of files) {
          const filePath = path.join(uploadDir, file);
          const stats = fs.statSync(filePath);
          totalBytes += stats.size;
        }
        const prettySize = totalBytes < 1024 ? `${totalBytes} B` :
                          totalBytes < 1024 * 1024 ? `${(totalBytes / 1024).toFixed(2)} KB` :
                          totalBytes < 1024 * 1024 * 1024 ? `${(totalBytes / (1024 * 1024)).toFixed(2)} MB` :
                          `${(totalBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
        uploadSize = { rows: [{ size: prettySize, bytes: totalBytes }] };
      }
    } catch (e) {
      console.error('Upload dir error:', e);
    }

    let userStorage = null;
    if (userId) {
      const messages = await query(`
        SELECT COUNT(*) as count FROM messages WHERE sender_id = $1 OR recipient_id = $1
      `, [userId]);

      const fileStats = await query(`
        SELECT COUNT(*) as count, COALESCE(SUM(file_size), 0) as total_size 
        FROM messages WHERE sender_id = $1 AND file_url IS NOT NULL
      `, [userId]);

      const user = await findUserById(userId);
      const totalFileBytes = parseInt(fileStats.rows[0].total_size) || 0;
      const prettyFileSize = totalFileBytes < 1024 ? `${totalFileBytes} B` :
                            totalFileBytes < 1024 * 1024 ? `${(totalFileBytes / 1024).toFixed(2)} KB` :
                            totalFileBytes < 1024 * 1024 * 1024 ? `${(totalFileBytes / (1024 * 1024)).toFixed(2)} MB` :
                            `${(totalFileBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
      
      userStorage = {
        user: user ? { id: user.id, name: user.display_name } : null,
        messageCount: parseInt(messages.rows[0].count),
        fileCount: parseInt(fileStats.rows[0].count) || 0,
        fileSize: prettyFileSize,
        fileSizeBytes: totalFileBytes
      };
    }

    res.json({
      database: dbSize.rows[0].size,
      uploads: uploadSize.rows[0].size,
      uploadsBytes: uploadSize.rows[0].bytes || 0,
      userStorage
    });
  } catch (error) {
    console.error('Storage stats error:', error);
    res.status(500).json({ error: 'Failed to get storage stats' });
  }
});

export default router;
