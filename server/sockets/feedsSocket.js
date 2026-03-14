import { onFixedMessage, onLiveMessage, deserializeProtoBytes } from '../services/rabbitMQService.js';
import { sendControlMessage } from '../config/rabbitmq.js';

// Maximum events per chunk to avoid "Invalid string length" error
const MAX_EVENTS_PER_CHUNK = 100;

/**
 * Split large messages into chunks to avoid Socket.io/V8 string length limits
 * @param {Object} dataFeedsDiff - The full DataFeedsDiff object
 * @param {Object} metadata - Message metadata
 * @param {string} feedsType - 'Fixed' or 'Live'
 * @returns {Array} Array of chunked messages
 */
function chunkMessage(dataFeedsDiff, metadata, feedsType) {
  const events = dataFeedsDiff.Events || [];

  // If small enough, return single chunk
  if (events.length <= MAX_EVENTS_PER_CHUNK) {
    return [{
      success: true,
      metadata: {
        ...metadata,
        feedsType,
        isChunked: false,
        totalEvents: events.length
      },
      data: dataFeedsDiff
    }];
  }

  // Split into chunks
  const chunks = [];
  const totalChunks = Math.ceil(events.length / MAX_EVENTS_PER_CHUNK);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * MAX_EVENTS_PER_CHUNK;
    const end = Math.min(start + MAX_EVENTS_PER_CHUNK, events.length);
    const chunkEvents = events.slice(start, end);

    chunks.push({
      success: true,
      metadata: {
        ...metadata,
        feedsType,
        isChunked: true,
        chunkIndex: i,
        totalChunks,
        chunkSize: chunkEvents.length,
        totalEvents: events.length
      },
      data: {
        ...dataFeedsDiff,
        Events: chunkEvents
      }
    });
  }

  return chunks;
}

/**
 * Initialize Socket.io event handlers
 *
 * @param {SocketIO.Server} io - Socket.io server instance
 */
export function initFeedsSocket(io) {
  // Register Fixed message handler
  onFixedMessage(async (dataFeedsDiff, metadata) => {
    const totalEvents = dataFeedsDiff.Events?.length || 0;
    console.log(`📢 Broadcasting Fixed message to ${io.sockets.sockets.size} clients (${totalEvents} events)`);

    try {
      const chunks = chunkMessage(dataFeedsDiff, metadata, 'Fixed');

      if (chunks.length > 1) {
        console.log(`  ↳ Split into ${chunks.length} chunks (${MAX_EVENTS_PER_CHUNK} events/chunk)`);
      }

      // Emit all chunks (with small delay for large messages to prevent overwhelming client)
      for (let i = 0; i < chunks.length; i++) {
        io.emit('feeds:fixed', chunks[i]);

        // Add 10ms delay between chunks for large messages (helps prevent socket timeout)
        if (chunks.length > 5 && i < chunks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      console.log(`✓ Broadcasted ${totalEvents} events in ${chunks.length} chunk(s)`);
    } catch (error) {
      console.error(`✗ Failed to broadcast Fixed message:`, error.message);
    }
  });

  // Register Live message handler
  onLiveMessage(async (dataFeedsDiff, metadata) => {
    const totalEvents = dataFeedsDiff.Events?.length || 0;
    console.log(`📢 Broadcasting Live message to ${io.sockets.sockets.size} clients (${totalEvents} events)`);

    try {
      const chunks = chunkMessage(dataFeedsDiff, metadata, 'Live');

      if (chunks.length > 1) {
        console.log(`  ↳ Split into ${chunks.length} chunks (${MAX_EVENTS_PER_CHUNK} events/chunk)`);
      }

      // Emit all chunks (with small delay for large messages to prevent overwhelming client)
      for (let i = 0; i < chunks.length; i++) {
        io.emit('feeds:live', chunks[i]);

        // Add 10ms delay between chunks for large messages (helps prevent socket timeout)
        if (chunks.length > 5 && i < chunks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      console.log(`✓ Broadcasted ${totalEvents} events in ${chunks.length} chunk(s)`);
    } catch (error) {
      console.error(`✗ Failed to broadcast Live message:`, error.message);
    }
  });

  io.on('connection', (socket) => {
    console.log(`✓ Client connected: ${socket.id}`);

    // Handle request for latest Full message
    // Sends control message to .NET bridge to re-send Full messages
    socket.on('request:full', async () => {
      try {
        console.log(`📨 Client ${socket.id} requested Full - triggering bridge`);

        // Send control message to .NET bridge
        await sendControlMessage('send-full');

        console.log(`✓ Control message sent - Full messages will arrive shortly`);
      } catch (error) {
        console.error(`✗ Error sending control message:`, error.message);
        socket.emit('error', {
          message: `Failed to request Full messages: ${error.message}`,
          type: 'full'
        });
      }
    });

    // Handle request for specific Snapshot message
    // Proxies to the .NET bridge for deserialization (same fix as Admin panel).
    socket.on('request:snapshot', async (payload) => {
      try {
        const { id, feedsType = 'Fixed' } = payload;
        if (!id || isNaN(parseInt(id, 10))) {
          throw new Error('Invalid snapshot ID');
        }

        const bridgeUrl = process.env.BRIDGE_URL || 'http://localhost:5100';
        console.log(`📨 Client ${socket.id} requested Snapshot ${id} (${feedsType}) via bridge`);

        const upstream = await fetch(`${bridgeUrl}/api/message/snapshot/${id}/proto`);
        if (!upstream.ok) {
          throw new Error(`Bridge error ${upstream.status}: ${await upstream.text()}`);
        }

        const arrayBuffer = await upstream.arrayBuffer();
        const dataFeedsDiff = deserializeProtoBytes(Buffer.from(arrayBuffer));
        console.log(`✓ Bridge deserialized Snapshot ${id}: ${dataFeedsDiff.Events?.length || 0} events`);

        const metadata = { messageId: id, diffType: 'snapshot', feedsType };
        const eventName = feedsType === 'Live' ? 'feeds:live' : 'feeds:fixed';
        const chunks = chunkMessage(dataFeedsDiff, metadata, feedsType);

        for (let i = 0; i < chunks.length; i++) {
          socket.emit(eventName, chunks[i]);
          if (chunks.length > 5 && i < chunks.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }

        console.log(`✓ Sent Snapshot ${id} to ${socket.id} as ${eventName} (${chunks.length} chunk(s))`);
      } catch (error) {
        console.error(`✗ Error sending Snapshot to ${socket.id}:`, error.message);
        socket.emit('error', {
          message: error.message,
          type: 'snapshot'
        });
      }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log(`✗ Client disconnected: ${socket.id}`);
    });
  });

  console.log('✓ Socket.io handlers initialized');
}

export default initFeedsSocket;
