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
  console.log('🌳 buildTree called with events:', events?.length || 0);

  if (!events || events.length === 0) {
    console.warn('⚠️ No events to build tree');
    $('#tree-container').html('<div class="loading">No events available</div>');
    return;
  }

  console.log('First event sample:', events[0]);

  // Debug: Log field names for first event
  if (events[0]) {
    console.log('Event field names:', Object.keys(events[0]));
    console.log('Sport fields:', {
      IDSport: events[0].IDSport,
      idSport: events[0].idSport,
      SportName: events[0].SportName,
      sportName: events[0].sportName,
      SportNameTranslations: events[0].SportNameTranslations,
      sportNameTranslations: events[0].sportNameTranslations
    });
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

  console.log('📊 Extracted sports:', sports.length, sports);

  // 2. Build tree HTML
  let html = '';

  sports.forEach(sport => {
    // Count total events for this sport
    const sportEvents = events.filter(e => (e.IDSport || e.idSport) === sport.id);
    const eventCount = sportEvents.length;

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
          <span class="tree-label">${_.escape(sport.name)} <span class="event-count">(${eventCount})</span></span>
        </div>
        <div class="tree-node-children">
    `;

    categories.forEach(category => {
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
            <span class="tree-label">${_.escape(category.name)}</span>
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

        html += `
          <div class="tree-node collapsed" data-type="tournament" data-id="${tournament.id}">
            <div class="tree-node-header">
              <span class="tree-toggle"></span>
              <span class="tree-label">${_.escape(tournament.name)}</span>
            </div>
            <div class="tree-node-children">
        `;

        tournamentEvents.forEach(event => {
          const eventName = event.EventName || event.eventName ||
                           getFirstTranslation(event.EventNameTranslations || event.eventNameTranslations) ||
                           `Event ${event.IDEvent || event.idEvent}`;
          html += `
            <div class="tree-node tree-node-leaf" data-type="event" data-id="${event.IDEvent || event.idEvent}">
              <div class="tree-node-header">
                <span class="tree-toggle"></span>
                <span class="tree-label">${_.escape(eventName)}</span>
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
  console.log('📝 Rendering tree HTML (' + html.length + ' chars)');
  $('#tree-container').html(html);

  // Restore previous state
  restoreTreeState(treeState);

  // Attach event handlers
  attachTreeHandlers();

  console.log('✅ Tree built successfully - Click ⊕ icons to expand nodes');
}

/**
 * Attach click handlers to tree nodes
 */
function attachTreeHandlers() {
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
 * Collapse all tree nodes
 */
export function collapseAll() {
  $('.tree-node').removeClass('expanded').addClass('collapsed');
}

/**
 * Expand all tree nodes
 */
export function expandAll() {
  $('.tree-node').removeClass('collapsed').addClass('expanded');
}
