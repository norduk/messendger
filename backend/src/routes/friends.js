import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { 
  getFriends, 
  getPendingRequests, 
  getSentRequests,
  createFriendship, 
  findFriendship,
  updateFriendshipStatus,
  deleteFriendship 
} from '../models/Friendship.js';
import { findUserById, findUserByIdentifier } from '../models/User.js';

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const friends = await getFriends(req.user.id);
    res.json({ friends });
  } catch (error) {
    console.error('Get friends error:', error);
    res.status(500).json({ error: 'Failed to get friends' });
  }
});

router.get('/requests', authenticate, async (req, res) => {
  try {
    const [incoming, outgoing] = await Promise.all([
      getPendingRequests(req.user.id),
      getSentRequests(req.user.id)
    ]);
    res.json({ incoming, outgoing });
  } catch (error) {
    console.error('Get requests error:', error);
    res.status(500).json({ error: 'Failed to get requests' });
  }
});

router.post('/request', authenticate, async (req, res) => {
  try {
    const { identifier } = req.body;
    
    if (!identifier) {
      return res.status(400).json({ error: 'ID, Email, or Name required' });
    }

    const friend = await findUserByIdentifier(identifier);
    if (!friend) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (friend.id === req.user.id) {
      return res.status(400).json({ error: 'Cannot add yourself' });
    }

    const existing = await findFriendship(req.user.id, friend.id);
    if (existing) {
      if (existing.status === 'accepted') {
        return res.status(400).json({ error: 'Already friends' });
      }
      if (existing.status === 'pending') {
        if (existing.user_id === req.user.id) {
          return res.status(400).json({ error: 'Request already sent' });
        }
        const updated = await updateFriendshipStatus(existing.id, 'accepted');
        return res.json({ friendship: updated, message: 'Request accepted' });
      }
    }

    const friendship = await createFriendship({ userId: req.user.id, friendId: friend.id });
    res.status(201).json({ 
      friendship,
      foundUser: {
        id: friend.id,
        email: friend.email,
        displayName: friend.display_name
      }
    });
  } catch (error) {
    console.error('Create friend request error:', error);
    res.status(500).json({ error: 'Failed to send request' });
  }
});

router.put('/request/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body;

    if (!['accept', 'decline'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    const { findFriendship } = await import('../models/Friendship.js');
    const friendship = await findFriendship(req.user.id, id);
    
    if (!friendship) {
      return res.status(404).json({ error: 'Request not found' });
    }

    if (friendship.friend_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (friendship.status !== 'pending') {
      return res.status(400).json({ error: 'Request already processed' });
    }

    const newStatus = action === 'accept' ? 'accepted' : 'declined';
    const updated = await updateFriendshipStatus(friendship.id, newStatus);
    
    res.json({ friendship: updated });
  } catch (error) {
    console.error('Update friend request error:', error);
    res.status(500).json({ error: 'Failed to update request' });
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    await deleteFriendship(req.user.id, id);
    res.json({ message: 'Friend removed' });
  } catch (error) {
    console.error('Delete friend error:', error);
    res.status(500).json({ error: 'Failed to remove friend' });
  }
});

export default router;
