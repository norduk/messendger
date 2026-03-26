import { body, param, query, validationResult } from 'express-validator';

export const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

export const registerValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('inviteCode').matches(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/).withMessage('Valid invite code required'),
  body('publicKey').optional().isString(),
  validate
];

export const loginValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password required'),
  validate
];

export const messageValidation = [
  body('encryptedContent').notEmpty().isString().withMessage('Encrypted content required'),
  body('contentType').optional().isIn(['text', 'image', 'video', 'file']),
  validate
];

export const inviteValidation = [
  body('count').optional().isInt({ min: 1, max: 100 }).withMessage('Count must be between 1 and 100'),
  validate
];
