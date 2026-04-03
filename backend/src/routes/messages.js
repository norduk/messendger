import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { 
  createMessage, 
  getMessages, 
  updateMessageStatus,
  markMessagesAsRead,
  softDeleteMessage,
  deleteMessages,
  updateMessageContent,
  togglePinMessage,
  addReaction,
  removeReaction,
  getMessageReactions,
  searchMessages,
  getPinnedMessages,
  saveLinkPreview
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

    const friendship = await findFriendship(req.user.id, friendId);
    if (!friendship || friendship.status !== 'accepted') {
      return res.status(403).json({ error: 'Not a friend' });
    }

    const messages = await getMessages(req.user.id, friendId, parseInt(limit), before);
    
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
      replyToId: m.reply_to_id,
      replyContent: m.reply_content,
      replyContentType: m.reply_content_type,
      replyFileUrl: m.reply_file_url,
      replyUserName: m.reply_user_name,
      isPinned: m.is_pinned,
      pinnedAt: m.pinned_at,
      pinnedByName: m.pinned_by_name,
      editedAt: m.edited_at,
      isDeleted: m.is_deleted,
      reactions: m.reactions,
      status: m.status,
      createdAt: m.created_at
    }))});
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

router.get('/:friendId/pinned', authenticate, async (req, res) => {
  try {
    const { friendId } = req.params;
    const messages = await getPinnedMessages(req.user.id, friendId);
    res.json({ messages });
  } catch (error) {
    console.error('Get pinned messages error:', error);
    res.status(500).json({ error: 'Failed to get pinned messages' });
  }
});

router.get('/search', authenticate, async (req, res) => {
  try {
    const { q, limit = 50 } = req.query;
    if (!q) return res.status(400).json({ error: 'Search query required' });
    const messages = await searchMessages(req.user.id, q, parseInt(limit));
    res.json({ messages: messages.map(m => ({
      id: m.id,
      senderId: m.sender_id,
      senderName: m.sender_name,
      senderAvatar: m.sender_avatar,
      encryptedContent: m.encrypted_content,
      contentType: m.content_type,
      createdAt: m.created_at
    }))});
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Failed to search messages' });
  }
});

router.post('/:friendId', authenticate, messageValidation, async (req, res) => {
  try {
    const { friendId } = req.params;
    const { encryptedContent, contentType, fileUrl, fileName, fileSize, replyToId, linkPreview } = req.body;

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
      fileSize,
      replyToId
    });

    if (linkPreview) {
      await saveLinkPreview(message.id, linkPreview.url, linkPreview.title, linkPreview.description, linkPreview.imageUrl, linkPreview.siteName);
    }

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
        replyToId: message.reply_to_id,
        status: message.status,
        createdAt: message.created_at
      }
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

router.put('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { encryptedContent } = req.body;
    const message = await updateMessageContent(id, req.user.id, encryptedContent);
    if (!message) return res.status(404).json({ error: 'Message not found' });
    res.json({ message: { id: message.id, encryptedContent: message.encrypted_content, editedAt: message.edited_at } });
  } catch (error) {
    console.error('Edit message error:', error);
    res.status(500).json({ error: 'Failed to edit message' });
  }
});

router.put('/:id/pin', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const message = await togglePinMessage(id, req.user.id);
    if (!message) return res.status(404).json({ error: 'Message not found' });
    res.json({ message: { id: message.id, isPinned: message.is_pinned, pinnedAt: message.pinned_at } });
  } catch (error) {
    console.error('Pin message error:', error);
    res.status(500).json({ error: 'Failed to pin message' });
  }
});

router.post('/:id/reactions', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { emoji, action } = req.body;
    if (action === 'remove') {
      await removeReaction(id, req.user.id, emoji);
      res.json({ message: 'Reaction removed' });
    } else {
      const reaction = await addReaction(id, req.user.id, emoji);
      res.json({ reaction });
    }
  } catch (error) {
    console.error('Reaction error:', error);
    res.status(500).json({ error: 'Failed to react' });
  }
});

router.get('/:id/reactions', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const reactions = await getMessageReactions(id);
    res.json({ reactions });
  } catch (error) {
    console.error('Get reactions error:', error);
    res.status(500).json({ error: 'Failed to get reactions' });
  }
});

router.put('/:id/read', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const message = await updateMessageStatus(id, 'read');
    
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (message.recipient_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    res.json({ message });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await softDeleteMessage(id, req.user.id);
    
    if (!deleted) {
      return res.status(404).json({ error: 'Message not found' });
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
