import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import { findUserById } from '../models/User.js';
import { createMessage, updateMessageStatus } from '../models/Message.js';
import { findFriendship } from '../models/Friendship.js';
import { setOnlineStatus, removeOnlineStatus, isUserOnline } from '../db/redis.js';

let io;
const userSockets = new Map();

export const initWebSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: config.cors.origin,
      credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = jwt.verify(token, config.jwt.secret);
      const user = await findUserById(decoded.userId);
      
      if (!user || user.is_blocked) {
        return next(new Error('Invalid user'));
      }

      socket.userId = user.id;
      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', async (socket) => {
    console.log(`User connected: ${socket.userId}`);
    
    userSockets.set(socket.userId, socket.id);
    await setOnlineStatus(socket.userId, socket.id);

    socket.join(`user:${socket.userId}`);

    socket.emit('connected', { userId: socket.userId });

    socket.on('message', async (data) => {
      try {
        const { recipientId, encryptedContent, contentType, tempId, fileUrl, fileName, fileSize } = data;

        const friendship = await findFriendship(socket.userId, recipientId);
        if (!friendship || friendship.status !== 'accepted') {
          socket.emit('error', { message: 'Not friends with this user', tempId });
          return;
        }

        const message = await createMessage({
          senderId: socket.userId,
          recipientId,
          encryptedContent,
          contentType: contentType || 'text',
          fileUrl,
          fileName,
          fileSize
        });

        const recipientOnline = await isUserOnline(recipientId);
        const status = recipientOnline ? 'delivered' : 'sent';

        if (recipientOnline) {
          io.to(`user:${recipientId}`).emit('message', {
            id: message.id,
            senderId: socket.userId,
            encryptedContent,
            contentType: contentType || 'text',
            fileUrl,
            fileName,
            fileSize,
            status: 'delivered',
            tempId
          });
        }

        socket.emit('message_sent', {
          id: message.id,
          recipientId,
          status,
          tempId
        });

      } catch (error) {
        console.error('Message error:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    socket.on('typing', async (data) => {
      try {
        const { recipientId } = data;
        const friendship = await findFriendship(socket.userId, recipientId);
        if (friendship && friendship.status === 'accepted') {
          io.to(`user:${recipientId}`).emit('typing', {
            userId: socket.userId
          });
        }
      } catch (error) {
        console.error('Typing error:', error);
      }
    });

    socket.on('read', async (data) => {
      try {
        const { messageId, senderId } = data;
        
        await updateMessageStatus(messageId, 'read');

        io.to(`user:${senderId}`).emit('message_status', {
          messageId,
          status: 'read'
        });
      } catch (error) {
        console.error('Read error:', error);
      }
    });

    socket.on('mark_delivered', async (data) => {
      try {
        const { messageId, senderId } = data;
        
        await updateMessageStatus(messageId, 'delivered');

        if (senderId) {
          io.to(`user:${senderId}`).emit('message_status', {
            messageId,
            status: 'delivered'
          });
        }
      } catch (error) {
        console.error('Mark delivered error:', error);
      }
    });

    socket.on('disconnect', async () => {
      console.log(`User disconnected: ${socket.userId}`);
      
      userSockets.delete(socket.userId);
      await removeOnlineStatus(socket.userId);

      socket.broadcast.emit('user_offline', { userId: socket.userId });
    });

    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
  });

  return io;
};

export const markAsDelivered = async (message) => {
  if (io && message.recipient_id) {
    const recipientSocket = userSockets.get(message.recipient_id);
    if (recipientSocket) {
      io.to(`user:${message.recipient_id}`).emit('message', {
        id: message.id,
        senderId: message.sender_id,
        encryptedContent: message.encrypted_content,
        contentType: message.content_type,
        fileUrl: message.file_url,
        fileName: message.file_name,
        fileSize: message.file_size,
        status: 'delivered'
      });
    }
  }
};

export const getIO = () => io;
