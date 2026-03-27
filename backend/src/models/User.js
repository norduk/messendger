import { query } from '../db/postgres.js';

export const createUser = async ({ passwordHash, publicKey, displayName }) => {
  const result = await query(
    `INSERT INTO users (password_hash, public_key, display_name)
     VALUES ($1, $2, $3)
     RETURNING id, public_key, display_name, avatar_url, is_blocked, is_admin, created_at`,
    [passwordHash, publicKey, displayName]
  );
  return result.rows[0];
};

export const findUserByName = async (name) => {
  const result = await query(
    'SELECT * FROM users WHERE display_name = $1',
    [name]
  );
  return result.rows[0];
};

export const findUserByDisplayName = async (displayName) => {
  const result = await query(
    'SELECT * FROM users WHERE display_name = $1',
    [displayName]
  );
  return result.rows[0];
};

export const findUserByEmail = async (email) => {
  const result = await query(
    'SELECT * FROM users WHERE email = $1',
    [email]
  );
  return result.rows[0];
};

export const findUserById = async (id) => {
  const result = await query(
    'SELECT id, public_key, display_name, avatar_url, is_blocked, is_admin, last_seen, created_at FROM users WHERE id = $1',
    [id]
  );
  return result.rows[0];
};

export const updateUser = async (id, { displayName, avatarUrl, publicKey, email, phone, nickname }) => {
  const result = await query(
    `UPDATE users 
     SET display_name = COALESCE($2, display_name),
         avatar_url = COALESCE($3, avatar_url),
         public_key = COALESCE($4, public_key),
         email = COALESCE($5, email),
         phone = COALESCE($6, phone),
         nickname = COALESCE($7, nickname),
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, email, phone, public_key, display_name, avatar_url, nickname`,
    [id, displayName, avatarUrl, publicKey, email, phone, nickname]
  );
  return result.rows[0];
};

export const updateLastSeen = async (id) => {
  await query('UPDATE users SET last_seen = NOW() WHERE id = $1', [id]);
};

export const blockUser = async (id, blocked = true) => {
  await query('UPDATE users SET is_blocked = $2, updated_at = NOW() WHERE id = $1', [id, blocked]);
};

export const setAdmin = async (id, isAdmin = true) => {
  await query('UPDATE users SET is_admin = $2, updated_at = NOW() WHERE id = $1', [id, isAdmin]);
};

export const searchUsers = async (queryString, limit = 20) => {
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(queryString);
  const cleanQuery = queryString.replace('@', '');
  
  let queryStr = `SELECT id, email, display_name, nickname, avatar_url, last_seen FROM users WHERE is_blocked = FALSE`;
  const params = [];
  let paramIndex = 1;

  if (isUUID) {
    queryStr += ` AND id = $${paramIndex}`;
    params.push(queryString);
    paramIndex++;
  } else {
    queryStr += ` AND (email ILIKE $${paramIndex} OR display_name ILIKE $${paramIndex} OR nickname ILIKE $${paramIndex} OR id::text LIKE $${paramIndex})`;
    params.push(`%${cleanQuery}%`);
    paramIndex++;
  }

  queryStr += ` LIMIT $${paramIndex}`;
  params.push(limit);

  const result = await query(queryStr, params);
  return result.rows;
};

export const findUserByIdentifier = async (identifier) => {
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
  const cleanIdentifier = identifier.startsWith('@') ? identifier.slice(1) : identifier;
  
  let queryStr = 'SELECT * FROM users WHERE';
  const params = [];

  if (isUUID) {
    queryStr += ' id = $1';
    params.push(identifier);
  } else if (identifier.includes('@') && identifier.includes('.')) {
    queryStr += ' email = $1';
    params.push(identifier.toLowerCase());
  } else if (identifier.startsWith('@')) {
    queryStr += ' nickname ILIKE $1';
    params.push(cleanIdentifier);
  } else {
    queryStr += ' (display_name ILIKE $1 OR nickname ILIKE $1)';
    params.push(`%${cleanIdentifier}%`);
  }

  const result = await query(queryStr, params);
  return result.rows[0];
};

export const getAllUsers = async (filters = {}) => {
  let queryStr = 'SELECT id, email, display_name, avatar_url, is_blocked, is_admin, last_seen, created_at FROM users WHERE 1=1';
  const params = [];
  let paramIndex = 1;

  if (filters.search) {
    queryStr += ` AND (email ILIKE $${paramIndex} OR display_name ILIKE $${paramIndex})`;
    params.push(`%${filters.search}%`);
    paramIndex++;
  }

  if (filters.isBlocked !== undefined) {
    queryStr += ` AND is_blocked = $${paramIndex}`;
    params.push(filters.isBlocked);
    paramIndex++;
  }

  queryStr += ' ORDER BY created_at DESC';
  
  if (filters.limit) {
    queryStr += ` LIMIT $${paramIndex}`;
    params.push(filters.limit);
    paramIndex++;
  }
  
  if (filters.offset) {
    queryStr += ` OFFSET $${paramIndex}`;
    params.push(filters.offset);
  }

  const result = await query(queryStr, params);
  return result.rows;
};

export const getUserCount = async () => {
  const result = await query('SELECT COUNT(*) as count FROM users');
  return parseInt(result.rows[0].count);
};

export const deleteUser = async (id) => {
  await query('DELETE FROM admin_logs WHERE admin_id = $1 OR target_user_id = $1', [id]);
  await query('DELETE FROM friendships WHERE user_id = $1 OR friend_id = $1', [id]);
  await query('DELETE FROM messages WHERE sender_id = $1 OR recipient_id = $1', [id]);
  await query('DELETE FROM users WHERE id = $1', [id]);
};

export const updateUserPassword = async (id, passwordHash) => {
  await query('UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1', [id, passwordHash]);
};

export const updateUserName = async (id, displayName) => {
  await query('UPDATE users SET display_name = $2, updated_at = NOW() WHERE id = $1', [id, displayName]);
};

export const getUserStorageStats = async (userId) => {
  const result = await query(`
    SELECT 
      (SELECT COUNT(*) FROM messages WHERE sender_id = $1 OR recipient_id = $1) as message_count,
      (SELECT COUNT(*) FROM friendships WHERE user_id = $1 OR friend_id = $1) as friendship_count
  `, [userId]);
  return result.rows[0];
};
