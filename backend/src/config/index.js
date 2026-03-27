import dotenv from 'dotenv';
dotenv.config();

const required = (name, fallback) => {
  const value = process.env[name];
  if (!value && fallback === undefined) {
    console.error(`Missing required environment variable: ${name}`);
  }
  return value || fallback;
};

export default {
  port: parseInt(process.env.PORT) || 3000,
  httpsPort: parseInt(process.env.HTTPS_PORT) || 3443,
  nodeEnv: process.env.NODE_ENV || 'production',
  
  serverUrl: process.env.SERVER_URL || 'http://localhost',
  
  database: {
    url: required('DATABASE_URL', 'postgresql://messenger:password@localhost:5432/messenger')
  },
  
  redis: {
    url: required('REDIS_URL', 'redis://localhost:6379')
  },
  
  jwt: {
    secret: required('JWT_SECRET', 'dev-secret-must-be-changed'),
    refreshSecret: required('JWT_REFRESH_SECRET', 'dev-refresh-secret-must-be-changed'),
    accessExpiresIn: '24h',
    refreshExpiresIn: '30d'
  },
  
  admin: {
    apiKey: required('ADMIN_API_KEY', 'default-api-key-must-be-changed')
  },
  
  file: {
    encryptionKey: required('FILE_ENCRYPTION_KEY', 'default-encryption-key-32ch!')
  },
  
  upload: {
    dir: process.env.UPLOAD_DIR || './uploads',
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 104857600,
    maxImageSize: 10485760,
    allowedImageTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    allowedVideoTypes: ['video/mp4', 'video/webm'],
    allowedFileTypes: ['application/pdf', 'application/zip', 'text/plain', 'application/json']
  },
  
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true
  },
  
  sync: {
    url: process.env.SYNC_URL || 'http://localhost:3002'
  }
};
