import { query } from '../db/postgres.js';

export const createFriendship = async ({ userId, friendId }) => {
  const result = await query(
    `INSERT INTO friendships (user_id, friend_id, status)
     VALUES ($1, $2, 'pending')
     RETURNING *`,
    [userId, friendId]
  );
  return result.rows[0];
};

export const findFriendship = async (userId, friendId) => {
  const result = await query(
    'SELECT * FROM friendships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)',
    [userId, friendId]
  );
  return result.rows[0];
};

export const updateFriendshipStatus = async (id, status) => {
  const result = await query(
    `UPDATE friendships SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, status]
  );
  return result.rows[0];
};

export const deleteFriendship = async (userId, friendId) => {
  await query(
    'DELETE FROM friendships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)',
    [userId, friendId]
  );
};

export const getFriends = async (userId) => {
  const result = await query(
    `SELECT u.id, u.email, u.display_name, u.avatar_url, u.last_seen, f.status, f.created_at as friend_since
     FROM friendships f
     JOIN users u ON (f.friend_id = u.id OR f.user_id = u.id) AND u.id != $1
     WHERE (f.user_id = $1 OR f.friend_id = $1) AND f.status = 'accepted'
     ORDER BY u.display_name`,
    [userId]
  );
  return result.rows;
};

export const getPendingRequests = async (userId) => {
  const result = await query(
    `SELECT f.id, u.id as user_id, u.email, u.display_name, u.avatar_url, f.created_at
     FROM friendships f
     JOIN users u ON f.user_id = u.id
     WHERE f.friend_id = $1 AND f.status = 'pending'
     ORDER BY f.created_at DESC`,
    [userId]
  );
  return result.rows;
};

export const getSentRequests = async (userId) => {
  const result = await query(
    `SELECT f.id, u.id as user_id, u.email, u.display_name, u.avatar_url, f.created_at
     FROM friendships f
     JOIN users u ON f.friend_id = u.id
     WHERE f.user_id = $1 AND f.status = 'pending'
     ORDER BY f.created_at DESC`,
    [userId]
  );
  return result.rows;
};
