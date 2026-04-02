import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { 
  createMessage, 
  getMessages, 
  findMessageById,
  updateMessageStatus,
  markMessagesAsRead,
  deleteMessage,
  deleteMessages
} from '../models/Message.js';
import fs from 'fs';
import path from 'path';
import config from '../config/index.js';
import { messageValidation } from '../middleware/validation.js';
import { findFriendship } from '../models/Friendship.js';
import { markAsDelivered } from '../services/websocket.js';

const router = express.Router();

function deleteFileFromDisk(fileUrl) {
  if (!fileUrl) return;
  try {
    const fileId = fileUrl.split('/').pop();
    const filePath = path.join(config.upload.dir, `${fileId}.enc`);
    const metaPath = path.join(config.upload.dir, `${fileId}.meta`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
  } catch (e) {
    console.error('Error deleting file:', e);
  }
}

router.get('/:friendId', authenticate, async (req, res) => {
  try {
    const { friendId } = req.params;
    const { limit = 50, before } = req.query;
    
    const safeLimit = Math.min(Math.max(parseInt(limit) || 50, 1), 100);

    const friendship = await findFriendship(req.user.id, friendId);
    if (!friendship || friendship.status !== 'accepted') {
      return res.status(403).json({ error: 'Not a friend' });
    }

    const messages = await getMessages(req.user.id, friendId, safeLimit, before);
    
    await markMessagesAsRead(req.user.id, friendId);

    res.json({ messages: messages.map(m => ({
      id: m.id,
      senderId: m.sender_id,
      recipientId: m.recipient_id,
      encryptedContent: m.encrypted_content,
      contentType: m.content_type,
      fileUrl: m.file_url,
      fileName: m.file_name,
      fileSize: m.file_size,
      status: m.status,
      createdAt: m.created_at
    }))});
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

router.post('/:friendId', authenticate, messageValidation, async (req, res) => {
  try {
    const { friendId } = req.params;
    const { encryptedContent, contentType, fileUrl, fileName, fileSize } = req.body;

    const friendship = await findFriendship(req.user.id, friendId);
    if (!friendship || friendship.status !== 'accepted') {
      return res.status(403).json({ error: 'Not a friend' });
    }

    const message = await createMessage({
      senderId: req.user.id,
      recipientId: friendId,
      encryptedContent,
      contentType: contentType || 'text',
      fileUrl,
      fileName,
      fileSize
    });

    markAsDelivered(message);

    res.status(201).json({
      message: {
        id: message.id,
        senderId: message.sender_id,
        recipientId: message.recipient_id,
        encryptedContent: message.encrypted_content,
        contentType: message.content_type,
        fileUrl: message.file_url,
        fileName: message.file_name,
        fileSize: message.file_size,
        status: message.status,
        createdAt: message.created_at
      }
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

router.put('/:id/read', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const message = await findMessageById(id);
    
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (message.recipient_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const updated = await updateMessageStatus(id, 'read');
    res.json({ message: updated });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await deleteMessage(id, req.user.id);
    
    if (!deleted) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (deleted.file_url) {
      deleteFileFromDisk(deleted.file_url);
    }

    res.json({ message: 'Message deleted' });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

router.post('/bulk-delete', authenticate, async (req, res) => {
  try {
    const { messageIds } = req.body;
    
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({ error: 'Invalid message IDs' });
    }

    const deletedMessages = await deleteMessages(messageIds, req.user.id);
    
    for (const msg of deletedMessages) {
      if (msg.file_url) {
        deleteFileFromDisk(msg.file_url);
      }
    }

    res.json({ message: `${deletedMessages.length} messages deleted`, deleted: deletedMessages.length });
  } catch (error) {
    console.error('Bulk delete error:', error);
    res.status(500).json({ error: 'Failed to delete messages' });
  }
});

export default router;
