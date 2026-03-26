import { query } from '../db/postgres.js';

export const createInvite = async ({ code, createdBy, expiresAt }) => {
  const result = await query(
    `INSERT INTO invites (code, created_by, expires_at)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [code, createdBy, expiresAt]
  );
  return result.rows[0];
};

export const findInviteByCode = async (code) => {
  const result = await query(
    'SELECT * FROM invites WHERE code = $1',
    [code]
  );
  return result.rows[0];
};

export const useInvite = async (code, userId) => {
  const result = await query(
    `UPDATE invites 
     SET is_used = TRUE, used_by = $2, used_at = NOW()
     WHERE code = $1 AND is_used = FALSE AND expires_at > NOW()
     RETURNING *`,
    [code, userId]
  );
  return result.rows[0];
};

export const getInvites = async (filters = {}) => {
  let queryStr = 'SELECT * FROM invites WHERE 1=1';
  const params = [];
  let paramIndex = 1;

  if (filters.isUsed !== undefined) {
    queryStr += ` AND is_used = $${paramIndex}`;
    params.push(filters.isUsed);
    paramIndex++;
  }

  queryStr += ' ORDER BY created_at DESC';

  if (filters.limit) {
    queryStr += ` LIMIT $${paramIndex}`;
    params.push(filters.limit);
  }

  const result = await query(queryStr, params);
  return result.rows;
};

export const deleteInvite = async (id) => {
  await query('DELETE FROM invites WHERE id = $1', [id]);
};

export const getInviteCount = async () => {
  const result = await query('SELECT COUNT(*) as count FROM invites');
  return parseInt(result.rows[0].count);
};

export const getActiveInviteCount = async () => {
  const result = await query('SELECT COUNT(*) as count FROM invites WHERE is_used = FALSE AND expires_at > NOW()');
  return parseInt(result.rows[0].count);
};
