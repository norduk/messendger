import express from 'express';
import fetch from 'node-fetch';
import config from '../config/index.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

const mapGiphyToTenorFormat = (giphyData) => {
  if (!giphyData.data || !Array.isArray(giphyData.data)) {
    return { results: [] };
  }

  const results = giphyData.data.map(gif => ({
    id: gif.id,
    title: gif.title,
    media_formats: {
      tinygif: {
        url: gif.images?.fixed_width_small?.url || gif.images?.original?.url
      },
      gif: {
        url: gif.images?.original?.url
      },
      nanogif: {
        url: gif.images?.fixed_width_small?.url || gif.images?.original?.url
      }
    },
    content_description: gif.title
  }));

  return { results };
};

router.get('/search', authenticate, async (req, res) => {
  try {
    const { q, limit = 20 } = req.query;
    const query = q || 'funny';
    const giphyKey = config.giphy.apiKey;
    
    if (!giphyKey) {
      return res.status(503).json({ error: 'GIPHY API not configured' });
    }
    
    const parsedLimit = Math.min(Math.max(parseInt(limit) || 20, 1), 50);
    const response = await fetch(
      `https://api.giphy.com/v1/gifs/search?api_key=${giphyKey}&q=${encodeURIComponent(query)}&limit=${parsedLimit}&rating=g`
    );
    const data = await response.json();
    
    res.json(mapGiphyToTenorFormat(data));
  } catch (error) {
    console.error('GIPHY API error:', error);
    res.status(500).json({ error: 'Failed to fetch GIFs' });
  }
});

router.get('/trending', authenticate, async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const giphyKey = config.giphy.apiKey;
    
    if (!giphyKey) {
      return res.status(503).json({ error: 'GIPHY API not configured' });
    }
    
    const parsedLimit = Math.min(Math.max(parseInt(limit) || 20, 1), 50);
    const response = await fetch(
      `https://api.giphy.com/v1/gifs/trending?api_key=${giphyKey}&limit=${parsedLimit}&rating=g`
    );
    const data = await response.json();
    
    res.json(mapGiphyToTenorFormat(data));
  } catch (error) {
    console.error('GIPHY API error:', error);
    res.status(500).json({ error: 'Failed to fetch GIFs' });
  }
});

export default router;