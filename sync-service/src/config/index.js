import dotenv from 'dotenv';
dotenv.config();

export default {
  port: process.env.SYNC_PORT || 3002,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  redis: {
    url: process.env.REDIS_URL || 'redis://redis:6379'
  },
  
  jwt: {
    secret: process.env.JWT_SECRET || 'sync-secret-key-change-in-production',
    expiresIn: '30d'
  },
  
  encryption: {
    keyDerivation: {
      iterations: 100000,
      keyLength: 32,
      digest: 'sha512'
    }
  },
  
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true
  }
};
