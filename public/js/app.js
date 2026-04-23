import { buildTree, collapseAll, attachSearchHandlers, filterTreeByEventId, revealEventInTree } from './treeBuilder.js';
import { renderEventDetail, clearEventDetail } from './eventRenderer.js';
import { applySnapshotDiff } from './diffApplier.js';
import { FeedTypeManager } from './feedTypeManager.js';
import { applyTreeHighlights, clearTreeHighlights, applyTreeMessageBadges } from './treeUpdater.js';
import { updateEventDetail } from './eventDetailUpdater.js';

// Global state
let socket = null;
let currentData = null;
let currentEventId = null;
let feedTypeManager = null;
let pendingUpdates = 0;
let pendingMessageIds = []; // Track which message IDs are pending
let pendingEvents = []; // Store pending events for incremental updates
let consumedMessageIds = new Set(); // Track consumed message IDs to prevent duplicates
let autoRefresh = false; // Manual refresh by default
let chunkedMessages = {}; // Store incomplete chunked messages: { messageId: { chunks: [], metadata: {} } }
let isFullLoaded = false; // Track if Full snapshot has been loaded
let queuedMessages = []; // Queue incremental messages until Full is loaded
let waitingForFull = false; // Track if we're waiting for a Full message after request:full
let fullMessageId = null; // Track the message ID of the Full message we're waiting for
let isReceivingChunkedFull = false; // Track if we're receiving a chunked Full message (block other messages)
let receivingFullMessageId = null; // The message ID of the chunked Full being received
let persistentHighlights = {}; // { [eventId]: { diffType, messageId } } — survives tree rebuilds

// Initialize Socket.io
function initSocket() {
  socket = io();

  socket.on('connect', () => {
    console.log('Connected to server');
    $('#connection-status')
      .removeClass('status-disconnected')
      .addClass('status-connected')
      .text('🟢 Connected');

    // Check if we were in the middle of receiving chunks
    const incompleteChunks = Object.keys(chunkedMessages);
    if (incompleteChunks.length > 0) {
      console.warn('Reconnected with incomplete chunks - requesting fresh Full');
      console.log(`   Incomplete message IDs: ${incompleteChunks.join(', ')}`);

      // Clear incomplete chunks and unblock message processing
      chunkedMessages = {};
      isFullLoaded = false;
      queuedMessages = [];
      isReceivingChunkedFull = false;
      receivingFullMessageId = null;

      // Request fresh Full
      waitingForFull = true;
      fullMessageId = null;
      socket.emit('request:full');

      $('#data-events-count').text('⏳ Reconnected - requesting fresh Full...');
    }
  });

  socket.on('disconnect', () => {
    console.log('Disconnected from server');
    $('#connection-status')
      .removeClass('status-connected')
      .addClass('status-disconnected')
      .text('⚫ Disconnected');
  });

  socket.on('feeds:full', (response) => {
    console.log('Received Full message:', response);
    if (response.success) {
      handleFullMessage(response.data, response.metadata);
    }
  });

  socket.on('feeds:snapshot', (response) => {
    console.log('Received Snapshot message:', response);
    if (response.success) {
      handleSnapshotMessage(response.data, response.metadata);
    }
  });

  // Handle Fixed messages (pre-match)
  socket.on('feeds:fixed', (response) => {
    console.log(`Received Fixed message - ID: ${response.metadata?.messageId}`, response);
    if (response.success) {
      handleFeedMessage(response.data, response.metadata, 'Fixed');
    }
  });

  // Handle Live messages (in-play)
  socket.on('feeds:live', (response) => {
    console.log(`Received Live message - ID: ${response.metadata?.messageId}`, response);
    if (response.success) {
      handleFeedMessage(response.data, response.metadata, 'Live');
    }
  });

  socket.on('error', (error) => {
    console.error('Socket error:', error);
    alert(`Error: ${error.message}`);
  });
}

// Handle Feed messages (Fixed or Live from RabbitMQ)
function handleFeedMessage(data, metadata, feedsType) {
  console.log(`Received ${feedsType} feed - Message ID: ${metadata.messageId}, DiffType: ${metadata.diffType}, Chunked: ${metadata.isChunked || false}`);

  // If we're receiving a chunked Full message, block all other messages
  if (isReceivingChunkedFull && metadata.messageId !== receivingFullMessageId) {
    console.log(`Blocking message ${metadata.messageId} - currently receiving chunked Full message ${receivingFullMessageId}`);
    return; // Discard this message
  }

  // Handle chunked messages FIRST (before duplicate check)
  if (metadata.isChunked) {
    const { messageId, chunkIndex, totalChunks, totalEvents } = metadata;

    // Discard stale chunks from a second/duplicate stream for a message already fully processed.
    // This happens when a reconnect triggers a fresh request:full while the previous chunked
    // stream is still in-flight — the two streams interleave and orphan chunks arrive after
    // the first merge, which would re-open chunkedMessages and lock isReceivingChunkedFull forever.
    if (consumedMessageIds.has(messageId)) {
      console.log(`Discarding stale chunk ${chunkIndex + 1}/${totalChunks} for already-consumed message ${messageId}`);
      return;
    }

    console.log(`Received chunk ${chunkIndex + 1}/${totalChunks} for message ${messageId} (${data.Events?.length || 0} events)`);

    // Initialize storage for this message if needed
    if (!chunkedMessages[messageId]) {
      chunkedMessages[messageId] = {
        chunks: Array.from({ length: totalChunks }, () => null), // Use null-filled array, not sparse array
        metadata: metadata,
        feedsType: feedsType,
        totalChunks: totalChunks
      };

      // Detect if this is the first chunk of a Full message
      const hasCompleteDiffType = metadata.diffType && (
        metadata.diffType.includes('complete') ||
        metadata.diffType.includes('Complete')
      );
      const isChunkedFull = hasCompleteDiffType;

      if (isChunkedFull) {
        console.log(`Starting to receive chunked Full message ${messageId} - blocking other messages`);
        isReceivingChunkedFull = true;
        receivingFullMessageId = messageId;
      }
    }

    // Store this chunk
    chunkedMessages[messageId].chunks[chunkIndex] = data.Events || [];

    // Check if we have all chunks (count non-null chunks)
    const allChunks = chunkedMessages[messageId].chunks;
    const receivedCount = allChunks.filter(chunk => chunk !== null).length;
    const isComplete = receivedCount === totalChunks;

    if (!isComplete) {
      console.log(`Waiting for remaining chunks (${receivedCount}/${totalChunks} received)`);
      return;
    }

    // All chunks received - merge them
    console.log(`All ${totalChunks} chunks received for message ${messageId} - merging ${totalEvents} events`);

    const mergedEvents = allChunks.flat();
    data = {
      ...data,
      Events: mergedEvents
    };

    // If this was a chunked Full message, unblock other messages
    if (isReceivingChunkedFull && messageId === receivingFullMessageId) {
      console.log(`Chunked Full message ${messageId} complete - resuming normal message processing`);
      isReceivingChunkedFull = false;
      receivingFullMessageId = null;
    }

    // Clean up
    delete chunkedMessages[messageId];

    console.log(`Merged ${mergedEvents.length} events from ${totalChunks} chunks`);
  }

  // Check for duplicate message AFTER chunk merging
  // (chunked messages share the same messageId, so we only check once all chunks are merged)
  if (consumedMessageIds.has(metadata.messageId)) {
    console.log(`Discarding duplicate ${feedsType} message - ID: ${metadata.messageId} (already consumed)`);
    return;
  }

  // Detect if this is a Full snapshot
  // Method 1: Check diffType for "complete" (GridFS aliases like 21_complete, 22_complete)
  const hasCompleteDiffType = metadata.diffType && (
    metadata.diffType.includes('complete') ||
    metadata.diffType.includes('Complete')
  );

  // A message is "Full" only if its diffType contains "complete" (e.g. 21_complete, 22_complete)
  const isFull = hasCompleteDiffType;

  // If this is a Full message after request:full, track its ID
  if (isFull && waitingForFull) {
    fullMessageId = metadata.messageId;
    waitingForFull = false; // Stop waiting
    console.log(`Received Full snapshot - Message ID: ${fullMessageId} (${data.Events?.length || 0} events)`);
  }

  // If Full snapshot not loaded yet and this is NOT a Full message, queue it
  // DON'T mark as consumed yet - will be marked when processed after Full loads
  if (!isFullLoaded && !isFull) {
    console.log(`Queuing ${feedsType} message ${metadata.messageId} (waiting for Full snapshot first)`);
    queuedMessages.push({ data, metadata, feedsType });
    return;
  }

  // Mark message as consumed (only if we're going to process it now)
  consumedMessageIds.add(metadata.messageId);

  // Process the message
  processMessage(data, metadata, feedsType, isFull);

  // If this was a Full message, mark as loaded and process queued messages
  if (isFull && !isFullLoaded) {
    isFullLoaded = true;
    console.log(`Full snapshot loaded! Processing ${queuedMessages.length} queued messages...`);

    // Process all queued messages
    const queued = [...queuedMessages];
    queuedMessages = [];

    queued.forEach(msg => {
      console.log(`Processing queued message ${msg.metadata.messageId}`);

      // Mark as consumed before processing
      consumedMessageIds.add(msg.metadata.messageId);

      processMessage(msg.data, msg.metadata, msg.feedsType, false);
    });
  }
}

/**
 * Deep merge an event update into an existing event
 * Preserves all markets/teams/scoreboards and only updates what's in the new event
 */
function mergeEvent(existingEvent, newEvent) {
  // Merge scalar properties
  Object.keys(newEvent).forEach(key => {
    if (key !== 'Markets' && key !== 'Teams' && key !== 'ScoreBoards' &&
        key !== 'ProviderDetails' && key !== 'Results' && key !== 'PropSuperCombo') {
      existingEvent[key] = newEvent[key];
    }
  });

  // Merge Markets array
  if (newEvent.Markets && newEvent.Markets.length > 0) {
    if (!existingEvent.Markets) {
      existingEvent.Markets = [];
    }

    newEvent.Markets.forEach(newMarket => {
      const marketId = newMarket.IDMarket || newMarket.idmarket;
      const existingMarketIndex = existingEvent.Markets.findIndex(
        m => (m.IDMarket || m.idmarket) === marketId
      );

      if (existingMarketIndex >= 0) {
        // Merge existing market (preserve selections, update properties)
        const existingMarket = existingEvent.Markets[existingMarketIndex];

        // Update market properties
        Object.keys(newMarket).forEach(key => {
          if (key !== 'Selections') {
            existingMarket[key] = newMarket[key];
          }
        });

        // Merge Selections
        if (newMarket.Selections && newMarket.Selections.length > 0) {
          if (!existingMarket.Selections) {
            existingMarket.Selections = [];
          }

          newMarket.Selections.forEach(newSelection => {
            const selectionId = newSelection.IDSelection || newSelection.idSelection;
            const existingSelectionIndex = existingMarket.Selections.findIndex(
              s => (s.IDSelection || s.idSelection) === selectionId
            );

            if (existingSelectionIndex >= 0) {
              // Update existing selection
              existingMarket.Selections[existingSelectionIndex] = newSelection;
            } else {
              // Add new selection
              existingMarket.Selections.push(newSelection);
            }
          });
        }
      } else {
        // Add new market
        existingEvent.Markets.push(newMarket);
      }
    });
  }

  // Merge Teams array
  if (newEvent.Teams && newEvent.Teams.length > 0) {
    if (!existingEvent.Teams) {
      existingEvent.Teams = [];
    }

    newEvent.Teams.forEach(newTeam => {
      const teamId = newTeam.TeamId;
      const existingTeamIndex = existingEvent.Teams.findIndex(t => t.TeamId === teamId);

      if (existingTeamIndex >= 0) {
        // Update existing team
        existingEvent.Teams[existingTeamIndex] = newTeam;
      } else {
        // Add new team
        existingEvent.Teams.push(newTeam);
      }
    });
  }

  // Merge ScoreBoards array
  if (newEvent.ScoreBoards && newEvent.ScoreBoards.length > 0) {
    if (!existingEvent.ScoreBoards) {
      existingEvent.ScoreBoards = [];
    }

    newEvent.ScoreBoards.forEach(newScoreboard => {
      const resultType = newScoreboard.IdResultType || newScoreboard.idResultType;
      const existingScoreboardIndex = existingEvent.ScoreBoards.findIndex(
        s => (s.IdResultType || s.idResultType) === resultType
      );

      if (existingScoreboardIndex >= 0) {
        // Update existing scoreboard
        existingEvent.ScoreBoards[existingScoreboardIndex] = newScoreboard;
      } else {
        // Add new scoreboard
        existingEvent.ScoreBoards.push(newScoreboard);
      }
    });
  }

  // Update other arrays if present
  if (newEvent.ProviderDetails) existingEvent.ProviderDetails = newEvent.ProviderDetails;
  if (newEvent.Results) existingEvent.Results = newEvent.Results;
  if (newEvent.PropSuperCombo) existingEvent.PropSuperCombo = newEvent.PropSuperCombo;

  return existingEvent;
}

// Process a single message (extracted from handleFeedMessage)
function processMessage(data, metadata, feedsType, isFull = false) {

  console.log(`Processing ${feedsType} message ${metadata.messageId} with ${data.Events?.length || 0} events (Full: ${isFull})`);

  // Record update time
  if (feedTypeManager) {
    feedTypeManager.recordUpdate(feedsType);
  }

  // Tag events with their type and message ID
  if (data && data.Events) {
    data.Events.forEach(event => {
      event.feedsType = feedsType;
      const diffType = event.DiffType ?? event.diffType ?? 0;
      const eventId = event.IDEvent || event.idEvent;
      if (diffType === 1 || diffType === 2) {
        event._messageId = metadata.messageId;
      }
      if (diffType === 2) {
        console.log(`Event ${eventId} marked as REMOVED | Msg: ${metadata.messageId} | ${new Date().toLocaleString()}`);
      }
      // Track persistent highlights so outlines survive tree rebuilds
      if (diffType !== 0 && eventId !== undefined) {
        persistentHighlights[eventId] = { diffType, messageId: metadata.messageId };
      }
    });
  }

  // Apply to current data
  if (isFull) {
    // Full snapshot - replace all data and clear any stale highlights
    console.log(`Loading Full snapshot (${data.Events?.length || 0} events)`);
    currentData = data;
    persistentHighlights = {};
  } else {
    // Incremental update - merge with existing data
    const isFirstLoad = !currentData || !currentData.Events;

    if (isFirstLoad) {
      console.warn(`Received incremental message without Full snapshot - using as base data`);
      currentData = data;
    } else {
      // Deep merge events (preserves all markets/teams/scoreboards)
      data.Events.forEach(newEvent => {
        const existingIndex = currentData.Events.findIndex(
          e => (e.IDEvent || e.idEvent) === (newEvent.IDEvent || newEvent.idEvent)
        );

        if (existingIndex >= 0) {
          // Merge into existing event (preserves markets not in update)
          currentData.Events[existingIndex] = mergeEvent(
            currentData.Events[existingIndex],
            newEvent
          );
        } else {
          // Add new event
          currentData.Events.push(newEvent);
        }
      });

      console.log(`Merged ${data.Events?.length || 0} events (total: ${currentData.Events.length})`);
    }
  }

  // Update UI based on auto-refresh setting and message type
  if (isFull || autoRefresh) {
    // Auto-refresh on Full snapshot or if auto-refresh enabled
    updateUI();
    resetPendingUpdates();
    // Also update event detail panel for incremental messages in auto-refresh mode
    if (!isFull && data.Events) {
      applyTreeMessageBadges(data.Events);
      applyTreeHighlights(data.Events);  // Show red/green/yellow outlines in auto-refresh too
      if (currentEventId) {
        data.Events.forEach(event => {
          updateEventDetail(event, currentEventId, metadata.messageId);
        });
      }
    }
  } else {
    // Manual refresh mode - store pending events and apply incremental updates
    console.log(`Storing pending events for manual refresh`);

    // Store pending events
    if (data.Events && data.Events.length > 0) {
      pendingEvents.push(...data.Events);
    }

    // Apply incremental updates to event detail view (if user is viewing an event)
    // This allows live updates to the currently viewed event even in manual mode
    if (currentEventId && data.Events) {
      data.Events.forEach(event => {
        updateEventDetail(event, currentEventId, metadata.messageId);
      });
    }

    // Increment counter to show pending updates count
    incrementPendingUpdates(metadata.messageId);
  }

  updateDataStatus(metadata, feedsType);
}

// Handle Full message
function handleFullMessage(dataFeedsDiff, metadata) {
  currentData = dataFeedsDiff;

  // Update status
  const eventCount = dataFeedsDiff.Events?.length || 0;
  $('#data-events-count').text(`Full: ${eventCount} events | ${metadata.filename}`);

  // Build tree
  buildTree(dataFeedsDiff.Events);
  filterTreeByEventId($('#tree-search-input').val());

  console.log(`Loaded ${eventCount} events`);
}

// Handle Snapshot message
function handleSnapshotMessage(dataFeedsDiff, metadata) {
  if (!currentData) {
    console.warn('No base data loaded, cannot apply snapshot');
    return;
  }

  // Apply diff to current data
  applySnapshotDiff(dataFeedsDiff, currentEventId, metadata.id);

  // Update current data
  currentData = dataFeedsDiff;

  console.log(`Applied Snapshot ${metadata.id}`);
}

// Load latest Full on page load
function loadLatestFull() {
  console.log('Requesting latest Full message...');
  clearEventDetail();

  // Set flag to indicate we're waiting for Full
  waitingForFull = true;
  fullMessageId = null;

  socket.emit('request:full');
}

// Load snapshot by ID
function loadSnapshotById(id, feedsType) {
  console.log(`Requesting Snapshot ${id} (${feedsType})...`);
  socket.emit('request:snapshot', { id, feedsType });
}

// Re-apply highlights that must survive tree rebuilds (e.g. REMOVED events stay red)
function applyPersistentHighlights() {
  const entries = Object.entries(persistentHighlights);
  if (entries.length === 0) return;
  const events = entries.map(([id, info]) => ({
    IDEvent: isNaN(Number(id)) ? id : Number(id),
    _messageId: info.messageId,
    DiffType: info.diffType
  }));
  applyTreeHighlights(events);
}

// Update UI based on current filter
function updateUI() {
  if (!currentData || !currentData.Events) {
    console.warn('updateUI: No currentData or Events');
    return;
  }

  console.log('updateUI: Total events:', currentData.Events.length);

  // Filter events based on feed type selection
  const filteredEvents = currentData.Events.filter(event => {
    if (!feedTypeManager) return true;
    return feedTypeManager.shouldShowEvent(event);
  });

  console.log('updateUI: Filtered events:', filteredEvents.length);

  // Rebuild tree with filtered events
  buildTree(filteredEvents);
  filterTreeByEventId($('#tree-search-input').val());

  // Restore persistent highlights after tree rebuild (REMOVED stays red, etc.)
  applyPersistentHighlights();

  // Update event detail if currently selected event is filtered out
  if (currentEventId) {
    const event = filteredEvents.find(e => e.IDEvent === currentEventId);
    if (!event) {
      clearEventDetail();
      currentEventId = null;
    }
  }
}

// Update data status display
function updateDataStatus(metadata, feedsType) {
  const eventCount = currentData?.Events?.filter(e => (e.DiffType ?? e.diffType ?? 0) !== 2).length || 0;
  const typeLabel = feedsType || 'Unknown';
  $('#data-events-count').text(`${typeLabel}: ${eventCount} events`);

  // Update message ID indicator
  if (metadata && metadata.messageId) {
    $('#message-id-indicator').text(`📨 Msg ID: ${metadata.messageId}`);
  }
}

// Expose tree reveal for use by eventRenderer (no ES module imports there)
window.revealEventInTree = revealEventInTree;

// Handle tree node click (event selection)
window.onEventSelect = function(eventId) {
  currentEventId = eventId;

  if (!currentData || !currentData.Events) {
    console.warn('No data loaded');
    return;
  }

  // Find event in current data (try both camelCase and PascalCase)
  const event = currentData.Events.find(e => (e.IDEvent || e.idEvent) === eventId);
  if (!event) {
    console.warn(`Event ${eventId} not found in current data`);
    return;
  }

  // Render event detail
  renderEventDetail(event);
};

// Listen for feed filter changes
window.addEventListener('feedFilterChanged', () => {
  updateUI();
  resetPendingUpdates(); // Reset counter when user changes filter
  // If no Full loaded yet, request one now
  if (!isFullLoaded && !waitingForFull && socket) {
    console.log('Feed type changed but no data loaded - auto-requesting Full...');
    waitingForFull = true;
    fullMessageId = null;
    socket.emit('request:full');
    $('#tree-container').html('<div class="loading">⏳ Requesting Full snapshot from bridge...</div>');
    $('#data-events-count').text('⏳ Requesting Full from bridge...');
  }
});

// Pending updates management
function incrementPendingUpdates(messageId) {
  pendingUpdates++;
  if (messageId) {
    pendingMessageIds.push(messageId);
  }
  updatePendingBadge();
}

function resetPendingUpdates() {
  pendingUpdates = 0;
  pendingMessageIds = [];
  pendingEvents = []; // Clear pending events
  updatePendingBadge();
}

function updatePendingBadge() {
  const badge = $('#pending-updates-badge');
  const button = $('#btn-refresh-tree');

  if (pendingUpdates > 0) {
    badge.text(pendingUpdates).removeClass('hidden').addClass('pulse');

    // Add tooltip with message IDs
    const tooltip = `${pendingUpdates} pending update(s)\nMessage IDs: ${pendingMessageIds.join(', ')}`;
    button.attr('title', tooltip);

    console.log(`Pending updates: ${pendingUpdates} | Message IDs: ${pendingMessageIds.join(', ')}`);
  } else {
    badge.addClass('hidden').removeClass('pulse');
    button.attr('title', 'Refresh tree with latest data');
  }
}

// Manual refresh tree - rebuild tree and apply visual highlights
function refreshTree() {
  if (pendingEvents.length > 0) {
    console.log(`Rebuilding tree with ${pendingEvents.length} pending events`);

    // Rebuild tree to update event counts and structure
    updateUI();

    // Apply visual highlights to tree (red/green/yellow outlines based on DiffType)
    applyTreeHighlights(pendingEvents);

    // Clear pending events
    pendingEvents = [];
  } else {
    console.log(`No pending events - rebuilding tree to refresh counts`);

    // Still rebuild tree to refresh event counts
    updateUI();
  }

  resetPendingUpdates();
}

// UI Event Handlers
$(document).ready(() => {
  console.log('Sports Calendar App initializing...');

  // Attach tree search handlers (once, independent of tree rebuilds)
  attachSearchHandlers();

  // Initialize Feed Type Manager
  feedTypeManager = new FeedTypeManager();
  window.feedTypeManager = feedTypeManager; // Make available globally

  // Initialize Socket.io
  initSocket();

  // Check URL parameters for snapshot ID
  const urlParams = new URLSearchParams(window.location.search);
  const snapshotId = urlParams.get('snapshot');

  // Auto-request Full snapshot on initial connect
  socket.on('connect', () => {
    if (!isFullLoaded && !waitingForFull) {
      console.log('Connected - auto-requesting Full snapshot...');
      $('#tree-container').html('<div class="loading">⏳ Requesting Full snapshot from bridge...</div>');
      $('#data-events-count').text('⏳ Requesting Full from bridge...');
      waitingForFull = true;
      fullMessageId = null;
      socket.emit('request:full');
    } else {
      console.log('Connected - Full already loaded or already requested');
    }
  });

  // Reset button - request fresh Full messages from .NET bridge
  $('#btn-reset').on('click', () => {
    console.log('Requesting fresh Full messages from bridge...');

    // Set flag to indicate we're waiting for Full
    waitingForFull = true;
    fullMessageId = null;

    socket.emit('request:full');

    // Clear current data to show loading state
    currentData = null;
    clearEventDetail();
    consumedMessageIds.clear(); // Clear consumed message IDs to allow reprocessing
    chunkedMessages = {}; // Clear any incomplete chunked messages
    isFullLoaded = false; // Reset Full loaded flag
    queuedMessages = []; // Clear queued messages
    isReceivingChunkedFull = false; // Clear chunked Full blocking flag
    receivingFullMessageId = null; // Clear receiving Full message ID
    persistentHighlights = {}; // Clear highlight state
    resetPendingUpdates();
    $('#tree-container').html('<div class="loading">⏳ Loading Fresh Full messages...</div>');
    $('#data-events-count').text('⏳ Requesting Fresh Full from bridge...');
  });

  // Load snapshot button
  $('#btn-load-snapshot').on('click', () => {
    const id = $('#input-snapshot-id').val();
    if (!id || isNaN(parseInt(id, 10))) {
      alert('Please enter a valid Snapshot ID');
      return;
    }
    // Guard: a Full snapshot must be loaded first (tree must exist)
    if (!currentData || !currentData.Events || currentData.Events.length === 0) {
      alert('Please load a Full snapshot first before loading a Snapshot ID.');
      return;
    }
    // Use the current Fixed / Live filter as feed-type context
    const feedsType = feedTypeManager && feedTypeManager.getFilter() === 'live' ? 'Live' : 'Fixed';
    loadSnapshotById(parseInt(id, 10), feedsType);
  });

  // Allow Enter key in snapshot input
  $('#input-snapshot-id').on('keypress', (e) => {
    if (e.which === 13) {
      $('#btn-load-snapshot').click();
    }
  });

  // Refresh tree button
  $('#btn-refresh-tree').on('click', () => {
    refreshTree();
    console.log('Manual tree refresh');
  });

  // Auto-refresh toggle
  $('#chk-auto-refresh').on('change', function() {
    autoRefresh = $(this).is(':checked');
    console.log(`Auto-refresh: ${autoRefresh ? 'ON' : 'OFF'}`);

    if (autoRefresh && pendingUpdates > 0) {
      // If enabling auto-refresh and there are pending updates, refresh now
      refreshTree();
    }
  });

  console.log('App initialized');
});
