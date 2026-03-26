export const requireAdmin = (req, res, next) => {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

export const verifyAdminApiKey = (req, res, next) => {
  const apiKey = req.headers['x-admin-api-key'];
  if (!apiKey || apiKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Invalid admin API key' });
  }
  next();
};
