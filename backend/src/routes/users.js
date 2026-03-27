import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { authenticate } from '../middleware/auth.js';
import { updateUser, searchUsers } from '../models/User.js';
import { updateLastSeen, isUserOnline } from '../db/redis.js';

const avatarStorage = multer.memoryStorage();
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

const uploadDir = process.env.UPLOAD_DIR || './uploads';
const avatarDir = path.join(uploadDir, 'avatars');
if (!fs.existsSync(avatarDir)) {
  fs.mkdirSync(avatarDir, { recursive: true });
}

const router = express.Router();

router.get('/search', authenticate, async (req, res) => {
  try {
    const { q, limit = 20 } = req.query;
    if (!q || q.length < 2) {
      return res.json({ users: [] });
    }

    const users = await searchUsers(q, parseInt(limit));
    const filtered = users.filter(u => u.id !== req.user.id);

    res.json({
      users: filtered.map(u => ({
        id: u.id,
        email: u.email,
        displayName: u.display_name,
        nickname: u.nickname,
        avatarUrl: u.avatar_url,
        lastSeen: u.last_seen
      }))
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    if (id === req.user.id) {
      return res.json({
        user: {
          id: req.user.id,
          email: req.user.email,
          displayName: req.user.display_name,
          nickname: req.user.nickname,
          avatarUrl: req.user.avatar_url,
          publicKey: req.user.public_key,
          lastSeen: req.user.last_seen
        }
      });
    }

    const { findUserById } = await import('../models/User.js');
    const user = await findUserById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        nickname: user.nickname,
        avatarUrl: user.avatar_url,
        publicKey: user.public_key,
        lastSeen: user.last_seen
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

router.put('/profile', authenticate, async (req, res) => {
  try {
    const { displayName, avatarUrl, email, phone, nickname } = req.body;
    const user = await updateUser(req.user.id, { displayName, avatarUrl, email, phone, nickname });
    
    await updateLastSeen(req.user.id);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        displayName: user.display_name,
        nickname: user.nickname,
        avatarUrl: user.avatar_url,
        publicKey: user.public_key
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Этот никнейм уже занят' });
    }
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.put('/keys', authenticate, async (req, res) => {
  try {
    const { publicKey } = req.body;
    const user = await updateUser(req.user.id, { publicKey });
    
    res.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        publicKey: user.public_key
      }
    });
  } catch (error) {
    console.error('Update keys error:', error);
    res.status(500).json({ error: 'Failed to update keys' });
  }
});

router.post('/avatar', authenticate, avatarUpload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    const filename = `${uuidv4()}${ext}`;
    const filePath = path.join(avatarDir, filename);

    fs.writeFileSync(filePath, req.file.buffer);

    const avatarUrl = `/uploads/avatars/${filename}`;
    const user = await updateUser(req.user.id, { avatarUrl });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        publicKey: user.public_key
      }
    });
  } catch (error) {
    console.error('Avatar upload error:', error);
    res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

router.get('/online-status/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const online = await isUserOnline(id);
    res.json({ online: !!online });
  } catch (error) {
    console.error('Online status error:', error);
    res.status(500).json({ error: 'Failed to get online status' });
  }
});

export default router;
