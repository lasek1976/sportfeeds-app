import { getChannel, FIXED_QUEUE_NAME, LIVE_QUEUE_NAME } from '../config/rabbitmq.js';
import protobuf from 'protobufjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let DataFeedsDiffType = null;
let fixedMessageHandlers = [];
let liveMessageHandlers = [];

/**
 * Initialize ProtoBuf schema
 */
export async function initProtoBuf() {
  try {
    const protoPath = join(__dirname, '../../proto/sportfeeds.proto');
    const root = await protobuf.load(protoPath);
    DataFeedsDiffType = root.lookupType('sportfeeds.DataFeedsDiff');
    console.log('✓ ProtoBuf schema loaded for RabbitMQ');
  } catch (error) {
    console.error('✗ Failed to load ProtoBuf schema:', error.message);
    throw error;
  }
}

/**
 * Register a Fixed message handler callback
 * @param {Function} handler - Callback function (message, metadata) => void
 */
export function onFixedMessage(handler) {
  fixedMessageHandlers.push(handler);
}

/**
 * Register a Live message handler callback
 * @param {Function} handler - Callback function (message, metadata) => void
 */
export function onLiveMessage(handler) {
  liveMessageHandlers.push(handler);
}

/**
 * Start consuming messages from RabbitMQ (both Fixed and Live queues)
 */
export async function startConsumer() {
  if (!DataFeedsDiffType) {
    throw new Error('ProtoBuf schema not initialized. Call initProtoBuf() first.');
  }

  const channel = getChannel();

  console.log(`🎧 Starting RabbitMQ consumers:`);
  console.log(`  - Fixed queue: ${FIXED_QUEUE_NAME}`);
  console.log(`  - Live queue: ${LIVE_QUEUE_NAME}`);

  // Consume Fixed messages
  await channel.consume(FIXED_QUEUE_NAME, async (msg) => {
    if (msg) {
      await processMessage(msg, 'Fixed', fixedMessageHandlers, channel);
    }
  }, {
    noAck: false // Manual acknowledgment
  });

  // Consume Live messages
  await channel.consume(LIVE_QUEUE_NAME, async (msg) => {
    if (msg) {
      await processMessage(msg, 'Live', liveMessageHandlers, channel);
    }
  }, {
    noAck: false // Manual acknowledgment
  });

  console.log('✓ RabbitMQ consumers started');
}

/**
 * Process a single message from RabbitMQ
 * @param {Object} msg - RabbitMQ message
 * @param {string} feedsType - 'Fixed' or 'Live'
 * @param {Array} handlers - Array of handler functions
 * @param {Object} channel - RabbitMQ channel
 */
async function processMessage(msg, feedsType, handlers, channel) {
  try {
    // Extract metadata from headers
    const metadata = {
      messageId: msg.properties.headers?.MessageId || 0,
      diffType: msg.properties.headers?.DiffType || '',
      format: msg.properties.headers?.Format || '',
      createdTime: msg.properties.headers?.CreatedTime || '',
      messageType: msg.properties.headers?.MessageType || '',
      feedsType: msg.properties.headers?.FeedsType || feedsType,
      contentType: msg.properties.contentType || ''
    };

    console.log(`📨 Received ${feedsType} message:`, {
      messageId: metadata.messageId,
      diffType: metadata.diffType,
      contentType: metadata.contentType,
      size: msg.content.length
    });

    // Deserialize ProtoBuf
    // NOTE: The bridge sends PURE ProtoBuf (no GZip, no type prefix)
    const dataFeedsDiff = deserializeProtoBuf(msg.content);

    console.log(`✓ Deserialized ${feedsType} message: ${dataFeedsDiff.Events?.length || 0} events`);

    // Notify all registered handlers
    for (const handler of handlers) {
      try {
        await handler(dataFeedsDiff, metadata);
      } catch (handlerError) {
        console.error(`✗ ${feedsType} message handler error:`, handlerError.message);
      }
    }

    // Acknowledge message
    channel.ack(msg);
  } catch (error) {
    console.error(`✗ Failed to process ${feedsType} RabbitMQ message:`, error.message);

    // Reject message and requeue (or send to DLX if configured)
    channel.nack(msg, false, false);
  }
}

/**
 * Deserialize pure ProtoBuf bytes (no GZip, no type metadata)
 * @param {Buffer} protoBytes - Pure ProtoBuf bytes from RabbitMQ
 * @returns {Object} Deserialized DataFeedsDiff object
 */
function deserializeProtoBuf(protoBytes) {
  try {
    // Direct ProtoBuf decode (no decompression needed)
    const message = DataFeedsDiffType.decode(protoBytes);

    // Convert to plain JavaScript object
    const plainObject = DataFeedsDiffType.toObject(message, {
      longs: Number,  // Convert Long to Number
      enums: Number,  // Convert enums to numeric values
      defaults: true, // Include default values
      arrays: true,   // Always create arrays for repeated fields
      objects: true   // Always create objects for message fields
    });

    return plainObject;
  } catch (error) {
    console.error('✗ ProtoBuf deserialization failed:', error.message);
    console.error('First 40 bytes (hex):', protoBytes.slice(0, 40).toString('hex'));
    throw new Error(`ProtoBuf deserialization error: ${error.message}`);
  }
}

/**
 * Deserialize raw Google.Protobuf binary bytes (application/octet-stream from bridge).
 * Produces the same plain-object format as messages arriving via RabbitMQ.
 *
 * @param {Buffer} buffer - Google.Protobuf binary from bridge /api/message/snapshot/{id}/proto
 * @returns {Object} Deserialized DataFeedsDiff object
 */
export function deserializeProtoBytes(buffer) {
  if (!DataFeedsDiffType) throw new Error('ProtoBuf schema not initialized. Call initProtoBuf() first.');
  return deserializeProtoBuf(buffer);
}

/**
 * Stop consuming messages
 */
export async function stopConsumer() {
  const channel = getChannel();
  // Note: channel.cancel() needs consumer tags which we don't track here
  // Connection close will handle cleanup
  console.log('✓ RabbitMQ consumers will be stopped on connection close');
}

export default {
  initProtoBuf,
  startConsumer,
  stopConsumer,
  onFixedMessage,
  onLiveMessage
};
