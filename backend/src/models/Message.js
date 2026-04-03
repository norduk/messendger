import { query } from '../db/postgres.js';

export const createMessage = async ({ senderId, recipientId, encryptedContent, contentType, fileUrl, fileName, fileSize, replyToId }) => {
  const result = await query(
    `INSERT INTO messages (sender_id, recipient_id, encrypted_content, content_type, file_url, file_name, file_size, reply_to_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [senderId, recipientId, encryptedContent, contentType || 'text', fileUrl, fileName, fileSize, replyToId]
  );
  return result.rows[0];
};

export const getMessages = async (userId, friendId, limit = 50, before) => {
  let queryStr = `
    SELECT m.*, 
           u1.display_name as sender_name, u1.avatar_url as sender_avatar,
           u2.display_name as recipient_name, u2.avatar_url as recipient_avatar,
           (SELECT json_agg(json_build_object(
             'emoji', r.emoji,
             'count', (SELECT COUNT(*) FROM message_reactions r2 WHERE r2.emoji = r.emoji AND r2.message_id = m.id),
             'users', (SELECT array_agg(u.display_name) FROM message_reactions r3 JOIN users u ON r3.user_id = u.id WHERE r3.emoji = r.emoji AND r3.message_id = m.id)
           )) FROM (SELECT DISTINCT emoji FROM message_reactions WHERE message_id = m.id) r) as reactions,
           rm.encrypted_content as reply_content,
           rm.content_type as reply_content_type,
           rm.file_url as reply_file_url,
           reply_user.display_name as reply_user_name
    FROM messages m
    JOIN users u1 ON m.sender_id = u1.id
    JOIN users u2 ON m.recipient_id = u2.id
    LEFT JOIN messages rm ON m.reply_to_id = rm.id
    LEFT JOIN users reply_user ON rm.sender_id = reply_user.id
    WHERE ((m.sender_id = $1 AND m.recipient_id = $2) OR (m.sender_id = $2 AND m.recipient_id = $1))
      AND m.is_deleted = FALSE
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

export const getPinnedMessages = async (userId, friendId) => {
  const result = await query(
    `SELECT m.*, u.display_name as pinned_by_name
     FROM messages m
     JOIN users u ON m.pinned_by = u.id
     WHERE m.recipient_id = $1 AND m.sender_id = $2 AND m.is_pinned = TRUE AND m.is_deleted = FALSE
     ORDER BY m.pinned_at DESC`,
    [userId, friendId]
  );
  return result.rows;
};

export const updateMessageContent = async (id, userId, encryptedContent) => {
  const result = await query(
    `UPDATE messages SET encrypted_content = $3, edited_at = NOW() 
     WHERE id = $1 AND sender_id = $2 AND is_deleted = FALSE
     RETURNING *`,
    [id, userId, encryptedContent]
  );
  return result.rows[0];
};

export const togglePinMessage = async (id, userId) => {
  const msg = await query('SELECT is_pinned FROM messages WHERE id = $1 AND (sender_id = $2 OR recipient_id = $2)', [id, userId]);
  if (!msg.rows[0]) return null;
  
  const newPinned = !msg.rows[0].is_pinned;
  const result = await query(
    `UPDATE messages SET is_pinned = $3, pinned_at = ${newPinned ? 'NOW()' : 'NULL'}, pinned_by = $2
     WHERE id = $1 RETURNING *`,
    [id, userId, newPinned]
  );
  return result.rows[0];
};

export const softDeleteMessage = async (id, userId) => {
  const result = await query(
    `UPDATE messages SET is_deleted = TRUE WHERE id = $1 AND sender_id = $2 RETURNING *`,
    [id, userId]
  );
  return result.rows[0];
};

export const addReaction = async (messageId, userId, emoji) => {
  const result = await query(
    `INSERT INTO message_reactions (message_id, user_id, emoji)
     VALUES ($1, $2, $3)
     ON CONFLICT (message_id, user_id, emoji) DO UPDATE SET emoji = EXCLUDED.emoji
     RETURNING *`,
    [messageId, userId, emoji]
  );
  return result.rows[0];
};

export const removeReaction = async (messageId, userId, emoji) => {
  await query(
    'DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3',
    [messageId, userId, emoji]
  );
};

export const getMessageReactions = async (messageId) => {
  const result = await query(
    `SELECT emoji, json_agg(json_build_object('id', user_id, 'name', display_name)) as users
     FROM message_reactions mr
     JOIN users u ON mr.user_id = u.id
     WHERE message_id = $1
     GROUP BY emoji`,
    [messageId]
  );
  return result.rows;
};

export const searchMessages = async (userId, query, limit = 50) => {
  const result = await query(
    `SELECT m.*, u.display_name as sender_name, u.avatar_url as sender_avatar
     FROM messages m
     JOIN users u ON m.sender_id = u.id
     WHERE (m.sender_id = $1 OR m.recipient_id = $1)
       AND m.is_deleted = FALSE
       AND m.encrypted_content ILIKE $2
     ORDER BY m.created_at DESC
     LIMIT $3`,
    [userId, `%${query}%`, limit]
  );
  return result.rows;
};

export const saveLinkPreview = async (messageId, url, title, description, imageUrl, siteName) => {
  const result = await query(
    `INSERT INTO message_link_previews (message_id, url, title, description, image_url, site_name)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (message_id) DO UPDATE SET url = EXCLUDED.url, title = EXCLUDED.title, 
       description = EXCLUDED.description, image_url = EXCLUDED.image_url, site_name = EXCLUDED.site_name
     RETURNING *`,
    [messageId, url, title, description, imageUrl, siteName]
  );
  return result.rows[0];
};

export const getLinkPreview = async (messageId) => {
  const result = await query('SELECT * FROM message_link_previews WHERE message_id = $1', [messageId]);
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
