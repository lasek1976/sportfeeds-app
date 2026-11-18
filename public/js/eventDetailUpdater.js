/**
 * Event Detail Updater Module
 * Handles real-time updates to the currently viewed event with visual indicators
 */

import { factCodeLabel } from './factCodes.js';

const DiffType = {
  EQUAL: 0,
  ADDED: 1,
  REMOVED: 2,
  UPDATED: 3
};

/**
 * Extract first available translation
 */
function getFirstTranslation(translationDict) {
  if (!translationDict || typeof translationDict !== 'object') {
    return '';
  }

  const languages = Object.keys(translationDict);
  if (languages.length === 0) return '';

  const preferredLanguages = ['it', 'en', 'es', 'de', 'fr'];

  for (const lang of preferredLanguages) {
    if (languages.includes(lang)) {
      const translationList = translationDict[lang];
      if (translationList?.items?.length > 0) {
        const value = translationList.items[0].value || translationList.items[0].Value;
        if (value) return value;
      }
    }
  }

  for (const lang of languages) {
    const translationList = translationDict[lang];
    if (translationList?.items?.length > 0) {
      const value = translationList.items[0].value || translationList.items[0].Value;
      if (value) return value;
    }
  }

  return '';
}

/**
 * Update event detail view with new event data
 * Only updates if eventId matches currentEventId
 */
export function updateEventDetail(newEvent, currentEventId, messageId) {
  const eventId = newEvent.IDEvent || newEvent.idEvent;

  // Only update if this is the currently viewed event
  if (eventId !== currentEventId) {
    return;
  }

  console.log(`Updating event detail for event ${eventId}`);

  const eventDiffType = newEvent.DiffType ?? newEvent.diffType ?? 0;

  // If event is REMOVED, highlight it but don't remove from view
  if (eventDiffType === DiffType.REMOVED) {
    $('.event-detail-content').addClass('event-removed-highlight');
    console.log(`  Event ${eventId} marked as REMOVED`);

    // Remove highlight after 3 seconds
    setTimeout(() => {
      $('.event-detail-content').removeClass('event-removed-highlight');
    }, 3000);
    return;
  }

  // If event is UPDATED, process markets
  if (eventDiffType === DiffType.UPDATED && newEvent.Markets) {
    updateMarkets(newEvent.Markets, messageId);
  }

  // Update scoreboards (for Live feeds)
  if (newEvent.ScoreBoards && newEvent.ScoreBoards.length > 0) {
    updateScoreboards(newEvent.ScoreBoards);
  }
}

/**
 * Update scoreboards section
 */
function updateScoreboards(newScoreboards) {
  let $scoreboardsSection = $('.scoreboards-section');

  if ($scoreboardsSection.length === 0) {
    // ScoreBoards section doesn't exist, create it with collapsible structure
    const html = `
      <div class="scoreboards-section expanded">
        <div class="scoreboards-header">
          <span class="scoreboards-toggle"></span>
          <h3>Score</h3>
        </div>
        <div class="scoreboards-content">
        </div>
      </div>
    `;
    $('.event-header').after(html);
    $scoreboardsSection = $('.scoreboards-section');

    // Attach toggle handler
    $('.scoreboards-header').on('click', function() {
      $(this).parent().toggleClass('expanded collapsed');
    });
  }

  const $scoreboardsContent = $('.scoreboards-content');

  newScoreboards.forEach(scoreboard => {
    const resultType = scoreboard.IdResultType || scoreboard.idResultType;
    const value = scoreboard.ResultValue || scoreboard.resultValue || '';
    const $existing = $(`.scoreboard[data-result-type="${resultType}"]`);

    if ($existing.length === 0) {
      // Add new scoreboard
      const label = getScoreboardLabel(resultType);
      const html = `
        <div class="scoreboard" data-result-type="${resultType}">
          <span class="label">${label}:</span>
          <span class="value">${_.escape(value)}</span>
        </div>
      `;
      $scoreboardsContent.append(html);
    } else {
      // Update existing scoreboard value
      const oldValue = $existing.find('.value').text();
      if (oldValue !== value) {
        $existing.find('.value').text(value).addClass('value-updated');
        setTimeout(() => {
          $existing.find('.value').removeClass('value-updated');
        }, 1000);
      }
    }
  });
}

/**
 * Label of a scoreboard: IdResultType is an IDFactCode (decoded from config/fact-codes.csv)
 */
function getScoreboardLabel(idResultType) {
  return `${_.escape(factCodeLabel(idResultType))} <span class="entity-id">(${idResultType})</span>`;
}

/**
 * Re-sort the markets and refresh the header counters after a market changed state
 */
function refreshMarketsSection() {
  sortMarkets();
  updateMarketsCounter();
}

/**
 * Keep markets ordered by group (active, disabled, removed), then MarketOrder, then IDMarket,
 * the same order eventRenderer uses. Re-appending existing elements moves them and keeps
 * their classes, badges and expanded/collapsed state.
 */
function sortMarkets() {
  const $section = $('.markets-section');
  const group = el => el.getAttribute('data-removed') === 'true' ? 2
                    : el.getAttribute('data-program-status') === '0' ? 1
                    : 0;
  const num = (el, attr) => Number(el.getAttribute(attr)) || 0;

  const sorted = $section.children('.market').get().sort((a, b) =>
    (group(a) - group(b)) ||
    (num(a, 'data-market-order') - num(b, 'data-market-order')) ||
    (num(a, 'data-market-id') - num(b, 'data-market-id')));

  $section.append(sorted);
}

/**
 * Refresh the active/disabled/removed counters in the markets section header.
 * The groups are disjoint: Removed (DiffType 2), Disabled (ProgramStatus 0, not removed), Active (the rest).
 */
function updateMarketsCounter() {
  const $markets = $('.markets-section .market');
  if ($markets.length === 0) return;

  const $removedMarkets = $markets.filter('[data-removed="true"]');
  const removedCount = $removedMarkets.length;
  const disabledCount = $markets.not($removedMarkets).filter('[data-program-status="0"]').length;
  const activeCount = $markets.length - removedCount - disabledCount;

  $('.markets-active-count').text(activeCount)
    .attr('title', `${activeCount} active market${activeCount !== 1 ? 's' : ''}`);

  setMarketsCountBadge('markets-disabled-count', disabledCount, 'disabled', $('.markets-active-count'));
  const $disabled = $('.markets-disabled-count');
  setMarketsCountBadge('markets-removed-count', removedCount, 'removed',
    $disabled.length > 0 ? $disabled : $('.markets-active-count'));
}

/**
 * Create, update or remove a counter badge in the markets section header
 */
function setMarketsCountBadge(cssClass, count, label, $after) {
  let $badge = $(`.${cssClass}`);
  if (count === 0) {
    $badge.remove();
    return;
  }
  if ($badge.length === 0) {
    $badge = $(`<span class="${cssClass}"></span>`);
    $after.after($badge);
  }
  $badge.text(`${count} ${label}`)
    .attr('title', `${count} ${label} market${count > 1 ? 's' : ''}`);
}

/**
 * Update markets in the event detail view
 */
function updateMarkets(newMarkets, messageId) {
  console.log(`Processing ${newMarkets.length} markets`);

  newMarkets.forEach(market => {
    const marketId = market.IDMarket || market.idmarket;
    const diffType = market.DiffType ?? market.diffType ?? 0;
    const $existingMarket = $(`.market[data-market-id="${marketId}"]`);

    if ($existingMarket.length === 0) {
      // Market not currently displayed
      if (diffType === DiffType.ADDED) {
        // Add new market with green highlight
        addMarket(market);
        setMessageIdBadge($(`.market[data-market-id="${marketId}"] .market-header`), messageId, getChangeDate(market));
        refreshMarketsSection();
      }
      return;
    }

    // Market exists in view
    switch (diffType) {
      case DiffType.ADDED:
        // If market already exists, treat as UPDATED (yellow outline + process selections)
        if (market.Selections && market.Selections.length > 0) {
          updateSelections($existingMarket, market.Selections, messageId);
        }

        $existingMarket.removeClass('market-removed market-added')
                      .removeAttr('data-removed')
                      .addClass('market-updated');
        setMessageIdBadge($existingMarket.find('.market-header'), messageId, getChangeDate(market));
        console.log(`  Market ${marketId} - ADDED but already visible, treating as UPDATED`);
        refreshMarketsSection();

        // Remove highlight after 2 seconds
        setTimeout(() => {
          $existingMarket.removeClass('market-updated');
        }, 2000);
        break;

      case DiffType.REMOVED:
        // Highlight as removed (red outline) but don't remove from DOM
        $existingMarket.removeClass('market-added market-updated')
                      .addClass('market-removed')
                      .attr('data-removed', 'true');
        setMessageIdBadge($existingMarket.find('.market-header'), messageId, getChangeDate(market));
        console.log(`  Market ${marketId} - REMOVED (red outline)`);
        refreshMarketsSection();

        // Keep the red outline (don't auto-remove)
        break;

      case DiffType.UPDATED:
        // Handle ProgramStatus padlock transition
        const newProgramStatus = market.ProgramStatus ?? market.programStatus;
        if (newProgramStatus !== undefined) {
          const currentProgramStatus = parseInt($existingMarket.attr('data-program-status') ?? '1');
          if (currentProgramStatus !== 0 && newProgramStatus === 0) {
            console.log(`  Market ${marketId} - LOCKED (ProgramStatus ${currentProgramStatus}→0)`);
          } else if (currentProgramStatus === 0 && newProgramStatus !== 0) {
            console.log(`  Market ${marketId} - UNLOCKED (ProgramStatus 0→${newProgramStatus})`);
          }
          $existingMarket.toggleClass('market-locked', newProgramStatus === 0)
                        .attr('data-program-status', newProgramStatus);
        }
        const newMarketOrder = market.MarketOrder ?? market.marketOrder;
        if (newMarketOrder !== undefined) {
          $existingMarket.attr('data-market-order', newMarketOrder);
        }

        // Update selections within the market
        if (market.Selections && market.Selections.length > 0) {
          updateSelections($existingMarket, market.Selections, messageId);
        }

        // Highlight as updated (yellow outline)
        $existingMarket.removeClass('market-added market-removed')
                      .removeAttr('data-removed')
                      .addClass('market-updated');
        setMessageIdBadge($existingMarket.find('.market-header'), messageId, getChangeDate(market));
        console.log(`  Market ${marketId} - UPDATED`);
        refreshMarketsSection();

        // Remove highlight after 2 seconds
        setTimeout(() => {
          $existingMarket.removeClass('market-updated');
        }, 2000);
        break;
    }
  });
}

/**
 * Add a new market to the view
 */
function addMarket(market) {
  const marketId = market.IDMarket || market.idmarket;
  const programStatus = market.ProgramStatus ?? market.programStatus ?? 1;
  const marketName = market.nameOverride ||
                    market.NameOverride ||
                    getFirstTranslation(market.marketNameTranslations || market.MarketNameTranslations) ||
                    `Market`;

  let selectionsHtml = '';
  if (market.Selections && market.Selections.length > 0) {
    market.Selections.forEach(selection => {
      const selectionId = selection.IDSelection || selection.idSelection;
      const selectionName = selection.SelectionName || selection.selectionName ||
                           getFirstTranslation(selection.SelectionNameTranslations || selection.selectionNameTranslations) ||
                           'Selection';
      const oddValue = selection.OddValue ?? selection.oddValue ?? 0;

      const isLocked = oddValue >= 0 && oddValue <= 1;
      const oddIndicator = isLocked ? '<span class="odd-locked">🔒</span>' : '';
      const oddDisplay = isLocked ? '' : oddValue;

      selectionsHtml += `
        <div class="selection" data-selection-id="${selectionId}" data-odd-value="${oddValue}">
          <span class="selection-name">${_.escape(selectionName)} (${selectionId})</span>
          <span class="selection-odd">${oddDisplay}${oddIndicator}</span>
        </div>
      `;
    });
  }

  const marketHtml = `
    <div class="market expanded market-added${programStatus === 0 ? ' market-locked' : ''}" data-market-id="${marketId}" data-market-order="${market.MarketOrder ?? market.marketOrder ?? 0}" data-program-status="${programStatus}">
      <div class="market-header">
        <span class="market-toggle"></span>
        <span class="market-name">${_.escape(marketName)} (${marketId})</span>
      </div>
      <div class="market-selections">
        ${selectionsHtml}
      </div>
    </div>
  `;

  $('.markets-section').append(marketHtml);

  // Attach toggle handler
  $(`.market[data-market-id="${marketId}"] .market-header`).on('click', function() {
    $(this).parent().toggleClass('expanded collapsed');
  });

  // Remove green highlight after 3 seconds
  setTimeout(() => {
    $(`.market[data-market-id="${marketId}"]`).removeClass('market-added');
  }, 3000);

  console.log(`  Market ${marketId} added to view`);
}

/**
 * Update selections within a market
 */
function updateSelections($marketElement, newSelections, messageId) {
  const $selectionsContainer = $marketElement.find('.market-selections');

  newSelections.forEach(selection => {
    const selectionId = selection.IDSelection || selection.idSelection;
    const diffType = selection.DiffType ?? selection.diffType ?? 0;
    const newOddValue = selection.OddValue ?? selection.oddValue ?? 0;
    const $existingSelection = $selectionsContainer.find(`.selection[data-selection-id="${selectionId}"]`);

    if ($existingSelection.length === 0) {
      // Selection not in view, skip
      return;
    }

    // Get current odd value
    const currentOddValue = parseFloat($existingSelection.attr('data-odd-value')) || 0;

    // Update odd value
    const $oddSpan = $existingSelection.find('.selection-odd');

    // Remove previous indicators
    $oddSpan.find('.odd-arrow, .odd-locked').remove();

    // Determine indicator
    const newIsLocked = newOddValue >= 0 && newOddValue <= 1;
    let indicator = '';
    if (newIsLocked) {
      indicator = '<span class="odd-locked">🔒</span>';
    } else if (newOddValue > currentOddValue) {
      indicator = '<span class="odd-arrow odd-up">▲</span>';
      console.log(`    Selection ${selectionId} odd increased: ${currentOddValue} → ${newOddValue}`);
    } else if (newOddValue < currentOddValue) {
      indicator = '<span class="odd-arrow odd-down">▼</span>';
      console.log(`    Selection ${selectionId} odd decreased: ${currentOddValue} → ${newOddValue}`);
    }

    // Update display
    $oddSpan.html(`${newIsLocked ? '' : newOddValue}${indicator}`);

    // Update stored value
    $existingSelection.attr('data-odd-value', newOddValue);

    // Add flash effect with directional color
    if (newOddValue !== currentOddValue) {
      const flashClass = newOddValue > currentOddValue ? 'selection-updated-up' : 'selection-updated-down';
      $existingSelection.addClass(flashClass);
      setTimeout(() => {
        $existingSelection.removeClass(flashClass);
      }, 1000);
    }

    // Show message ID badge on the selection row
    setMessageIdBadge($existingSelection, messageId);
  });
}

/**
 * Set or update the message ID badge on a market header or selection row.
 * Creates the badge element if it doesn't exist yet; updates the text if it does.
 * When changeDate is given, a date badge is shown right after the message ID badge.
 */
function setMessageIdBadge($container, messageId, changeDate = null) {
  if (!messageId) return;
  let $badge = $container.find('.snapshot-id-badge');
  if ($badge.length === 0) {
    $badge = $('<span class="snapshot-id-badge"></span>');
    $container.append($badge);
  }
  $badge.text(messageId);

  let $dateBadge = $container.find('.snapshot-date-badge');
  if (!changeDate) {
    $dateBadge.remove(); // don't leave the date of a previous variation next to a new message ID
    return;
  }
  if ($dateBadge.length === 0) {
    $dateBadge = $('<span class="snapshot-date-badge"></span>');
    $badge.after($dateBadge);
  }
  $dateBadge.text(changeDate.toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }));
}

/**
 * Get the time a diff entity (e.g. a market) was created by the producer,
 * from its CreatedUTCTime (google.protobuf.Timestamp decoded as { seconds, nanos }).
 */
function getChangeDate(entity) {
  const ts = entity.CreatedUTCTime ?? entity.createdUTCTime;
  const seconds = Number(ts?.seconds ?? 0);
  if (!seconds) return null;
  return new Date(seconds * 1000 + Math.floor(Number(ts.nanos ?? 0) / 1e6));
}
