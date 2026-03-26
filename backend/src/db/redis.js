import Redis from 'ioredis';
import config from '../config/index.js';

const redis = new Redis(config.redis.url);

redis.on('error', (err) => {
  console.error('Redis error:', err);
});

redis.on('connect', () => {
  console.log('Connected to Redis');
});

export const cacheGet = async (key) => {
  const data = await redis.get(key);
  return data ? JSON.parse(data) : null;
};

export const cacheSet = async (key, value, expiresIn = 3600) => {
  await redis.setex(key, expiresIn, JSON.stringify(value));
};

export const cacheDel = async (key) => {
  await redis.del(key);
};

export const setOnlineStatus = async (userId, socketId) => {
  await redis.setex(`online:${userId}`, 300, socketId);
  await redis.sadd('online_users', userId);
};

export const removeOnlineStatus = async (userId) => {
  await redis.del(`online:${userId}`);
  await redis.srem('online_users', userId);
};

export const isUserOnline = async (userId) => {
  return await redis.exists(`online:${userId}`);
};

export const getOnlineUsers = async () => {
  return await redis.smembers('online_users');
};

export const updateLastSeen = async (userId) => {
  await redis.setex(`last_seen:${userId}`, 3600, Date.now().toString());
};

export default redis;
