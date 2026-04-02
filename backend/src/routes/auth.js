import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../db/postgres.js';
import config from '../config/index.js';
import { createUser, findUserByName, findUserByDisplayName, findUserByEmail, findUserByIdentifier } from '../models/User.js';
import { findInviteByCode, useInvite } from '../models/Invite.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { password, inviteCode, publicKey, displayName } = req.body;

    if (!password || !inviteCode || !displayName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existingUser = await findUserByDisplayName(displayName);
    if (existingUser) {
      return res.status(400).json({ error: 'Name already taken' });
    }

    const invite = await findInviteByCode(inviteCode);
    if (!invite) {
      return res.status(400).json({ error: 'Invalid invite code' });
    }
    if (invite.is_used) {
      return res.status(400).json({ error: 'Invite already used' });
    }
    if (new Date(invite.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Invite expired' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await createUser({ passwordHash, publicKey, displayName });

    await useInvite(inviteCode, user.id);

    const accessToken = jwt.sign(
      { userId: user.id },
      config.jwt.secret,
      { expiresIn: config.jwt.accessExpiresIn }
    );

    const refreshToken = jwt.sign(
      { userId: user.id, type: 'refresh' },
      config.jwt.refreshSecret,
      { expiresIn: config.jwt.refreshExpiresIn }
    );

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/api/auth'
    });

    res.status(201).json({
      user: {
        id: user.id,
        displayName: user.display_name,
        nickname: user.nickname,
        email: user.email,
        phone: user.phone,
        avatarUrl: user.avatar_url,
        publicKey: user.public_key,
        isAdmin: user.is_admin
      },
      accessToken
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { name, password } = req.body;

    if (!name || !password) {
      return res.status(400).json({ error: 'Name and password required' });
    }

    let user = await findUserByName(name);
    if (!user) {
      user = await findUserByEmail(name);
    }
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.is_blocked) {
      return res.status(403).json({ error: 'Account is blocked' });
    }

    const accessToken = jwt.sign(
      { userId: user.id },
      config.jwt.secret,
      { expiresIn: config.jwt.accessExpiresIn }
    );

    const refreshToken = jwt.sign(
      { userId: user.id, type: 'refresh' },
      config.jwt.refreshSecret,
      { expiresIn: config.jwt.refreshExpiresIn }
    );

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/api/auth'
    });

    res.json({
      user: {
        id: user.id,
        displayName: user.display_name,
        nickname: user.nickname,
        email: user.email,
        phone: user.phone,
        avatarUrl: user.avatar_url,
        publicKey: user.public_key,
        isAdmin: user.is_admin
      },
      accessToken
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('refreshToken', { path: '/api/auth' });
  res.json({ message: 'Logged out successfully' });
});

router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({ error: 'No refresh token' });
    }

    const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret);
    if (decoded.type !== 'refresh') {
      return res.status(401).json({ error: 'Invalid token type' });
    }

    const newAccessToken = jwt.sign(
      { 
        userId: decoded.userId,
        type: 'access',
        iat: Math.floor(Date.now() / 1000)
      },
      config.jwt.secret,
      { expiresIn: config.jwt.accessExpiresIn }
    );

    const newRefreshToken = jwt.sign(
      { 
        userId: decoded.userId, 
        type: 'refresh',
        iat: Math.floor(Date.now() / 1000)
      },
      config.jwt.refreshSecret,
      { expiresIn: config.jwt.refreshExpiresIn }
    );

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/api/auth'
    });

    res.json({ accessToken: newAccessToken });
  } catch (error) {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

router.get('/me', authenticate, async (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      displayName: req.user.display_name,
      nickname: req.user.nickname,
      email: req.user.email,
      phone: req.user.phone,
      avatarUrl: req.user.avatar_url,
      publicKey: req.user.public_key,
      isAdmin: req.user.is_admin
    }
  });
});

router.delete('/account', authenticate, async (req, res) => {
  try {
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    const user = await findUserByIdentifier(req.user.email);
    const isValid = await bcrypt.compare(password, user.password_hash);
    
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    await query('UPDATE users SET display_name = $1, email = $2, phone = NULL, nickname = NULL, avatar_url = NULL, is_blocked = TRUE WHERE id = $3',
      ['[Deleted]', `deleted_${req.user.id}@deleted.local`, req.user.id]
    );

    await query('DELETE FROM messages WHERE sender_id = $1 OR recipient_id = $1', [req.user.id]);
    await query('DELETE FROM friendships WHERE user_id = $1 OR friend_id = $1', [req.user.id]);

    res.clearCookie('refreshToken', { path: '/api/auth' });
    res.json({ message: 'Account deleted' });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

export default router;
