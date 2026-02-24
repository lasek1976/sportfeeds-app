import { getDB } from '../config/mongodb.js';
import { GridFSBucket } from 'mongodb';
import { deserializeBody } from './deserializer.js';

/**
 * Get latest Full message from GridFS
 *
 * Algorithm:
 * 1. Query fs.files for documents with metadata.Aliases ending in "_complete"
 * 2. Sort by uploadDate DESC
 * 3. Download file chunks from GridFS
 * 4. Deserialize binary data
 *
 * @returns {Promise<Object>} DataFeedsDiff object
 */
export async function getLatestFull() {
  const db = getDB();
  const bucket = new GridFSBucket(db, { bucketName: 'fs' });

  try {
    // Find latest complete Full message
    const file = await db.collection('fs.files')
      .find({
        'metadata.Aliases': { $regex: /_complete$/ }
      })
      .sort({ uploadDate: -1 })
      .limit(1)
      .toArray();

    if (!file || file.length === 0) {
      throw new Error('No Full message found in GridFS');
    }

    const fileDoc = file[0];
    console.log(`📥 Downloading GridFS file: ${fileDoc.filename} (${fileDoc.length} bytes)`);

    // Download file from GridFS
    const chunks = [];
    const downloadStream = bucket.openDownloadStream(fileDoc._id);

    for await (const chunk of downloadStream) {
      chunks.push(chunk);
    }

    const binaryData = Buffer.concat(chunks);
    console.log(`✓ Downloaded ${binaryData.length} bytes from GridFS`);

    // Debug: Read type metadata from first 500 bytes
    const typeMetadata = binaryData.slice(0, 500).toString('utf8').replace(/\0/g, '');
    console.log(`Type metadata (first 500 bytes): "${typeMetadata.substring(0, 200)}..."`);

    // Deserialize
    const dataFeedsDiff = deserializeBody(binaryData);
    console.log(`✓ Deserialized Full message: ${dataFeedsDiff.Events?.length || 0} events`);

    return {
      metadata: {
        id: fileDoc._id,
        filename: fileDoc.filename,
        uploadDate: fileDoc.uploadDate,
        aliases: fileDoc.metadata?.Aliases
      },
      data: dataFeedsDiff
    };
  } catch (error) {
    console.error('✗ Failed to get latest Full:', error.message);
    throw error;
  }
}

/**
 * Get Snapshot message by ID from FeedsMessages collection
 *
 * @param {number} messageId - FeedsMessages._id
 * @returns {Promise<Object>} DataFeedsDiff object
 */
export async function getSnapshotById(messageId) {
  const db = getDB();

  try {
    const doc = await db.collection('FeedsMessages').findOne({
      _id: Number(messageId)
    });

    if (!doc) {
      throw new Error(`Snapshot message ${messageId} not found`);
    }

    console.log(`📥 Loading Snapshot: ${messageId} (Format: ${doc.Format})`);

    // Body field contains binary data
    let binaryData;
    if (Buffer.isBuffer(doc.Body)) {
      binaryData = doc.Body;
    } else if (doc.Body && doc.Body.buffer) {
      // Handle BSON Binary type
      binaryData = Buffer.from(doc.Body.buffer);
    } else {
      throw new Error('Invalid Body format in Snapshot message');
    }

    // Deserialize
    const dataFeedsDiff = deserializeBody(binaryData);
    console.log(`✓ Deserialized Snapshot: ${dataFeedsDiff.Events?.length || 0} events`);

    return {
      metadata: {
        id: doc._id,
        format: doc.Format,
        diffType: doc.DiffType,
        createdTime: doc.CreatedTime
      },
      data: dataFeedsDiff
    };
  } catch (error) {
    console.error(`✗ Failed to get Snapshot ${messageId}:`, error.message);
    throw error;
  }
}

/**
 * Get latest Fixed snapshot pointer
 *
 * @returns {Promise<Object>} Snapshot data
 */
export async function getLatestFixedSnapshot() {
  const db = getDB();

  try {
    const pointer = await db.collection('FixedSnapshotMessages')
      .find({ FeedsType: 'Fixed' })
      .sort({ CreatedTime: -1 })
      .limit(1)
      .toArray();

    if (!pointer || pointer.length === 0) {
      throw new Error('No Fixed snapshot pointer found');
    }

    const messageId = pointer[0].MessageId;
    return await getSnapshotById(messageId);
  } catch (error) {
    console.error('✗ Failed to get latest Fixed snapshot:', error.message);
    throw error;
  }
}

/**
 * Get latest Live snapshot pointer
 *
 * @returns {Promise<Object>} Snapshot data
 */
export async function getLatestLiveSnapshot() {
  const db = getDB();

  try {
    const pointer = await db.collection('LiveSnapshotMessages')
      .find({ FeedsType: 'Live' })
      .sort({ CreatedTime: -1 })
      .limit(1)
      .toArray();

    if (!pointer || pointer.length === 0) {
      throw new Error('No Live snapshot pointer found');
    }

    const messageId = pointer[0].MessageId;
    return await getSnapshotById(messageId);
  } catch (error) {
    console.error('✗ Failed to get latest Live snapshot:', error.message);
    throw error;
  }
}

/**
 * Browse Full messages from GridFS
 *
 * @param {number} limit - Number of records to return (default: 50)
 * @param {number} skip - Number of records to skip (default: 0)
 * @returns {Promise<Array>} Array of Full message metadata
 */
export async function browseFullMessages(limit = 50, skip = 0) {
  const db = getDB();

  try {
    const files = await db.collection('fs.files')
      .find({
        'metadata.Aliases': { $regex: /_complete$/ }
      })
      .sort({ uploadDate: -1 })
      .limit(limit)
      .skip(skip)
      .toArray();

    return files.map(file => ({
      id: file._id,
      filename: file.filename,
      uploadDate: file.uploadDate,
      length: file.length,
      aliases: file.metadata?.Aliases,
      type: file.metadata?.Aliases?.includes('21_') ? 'Fixed' : 'Live'
    }));
  } catch (error) {
    console.error('✗ Failed to browse Full messages:', error.message);
    throw error;
  }
}

/**
 * Browse Snapshot messages from FeedsMessages collection
 *
 * @param {number} limit - Number of records to return (default: 50)
 * @param {number} skip - Number of records to skip (default: 0)
 * @returns {Promise<Array>} Array of Snapshot message metadata
 */
export async function browseSnapshots(limit = 50, skip = 0) {
  const db = getDB();

  try {
    const snapshots = await db.collection('FeedsMessages')
      .find({})
      .sort({ CreatedTime: -1 })
      .limit(limit)
      .skip(skip)
      .project({
        _id: 1,
        Format: 1,
        DiffType: 1,
        CreatedTime: 1
      })
      .toArray();

    return snapshots.map(doc => ({
      id: doc._id,
      format: doc.Format,
      diffType: doc.DiffType,
      createdTime: doc.CreatedTime
    }));
  } catch (error) {
    console.error('✗ Failed to browse Snapshots:', error.message);
    throw error;
  }
}

/**
 * Browse Fixed snapshot pointers
 *
 * @param {number} limit - Number of records to return (default: 50)
 * @param {number} skip - Number of records to skip (default: 0)
 * @returns {Promise<Array>} Array of Fixed snapshot pointers
 */
export async function browseFixedPointers(limit = 50, skip = 0) {
  const db = getDB();

  try {
    const pointers = await db.collection('FixedSnapshotMessages')
      .find({ FeedsType: 'Fixed' })
      .sort({ CreatedTime: -1 })
      .limit(limit)
      .skip(skip)
      .toArray();

    return pointers.map(doc => ({
      id: doc._id,
      messageId: doc.MessageId,
      feedsType: doc.FeedsType,
      createdTime: doc.CreatedTime
    }));
  } catch (error) {
    console.error('✗ Failed to browse Fixed pointers:', error.message);
    throw error;
  }
}

/**
 * Browse Live snapshot pointers
 *
 * @param {number} limit - Number of records to return (default: 50)
 * @param {number} skip - Number of records to skip (default: 0)
 * @returns {Promise<Array>} Array of Live snapshot pointers
 */
export async function browseLivePointers(limit = 50, skip = 0) {
  const db = getDB();

  try {
    const pointers = await db.collection('LiveSnapshotMessages')
      .find({ FeedsType: 'Live' })
      .sort({ CreatedTime: -1 })
      .limit(limit)
      .skip(skip)
      .toArray();

    return pointers.map(doc => ({
      id: doc._id,
      messageId: doc.MessageId,
      feedsType: doc.FeedsType,
      createdTime: doc.CreatedTime
    }));
  } catch (error) {
    console.error('✗ Failed to browse Live pointers:', error.message);
    throw error;
  }
}

/**
 * Get database statistics
 *
 * @returns {Promise<Object>} Database statistics
 */
export async function getStats() {
  const db = getDB();

  try {
    const [
      fullCount,
      snapshotCount,
      fixedPointerCount,
      livePointerCount
    ] = await Promise.all([
      db.collection('fs.files').countDocuments({
        'metadata.Aliases': { $regex: /_complete$/ }
      }),
      db.collection('FeedsMessages').countDocuments(),
      db.collection('FixedSnapshotMessages').countDocuments(),
      db.collection('LiveSnapshotMessages').countDocuments()
    ]);

    return {
      fullMessages: fullCount,
      snapshots: snapshotCount,
      fixedPointers: fixedPointerCount,
      livePointers: livePointerCount
    };
  } catch (error) {
    console.error('✗ Failed to get stats:', error.message);
    throw error;
  }
}

export default {
  getLatestFull,
  getSnapshotById,
  getLatestFixedSnapshot,
  getLatestLiveSnapshot,
  browseFullMessages,
  browseSnapshots,
  browseFixedPointers,
  browseLivePointers,
  getStats
};
