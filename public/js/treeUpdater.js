/**
 * Tree Updater Module
 * Applies visual highlights to events in the tree based on DiffType
 */

const DiffType = {
  EQUAL: 0,
  ADDED: 1,
  REMOVED: 2,
  UPDATED: 3
};

/**
 * Apply visual highlights to events in the tree based on pending updates
 * - REMOVED events: Red outline
 * - ADDED events: Green outline
 * - UPDATED events: Yellow outline
 */
export function applyTreeHighlights(events) {
  if (!events || events.length === 0) {
    console.log('No events to highlight');
    return;
  }

  console.log(`🎨 Applying visual highlights to ${events.length} events in tree`);

  let added = 0, removed = 0, updated = 0;

  events.forEach(event => {
    const eventId = event.IDEvent || event.idEvent;
    const diffType = event.DiffType ?? event.diffType ?? 0;
    const $eventNode = $(`.tree-node[data-type="event"][data-id="${eventId}"]`);

    if ($eventNode.length === 0) {
      return; // Event not in tree
    }

    // Remove previous highlight classes
    $eventNode.removeClass('highlight-added highlight-removed highlight-updated');

    switch (diffType) {
      case DiffType.ADDED:
        $eventNode.addClass('highlight-added');
        setTreeMsgBadge($eventNode, event._messageId);
        $eventNode.parents('.tree-node').removeClass('collapsed').addClass('expanded');
        added++;
        console.log(`  🟢 Event ${eventId} - ADDED (green outline)`);
        break;

      case DiffType.REMOVED:
        $eventNode.addClass('highlight-removed');
        setTreeMsgBadge($eventNode, event._messageId);
        removed++;
        console.log(`  🔴 Event ${eventId} - REMOVED (red outline) | Msg: ${event._messageId ?? '?'} | ${new Date().toLocaleString()}`);
        break;

      case DiffType.UPDATED:
        $eventNode.addClass('highlight-updated');
        updated++;
        console.log(`  🟡 Event ${eventId} - UPDATED (yellow outline)`);
        break;
    }
  });

  console.log(`✓ Highlights applied: ${added} added, ${removed} removed, ${updated} updated`);
}

/**
 * Apply message ID badges to ADDED/REMOVED event nodes in the tree.
 * Used in auto-refresh mode after updateUI() rebuilds the tree.
 */
export function applyTreeMessageBadges(events) {
  if (!events) return;

  events.forEach(event => {
    const diffType = event.DiffType ?? event.diffType ?? 0;
    if (diffType !== DiffType.ADDED && diffType !== DiffType.REMOVED) return;
    if (!event._messageId) return;

    const eventId = event.IDEvent || event.idEvent;
    const $eventNode = $(`.tree-node[data-type="event"][data-id="${eventId}"]`);
    if ($eventNode.length > 0) {
      setTreeMsgBadge($eventNode, event._messageId);
    }
  });
}

/**
 * Clear all highlights and message ID badges from the tree
 */
export function clearTreeHighlights() {
  $('.tree-node').removeClass('highlight-added highlight-removed highlight-updated');
  $('.tree-msg-badge').remove();
  console.log('✓ Tree highlights cleared');
}

/**
 * Set or replace the message ID badge on an event tree node header
 */
function setTreeMsgBadge($node, messageId) {
  if (!messageId) return;
  $node.find('.tree-node-header .tree-msg-badge').remove();
  $node.find('.tree-node-header').append(`<span class="tree-msg-badge">${messageId}</span>`);
}
