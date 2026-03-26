import express from 'express';
import multer from 'multer';
import archiver from 'archiver';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3003;
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/uploads';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-key-change-in-production-32';

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024
  }
});

app.use(express.json());

function encrypt(buffer, key) {
  const algorithm = 'aes-256-gcm';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, Buffer.from(key.padEnd(32).slice(0, 32)), iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

function decrypt(buffer, key) {
  const algorithm = 'aes-256-gcm';
  const iv = buffer.subarray(0, 16);
  const authTag = buffer.subarray(16, 32);
  const encrypted = buffer.subarray(32);
  const decipher = crypto.createDecipheriv(algorithm, Buffer.from(key.padEnd(32).slice(0, 32)), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileId = uuidv4();
    const ext = path.extname(req.file.originalname).toLowerCase();
    let mimeType = req.file.mimetype;

    let processedBuffer = req.file.buffer;
    let compressionType = 'none';

    if (mimeType.startsWith('image/')) {
      if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
        try {
          processedBuffer = await sharp(req.file.buffer)
            .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80, progressive: true })
            .toBuffer();
          mimeType = 'image/jpeg';
          compressionType = 'compressed';
        } catch (e) {
          console.log('Sharp processing failed, using original');
        }
      }
    }

    const encryptedBuffer = encrypt(processedBuffer, ENCRYPTION_KEY);
    const filePath = path.join(UPLOAD_DIR, `${fileId}.enc`);
    fs.writeFileSync(filePath, encryptedBuffer);

    const metadata = {
      id: fileId,
      originalName: req.file.originalname,
      mimeType,
      size: processedBuffer.length,
      originalSize: req.file.size,
      compressionType,
      encrypted: true,
      ext,
      createdAt: new Date().toISOString()
    };

    const metaPath = path.join(UPLOAD_DIR, `${fileId}.meta`);
    fs.writeFileSync(metaPath, JSON.stringify(metadata));

    res.json({
      file: {
        id: fileId,
        originalName: req.file.originalname,
        mimeType: mimeType,
        url: `/files/${fileId}`,
        size: processedBuffer.length,
        originalSize: req.file.size,
        compression: compressionType,
        encrypted: true
      }
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.get('/files/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const metaPath = path.join(UPLOAD_DIR, `${id}.meta`);
    const filePath = path.join(UPLOAD_DIR, `${id}.enc`);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    let metadata = { originalName: 'file', mimeType: 'application/octet-stream' };

    if (fs.existsSync(metaPath)) {
      metadata = JSON.parse(fs.readFileSync(metaPath));
    }

    const encryptedBuffer = fs.readFileSync(filePath);
    const decryptedBuffer = decrypt(encryptedBuffer, ENCRYPTION_KEY);

    res.set({
      'Content-Type': metadata.mimeType,
      'Content-Disposition': `inline; filename="${metadata.originalName}"`,
      'X-Encryption': 'AES-256-GCM',
      'X-Compression': metadata.compressionType
    });

    res.send(decryptedBuffer);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Download failed' });
  }
});

app.get('/files/:id/info', async (req, res) => {
  try {
    const { id } = req.params;
    const metaPath = path.join(UPLOAD_DIR, `${id}.meta`);

    if (!fs.existsSync(metaPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const metadata = JSON.parse(fs.readFileSync(metaPath));
    res.json(metadata);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get file info' });
  }
});

app.delete('/files/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const filePath = path.join(UPLOAD_DIR, `${id}.enc`);
    const metaPath = path.join(UPLOAD_DIR, `${id}.meta`);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    if (fs.existsSync(metaPath)) {
      fs.unlinkSync(metaPath);
    }

    res.json({ message: 'File deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

app.post('/files/batch-download', async (req, res) => {
  try {
    const { fileIds } = req.body;

    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: 'fileIds array required' });
    }

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="files.zip"'
    });

    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.on('error', (err) => {
      throw err;
    });

    archive.pipe(res);

    for (const fileId of fileIds) {
      const filePath = path.join(UPLOAD_DIR, `${fileId}.enc`);
      const metaPath = path.join(UPLOAD_DIR, `${fileId}.meta`);

      if (fs.existsSync(filePath)) {
        let originalName = `${fileId}.bin`;

        if (fs.existsSync(metaPath)) {
          const metadata = JSON.parse(fs.readFileSync(metaPath));
          originalName = metadata.originalName || originalName;
        }

        const encryptedBuffer = fs.readFileSync(filePath);
        const decryptedBuffer = decrypt(encryptedBuffer, ENCRYPTION_KEY);
        archive.append(decryptedBuffer, { name: originalName });
      }
    }

    archive.finalize();
  } catch (error) {
    console.error('Batch download error:', error);
    res.status(500).json({ error: 'Batch download failed' });
  }
});

app.get('/health', (req, res) => {
  const stats = {
    uptime: process.uptime(),
    files: fs.readdirSync(UPLOAD_DIR).filter(f => f.endsWith('.enc')).length,
    storageUsed: fs.readdirSync(UPLOAD_DIR)
      .filter(f => f.endsWith('.enc'))
      .reduce((acc, f) => acc + fs.statSync(path.join(UPLOAD_DIR, f)).size, 0)
  };

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    ...stats
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`File service running on port ${PORT}`);
  console.log(`Upload directory: ${UPLOAD_DIR}`);
});