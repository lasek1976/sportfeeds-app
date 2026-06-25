# NEXTODO — SportFeeds App

## Done this session (2026-03-19)

### Tree panel text selection
- Removed `user-select: none` from `.tree-node` in `style.css`
- All text in the left tree panel is now selectable and copyable with Ctrl+C

### Tournament (and sport/category) counters
- **Root cause**: the counter correctly excluded DiffType=2 (removed) events, but the leaf
  render loop iterated ALL events — so visible leaves > counter, looking "wrong"
- **Fix** (`treeBuilder.js`): at HTML build time, the event leaf `<div>` now receives the
  DiffType-based CSS class directly (`highlight-removed`, `highlight-added`, `highlight-updated`)
  based on `event.DiffType ?? event.diffType ?? 0` stored in `currentData`
- Counter already counted only active events (DiffType !== 2) — behaviour unchanged
- Red/green/yellow borders are now always correct after any tree rebuild regardless of
  timing issues in the post-build `applyTreeHighlights` calls

### Duplicate chunk stream / blocked incremental messages
- **Symptom**: after startup, all incremental messages were silently blocked forever
- **Root cause**: a reconnect mid-transmission triggers a second `request:full`, producing
  two interleaved chunk streams for the same messageId. The first stream completes → message
  consumed → `delete chunkedMessages[id]`. Orphaned chunks from the second stream then
  re-open `chunkedMessages[id]` and re-set `isReceivingChunkedFull = true` with no chance
  of ever reaching 16/16 (chunks 1-7 of stream 2 already arrived and won't come again)
- **Fix** (`app.js`): at the top of the chunked path, discard any chunk whose messageId is
  already in `consumedMessageIds` — one early-return stops the second stream dead before it
  can re-lock the blocking flag

## Done this session (2026-05-28)

### Admin: MessageId filter for Fixed and Live Snapshot Pointers
- Added optional `messageId` query param to `browseFixedPointers()` and `browseLivePointers()` in `server/services/feedsService.js` — appended to the MongoDB `find` filter when provided
- Updated `/api/admin/browse/pointers/fixed` and `/api/admin/browse/pointers/live` in `server/routes/api.js` to read, validate, and forward the `?messageId=<number>` query param
- Added "Message ID" number input and "Clear Filter" button to both Fixed and Live Snapshot Pointers sections in `public/admin.html`; status text shows the active filter; no bridge changes required

## Done this session (2026-06-04)

### OddValue = 0 missing from JSON API responses
- **Root cause**: `JsonFormatter.Default` (Google.Protobuf) follows proto3 conventions and omits fields whose value equals the type default — `0.0` for `double`. When a variation set `OddValue` to zero it simply disappeared from the JSON output of the bridge's `/api/message/snapshot/:id` and `/api/message/full/:id` endpoints.
- **Fix** (`sportfeeds-bridge/Program.cs`): replaced `JsonFormatter.Default` with a shared instance built from `JsonFormatter.Settings.Default.WithFormatDefaultValues(true)`, used by both JSON endpoints. The RabbitMQ binary path was already safe (`protobufjs` uses `defaults: true` in `toObject()`).

### ProgramStatus enum mismatch between C# and proto
- **Root cause**: proto enum only defined values 0–3 with names like `PROGRAM_STATUS_ACTIVE`, while the C# `ProgramStatus` enum has 9 values (including `NotStartedRetired = 14`). Values ≥ 4 serialised as bare integers in JSON with no readable name.
- **Fix**: both `proto/sportfeeds.proto` files extended to cover all 9 C# enum values with matching names (`PROGRAM_STATUS_DISABLED`, `PROGRAM_STATUS_ENABLED`, … `PROGRAM_STATUS_NOT_STARTED_RETIRED = 14`).

### SelectionStatus removed from serialization
- **Finding**: `SelectionStatus` was never detected as a diff (absent from `CompareProperties`), so it only appeared as a passenger on other changes — and always showed `PROGRAM_STATUS_ENABLED (1)` because zero-valued selections were previously invisible due to the `JsonFormatter.Default` bug above.
- **Removed from** (bridge): `DataSelection.cs`, `DataSelectionDiff.cs` (property + `Convert()` assignment + `NotStartedRetired` force-zero block), `ProtobufConverter.cs`, `proto/sportfeeds.proto`.
- **Removed from** (app): `proto/sportfeeds.proto` field; `diffApplier.js` `selection-status-locked` CSS class toggle — confirmed safe because `SelectionStatus` was never actually `0` in practice so the class was never applied. `ProgramStatus` enum kept in both protos for documentation.

## Open / Next

- Verify the red border (highlight-removed) now appears reliably in auto-refresh mode
  after the baked-in CSS class fix
- Investigate if the duplicate chunk stream can still occur with a Live feed (same fix
  should cover it, but worth confirming)
- Consider showing a counter badge (e.g. "2 removed") on tournament headers instead of
  (or in addition to) the red leaf borders, so removed events are obvious without expanding
