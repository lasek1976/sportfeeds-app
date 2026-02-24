/**
 * Diff Applier Module
 * Applies snapshot diffs with visual transitions
 */

const TRANSITION_DURATION = 2000; // 2 seconds

/**
 * Apply snapshot diff to displayed event
 * Only apply if snapshot contains the currently displayed event
 *
 * @param {Object} dataFeedsDiff - Snapshot DataFeedsDiff
 * @param {number} currentEventId - Currently displayed event ID
 */
export function applySnapshotDiff(dataFeedsDiff, currentEventId, snapshotId) {
  if (!currentEventId || !dataFeedsDiff.Events || dataFeedsDiff.Events.length === 0) {
    return;
  }

  // Filter: Only apply if snapshot contains current event
  const updatedEvent = dataFeedsDiff.Events.find(e => e.IDEvent === currentEventId);
  if (!updatedEvent) {
    console.log('Snapshot does not contain current event, skipping update');
    return;
  }

  console.log(`Applying diff for event ${currentEventId}`);

  // Apply Teams diff
  if (updatedEvent.Teams && updatedEvent.Teams.length > 0) {
    applyTeamsDiff(updatedEvent.Teams);
  }

  // Apply ScoreBoards diff
  if (updatedEvent.ScoreBoards && updatedEvent.ScoreBoards.length > 0) {
    applyScoreBoardsDiff(updatedEvent.ScoreBoards);
  }

  // Apply Markets diff
  if (updatedEvent.Markets && updatedEvent.Markets.length > 0) {
    applyMarketsDiff(updatedEvent.Markets, snapshotId);
  }
}

/**
 * Apply Teams diff
 * Teams use YELLOW transition when UPDATED
 */
function applyTeamsDiff(teams) {
  teams.forEach(team => {
    const $team = $(`.team[data-team-id="${team.TeamId}"]`);
    if ($team.length === 0) {
      // Team added (should rarely happen for teams)
      if (team.DiffType === 1) { // ADDED
        console.log(`Team ADDED: ${team.TeamName}`);
        // Would need to render new team - for now, just log
      }
      return;
    }

    // Handle diff types
    switch (team.DiffType) {
      case 1: // ADDED
        applyTransition($team, 'diff-added');
        break;

      case 2: // REMOVED
        applyTransition($team, 'diff-removed');
        break;

      case 3: // UPDATED
        applyTransition($team, 'diff-updated-neutral'); // YELLOW
        // Update team name if changed
        const teamName = team.TeamName || team.FullTeamName || '';
        $team.find('.team-name').text(teamName);
        break;
    }
  });
}

/**
 * Apply ScoreBoards diff
 * ScoreBoards use YELLOW transition when UPDATED
 */
function applyScoreBoardsDiff(scoreboards) {
  scoreboards.forEach(scoreboard => {
    const $scoreboard = $(`.scoreboard[data-result-type="${scoreboard.IdResultType}"]`);
    if ($scoreboard.length === 0) {
      // ScoreBoard added - would need to render it
      if (scoreboard.DiffType === 1) { // ADDED
        console.log(`ScoreBoard ADDED: Type ${scoreboard.IdResultType}`);
      }
      return;
    }

    // Handle diff types
    switch (scoreboard.DiffType) {
      case 1: // ADDED
        applyTransition($scoreboard, 'diff-added');
        break;

      case 2: // REMOVED
        applyTransition($scoreboard, 'diff-removed');
        break;

      case 3: // UPDATED
        applyTransition($scoreboard, 'diff-updated-neutral'); // YELLOW
        // Update score value
        $scoreboard.find('.value').text(scoreboard.ResultValue || '');
        break;
    }
  });
}

/**
 * Apply Markets diff
 * Selections use GREEN/RED for odds changes
 */
function applyMarketsDiff(markets, snapshotId) {
  markets.forEach(market => {
    const $market = $(`.market[data-market-id="${market.IDMarket}"]`);
    if ($market.length === 0) {
      // Market added
      if (market.DiffType === 1) { // ADDED
        console.log(`Market ADDED: ${market.MarketName}`);
        // Would need to render new market
      }
      return;
    }

    // Handle market diff type
    switch (market.DiffType) {
      case 1: // ADDED
        applyTransition($market, 'diff-added');
        setSnapshotBadge($market.find('.market-header'), snapshotId);
        break;

      case 2: // REMOVED
        applyTransition($market, 'diff-removed');
        setSnapshotBadge($market.find('.market-header'), snapshotId);
        break;
    }

    // Apply selections diff
    if (market.Selections && market.Selections.length > 0) {
      applySelectionsDiff(market.Selections, snapshotId);
    }
  });
}

/**
 * Apply Selections diff
 * GREEN for odds increase, RED for odds decrease
 */
function applySelectionsDiff(selections, snapshotId) {
  selections.forEach(selection => {
    const $selection = $(`.selection[data-selection-id="${selection.IDSelection}"]`);
    if ($selection.length === 0) {
      // Selection added
      if (selection.DiffType === 1) { // ADDED
        console.log(`Selection ADDED: ${selection.SelectionName}`);
      }
      return;
    }

    // Handle diff types
    switch (selection.DiffType) {
      case 1: // ADDED
        applyTransition($selection, 'diff-added');
        setSnapshotBadge($selection, snapshotId);
        break;

      case 2: // REMOVED
        applyTransition($selection, 'diff-removed');
        setSnapshotBadge($selection, snapshotId);
        break;

      case 3: // UPDATED
        // Get old odd value
        const $oddElement = $selection.find('.selection-odd');
        const oldOddText = $oddElement.text();
        const oldOdd = parseFloat(oldOddText);
        const newOdd = selection.OddValue;

        // Update odd value
        $oddElement.text(newOdd?.toFixed(2) || '-');

        // Apply color based on change direction
        if (!isNaN(oldOdd) && newOdd !== undefined) {
          if (newOdd > oldOdd) {
            applyTransition($selection, 'diff-updated-up'); // GREEN
          } else if (newOdd < oldOdd) {
            applyTransition($selection, 'diff-updated-down'); // RED
          }
        }

        // Update selection status (locked/active)
        if (selection.SelectionStatus === 0) {
          $selection.addClass('selection-status-locked');
        } else {
          $selection.removeClass('selection-status-locked');
        }

        setSnapshotBadge($selection, snapshotId);
        break;
    }
  });
}

/**
 * Set or update the snapshot ID badge on a market header or selection row.
 * Creates the badge element if it doesn't exist yet; updates the text if it does.
 */
function setSnapshotBadge($container, snapshotId) {
  if (!snapshotId) return;
  let $badge = $container.find('.snapshot-id-badge');
  if ($badge.length === 0) {
    $badge = $('<span class="snapshot-id-badge"></span>');
    $container.append($badge);
  }
  $badge.text(snapshotId);
}

/**
 * Apply visual transition to element
 * Transition lasts 2 seconds then fades back to normal
 */
function applyTransition($element, className) {
  // Remove all existing diff classes
  $element.removeClass('diff-added diff-removed diff-updated-up diff-updated-down diff-updated-neutral');

  // Add new class
  $element.addClass(className);

  // Remove class after transition duration
  setTimeout(() => {
    $element.removeClass(className);
  }, TRANSITION_DURATION);
}
