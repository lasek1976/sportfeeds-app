# Fixed vs Live Feeds Architecture

## Overview

The SportFeeds system handles two distinct types of betting feeds:
- **Fixed** - Pre-match/Fixed odds betting (events that haven't started yet)
- **Live** - In-play/Live betting (events currently in progress)

## MongoDB Structure

### Collections

#### 1. GridFS (`fs.files`)
Contains full feed snapshots with aliases:
- **F1_complete** - Fixed odds full snapshots (pre-match events)
- **L1_complete** - Live odds full snapshots (in-play events)

#### 2. FeedsMessages
Stores the actual message bodies (referenced by snapshot pointers)
- Contains serialized `DataFeedsDiff` objects
- Body field uses `ZipBinaryBsonSerializer` (GZip + ProtoBuf)

#### 3. FixedSnapshotMessages
Pointer collection for Fixed feeds:
- `SnapshotID` - Unique snapshot identifier
- `MessageId` - Reference to `FeedsMessages._id`
- `FeedsType: "Fixed"`
- `CreatedTime` - Timestamp

#### 4. LiveSnapshotMessages
Pointer collection for Live feeds:
- `SnapshotID` - Unique snapshot identifier
- `MessageId` - Reference to `FeedsMessages._id`
- `FeedsType: "Live"`
- `CreatedTime` - Timestamp

## RabbitMQ Architecture

### Exchanges & Queues

```
Exchange: sportfeeds (topic)
    ├── Queue: sportfeeds.fixed (routing key: feeds.fixed)
    └── Queue: sportfeeds.live  (routing key: feeds.live)
```

### Message Flow

```
MongoDB Collections
    ├── GridFS (F1_complete) ──┐
    ├── FixedSnapshotMessages ─┤
    │                           ├──> .NET Bridge ──> RabbitMQ (feeds.fixed) ──> sportfeeds.fixed queue
    ├── GridFS (L1_complete) ──┤
    └── LiveSnapshotMessages ──┘
                                └──> .NET Bridge ──> RabbitMQ (feeds.live)  ──> sportfeeds.live queue

Node.js Consumers
    ├── Fixed Consumer (sportfeeds.fixed) ──> WebSocket (feeds:fixed event)
    └── Live Consumer  (sportfeeds.live)  ──> WebSocket (feeds:live event)
```

## .NET Bridge Configuration

### appsettings.json

```json
{
  "MongoDB": {
    "ConnectionString": "mongodb://localhost:27017",
    "DatabaseName": "SportFeeds",
    "FeedsMessagesCollection": "FeedsMessages",
    "FixedSnapshotMessagesCollection": "FixedSnapshotMessages",
    "LiveSnapshotMessagesCollection": "LiveSnapshotMessages",
    "GridFSBucket": "fs"
  },
  "RabbitMQ": {
    "HostName": "localhost",
    "ExchangeName": "sportfeeds",
    "FixedQueueName": "sportfeeds.fixed",
    "LiveQueueName": "sportfeeds.live",
    "FixedRoutingKey": "feeds.fixed",
    "LiveRoutingKey": "feeds.live"
  },
  "Processing": {
    "PublishFormat": "ProtoBuf",
    "PollingIntervalSeconds": 5,
    "ProcessFixed": true,
    "ProcessLive": true
  }
}
```

### Processing Logic

The bridge polls MongoDB every N seconds and:

1. **Fixed Processing** (if `ProcessFixed: true`):
   - Reads latest GridFS file with alias `F1_complete`
   - Reads latest pointer from `FixedSnapshotMessages`
   - Deserializes using `ZipBinaryBsonSerializer`
   - Re-serializes to standard ProtoBuf
   - Publishes to `feeds.fixed` routing key

2. **Live Processing** (if `ProcessLive: true`):
   - Reads latest GridFS file with alias `L1_complete`
   - Reads latest pointer from `LiveSnapshotMessages`
   - Deserializes using `ZipBinaryBsonSerializer`
   - Re-serializes to standard ProtoBuf
   - Publishes to `feeds.live` routing key

## Node.js Consumer

### RabbitMQ Connection

```javascript
import { connectRabbitMQ } from './config/rabbitmq.js';
import { initProtoBuf, startConsumer, onFixedMessage, onLiveMessage } from './services/rabbitMQService.js';

// Initialize
await connectRabbitMQ();
await initProtoBuf();

// Register handlers
onFixedMessage((dataFeedsDiff, metadata) => {
  console.log('Fixed message received:', metadata.feedsType);
  // Handle Fixed message
});

onLiveMessage((dataFeedsDiff, metadata) => {
  console.log('Live message received:', metadata.feedsType);
  // Handle Live message
});

// Start consuming
await startConsumer();
```

### WebSocket Events

Clients receive two types of events:

#### 1. `feeds:fixed` Event
```javascript
socket.on('feeds:fixed', (payload) => {
  console.log('Fixed odds update:', payload);
  // payload.metadata.feedsType === 'Fixed'
  // payload.data.Events[] - pre-match events
});
```

#### 2. `feeds:live` Event
```javascript
socket.on('feeds:live', (payload) => {
  console.log('Live odds update:', payload);
  // payload.metadata.feedsType === 'Live'
  // payload.data.Events[] - in-play events
});
```

## Message Metadata

Each RabbitMQ message includes headers:

```javascript
{
  MessageId: 123456789,
  DiffType: "Snapshot",
  Format: "ProtoBuf",
  CreatedTime: "2026-02-11T10:30:00Z",
  MessageType: "DataFeedsDiff",
  FeedsType: "Fixed"  // or "Live"
}
```

## Use Cases

### Scenario 1: Pre-Match Betting Display
```javascript
// Subscribe only to Fixed feeds
onFixedMessage((dataFeedsDiff, metadata) => {
  displayPreMatchEvents(dataFeedsDiff.Events);
});
```

### Scenario 2: Live Betting Display
```javascript
// Subscribe only to Live feeds
onLiveMessage((dataFeedsDiff, metadata) => {
  displayLiveEvents(dataFeedsDiff.Events);
});
```

### Scenario 3: Combined Display
```javascript
// Subscribe to both
let fixedEvents = [];
let liveEvents = [];

onFixedMessage((dataFeedsDiff) => {
  fixedEvents = dataFeedsDiff.Events;
  updateDisplay();
});

onLiveMessage((dataFeedsDiff) => {
  liveEvents = dataFeedsDiff.Events;
  updateDisplay();
});

function updateDisplay() {
  // Show both Fixed and Live events
  renderEvents([...fixedEvents, ...liveEvents]);
}
```

## Monitoring

### RabbitMQ Management UI

Access: `http://localhost:15672`

Check queue depths:
- `sportfeeds.fixed` - Should have low depth if consumers are active
- `sportfeeds.live` - Should have low depth if consumers are active

### .NET Bridge Logs

Look for:
```
info: Processing Fixed Full message: 123456
info: Published Fixed message 123456 to RabbitMQ (12345 bytes, routing: feeds.fixed)
info: Processing Live Snapshot message: 789012
info: Published Live message 789012 to RabbitMQ (23456 bytes, routing: feeds.live)
```

### Node.js Logs

Look for:
```
📨 Received Fixed message: { messageId: 123456, ... }
✓ Deserialized Fixed message: 150 events
📢 Broadcasting Fixed message to 5 clients (150 events)

📨 Received Live message: { messageId: 789012, ... }
✓ Deserialized Live message: 75 events
📢 Broadcasting Live message to 5 clients (75 events)
```

## Configuration Scenarios

### Process Only Fixed
```json
{
  "Processing": {
    "ProcessFixed": true,
    "ProcessLive": false
  }
}
```

### Process Only Live
```json
{
  "Processing": {
    "ProcessFixed": false,
    "ProcessLive": true
  }
}
```

### Process Both (Default)
```json
{
  "Processing": {
    "ProcessFixed": true,
    "ProcessLive": true
  }
}
```

## Advantages of Separate Queues

1. **Independent Scaling**: Scale Fixed and Live consumers independently
2. **Selective Processing**: Enable/disable Fixed or Live processing
3. **Message Prioritization**: Different TTL or priority for Fixed vs Live
4. **Monitoring**: Separate metrics for Fixed vs Live throughput
5. **Load Balancing**: Distribute Fixed and Live to different servers
6. **Failover**: One feed type can fail without affecting the other

## Best Practices

1. **Always check `FeedsType` header** when processing messages
2. **Use separate WebSocket events** (`feeds:fixed` vs `feeds:live`)
3. **Monitor both queues** separately in RabbitMQ Management UI
4. **Set appropriate polling intervals** (Live may need faster polling than Fixed)
5. **Handle reconnections** gracefully for both queue consumers
6. **Log queue names** in debug output for troubleshooting

## Troubleshooting

### No Fixed Messages
- Check `ProcessFixed: true` in appsettings.json
- Verify `FixedSnapshotMessages` collection has data
- Check GridFS for files with alias `F1_complete`
- Look for errors in .NET Bridge logs

### No Live Messages
- Check `ProcessLive: true` in appsettings.json
- Verify `LiveSnapshotMessages` collection has data
- Check GridFS for files with alias `L1_complete`
- Look for errors in .NET Bridge logs

### Messages Going to Wrong Queue
- Verify routing keys in appsettings.json:
  - `FixedRoutingKey: "feeds.fixed"`
  - `LiveRoutingKey: "feeds.live"`
- Check queue bindings in RabbitMQ Management UI
- Verify `FeedsType` header in published messages
