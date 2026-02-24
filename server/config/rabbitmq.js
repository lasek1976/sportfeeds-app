import amqp from 'amqplib';

let connection = null;
let channel = null;

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';
const FIXED_QUEUE_NAME = 'sportfeeds.fixed';
const LIVE_QUEUE_NAME = 'sportfeeds.live';
const CONTROL_QUEUE_NAME = 'sportfeeds.control';

/**
 * Connect to RabbitMQ
 */
export async function connectRabbitMQ() {
  try {
    console.log(`📡 Connecting to RabbitMQ at ${RABBITMQ_URL}...`);

    connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();

    // Assert Fixed queue
    await channel.assertQueue(FIXED_QUEUE_NAME, {
      durable: true
    });

    // Assert Live queue
    await channel.assertQueue(LIVE_QUEUE_NAME, {
      durable: true
    });

    // Assert Control queue
    await channel.assertQueue(CONTROL_QUEUE_NAME, {
      durable: false
    });

    console.log(`✓ Connected to RabbitMQ`);
    console.log(`  - Fixed queue: ${FIXED_QUEUE_NAME}`);
    console.log(`  - Live queue: ${LIVE_QUEUE_NAME}`);
    console.log(`  - Control queue: ${CONTROL_QUEUE_NAME}`);

    // Handle connection errors
    connection.on('error', (err) => {
      console.error('❌ RabbitMQ connection error:', err.message);
    });

    connection.on('close', () => {
      console.warn('⚠️  RabbitMQ connection closed');
    });

  } catch (error) {
    console.error('❌ Failed to connect to RabbitMQ:', error.message);
    throw error;
  }
}

/**
 * Get RabbitMQ channel
 */
export function getChannel() {
  if (!channel) {
    throw new Error('RabbitMQ channel not initialized. Call connectRabbitMQ() first.');
  }
  return channel;
}

/**
 * Send control message to .NET bridge
 */
export async function sendControlMessage(message) {
  try {
    const channel = getChannel();
    await channel.sendToQueue(CONTROL_QUEUE_NAME, Buffer.from(message));
    console.log(`📤 Sent control message: ${message}`);
  } catch (error) {
    console.error('❌ Failed to send control message:', error.message);
    throw error;
  }
}

/**
 * Close RabbitMQ connection
 */
export async function closeRabbitMQ() {
  try {
    if (channel) {
      await channel.close();
    }
    if (connection) {
      await connection.close();
    }
    console.log('✓ RabbitMQ connection closed');
  } catch (error) {
    console.error('❌ Error closing RabbitMQ:', error.message);
  }
}

// Export queue names
export { FIXED_QUEUE_NAME, LIVE_QUEUE_NAME, CONTROL_QUEUE_NAME };

export default {
  connectRabbitMQ,
  getChannel,
  sendControlMessage,
  closeRabbitMQ,
  FIXED_QUEUE_NAME,
  LIVE_QUEUE_NAME,
  CONTROL_QUEUE_NAME
};
