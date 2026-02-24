import zlib from 'zlib';
import protobuf from 'protobufjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let DataFeedsDiffType = null;

/**
 * Initialize ProtoBuf schema
 */
export async function initProtoBuf() {
  try {
    const protoPath = join(__dirname, '../../proto/sportfeeds.proto');
    const root = await protobuf.load(protoPath);
    DataFeedsDiffType = root.lookupType('sportfeeds.DataFeedsDiff');
    console.log('✓ ProtoBuf schema loaded');
  } catch (error) {
    console.error('✗ Failed to load ProtoBuf schema:', error.message);
    throw error;
  }
}

/**
 * Deserialize binary data from MongoDB Body field
 *
 * CRITICAL: Both Full (GridFS) and Snapshot (FeedsMessages) use same format:
 * - Bytes 0-499: .NET Assembly Qualified Name (SKIP in JS)
 * - Bytes 500+: GZip-compressed ProtoBuf DataFeedsDiff
 *
 * @param {Buffer} binaryData - Binary data from Body field
 * @returns {Object} Deserialized DataFeedsDiff object
 */
export function deserializeBody(binaryData) {
  if (!DataFeedsDiffType) {
    throw new Error('ProtoBuf schema not initialized. Call initProtoBuf() first.');
  }

  try {
    // 1. Skip first 500 bytes (.NET type metadata)
    if (binaryData.length < 500) {
      throw new Error(`Invalid binary data: length ${binaryData.length} < 500 bytes`);
    }

    const compressedData = binaryData.slice(500);

    // Debug: Analyze the binary structure
    console.log('\n=== BINARY ANALYSIS ===');
    console.log(`Total length after 500-byte skip: ${compressedData.length} bytes`);
    console.log('First 50 bytes (hex):', compressedData.slice(0, 50).toString('hex'));
    console.log('First 20 bytes (decimal):', Array.from(compressedData.slice(0, 20)));

    // Check for various compression signatures
    const firstByte = compressedData[0];
    const secondByte = compressedData[1];
    console.log(`First two bytes: 0x${firstByte.toString(16).padStart(2, '0')} 0x${secondByte.toString(16).padStart(2, '0')}`);

    if (firstByte === 0x1f && secondByte === 0x8b) {
      console.log('→ GZip signature detected (0x1f 0x8b)');
    } else if (firstByte === 0x78 && (secondByte === 0x9c || secondByte === 0xda || secondByte === 0x01)) {
      console.log('→ Zlib/Deflate signature detected (0x78)');
    } else {
      console.log('→ No standard compression signature');
    }

    // 2. Try different decompression methods
    let decompressed = null;
    let method = null;

    // Try GZip
    try {
      decompressed = zlib.gunzipSync(compressedData);
      method = 'gunzip';
      console.log(`✓ GZip decompression successful: ${decompressed.length} bytes`);
    } catch (gzipError) {
      console.log(`✗ GZip failed: ${gzipError.message}`);

      // Try raw Deflate
      try {
        decompressed = zlib.inflateRawSync(compressedData);
        method = 'inflateRaw';
        console.log(`✓ Raw Deflate successful: ${decompressed.length} bytes`);
      } catch (deflateError) {
        console.log(`✗ Raw Deflate failed: ${deflateError.message}`);

        // Try standard Inflate (zlib)
        try {
          decompressed = zlib.inflateSync(compressedData);
          method = 'inflate';
          console.log(`✓ Zlib inflate successful: ${decompressed.length} bytes`);
        } catch (zlibError) {
          console.log(`✗ Zlib inflate failed: ${zlibError.message}`);

          // Try uncompressed
          console.log('→ Trying uncompressed ProtoBuf...');
          decompressed = compressedData;
          method = 'uncompressed';
        }
      }
    }

    console.log(`Using method: ${method}`);
    console.log('First 40 bytes of decompressed data (hex):', decompressed.slice(0, 40).toString('hex'));
    console.log('=== END ANALYSIS ===\n');

    // 3. ProtoBuf deserialize
    const message = DataFeedsDiffType.decode(decompressed);

    // 4. Convert to plain JavaScript object
    const plainObject = DataFeedsDiffType.toObject(message, {
      longs: Number,  // Convert Long to Number
      enums: Number,  // Convert enums to numeric values
      defaults: true, // Include default values
      arrays: true,   // Always create arrays for repeated fields
      objects: true   // Always create objects for message fields
    });

    return plainObject;
  } catch (error) {
    console.error('✗ Deserialization failed:', error.message);
    throw new Error(`Deserialization error: ${error.message}`);
  }
}

/**
 * Convert .NET ticks to JavaScript Date
 * .NET ticks: 100-nanosecond intervals since 0001-01-01 00:00:00
 *
 * @param {number} ticks - .NET ticks
 * @returns {Date} JavaScript Date object
 */
export function ticksToDate(ticks) {
  if (!ticks || ticks === 0) return null;

  // .NET epoch: January 1, 0001
  // Unix epoch: January 1, 1970
  // Difference: 621355968000000000 ticks
  const dotNetEpochDiff = 621355968000000000;
  const ticksPerMillisecond = 10000;

  const milliseconds = (ticks - dotNetEpochDiff) / ticksPerMillisecond;
  return new Date(milliseconds);
}

/**
 * Extract first available translation from translation dictionary
 *
 * @param {Object} translationDict - Translation dictionary from ProtoBuf
 * @returns {string} First available translation or empty string
 */
export function getFirstTranslation(translationDict) {
  if (!translationDict || !translationDict.translations) {
    return '';
  }

  const languages = Object.keys(translationDict.translations);
  if (languages.length === 0) return '';

  const firstLang = languages[0];
  const translationList = translationDict.translations[firstLang];

  if (!translationList || !translationList.items || translationList.items.length === 0) {
    return '';
  }

  return translationList.items[0].value || '';
}

export default {
  initProtoBuf,
  deserializeBody,
  ticksToDate,
  getFirstTranslation
};
