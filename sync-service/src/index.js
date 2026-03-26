import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

import config from './config/index.js';
import redis from './db/redis.js';
import { encrypt, decrypt, hashPassword, verifyPassword } from './utils/encryption.js';

const app = express();

app.use(cors(config.cors));
app.use(express.json({ limit: '10mb' }));

const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token' });
  }
  
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    req.userId = decoded.userId;
    req.syncKey = decoded.syncKey;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

app.post('/api/sync/register', async (req, res) => {
  try {
    const { userId, password } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }
    
    const existing = await redis.get(`sync:${userId}`);
    if (existing) {
      const data = JSON.parse(existing);
      const token = jwt.sign(
        { userId, syncKey: data.syncKey },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn }
      );
      return res.json({ token, syncKey: data.syncKey });
    }
    
    const syncKey = uuidv4();
    const hashedPassword = password ? hashPassword(password) : null;
    
    await redis.set(`sync:${userId}`, JSON.stringify({
      password: hashedPassword,
      syncKey,
      createdAt: Date.now(),
      autoSync: true
    }));
    
    const token = jwt.sign(
      { userId, syncKey },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );
    
    res.json({ token, syncKey });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/sync/login', async (req, res) => {
  try {
    const { userId, password } = req.body;
    
    let stored = await redis.get(`sync:${userId}`);
    
    if (!stored) {
      const syncKey = uuidv4();
      const hashedPassword = password ? hashPassword(password) : null;
      
      await redis.set(`sync:${userId}`, JSON.stringify({
        password: hashedPassword,
        syncKey,
        createdAt: Date.now(),
        autoSync: true
      }));
      
      const token = jwt.sign(
        { userId, syncKey },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn }
      );
      
      return res.json({ token, syncKey });
    }
    
    const data = JSON.parse(stored);
    
    if (password && data.password && !verifyPassword(password, data.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { userId, syncKey: data.syncKey },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );
    
    res.json({ token, syncKey: data.syncKey });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/sync/messages', authenticate, async (req, res) => {
  try {
    const { messages } = req.body;
    
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array required' });
    }
    
    const encrypted = encrypt(messages, req.syncKey);
    
    await redis.set(
      `messages:${req.userId}`,
      JSON.stringify(encrypted),
      'EX',
      60 * 60 * 24 * 30
    );
    
    res.json({ success: true, count: messages.length });
  } catch (error) {
    console.error('Save messages error:', error);
    res.status(500).json({ error: 'Failed to save messages' });
  }
});

app.get('/api/sync/messages', authenticate, async (req, res) => {
  try {
    const stored = await redis.get(`messages:${req.userId}`);
    
    if (!stored) {
      return res.json({ messages: [] });
    }
    
    const encrypted = JSON.parse(stored);
    const messages = decrypt(encrypted, req.syncKey);
    
    res.json({ messages });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

app.post('/api/sync/sync', authenticate, async (req, res) => {
  try {
    const { messages, lastSync } = req.body;
    
    const stored = await redis.get(`messages:${req.userId}`);
    let serverMessages = [];
    
    if (stored) {
      const encrypted = JSON.parse(stored);
      serverMessages = decrypt(encrypted, req.syncKey);
    }
    
    const clientMessages = messages || [];
    
    const serverMap = new Map(serverMessages.map(m => [m.id, m]));
    const clientMap = new Map(clientMessages.map(m => [m.id, m]));
    
    const merged = [...serverMessages];
    
    for (const msg of clientMessages) {
      if (!serverMap.has(msg.id)) {
        merged.push(msg);
      }
    }
    
    merged.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    
    const encrypted = encrypt(merged, req.syncKey);
    await redis.set(
      `messages:${req.userId}`,
      JSON.stringify(encrypted),
      'EX',
      60 * 60 * 24 * 30
    );
    
    res.json({
      messages: merged,
      syncedAt: Date.now()
    });
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ error: 'Sync failed' });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = config.port;
app.listen(PORT, () => {
  console.log(`Sync service running on port ${PORT}`);
});
