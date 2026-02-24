import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

let client = null;
let db = null;

export async function connectMongoDB() {
  try {
    client = new MongoClient(process.env.MONGO_URL, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000
    });

    await client.connect();
    db = client.db();  // database name comes from MONGO_URL connection string

    console.log(`✓ MongoDB connected: ${db.databaseName}`);

    // Verify collections exist
    const collections = await db.listCollections().toArray();
    console.log(`  Collections found: ${collections.map(c => c.name).join(', ')}`);

    return db;
  } catch (error) {
    console.error('✗ MongoDB connection failed:', error.message);
    throw error;
  }
}

export function getDB() {
  if (!db) {
    throw new Error('Database not initialized. Call connectMongoDB() first.');
  }
  return db;
}

export async function closeMongoDB() {
  if (client) {
    await client.close();
    console.log('✓ MongoDB connection closed');
  }
}

export default {
  connect: connectMongoDB,
  getDB,
  close: closeMongoDB
};
