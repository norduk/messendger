import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { updateUser, searchUsers } from '../models/User.js';
import { updateLastSeen } from '../db/redis.js';

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
    const { displayName, avatarUrl } = req.body;
    const user = await updateUser(req.user.id, { displayName, avatarUrl });
    
    await updateLastSeen(req.user.id);

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
    console.error('Update profile error:', error);
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

export default router;
