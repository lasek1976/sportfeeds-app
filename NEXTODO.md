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

## Open / Next

- Verify the red border (highlight-removed) now appears reliably in auto-refresh mode
  after the baked-in CSS class fix
- Investigate if the duplicate chunk stream can still occur with a Live feed (same fix
  should cover it, but worth confirming)
- Consider showing a counter badge (e.g. "2 removed") on tournament headers instead of
  (or in addition to) the red leaf borders, so removed events are obvious without expanding
