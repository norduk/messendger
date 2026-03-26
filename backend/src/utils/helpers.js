export const generateId = () => {
  return crypto.randomUUID();
};

export const formatDate = (date) => {
  return new Date(date).toISOString();
};

export const sanitize = (str) => {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '');
};

export const isValidEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};

export const paginate = (page = 1, limit = 20) => {
  const offset = (page - 1) * limit;
  return { limit: Math.min(limit, 100), offset };
};
