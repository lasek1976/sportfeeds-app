# Sports Calendar Application

Real-time sports calendar application with MongoDB, Socket.io, and ProtoBuf deserialization.

## Features

- ✅ Real-time event updates via Socket.io
- ✅ MongoDB GridFS support for Full messages
- ✅ FeedsMessages collection for Snapshot messages
- ✅ GZip + ProtoBuf deserialization
- ✅ Hierarchical tree view (Sport → Category → Tournament → Event)
- ✅ Event details with Teams, ScoreBoards, and Markets
- ✅ Visual diff transitions (2s fade)
  - GREEN: Added/Increased odds
  - RED: Removed/Decreased odds
  - YELLOW: Updated Teams/ScoreBoards

## Prerequisites

- Node.js 18+
- MongoDB running on `localhost:27017`
  - Database: `Feeds_Sogei_NET9`
  - User: `test` / Password: `test`
  - Collections: `fs.files`, `fs.chunks`, `FeedsMessages`, `FixedSnapshotMessages`, `LiveSnapshotMessages`

## Installation

```bash
# Install dependencies
npm install

# Start server
npm start

# Development mode (with auto-reload)
npm run dev
```

## Configuration

Edit `.env` file:

```env
MONGO_URL=mongodb://test:test@localhost:27017
MONGO_DB=Feeds_Sogei_NET9

RABBITMQ_ENABLED=false
RABBITMQ_URL=amqp://test:test@localhost:5672

PORT=3000
```

## Usage

1. Open browser: `http://localhost:3000`
2. Application auto-loads latest Full message from GridFS
3. Click tree nodes to expand/collapse
4. Click events to view details in center panel
5. Use "Load Snapshot ID" to load specific snapshot

## API Endpoints

### Public Endpoints
```
GET  /api/feeds/full/latest              - Latest Full from GridFS
GET  /api/feeds/snapshot/:id             - Snapshot by ID
GET  /api/feeds/snapshot/fixed/latest    - Latest Fixed snapshot
GET  /api/feeds/snapshot/live/latest     - Latest Live snapshot
GET  /api/health                         - Health check
```

### Admin Endpoints
```
GET  /api/admin/stats                         - Database statistics
GET  /api/admin/browse/full                   - Browse Full messages (GridFS)
     ?limit=50&skip=0                         - Pagination parameters
GET  /api/admin/browse/snapshots              - Browse Snapshots (FeedsMessages)
     ?limit=50&skip=0                         - Pagination parameters
GET  /api/admin/browse/pointers/fixed         - Browse Fixed snapshot pointers
     ?limit=50&skip=0                         - Pagination parameters
GET  /api/admin/browse/pointers/live          - Browse Live snapshot pointers
     ?limit=50&skip=0                         - Pagination parameters
```

### Admin Interface
Access the admin panel at: **http://localhost:3000/admin.html**

Features:
- 📊 View database statistics (total counts)
- 📄 Browse Full messages with metadata
- 📝 Browse Snapshots with pagination
- 🔗 Browse Fixed/Live pointers
- 🔗 Quick links to open snapshots in main calendar
- ⏭️ Pagination controls (Previous/Next)

## Socket.io Events

**Client → Server:**
```javascript
socket.emit('request:full');
socket.emit('request:snapshot', { id: 123 });
```

**Server → Client:**
```javascript
socket.on('feeds:full', (data) => { ... });
socket.on('feeds:snapshot', (data) => { ... });
socket.on('error', (error) => { ... });
```

## Architecture

### Backend
- Express.js + Socket.io
- MongoDB official driver
- GridFS for Full messages
- GZip decompression (zlib)
- ProtoBuf deserialization (protobufjs)

### Frontend
- Vanilla JavaScript ES6+
- jQuery 3.x
- Socket.io-client
- Lodash for utilities

### Data Flow

```
GridFS (Full) ──────┐
                    ├──> Deserialize ──> Tree Builder ──> UI
FeedsMessages ──────┘
(Snapshot)
                    Snapshot Diff ──> Diff Applier ──> Visual Transitions
```

## Deserialization Algorithm

Both Full and Snapshot messages use same format:

```
Bytes 0-499:   .NET Assembly Qualified Name (SKIP in JS)
Bytes 500+:    GZip-compressed ProtoBuf DataFeedsDiff
```

**Steps:**
1. Skip first 500 bytes
2. GZip decompress
3. ProtoBuf decode
4. Convert to plain object

## Project Structure

```
sportfeeds-app/
├── server/
│   ├── index.js                 # Main server
│   ├── config/
│   │   └── mongodb.js           # MongoDB connection
│   ├── services/
│   │   ├── deserializer.js      # GZip + ProtoBuf
│   │   └── feedsService.js      # GridFS + FeedsMessages
│   ├── routes/
│   │   └── api.js               # REST API
│   └── sockets/
│       └── feedsSocket.js       # Socket.io handlers
├── proto/
│   └── sportfeeds.proto         # ProtoBuf schema
├── public/
│   ├── index.html
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── app.js               # Main application
│       ├── treeBuilder.js       # Tree construction
│       ├── eventRenderer.js     # Event detail rendering
│       └── diffApplier.js       # Snapshot diff application
└── package.json
```

## Diff Types

```javascript
EQUAL   = 0  // No change
ADDED   = 1  // New entity (GREEN)
REMOVED = 2  // Deleted entity (RED)
UPDATED = 3  // Modified entity (GREEN/RED/YELLOW)
```

## Visual Transitions

| Entity | Condition | Color | Duration |
|--------|-----------|-------|----------|
| Market | ADDED | Green | 2s |
| Market | REMOVED | Red | 2s |
| Selection | OddValue ⬆ | Green | 2s |
| Selection | OddValue ⬇ | Red | 2s |
| Team | UPDATED | Yellow | 2s |
| ScoreBoard | UPDATED | Yellow | 2s |

## Troubleshooting

### MongoDB Connection Failed
- Verify MongoDB is running: `mongosh mongodb://test:test@localhost:27017`
- Check user permissions
- Verify database name

### No Events Displayed
- Check GridFS has files with `metadata.Aliases` ending in `_complete`
- Check console for deserialization errors
- Verify ProtoBuf schema matches data structure

### Socket.io Not Connecting
- Check browser console for errors
- Verify server is running
- Check firewall/antivirus settings

## License

MIT
