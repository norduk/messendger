import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query } from '../db/postgres.js';
import { 
  getAllUsers, 
  getUserCount, 
  blockUser, 
  deleteUser,
  findUserById,
  updateUserPassword,
  updateUserName,
  findUserByName
} from '../models/User.js';
import { 
  getInvites, 
  createInvite, 
  deleteInvite,
  getInviteCount,
  getActiveInviteCount 
} from '../models/Invite.js';
import { getMessageStats, getRecentMessages } from '../models/Message.js';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin, verifyAdminApiKey } from '../middleware/admin.js';
import { inviteValidation } from '../middleware/validation.js';
import pool from '../db/postgres.js';

const router = express.Router();

router.use(verifyAdminApiKey);

router.get('/config', async (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (!adminKey) {
    return res.status(401).json({ error: 'Admin key required' });
  }
  
  const user = await query(
    'SELECT admin_secret_path FROM users WHERE admin_key = $1',
    [adminKey]
  );
  
  if (user.rows.length === 0) {
    return res.status(401).json({ error: 'Invalid admin key' });
  }
  
  let secretPath = user.rows[0].admin_secret_path;
  if (!secretPath) {
    secretPath = crypto.randomBytes(8).toString('hex');
    await query(
      'UPDATE users SET admin_secret_path = $1 WHERE admin_key = $2',
      [secretPath, adminKey]
    );
  }
  
  res.json({ secretPath });
});

router.post('/generate-key/:userId', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const adminKey = crypto.randomBytes(24).toString('hex');
    const adminSecretPath = crypto.randomBytes(8).toString('hex');
    const hashedKey = await bcrypt.hash(adminKey, 10);
    
    await query(
      'UPDATE users SET admin_key = $1, admin_secret_path = $2, is_admin = TRUE WHERE id = $3',
      [hashedKey, adminSecretPath, userId]
    );
    
    res.json({ 
      adminKey, 
      secretPath: adminSecretPath,
      message: 'Admin key generated. Share these credentials with the user - they will not be shown again.' 
    });
  } catch (error) {
    console.error('Generate key error:', error);
    res.status(500).json({ error: 'Failed to generate admin key' });
  }
});

router.delete('/revoke-key/:userId', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    await query(
      'UPDATE users SET admin_key = NULL, admin_secret_path = NULL, is_admin = FALSE WHERE id = $1',
      [userId]
    );
    
    res.json({ message: 'Admin key revoked' });
  } catch (error) {
    console.error('Revoke key error:', error);
    res.status(500).json({ error: 'Failed to revoke admin key' });
  }
});

import rateLimit from 'express-rate-limit';

const verifyKeyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many verification attempts, please try again later' }
});

router.get('/verify-key', verifyKeyLimiter, async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (!adminKey) {
      return res.status(401).json({ error: 'Admin key required' });
    }
    
    const result = await query(
      'SELECT id, display_name, email, admin_secret_path FROM users WHERE admin_key = $1',
      [adminKey]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid admin key' });
    }
    
    const user = result.rows[0];
    res.json({ 
      valid: true, 
      secretPath: user.admin_secret_path,
      user: { id: user.id, displayName: user.display_name, email: user.email } 
    });
  } catch (error) {
    console.error('Verify key error:', error);
    res.status(500).json({ error: 'Failed to verify admin key' });
  }
});

router.get('/health', async (req, res) => {
  try {
    const checkService = async (url, name) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        return { name, status: response.ok ? 'up' : 'down' };
      } catch {
        return { name, status: 'down' };
      }
    };

    const [pgHealth, redisHealth, messengerHealth, syncHealth, filesHealth] = await Promise.all([
      pool.query('SELECT 1').then(() => ({ name: 'PostgreSQL', status: 'up' })).catch(() => ({ name: 'PostgreSQL', status: 'down' })),
      import('../db/redis.js').then(m => m.default.ping()).then(r => ({ name: 'Redis', status: r === 'PONG' ? 'up' : 'down' })).catch(() => ({ name: 'Redis', status: 'down' })),
      checkService('http://localhost:3000/api/health', 'Messenger'),
      checkService('http://sync:3002/health', 'Sync'),
      checkService('http://files:3003/health', 'Files')
    ]);

    const services = [pgHealth, redisHealth, messengerHealth, syncHealth, filesHealth];
    const allUp = services.every(s => s.status === 'up');

    const status = {
      status: allUp ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      services: services.reduce((acc, s) => ({ ...acc, [s.name.toLowerCase()]: s.status }), {}),
      containers: services
    };

    res.json(status);
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const [
      userCount,
      messageStats,
      inviteStats
    ] = await Promise.all([
      getUserCount(),
      getMessageStats(),
      Promise.all([
        getInviteCount(),
        getActiveInviteCount()
      ]).then(([total, active]) => ({ total, active }))
    ]);

    const networkTraffic = await query(`
      SELECT 
        pg_size_pretty(pg_database_size(current_database())) as db_size
    `);

    res.json({
      users: {
        total: userCount,
        blocked: await query('SELECT COUNT(*) as count FROM users WHERE is_blocked = true').then(r => parseInt(r.rows[0].count)),
        admins: await query('SELECT COUNT(*) as count FROM users WHERE is_admin = true').then(r => parseInt(r.rows[0].count))
      },
      messages: {
        total: parseInt(messageStats.total),
        last24h: parseInt(messageStats.last_24h),
        last7d: parseInt(messageStats.last_7d),
        last30d: parseInt(messageStats.last_30d)
      },
      invites: {
        total: inviteStats.total,
        active: inviteStats.active
      },
      storage: {
        database: networkTraffic.rows[0].db_size
      }
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

router.get('/logs', async (req, res) => {
  try {
    const { limit = 100, offset = 0 } = req.query;
    
    const result = await query(`
      SELECT l.*, u.email as admin_email
      FROM admin_logs l
      LEFT JOIN users u ON l.admin_id = u.id
      ORDER BY l.created_at DESC
      LIMIT $1 OFFSET $2
    `, [parseInt(limit), parseInt(offset)]);

    res.json({ logs: result.rows });
  } catch (error) {
    console.error('Logs error:', error);
    res.status(500).json({ error: 'Failed to get logs' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const { search, isBlocked, limit = 50, offset = 0 } = req.query;
    
    const users = await getAllUsers({
      search,
      isBlocked: isBlocked === 'true' ? true : isBlocked === 'false' ? false : undefined,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({ users });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to get users' });
  }
});

router.put('/users/:id/block', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await findUserById(id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.is_admin) {
      return res.status(403).json({ error: 'Cannot block admin' });
    }

    await blockUser(id, true);
    
    await query(
      `INSERT INTO admin_logs (admin_id, action, target_user_id, details, ip_address)
       VALUES ($1, 'block_user', $2, $3, $4)`,
      [req.user.id, id, JSON.stringify({ email: user.email }), req.ip]
    );

    res.json({ message: 'User blocked' });
  } catch (error) {
    console.error('Block user error:', error);
    res.status(500).json({ error: 'Failed to block user' });
  }
});

router.put('/users/:id/unblock', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await blockUser(id, false);

    const user = await findUserById(id);
    await query(
      `INSERT INTO admin_logs (admin_id, action, target_user_id, details, ip_address)
       VALUES ($1, 'unblock_user', $2, $3, $4)`,
      [req.user.id, id, JSON.stringify({ email: user?.email }), req.ip]
    );

    res.json({ message: 'User unblocked' });
  } catch (error) {
    console.error('Unblock user error:', error);
    res.status(500).json({ error: 'Failed to unblock user' });
  }
});

router.delete('/users/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await findUserById(id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.is_admin) {
      return res.status(403).json({ error: 'Cannot delete admin' });
    }

    await query(
      `INSERT INTO admin_logs (admin_id, action, target_user_id, details, ip_address)
       VALUES ($1, 'delete_user', $2, $3, $4)`,
      [req.user.id, id, JSON.stringify({ email: user.email }), req.ip]
    );

    await deleteUser(id);

    res.json({ message: 'User deleted' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

router.put('/users/:id/name', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || name.trim().length < 2) {
      return res.status(400).json({ error: 'Name must be at least 2 characters' });
    }

    const user = await findUserById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const existing = await findUserByName(name);
    if (existing && existing.id !== id) {
      return res.status(400).json({ error: 'Name already taken' });
    }

    await updateUserName(id, name.trim());

    res.json({ message: 'User name updated' });
  } catch (error) {
    console.error('Update user name error:', error);
    res.status(500).json({ error: 'Failed to update user name' });
  }
});

router.put('/users/:id/password', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;

    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const user = await findUserById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await updateUserPassword(id, passwordHash);

    res.json({ message: 'User password updated' });
  } catch (error) {
    console.error('Update user password error:', error);
    res.status(500).json({ error: 'Failed to update user password' });
  }
});

router.put('/users/:id/admin', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { isAdmin } = req.body;

    const user = await findUserById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.is_admin && !isAdmin) {
      const adminCount = await query('SELECT COUNT(*) as count FROM users WHERE is_admin = true');
      if (parseInt(adminCount.rows[0].count) <= 1) {
        return res.status(400).json({ error: 'Cannot remove last admin' });
      }
    }

    await query(
      `UPDATE users SET is_admin = $2, updated_at = NOW() WHERE id = $1`,
      [id, isAdmin]
    );

    await query(
      `INSERT INTO admin_logs (admin_id, action, target_user_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, isAdmin ? 'grant_admin' : 'revoke_admin', id, JSON.stringify({ user_name: user.display_name }), req.ip]
    );

    res.json({ message: isAdmin ? 'Admin rights granted' : 'Admin rights revoked' });
  } catch (error) {
    console.error('Update admin status error:', error);
    res.status(500).json({ error: 'Failed to update admin status' });
  }
});

router.get('/invites', async (req, res) => {
  try {
    const { isUsed, limit = 50 } = req.query;
    
    const invites = await getInvites({
      isUsed: isUsed === 'true' ? true : isUsed === 'false' ? false : undefined,
      limit: parseInt(limit)
    });

    res.json({ invites });
  } catch (error) {
    console.error('Get invites error:', error);
    res.status(500).json({ error: 'Failed to get invites' });
  }
});

router.post('/invites', inviteValidation, async (req, res) => {
  try {
    const { count = 1 } = req.body;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const generateCode = () => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let code = '';
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        if (i < 3) code += '-';
      }
      return code;
    };

    const invites = [];
    for (let i = 0; i < count; i++) {
      const code = generateCode();
      const invite = await createInvite({
        code,
        createdBy: req.user?.id || null,
        expiresAt
      });
      invites.push(invite);
    }

    await query(
      `INSERT INTO admin_logs (admin_id, action, details, ip_address)
       VALUES ($1, 'create_invites', $2, $3)`,
      [req.user?.id || null, JSON.stringify({ count }), req.ip]
    );

    res.status(201).json({ invites });
  } catch (error) {
    console.error('Create invites error:', error);
    res.status(500).json({ error: 'Failed to create invites' });
  }
});

router.delete('/invites/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await deleteInvite(id);

    await query(
      `INSERT INTO admin_logs (admin_id, action, details, ip_address)
       VALUES ($1, 'delete_invite', $2, $3)`,
      [req.user.id, JSON.stringify({ inviteId: id }), req.ip]
    );

    res.json({ message: 'Invite deleted' });
  } catch (error) {
    console.error('Delete invite error:', error);
    res.status(500).json({ error: 'Failed to delete invite' });
  }
});

export default router;
