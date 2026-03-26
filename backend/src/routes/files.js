import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import config from '../config/index.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

const ENCRYPTION_KEY = process.env.FILE_ENCRYPTION_KEY || 'file-encryption-key-32chars!';

function encrypt(buffer) {
  const algorithm = 'aes-256-gcm';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32)), iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

function decrypt(buffer) {
  const algorithm = 'aes-256-gcm';
  const iv = buffer.subarray(0, 16);
  const authTag = buffer.subarray(16, 32);
  const encrypted = buffer.subarray(32);
  const decipher = crypto.createDecipheriv(algorithm, Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32)), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: config.upload.maxFileSize
  }
});

router.post('/upload', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileId = uuidv4();
    const ext = path.extname(req.file.originalname).toLowerCase();
    const encryptedBuffer = encrypt(req.file.buffer);

    const filePath = path.join(config.upload.dir, `${fileId}.enc`);
    fs.writeFileSync(filePath, encryptedBuffer);

    const metadata = {
      id: fileId,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      ext
    };
    const metaPath = path.join(config.upload.dir, `${fileId}.meta`);
    fs.writeFileSync(metaPath, JSON.stringify(metadata));

    const fileUrl = `/files/${fileId}`;
    const contentType = req.body.contentType || 'file';

    res.json({
      file: {
        url: fileUrl,
        filename: `${fileId}${ext}`,
        originalName: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        contentType,
        encrypted: true
      }
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

router.get('/:id', (req, res) => {
  const { id } = req.params;
  const filePath = path.join(config.upload.dir, `${id}.enc`);
  const metaPath = path.join(config.upload.dir, `${id}.meta`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  let metadata = { originalName: 'file', mimeType: 'application/octet-stream' };
  if (fs.existsSync(metaPath)) {
    metadata = JSON.parse(fs.readFileSync(metaPath));
  }

  const encryptedBuffer = fs.readFileSync(filePath);
  const decryptedBuffer = decrypt(encryptedBuffer);

  res.set({
    'Content-Type': metadata.mimeType,
    'Content-Disposition': `inline; filename="${metadata.originalName}"`,
    'X-Encryption': 'AES-256-GCM'
  });

  res.send(decryptedBuffer);
});

router.delete('/:id', authenticate, (req, res) => {
  const { id } = req.params;
  const filePath = path.join(config.upload.dir, `${id}.enc`);
  const metaPath = path.join(config.upload.dir, `${id}.meta`);

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    if (fs.existsSync(metaPath)) {
      fs.unlinkSync(metaPath);
    }
    res.json({ message: 'File deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

export default router;
