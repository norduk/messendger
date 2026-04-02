import { query } from '../db/postgres.js';

export const findMessageById = async (id) => {
  const result = await query('SELECT * FROM messages WHERE id = $1', [id]);
  return result.rows[0];
};

export const createMessage = async ({ senderId, recipientId, encryptedContent, contentType, fileUrl, fileName, fileSize }) => {
  const result = await query(
    `INSERT INTO messages (sender_id, recipient_id, encrypted_content, content_type, file_url, file_name, file_size)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [senderId, recipientId, encryptedContent, contentType || 'text', fileUrl, fileName, fileSize]
  );
  return result.rows[0];
};

export const getMessages = async (userId, friendId, limit = 50, before) => {
  let queryStr = `
    SELECT m.*, 
           u1.display_name as sender_name, u1.avatar_url as sender_avatar,
           u2.display_name as recipient_name, u2.avatar_url as recipient_avatar
    FROM messages m
    JOIN users u1 ON m.sender_id = u1.id
    JOIN users u2 ON m.recipient_id = u2.id
    WHERE ((m.sender_id = $1 AND m.recipient_id = $2) OR (m.sender_id = $2 AND m.recipient_id = $1))
  `;
  const params = [userId, friendId];
  let paramIndex = 3;

  if (before) {
    queryStr += ` AND m.created_at < $${paramIndex}`;
    params.push(before);
    paramIndex++;
  }

  queryStr += ` ORDER BY m.created_at DESC LIMIT $${paramIndex}`;
  params.push(limit);

  const result = await query(queryStr, params);
  return result.rows.reverse();
};

export const updateMessageStatus = async (id, status) => {
  const result = await query(
    'UPDATE messages SET status = $2 WHERE id = $1 RETURNING *',
    [id, status]
  );
  return result.rows[0];
};

export const markMessagesAsRead = async (userId, friendId) => {
  await query(
    `UPDATE messages SET status = 'read' 
     WHERE recipient_id = $1 AND sender_id = $2 AND status != 'read'`,
    [userId, friendId]
  );
};

export const deleteMessage = async (id, userId) => {
  const result = await query(
    `DELETE FROM messages WHERE id = $1 AND sender_id = $2 RETURNING *`,
    [id, userId]
  );
  return result.rows[0];
};

export const deleteMessages = async (ids, userId) => {
  const result = await query(
    `DELETE FROM messages WHERE id = ANY($1) AND sender_id = $2 RETURNING *`,
    [ids, userId]
  );
  return result.rows;
};

export const getUnreadCount = async (userId) => {
  const result = await query(
    'SELECT COUNT(*) as count FROM messages WHERE recipient_id = $1 AND status != \'read\'',
    [userId]
  );
  return parseInt(result.rows[0].count);
};

export const getMessageStats = async () => {
  const result = await query(`
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as last_24h,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as last_7d,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') as last_30d
    FROM messages
  `);
  return result.rows[0];
};

export const getRecentMessages = async (limit = 100) => {
  const result = await query(
    `SELECT m.*, 
            u1.email as sender_email, u1.display_name as sender_name,
            u2.email as recipient_email, u2.display_name as recipient_name
     FROM messages m
     JOIN users u1 ON m.sender_id = u1.id
     JOIN users u2 ON m.recipient_id = u2.id
     ORDER BY m.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
};
