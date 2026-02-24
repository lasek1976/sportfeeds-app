# Sports Calendar API Documentation

## Base URL
```
http://localhost:3000
```

---

## Public API Endpoints

### 1. Get Latest Full Message
Retrieves the latest Full message from GridFS.

**Endpoint**: `GET /api/feeds/full/latest`

**Response**:
```json
{
  "success": true,
  "metadata": {
    "id": "ObjectId",
    "filename": "GOLDBET-2026-02-10T17-00-27-F1_complete",
    "uploadDate": "2026-02-10T17:00:27.000Z",
    "aliases": "21_complete"
  },
  "data": {
    "Events": [...],
    "DiffType": 0
  }
}
```

---

### 2. Get Snapshot by ID
Retrieves a specific Snapshot message from FeedsMessages collection.

**Endpoint**: `GET /api/feeds/snapshot/:id`

**Parameters**:
- `id` (path) - FeedsMessages._id (number)

**Example**: `GET /api/feeds/snapshot/123456789`

**Response**:
```json
{
  "success": true,
  "metadata": {
    "id": 123456789,
    "format": "Snapshot",
    "diffType": "Updated",
    "createdTime": "2026-02-10T18:30:15.000Z"
  },
  "data": {
    "Events": [...],
    "DiffType": 3
  }
}
```

---

### 3. Get Latest Fixed Snapshot
Retrieves the latest Fixed snapshot via FixedSnapshotMessages pointer.

**Endpoint**: `GET /api/feeds/snapshot/fixed/latest`

**Response**: Same as Get Snapshot by ID

---

### 4. Get Latest Live Snapshot
Retrieves the latest Live snapshot via LiveSnapshotMessages pointer.

**Endpoint**: `GET /api/feeds/snapshot/live/latest`

**Response**: Same as Get Snapshot by ID

---

### 5. Health Check
Simple health check endpoint.

**Endpoint**: `GET /api/health`

**Response**:
```json
{
  "success": true,
  "status": "healthy",
  "timestamp": "2026-02-10T18:45:00.000Z"
}
```

---

## Admin API Endpoints

### 1. Database Statistics
Get counts of all message types.

**Endpoint**: `GET /api/admin/stats`

**Response**:
```json
{
  "success": true,
  "stats": {
    "fullMessages": 150,
    "snapshots": 45000,
    "fixedPointers": 300,
    "livePointers": 500
  }
}
```

---

### 2. Browse Full Messages
Browse Full messages from GridFS with pagination.

**Endpoint**: `GET /api/admin/browse/full`

**Query Parameters**:
- `limit` (optional) - Number of records (default: 50, max: 100)
- `skip` (optional) - Number of records to skip (default: 0)

**Example**: `GET /api/admin/browse/full?limit=20&skip=0`

**Response**:
```json
{
  "success": true,
  "count": 20,
  "limit": 20,
  "skip": 0,
  "messages": [
    {
      "id": "ObjectId",
      "filename": "GOLDBET-2026-02-10T17-00-27-F1_complete",
      "uploadDate": "2026-02-10T17:00:27.000Z",
      "length": 1234567,
      "aliases": "21_complete",
      "type": "Fixed"
    }
  ]
}
```

---

### 3. Browse Snapshots
Browse Snapshot messages from FeedsMessages collection with pagination.

**Endpoint**: `GET /api/admin/browse/snapshots`

**Query Parameters**:
- `limit` (optional) - Number of records (default: 50, max: 100)
- `skip` (optional) - Number of records to skip (default: 0)

**Example**: `GET /api/admin/browse/snapshots?limit=50&skip=100`

**Response**:
```json
{
  "success": true,
  "count": 50,
  "limit": 50,
  "skip": 100,
  "snapshots": [
    {
      "id": 123456789,
      "format": "Snapshot",
      "diffType": "Updated",
      "createdTime": "2026-02-10T18:30:15.000Z"
    }
  ]
}
```

---

### 4. Browse Fixed Pointers
Browse Fixed snapshot pointers with pagination.

**Endpoint**: `GET /api/admin/browse/pointers/fixed`

**Query Parameters**:
- `limit` (optional) - Number of records (default: 50, max: 100)
- `skip` (optional) - Number of records to skip (default: 0)

**Response**:
```json
{
  "success": true,
  "count": 50,
  "limit": 50,
  "skip": 0,
  "pointers": [
    {
      "id": 987654321,
      "messageId": 123456789,
      "feedsType": "Fixed",
      "createdTime": "2026-02-10T18:00:00.000Z"
    }
  ]
}
```

---

### 5. Browse Live Pointers
Browse Live snapshot pointers with pagination.

**Endpoint**: `GET /api/admin/browse/pointers/live`

**Query Parameters**:
- `limit` (optional) - Number of records (default: 50, max: 100)
- `skip` (optional) - Number of records to skip (default: 0)

**Response**: Same as Browse Fixed Pointers

---

## Socket.io Events

### Client → Server

#### Request Full Message
```javascript
socket.emit('request:full');
```

#### Request Snapshot by ID
```javascript
socket.emit('request:snapshot', { id: 123456789 });
```

### Server → Client

#### Receive Full Message
```javascript
socket.on('feeds:full', (response) => {
  console.log(response.metadata);
  console.log(response.data);
});
```

#### Receive Snapshot Message
```javascript
socket.on('feeds:snapshot', (response) => {
  console.log(response.metadata);
  console.log(response.data);
});
```

#### Error Handling
```javascript
socket.on('error', (error) => {
  console.error(error.message);
  console.error(error.type); // 'full' or 'snapshot'
});
```

#### Connection Events
```javascript
socket.on('connect', () => {
  console.log('Connected to server');
});

socket.on('disconnect', () => {
  console.log('Disconnected from server');
});
```

---

## Error Responses

All endpoints return errors in the following format:

```json
{
  "success": false,
  "error": "Error message description"
}
```

**HTTP Status Codes**:
- `200` - Success
- `400` - Bad Request (invalid parameters)
- `500` - Internal Server Error

---

## Data Models

### DataFeedsDiff (Root)
```javascript
{
  Events: [DataEventDiff],
  DiffType: Number  // 0=Equal, 1=Added, 2=Removed, 3=Updated
}
```

### DataEventDiff
```javascript
{
  IDSport: Number,
  SportName: String,
  IDCategory: Number,
  CategoryName: String,
  IDTournament: Number,
  TournamentName: String,
  IDEvent: Number,
  EventName: String,
  EventDate: Number,  // .NET ticks
  Markets: [DataMarketDiff],
  Teams: [DataTeamDiff],
  ScoreBoards: [DataScoreBoardDiff]
}
```

### DataTeamDiff
```javascript
{
  TeamId: Number,
  TeamName: String,
  IdTeamNumber: Number,  // 1=Home, 2=Away
  DiffType: Number
}
```

### DataScoreBoardDiff
```javascript
{
  IdResultType: Number,  // 1=Current, 2=Quarter, etc.
  ResultValue: String,   // "45-38", "2", etc.
  DiffType: Number
}
```

### DataMarketDiff
```javascript
{
  IDMarket: Number,
  MarketName: String,
  MarketOrder: Number,
  Selections: [DataSelectionDiff],
  DiffType: Number
}
```

### DataSelectionDiff
```javascript
{
  IDSelection: Number,
  SelectionName: String,
  OddValue: Number,
  SelectionStatus: Number,  // 0=Locked, 1=Active
  SelectionOrder: Number,
  DiffType: Number
}
```

---

## Usage Examples

### Fetch Latest Full via HTTP
```javascript
const response = await fetch('http://localhost:3000/api/feeds/full/latest');
const data = await response.json();

if (data.success) {
  console.log(`Loaded ${data.data.Events.length} events`);
}
```

### Fetch Snapshot via HTTP
```javascript
const snapshotId = 123456789;
const response = await fetch(`http://localhost:3000/api/feeds/snapshot/${snapshotId}`);
const data = await response.json();

if (data.success) {
  console.log(`Snapshot format: ${data.metadata.format}`);
}
```

### Request Full via Socket.io
```javascript
const socket = io('http://localhost:3000');

socket.on('connect', () => {
  socket.emit('request:full');
});

socket.on('feeds:full', (response) => {
  if (response.success) {
    console.log('Received Full message:', response.data);
  }
});
```

### Browse Snapshots (Admin)
```javascript
const response = await fetch('http://localhost:3000/api/admin/browse/snapshots?limit=10&skip=0');
const data = await response.json();

data.snapshots.forEach(snap => {
  console.log(`Snapshot ${snap.id}: ${snap.createdTime}`);
});
```

---

## Rate Limiting & Best Practices

- Use Socket.io for real-time updates (lower overhead)
- Use HTTP API for one-time queries
- Pagination: Use `limit` and `skip` for large result sets
- Cache Full messages when possible (they don't change frequently)
- Filter snapshots by displaying event before applying visual transitions
