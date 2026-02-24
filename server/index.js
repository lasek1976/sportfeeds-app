import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { connectMongoDB, closeMongoDB } from './config/mongodb.js';
import { connectRabbitMQ, closeRabbitMQ } from './config/rabbitmq.js';
import { initProtoBuf as initRabbitMQProtoBuf, startConsumer } from './services/rabbitMQService.js';
import { initProtoBuf as initDeserializerProtoBuf } from './services/deserializer.js';
import apiRouter from './routes/api.js';
import { initFeedsSocket } from './sockets/feedsSocket.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingTimeout: 60000,      // 60 seconds (default: 20s) - wait time for pong response
  pingInterval: 25000,     // 25 seconds (default: 25s) - interval between pings
  maxHttpBufferSize: 1e8,  // 100 MB (default: 1MB) - max message size
  transports: ['websocket', 'polling']  // Prefer websocket for large messages
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// API routes
app.use('/api', apiRouter);

// Serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Initialize application
async function init() {
  try {
    console.log('\n🚀 Starting Sports Calendar Application...\n');

    // 1. Connect to MongoDB (for browsing historical data)
    await connectMongoDB();

    // 2. Connect to RabbitMQ (for real-time messages)
    await connectRabbitMQ();

    // 3. Initialize ProtoBuf schemas
    await initDeserializerProtoBuf();  // For Full/Snapshot messages from MongoDB
    await initRabbitMQProtoBuf();      // For Fixed/Live messages from RabbitMQ

    // 4. Initialize Socket.io handlers
    initFeedsSocket(io);

    // 5. Start RabbitMQ consumer
    await startConsumer();

    // 6. Start HTTP server
    httpServer.listen(PORT, () => {
      console.log(`\n✓ Server running on http://localhost:${PORT}`);
      console.log(`✓ Socket.io ready for connections\n`);
    });
  } catch (error) {
    console.error('\n✗ Initialization failed:', error.message);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\n🛑 Shutting down gracefully...');
  await closeRabbitMQ();
  await closeMongoDB();
  httpServer.close(() => {
    console.log('✓ Server closed');
    process.exit(0);
  });
});

// Start application
init();
