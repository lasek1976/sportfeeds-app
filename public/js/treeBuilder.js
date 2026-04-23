/**
 * Tree Builder Module
 * Aggregates Events into Sport -> Category -> Tournament -> Event hierarchy
 */

/**
 * Extract first available translation from translation dictionary
 * Structure: map<string, TranslationList> where TranslationList has items array
 * Prefers common languages (it, en, es, de, fr) but accepts ANY language as fallback (including "--")
 */
function getFirstTranslation(translationDict) {
  if (!translationDict || typeof translationDict !== 'object') {
    return '';
  }

  // translationDict IS the map directly (no .translations property)
  const languages = Object.keys(translationDict);
  if (languages.length === 0) return '';

  // Preferred languages in order
  const preferredLanguages = ['it', 'en', 'es', 'de', 'fr'];

  // Try preferred languages first
  for (const lang of preferredLanguages) {
    if (languages.includes(lang)) {
      const translationList = translationDict[lang];
      if (translationList?.items?.length > 0) {
        const value = translationList.items[0].value || translationList.items[0].Value;
        if (value) return value;
      }
    }
  }

  // Fallback: use ANY available language (including "--" or others)
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
 * Save current tree state (expanded nodes and selected event)
 */
function saveTreeState() {
  const expandedNodes = [];
  $('.tree-node.expanded').each(function() {
    const type = $(this).data('type');
    const id = $(this).data('id');
    expandedNodes.push({ type, id });
  });

  const selectedEventId = $('.tree-node-header.selected').parent().data('id');

  return { expandedNodes, selectedEventId };
}

/**
 * Restore tree state (expanded nodes and selected event)
 */
function restoreTreeState(state) {
  if (!state) return;

  // Restore expanded nodes
  state.expandedNodes.forEach(node => {
    $(`.tree-node[data-type="${node.type}"][data-id="${node.id}"]`)
      .removeClass('collapsed')
      .addClass('expanded');
  });

  // Restore selected event
  if (state.selectedEventId) {
    $(`.tree-node[data-type="event"][data-id="${state.selectedEventId}"] .tree-node-header`)
      .addClass('selected');
  }
}

/**
 * Build tree from events array
 * @param {Array} events - Array of DataEventDiff objects
 */
export function buildTree(events) {
  console.log('buildTree called with events:', events?.length || 0);

  if (!events || events.length === 0) {
    console.warn('No events to build tree');
    $('#tree-container').html('<div class="loading">No events available</div>');
    return;
  }

  // Save current state before rebuilding
  const treeState = saveTreeState();

  // 1. Extract Sports (try both camelCase and PascalCase)
  const sports = _.uniqBy(
    events.map(e => ({
      id: e.IDSport || e.idSport,
      name: e.SportName || e.sportName ||
            getFirstTranslation(e.SportNameTranslations || e.sportNameTranslations) ||
            `Sport ${e.IDSport || e.idSport}`,
      order: e.SportOrder || e.sportOrder || 0,
      diffType: e.SportDiffType || e.sportDiffType
    })),
    'id'
  ).sort((a, b) => a.order - b.order);

  console.log('Extracted sports:', sports.length, sports);

  // 2. Build tree HTML
  let html = '';

  sports.forEach(sport => {
    // Count total events for this sport
    const sportEvents = events.filter(e => (e.IDSport || e.idSport) === sport.id);
    const eventCount = sportEvents.filter(e => (e.DiffType ?? e.diffType ?? 0) !== 2).length;

    // Get categories for this sport (try both camelCase and PascalCase)
    const categories = _.uniqBy(
      sportEvents
        .map(e => ({
          id: e.IDCategory || e.idCategory,
          name: e.CategoryName || e.categoryName ||
                getFirstTranslation(e.CategoryNameTranslations || e.categoryNameTranslations) ||
                `Category ${e.IDCategory || e.idCategory}`,
          order: e.CategoryOrder || e.categoryOrder || 0,
          sportId: e.IDSport || e.idSport,
          diffType: e.CategoryDiffType || e.categoryDiffType
        })),
      'id'
    ).sort((a, b) => a.order - b.order);

    html += `
      <div class="tree-node collapsed" data-type="sport" data-id="${sport.id}">
        <div class="tree-node-header">
          <span class="tree-toggle"></span>
          <span class="tree-sport-id">${sport.id}</span>
          <span class="tree-label">${_.escape(sport.name)} <span class="event-count">(${eventCount})</span></span>
          <span class="sport-expand-all" title="Expand all">⊞</span>
          <span class="sport-collapse-all" title="Collapse all">⊟</span>
        </div>
        <div class="tree-node-children">
    `;

    categories.forEach(category => {
      // Count active events for this category
      const categoryEventCount = events
        .filter(e => (e.IDSport || e.idSport) === sport.id && (e.IDCategory || e.idCategory) === category.id)
        .filter(e => (e.DiffType ?? e.diffType ?? 0) !== 2).length;

      // Get tournaments for this category (try both camelCase and PascalCase)
      const tournaments = _.uniqBy(
        events
          .filter(e => (e.IDSport || e.idSport) === sport.id && (e.IDCategory || e.idCategory) === category.id)
          .map(e => ({
            id: e.IDTournament || e.idTournament,
            name: e.TournamentName || e.tournamentName ||
                  getFirstTranslation(e.TournamentNameTranslations || e.tournamentNameTranslations) ||
                  `Tournament ${e.IDTournament || e.idTournament}`,
            order: e.TournamentOrder || e.tournamentOrder || 0,
            categoryId: e.IDCategory || e.idCategory,
            diffType: e.TournamentDiffType || e.tournamentDiffType
          })),
        'id'
      ).sort((a, b) => a.order - b.order);

      html += `
        <div class="tree-node collapsed" data-type="category" data-id="${category.id}">
          <div class="tree-node-header">
            <span class="tree-toggle"></span>
            <span class="tree-label">${_.escape(category.name)} <span class="event-count">(${categoryEventCount})</span></span>
          </div>
          <div class="tree-node-children">
      `;

      tournaments.forEach(tournament => {
        // Get events for this tournament (try both camelCase and PascalCase)
        const tournamentEvents = events
          .filter(e =>
            (e.IDSport || e.idSport) === sport.id &&
            (e.IDCategory || e.idCategory) === category.id &&
            (e.IDTournament || e.idTournament) === tournament.id
          )
          .sort((a, b) => ((a.EventOrder || a.eventOrder) || 0) - ((b.EventOrder || b.eventOrder) || 0));

        const tournamentEventCount = tournamentEvents.filter(e => (e.DiffType ?? e.diffType ?? 0) !== 2).length;

        html += `
          <div class="tree-node collapsed" data-type="tournament" data-id="${tournament.id}">
            <div class="tree-node-header">
              <span class="tree-toggle"></span>
              <span class="tree-label">${_.escape(tournament.name)} <span class="event-count">(${tournamentEventCount})</span></span>
              <span class="tournament-copy-ids" title="evts to clipboard">⎘</span>
            </div>
            <div class="tree-node-children">
        `;

        tournamentEvents.forEach(event => {
          const eventName = event.EventName || event.eventName ||
                           getFirstTranslation(event.EventNameTranslations || event.eventNameTranslations) ||
                           `Event ${event.IDEvent || event.idEvent}`;
          const eventDiffType = event.DiffType ?? event.diffType ?? 0;
          const diffClass = eventDiffType === 1 ? ' highlight-added'
                          : eventDiffType === 2 ? ' highlight-removed'
                          : eventDiffType === 3 ? ' highlight-updated'
                          : '';
          html += `
            <div class="tree-node tree-node-leaf${diffClass}" data-type="event" data-id="${event.IDEvent || event.idEvent}">
              <div class="tree-node-header">
                <span class="tree-toggle"></span>
                <span class="tree-label">${_.escape(eventName)} <span class="entity-id">(${event.IDEvent || event.idEvent})</span></span>
              </div>
            </div>
          `;
        });

        html += `
            </div>
          </div>
        `;
      });

      html += `
          </div>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;
  });

  // Render tree
  console.log('Rendering tree HTML (' + html.length + ' chars)');
  $('#tree-container').html(html);

  // Restore previous state
  restoreTreeState(treeState);

  // Attach event handlers
  attachTreeHandlers();

  console.log('Tree built successfully - Click icons to expand nodes');
}

/**
 * Attach click handlers to tree nodes
 */
function attachTreeHandlers() {
  // Copy active event IDs for a tournament
  $('.tournament-copy-ids').on('click', function(e) {
    e.stopPropagation();
    const $tournament = $(this).closest('.tree-node[data-type="tournament"]');
    const ids = $tournament.find('.tree-node[data-type="event"]:not(.highlight-removed)')
      .map(function() { return $(this).data('id'); })
      .get();
    const $btn = $(this);
    navigator.clipboard.writeText(ids.join('\n')).then(() => {
      $btn.text('✓');
      setTimeout(() => $btn.text('⎘'), 1200);
    });
  });

  // Expand all nodes inside a sport
  $('.sport-expand-all').on('click', function(e) {
    e.stopPropagation();
    const $sport = $(this).closest('.tree-node[data-type="sport"]');
    $sport.add($sport.find('.tree-node')).removeClass('collapsed').addClass('expanded');
  });

  // Collapse all nodes inside a sport
  $('.sport-collapse-all').on('click', function(e) {
    e.stopPropagation();
    const $sport = $(this).closest('.tree-node[data-type="sport"]');
    $sport.add($sport.find('.tree-node')).removeClass('expanded').addClass('collapsed');
  });

  // Toggle expand/collapse
  $('.tree-node-header').on('click', function(e) {
    e.stopPropagation();

    const $node = $(this).parent();
    const nodeType = $node.data('type');

    // Toggle expand/collapse for non-leaf nodes
    if (nodeType !== 'event') {
      $node.toggleClass('expanded collapsed');
    }

    // If event node, trigger event selection
    if (nodeType === 'event') {
      const eventId = $node.data('id');

      // Highlight selected event
      $('.tree-node-header').removeClass('selected');
      $(this).addClass('selected');

      // Call global event handler
      if (window.onEventSelect) {
        window.onEventSelect(eventId);
      }
    }
  });
}

/**
 * Filter the tree by Event ID (partial match).
 * Hides non-matching event leaves and collapses empty ancestor nodes.
 * Passing an empty string restores the full tree.
 */
export function filterTreeByEventId(query) {
  const q = query.trim();

  if (!q) {
    // Restore all nodes
    $('.tree-node').removeClass('tree-search-hidden');
    return;
  }

  // Show/hide event leaves based on match
  $('.tree-node[data-type="event"]').each(function() {
    const id = String($(this).data('id'));
    if (id.includes(q)) {
      $(this).removeClass('tree-search-hidden');
    } else {
      $(this).addClass('tree-search-hidden');
    }
  });

  // Hide/show tournaments based on whether they have any visible events
  $('.tree-node[data-type="tournament"]').each(function() {
    const hasVisible = $(this).find('.tree-node[data-type="event"]:not(.tree-search-hidden)').length > 0;
    if (hasVisible) {
      $(this).removeClass('tree-search-hidden').addClass('expanded').removeClass('collapsed');
    } else {
      $(this).addClass('tree-search-hidden');
    }
  });

  // Hide/show categories based on whether they have any visible tournaments
  $('.tree-node[data-type="category"]').each(function() {
    const hasVisible = $(this).find('.tree-node[data-type="tournament"]:not(.tree-search-hidden)').length > 0;
    if (hasVisible) {
      $(this).removeClass('tree-search-hidden').addClass('expanded').removeClass('collapsed');
    } else {
      $(this).addClass('tree-search-hidden');
    }
  });

  // Hide/show sports based on whether they have any visible categories
  $('.tree-node[data-type="sport"]').each(function() {
    const hasVisible = $(this).find('.tree-node[data-type="category"]:not(.tree-search-hidden)').length > 0;
    if (hasVisible) {
      $(this).removeClass('tree-search-hidden').addClass('expanded').removeClass('collapsed');
    } else {
      $(this).addClass('tree-search-hidden');
    }
  });
}

/**
 * Attach search input handlers (called once on page load, not on tree rebuild)
 */
export function attachSearchHandlers() {
  $('#tree-search-input').on('input', function() {
    filterTreeByEventId($(this).val());
  });

  $('#tree-search-clear').on('click', function() {
    $('#tree-search-input').val('');
    filterTreeByEventId('');
  });
}

/**
 * Collapse all tree nodes
 */
/**
 * Expand all ancestor nodes of an event and scroll it into view
 */
export function revealEventInTree(eventId) {
  const $eventNode = $(`.tree-node[data-type="event"][data-id="${eventId}"]`);
  if ($eventNode.length === 0) return;

  // Expand all ancestor tree-nodes
  $eventNode.parents('.tree-node').removeClass('collapsed').addClass('expanded');

  // Scroll into view inside the tree panel
  const treeContainer = document.getElementById('tree-container');
  const nodeEl = $eventNode[0];
  if (treeContainer && nodeEl) {
    const containerRect = treeContainer.getBoundingClientRect();
    const nodeRect = nodeEl.getBoundingClientRect();
    const offset = nodeRect.top - containerRect.top + treeContainer.scrollTop - 80;
    treeContainer.scrollTo({ top: offset, behavior: 'smooth' });
  }

  // Brief flash to draw the eye
  $eventNode.addClass('tree-reveal-flash');
  setTimeout(() => $eventNode.removeClass('tree-reveal-flash'), 1200);
}

export function collapseAll() {
  $('.tree-node').removeClass('expanded').addClass('collapsed');
}

/**
 * Expand all tree nodes
 */
export function expandAll() {
  $('.tree-node').removeClass('collapsed').addClass('expanded');
}
