import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import https from 'https';
import http from 'http';
import { fileURLToPath } from 'url';

import config from './config/index.js';
import { initWebSocket } from './services/websocket.js';
import logger from './utils/logger.js';

import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import friendsRoutes from './routes/friends.js';
import messagesRoutes from './routes/messages.js';
import filesRoutes from './routes/files.js';
import adminRoutes from './routes/admin.js';
import adminAuthRoutes from './routes/adminAuth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'", "https://192.168.1.36:*", "http://192.168.1.36:*", "http://localhost:*", "https://localhost:*", "ws://192.168.1.36:*", "wss://192.168.1.36:*"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.socket.io", "https://192.168.1.36:*", "http://192.168.1.36:*", "http://localhost:*", "https://localhost:*"],
      scriptSrcAttr: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://192.168.1.36:*", "http://192.168.1.36:*", "http://localhost:*", "https://localhost:*"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", "https://cdn.socket.io", "wss://192.168.1.36:*", "ws://192.168.1.36:*", "https://192.168.1.36:*", "http://192.168.1.36:*", "http://localhost:*", "https://localhost:*"],
      imgSrc: ["'self'", "data:", "blob:", "https://192.168.1.36:*", "http://192.168.1.36:*", "http://localhost:*", "https://localhost:*"],
      formAction: ["'self'", "https://192.168.1.36:*", "http://192.168.1.36:*", "http://localhost:*", "https://localhost:*"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false
}));

app.use(cors(config.cors));

app.use(cookieParser());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { error: 'Too many requests, please try again later' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many authentication attempts' }
});

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { error: 'Too many requests' }
});

app.use('/api/', limiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/admin', adminLimiter);

app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use(express.static(path.join(__dirname, '../messenger-frontend')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/config', (req, res) => {
  res.json({
    serverUrl: config.serverUrl,
    corsOrigin: config.cors.origin
  });
});

app.use('/sync-api', (req, res) => {
  const syncHost = process.env.SYNC_URL || 'http://sync:3002';
  const urlParts = new URL(syncHost);
  const options = {
    hostname: urlParts.hostname,
    port: urlParts.port || 3002,
    path: req.originalUrl.replace('/sync-api', ''),
    method: req.method,
    headers: {
      ...req.headers,
      host: `${urlParts.hostname}:${urlParts.port || 3002}`
    }
  };
  
  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  
  proxyReq.on('error', (e) => {
    console.error('Sync proxy error:', e);
    res.status(502).json({ error: 'Sync service unavailable' });
  });
  
  req.pipe(proxyReq);
});

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/friends', friendsRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/files', filesRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin-auth', adminAuthRoutes);

app.use((err, req, res, next) => {
  logger.error(err);
  
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large' });
    }
    return res.status(400).json({ error: 'File upload error' });
  }
  
  res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, '../messenger-frontend/index.html'));
});

const sslOptions = {
  key: fs.readFileSync(path.join(__dirname, '../ssl/server.key')),
  cert: fs.readFileSync(path.join(__dirname, '../ssl/server.crt'))
};

const httpsPort = process.env.HTTPS_PORT || 3443;
const httpPort = process.env.HTTP_PORT || 3000;

const httpsServer = https.createServer(sslOptions, app).listen(httpsPort, () => {
  logger.info(`HTTPS Server running on port ${httpsPort}`);
});

const httpServer = http.createServer(app).listen(httpPort, () => {
  logger.info(`HTTP Server running on port ${httpPort}`);
});

initWebSocket(httpsServer);
initWebSocket(httpServer);

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

export default app;
