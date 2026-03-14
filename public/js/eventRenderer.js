/**
 * Event Renderer Module
 * Renders event details including Teams, ScoreBoards, and Markets
 */

/**
 * Extract first available translation
 * Handles both the old format (nested .translations) and protobuf map format
 */
function getFirstTranslation(translationDict) {
  if (!translationDict) {
    return '';
  }

  // Debug: log the structure
  console.log('Translation dict structure:', translationDict);

  // Try protobuf map format (direct language keys)
  const languages = Object.keys(translationDict);
  if (languages.length === 0) return '';

  const firstLang = languages[0];
  let translationList = translationDict[firstLang];

  // If translationList has .items, extract from there
  if (translationList && translationList.items && translationList.items.length > 0) {
    const firstItem = translationList.items[0];
    return firstItem.value || firstItem.Value || '';
  }

  // Try old nested format
  if (translationDict.translations) {
    const nestedLangs = Object.keys(translationDict.translations);
    if (nestedLangs.length > 0) {
      const nestedLang = nestedLangs[0];
      translationList = translationDict.translations[nestedLang];
      if (translationList && translationList.items && translationList.items.length > 0) {
        const firstItem = translationList.items[0];
        return firstItem.value || firstItem.Value || '';
      }
    }
  }

  return '';
}

/**
 * Convert .NET ticks to JavaScript Date
 */
function ticksToDate(ticks) {
  if (!ticks || ticks === 0) return null;

  const dotNetEpochDiff = 621355968000000000;
  const ticksPerMillisecond = 10000;

  const milliseconds = (ticks - dotNetEpochDiff) / ticksPerMillisecond;
  return new Date(milliseconds);
}

/**
 * Format date for display
 */
function formatDate(date) {
  if (!date) return '';
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Render event detail in center panel
 * @param {Object} event - DataEventDiff object
 */
export function renderEventDetail(event) {
  const eventId = event.IDEvent || event.idEvent;
  const eventName = event.EventName || getFirstTranslation(event.EventNameTranslations);
  const eventDate = event.EventDate ? formatDate(ticksToDate(event.EventDate)) : event.EventDateString || '';

  let html = `
    <div class="event-detail-content">
      <div class="event-header">
        <h1>${_.escape(eventName)} <span class="entity-id">(${eventId})</span></h1>
        <div class="event-date">
          ${_.escape(eventDate)}
          <span class="markets-expand-all" title="Expand all markets">⊞</span>
          <span class="markets-collapse-all" title="Collapse all markets">⊟</span>
        </div>
      </div>
  `;

  // Teams Section
  if (event.Teams && event.Teams.length > 0) {
    html += `
      <div class="teams-section">
        <h3>Teams</h3>
    `;

    event.Teams
      .sort((a, b) => (a.IdTeamNumber || 0) - (b.IdTeamNumber || 0))
      .forEach(team => {
        const teamName = team.TeamName || team.FullTeamName || '';
        html += `
          <div class="team" data-team-id="${team.TeamId}" data-team-number="${team.IdTeamNumber}">
            <span class="team-number">[${team.IdTeamNumber}]</span>
            <span class="team-name">${_.escape(teamName)}</span>
          </div>
        `;
      });

    html += `</div>`;
  }

  // ScoreBoards Section
  if (event.ScoreBoards && event.ScoreBoards.length > 0) {
    html += `
      <div class="scoreboards-section expanded">
        <div class="scoreboards-header">
          <span class="scoreboards-toggle"></span>
          <h3>Score</h3>
        </div>
        <div class="scoreboards-content">
    `;

    event.ScoreBoards.forEach(scoreboard => {
      const label = getScoreboardLabel(scoreboard.IdResultType);
      html += `
        <div class="scoreboard" data-result-type="${scoreboard.IdResultType}">
          <span class="label">${label}:</span>
          <span class="value">${_.escape(scoreboard.ResultValue || '')}</span>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;
  }

  // Markets Section
  if (event.Markets && event.Markets.length > 0) {
    html += `
      <div class="markets-section">
        <h3>Markets</h3>
    `;

    // Sort markets by MarketOrder, then IDMarket
    const markets = [...event.Markets].sort((a, b) => {
      const orderDiff = (a.MarketOrder || 0) - (b.MarketOrder || 0);
      if (orderDiff !== 0) return orderDiff;
      return (a.IDMarket || 0) - (b.IDMarket || 0);
    });

    markets.forEach(market => {
      const marketId = market.IDMarket || market.idmarket;
      const marketName = market.nameOverride ||
                        market.NameOverride ||
                        getFirstTranslation(market.marketNameTranslations || market.MarketNameTranslations) ||
                        `Market`;

      html += `
        <div class="market collapsed" data-market-id="${marketId}">
          <div class="market-header">
            <span class="market-toggle"></span>
            <span class="market-name">${_.escape(marketName)} <span class="entity-id">(${marketId})</span></span>
          </div>
          <div class="market-selections">
      `;

      // Sort selections by SelectionOrder, then IDSelection
      if (market.Selections && market.Selections.length > 0) {
        const selections = [...market.Selections].sort((a, b) => {
          const orderDiff = (a.SelectionOrder || 0) - (b.SelectionOrder || 0);
          if (orderDiff !== 0) return orderDiff;
          return (a.IDSelection || 0) - (b.IDSelection || 0);
        });

        selections.forEach(selection => {
          const selectionId = selection.IDSelection || selection.idselection;
          const selectionName = selection.selectionName ||
                               selection.SelectionName ||
                               getFirstTranslation(selection.selectionNameTranslations || selection.SelectionNameTranslations) ||
                               `Selection`;
          const oddValue = selection.oddValue ?? selection.OddValue ?? 0;

          let oddDisplay = oddValue;
          let oddIndicator = '';
          if (oddValue >= 0 && oddValue < 1) {
            oddIndicator = '<span class="odd-locked">🔒</span>';
          }

          html += `
            <div class="selection" data-selection-id="${selectionId}" data-odd-value="${oddValue}">
              <span class="selection-name">${_.escape(selectionName)} <span class="entity-id">(${selectionId})</span></span>
              <span class="selection-odd">${oddDisplay}${oddIndicator}</span>
            </div>
          `;
        });
      }

      html += `
          </div>
        </div>
      `;
    });

    html += `</div>`;
  }

  html += `</div>`;

  // Render to DOM
  $('#event-detail').html(html);

  // Attach toggle handlers for markets and scoreboards
  attachToggleHandlers();
}

/**
 * Get human-readable label for scoreboard result type
 */
function getScoreboardLabel(idResultType) {
  const labels = {
    1: 'Current',
    2: 'Quarter',
    3: 'Half',
    4: 'Period',
    5: 'Set',
    6: 'Game'
  };
  return labels[idResultType] || `Type ${idResultType}`;
}

/**
 * Attach market and scoreboards expand/collapse handlers
 */
function attachToggleHandlers() {
  $('.markets-expand-all').on('click', function() {
    $('.market').removeClass('collapsed').addClass('expanded');
  });

  $('.markets-collapse-all').on('click', function() {
    $('.market').removeClass('expanded').addClass('collapsed');
  });

  $('.market-header').on('click', function() {
    const $market = $(this).parent();
    $market.toggleClass('expanded collapsed');
  });

  $('.scoreboards-header').on('click', function() {
    const $scoreboards = $(this).parent();
    $scoreboards.toggleClass('expanded collapsed');
  });
}

/**
 * Clear event detail panel
 */
export function clearEventDetail() {
  $('#event-detail').html(`
    <div class="empty-state">
      <p>Select an event from the tree to view details</p>
    </div>
  `);
}
