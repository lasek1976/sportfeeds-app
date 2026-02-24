import express from 'express';
import {
  getLatestFull,
  getSnapshotById,
  getLatestFixedSnapshot,
  getLatestLiveSnapshot,
  browseFullMessages,
  browseSnapshots,
  browseFixedPointers,
  browseLivePointers,
  getStats
} from '../services/feedsService.js';

const router = express.Router();

/**
 * GET /api/feeds/full/latest
 * Get latest Full message from GridFS
 */
router.get('/feeds/full/latest', async (req, res) => {
  try {
    const result = await getLatestFull();
    res.json({
      success: true,
      metadata: result.metadata,
      data: result.data
    });
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/feeds/snapshot/:id
 * Get Snapshot message by ID
 */
router.get('/feeds/snapshot/:id', async (req, res) => {
  try {
    const messageId = parseInt(req.params.id, 10);
    if (isNaN(messageId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid message ID'
      });
    }

    const result = await getSnapshotById(messageId);
    res.json({
      success: true,
      metadata: result.metadata,
      data: result.data
    });
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/feeds/snapshot/fixed/latest
 * Get latest Fixed snapshot
 */
router.get('/feeds/snapshot/fixed/latest', async (req, res) => {
  try {
    const result = await getLatestFixedSnapshot();
    res.json({
      success: true,
      metadata: result.metadata,
      data: result.data
    });
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/feeds/snapshot/live/latest
 * Get latest Live snapshot
 */
router.get('/feeds/snapshot/live/latest', async (req, res) => {
  try {
    const result = await getLatestLiveSnapshot();
    res.json({
      success: true,
      metadata: result.metadata,
      data: result.data
    });
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// ==================== ADMIN ENDPOINTS ====================

/**
 * GET /api/admin/stats
 * Get database statistics
 */
router.get('/admin/stats', async (req, res) => {
  try {
    const stats = await getStats();
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/admin/browse/full
 * Browse Full messages from GridFS
 * Query params: ?limit=50&skip=0
 */
router.get('/admin/browse/full', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const skip = parseInt(req.query.skip, 10) || 0;

    const messages = await browseFullMessages(limit, skip);
    res.json({
      success: true,
      count: messages.length,
      limit,
      skip,
      messages
    });
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/admin/browse/snapshots
 * Browse Snapshot messages from FeedsMessages
 * Query params: ?limit=50&skip=0
 */
router.get('/admin/browse/snapshots', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const skip = parseInt(req.query.skip, 10) || 0;

    const snapshots = await browseSnapshots(limit, skip);
    res.json({
      success: true,
      count: snapshots.length,
      limit,
      skip,
      snapshots
    });
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/admin/browse/pointers/fixed
 * Browse Fixed snapshot pointers
 * Query params: ?limit=50&skip=0
 */
router.get('/admin/browse/pointers/fixed', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const skip = parseInt(req.query.skip, 10) || 0;

    const pointers = await browseFixedPointers(limit, skip);
    res.json({
      success: true,
      count: pointers.length,
      limit,
      skip,
      pointers
    });
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/admin/browse/pointers/live
 * Browse Live snapshot pointers
 * Query params: ?limit=50&skip=0
 */
router.get('/admin/browse/pointers/live', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const skip = parseInt(req.query.skip, 10) || 0;

    const pointers = await browseLivePointers(limit, skip);
    res.json({
      success: true,
      count: pointers.length,
      limit,
      skip,
      pointers
    });
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/admin/message/full/:id
 * Proxy to bridge: fetches GridFS Full message by ObjectId, returns JSON.
 * The bridge uses the same Phoenix → ProtobufConverter pipeline as RabbitMQ publishing.
 */
router.get('/admin/message/full/:id', async (req, res) => {
  const bridgeUrl = process.env.BRIDGE_URL || 'http://localhost:5100';
  try {
    const upstream = await fetch(`${bridgeUrl}/api/message/full/${req.params.id}`);
    if (!upstream.ok) {
      return res.status(upstream.status).json({ success: false, error: await upstream.text() });
    }
    res.setHeader('Content-Type', 'application/json');
    res.send(await upstream.text());
  } catch (error) {
    console.error('Bridge proxy error (full):', error);
    res.status(502).json({ success: false, error: `Bridge unavailable: ${error.message}` });
  }
});

/**
 * GET /api/admin/message/snapshot/:id
 * Proxy to bridge: fetches FeedsMessage snapshot by integer ID, returns JSON.
 * The bridge uses the same Phoenix → ProtobufConverter pipeline as RabbitMQ publishing.
 */
router.get('/admin/message/snapshot/:id', async (req, res) => {
  const bridgeUrl = process.env.BRIDGE_URL || 'http://localhost:5100';
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid message ID' });
  try {
    const upstream = await fetch(`${bridgeUrl}/api/message/snapshot/${id}`);
    if (!upstream.ok) {
      return res.status(upstream.status).json({ success: false, error: await upstream.text() });
    }
    res.setHeader('Content-Type', 'application/json');
    res.send(await upstream.text());
  } catch (error) {
    console.error('Bridge proxy error (snapshot):', error);
    res.status(502).json({ success: false, error: `Bridge unavailable: ${error.message}` });
  }
});

export default router;
