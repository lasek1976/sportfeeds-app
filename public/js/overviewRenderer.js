/**
 * Overview Renderer Module
 * Sport overview: every event of the selected sport (for the current Fixed / Live feed) on one page,
 * with the most important markets as columns. A side panel lets the user pick, per sport and feed,
 * which market types are shown and in which order (saved in localStorage).
 * While the overview is open, incoming variations are applied to it in place.
 */

import { getFirstTranslation } from './treeBuilder.js';
import { getScoreSummary } from './factCodes.js';

const DiffType = {
  EQUAL: 0,
  ADDED: 1,
  REMOVED: 2,
  UPDATED: 3
};

const STORAGE_KEY = 'sportfeeds.overview.markets.v1';
const DEFAULT_MARKET_COUNT = 3;
const RERENDER_DELAY_MS = 300;
const ODD_FLASH_MS = 1500;
const ROW_ADDED_MS = 5000;
const ROW_UPDATED_MS = 2000;

const state = {
  active: false,
  sportId: null,
  feedType: 'fixed',
  columns: [],              // [{ id, name }] selected market types, in display order
  marketTypes: [],          // market types available for the sport (from collectMarketTypes)
  rowHtml: new Map(),       // eventId -> last rendered row HTML (skips no-op DOM replacements)
  lastMessageId: new Map(), // eventId -> last message ID that touched the event
  pendingAdded: new Set(),  // events added since the last render, highlighted after the next one
  rerenderTimer: null,
  filterText: '',
  collapsedGroups: new Set(), // group keys (category|tournament) collapsed by the user
  getEvents: () => [],
  getFeedType: () => 'fixed',
  onEventOpen: null
};

// ----------------------------------------------------------------------------
// Field accessors (PascalCase from protobufjs, camelCase fallback)
// ----------------------------------------------------------------------------

const eventIdOf = e => e.IDEvent || e.idEvent;
const sportIdOf = e => e.IDSport || e.idSport;
const diffTypeOf = o => o.DiffType ?? o.diffType ?? 0;
const isRemoved = o => diffTypeOf(o) === DiffType.REMOVED;
const marketTypeOf = m => m.IDMarketType ?? m.idMarketType ?? 0;
const marketOrderOf = m => m.MarketOrder ?? m.marketOrder ?? 0;
const marketIdOf = m => m.IDMarket || m.idMarket || m.idmarket;
const programStatusOf = m => m.ProgramStatus ?? m.programStatus ?? 1;
const selectionIdOf = s => s.IDSelection || s.idSelection || s.idselection;
const oddOf = s => Number(s.OddValue ?? s.oddValue ?? 0);
const isOddLocked = odd => odd >= 0 && odd <= 1;

function eventName(e) {
  const name = e.EventName || e.eventName ||
               getFirstTranslation(e.EventNameTranslations || e.eventNameTranslations);
  if (name) return name;
  const teams = (e.Teams || [])
    .slice()
    .sort((a, b) => (a.IdTeamNumber || 0) - (b.IdTeamNumber || 0))
    .map(t => t.TeamName || t.FullTeamName)
    .filter(Boolean);
  return teams.length > 0 ? teams.join(' - ') : `Event ${eventIdOf(e)}`;
}

function sportName(e) {
  return e.SportName || e.sportName ||
         getFirstTranslation(e.SportNameTranslations || e.sportNameTranslations) ||
         `Sport ${sportIdOf(e)}`;
}

function categoryName(e) {
  return e.CategoryName || e.categoryName ||
         getFirstTranslation(e.CategoryNameTranslations || e.categoryNameTranslations) ||
         `Category ${e.IDCategory || e.idCategory}`;
}

function tournamentName(e) {
  return e.TournamentName || e.tournamentName ||
         getFirstTranslation(e.TournamentNameTranslations || e.tournamentNameTranslations) ||
         `Tournament ${e.IDTournament || e.idTournament}`;
}

/** Generic name of a market (type-level name first, market-specific override last) */
function marketName(m) {
  return getFirstTranslation(m.MarketNameTranslations || m.marketNameTranslations) ||
         m.AamsMarketName || m.aamsMarketName ||
         m.NameOverride || m.nameOverride || '';
}

function selectionName(s) {
  return s.SelectionName || s.selectionName ||
         getFirstTranslation(s.SelectionNameTranslations || s.selectionNameTranslations) ||
         `${selectionIdOf(s)}`;
}

/**
 * Convert an event date to a JS Date.
 * Handles google.protobuf.Timestamp ({ seconds, nanos }), .NET ticks, epoch ms/s and strings.
 */
function toDate(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') {
    const seconds = Number(value.seconds ?? value.Seconds ?? 0);
    if (!seconds) return null;
    return new Date(seconds * 1000 + Math.floor(Number(value.nanos ?? value.Nanos ?? 0) / 1e6));
  }
  if (typeof value === 'number') {
    if (value <= 0) return null;
    if (value > 1e14) return new Date((value - 621355968000000000) / 10000); // .NET ticks
    if (value > 1e11) return new Date(value);                                 // epoch ms
    return new Date(value * 1000);                                            // epoch s
  }
  const parsed = Date.parse(value);
  return isNaN(parsed) ? null : new Date(parsed);
}

function formatEventDate(date) {
  if (!date) return '';
  const day = date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
  const time = date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  return `${day} ${time}`;
}

/** MatchTime is a .NET TimeSpan in ticks: show it as elapsed minutes */
function matchMinute(e) {
  const ticks = Number(e.MatchTime ?? e.matchTime ?? 0);
  if (!ticks || ticks < 0) return '';
  return `${Math.floor(ticks / 600000000)}'`;
}

// ----------------------------------------------------------------------------
// Market types and selection persistence
// ----------------------------------------------------------------------------

/**
 * Aggregate the market types offered by the events of the sport.
 * events = number of (non-removed) events offering the type, avgOrder = average MarketOrder.
 */
function collectMarketTypes(events) {
  const types = new Map();

  events.forEach(ev => {
    if (isRemoved(ev)) return;
    const seenInEvent = new Set();

    (ev.Markets || ev.markets || []).forEach(m => {
      if (isRemoved(m)) return;
      const typeId = marketTypeOf(m);
      let type = types.get(typeId);
      if (!type) {
        type = { id: typeId, name: '', nameOrder: Infinity, events: 0, orderSum: 0, orderCount: 0 };
        types.set(typeId, type);
      }
      if (!seenInEvent.has(typeId)) {
        seenInEvent.add(typeId);
        type.events++;
      }
      const order = marketOrderOf(m);
      type.orderSum += order;
      type.orderCount++;
      const name = marketName(m);
      if (name && order < type.nameOrder) {
        type.name = name;
        type.nameOrder = order;
      }
    });
  });

  return [...types.values()]
    .map(t => ({
      id: t.id,
      name: t.name || `Market type ${t.id}`,
      events: t.events,
      avgOrder: t.orderCount > 0 ? t.orderSum / t.orderCount : 0
    }))
    .sort(compareByImportance);
}

/** Most important first: lowest average MarketOrder, then widest coverage, then type ID */
function compareByImportance(a, b) {
  return (a.avgOrder - b.avgOrder) || (b.events - a.events) || (a.id - b.id);
}

/**
 * Default columns when the user never configured the sport:
 * among the types offered by at least half as many events as the most common one,
 * take the first DEFAULT_MARKET_COUNT by importance.
 */
function defaultColumns(types) {
  if (types.length === 0) return [];
  const maxCoverage = Math.max(...types.map(t => t.events));
  return types
    .filter(t => t.events >= maxCoverage * 0.5)
    .sort(compareByImportance)
    .slice(0, DEFAULT_MARKET_COUNT)
    .map(t => ({ id: t.id, name: t.name }));
}

function storageKey() {
  return `${state.feedType}:${state.sportId}`;
}

function readStorage() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function writeStorage(all) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // storage unavailable (private window, quota): the selection lives only for this page
  }
}

/** Saved columns for the current sport + feed, or null when the user never configured them */
function loadSavedColumns() {
  const saved = readStorage()[storageKey()];
  return Array.isArray(saved) ? saved.filter(c => c && c.id !== undefined) : null;
}

function saveColumns(columns) {
  const all = readStorage();
  all[storageKey()] = columns.map(c => ({ id: c.id, name: c.name }));
  writeStorage(all);
}

function clearSavedColumns() {
  const all = readStorage();
  delete all[storageKey()];
  writeStorage(all);
}

/** Columns to show: saved ones (names refreshed from current data) or the defaults */
function resolveColumns(types) {
  const saved = loadSavedColumns();
  if (!saved) return defaultColumns(types);
  const byId = new Map(types.map(t => [t.id, t]));
  return saved.map(c => ({ id: c.id, name: byId.get(c.id)?.name || c.name || `Market type ${c.id}` }));
}

// ----------------------------------------------------------------------------
// Rendering
// ----------------------------------------------------------------------------

function sportEvents() {
  return state.getEvents().filter(e => sportIdOf(e) === state.sportId);
}

/**
 * Main market of a type within an event: enabled before disabled, then MarketOrder, then IDMarket.
 * Removed markets are ignored.
 */
function pickMarket(ev, typeId) {
  const candidates = (ev.Markets || ev.markets || [])
    .filter(m => marketTypeOf(m) === typeId && !isRemoved(m));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) =>
    ((programStatusOf(a) === 0) - (programStatusOf(b) === 0)) ||
    (marketOrderOf(a) - marketOrderOf(b)) ||
    (marketIdOf(a) - marketIdOf(b)));
  return { market: candidates[0], lines: candidates.length };
}

function sortedSelections(market) {
  return (market.Selections || market.selections || [])
    .filter(s => !isRemoved(s))
    .sort((a, b) =>
      ((a.IDSelectionType ?? 0) - (b.IDSelectionType ?? 0)) ||
      (selectionIdOf(a) - selectionIdOf(b)));
}

function renderCell(ev, column) {
  const picked = pickMarket(ev, column.id);
  if (!picked) {
    return `<td class="ov-cell ov-cell-empty" data-market-type="${column.id}">–</td>`;
  }

  const { market, lines } = picked;
  const marketId = marketIdOf(market);
  const marketLocked = programStatusOf(market) === 0 || !!(ev.StopBetting ?? ev.stopBetting);
  const spread = Number(market.Spread ?? market.spread ?? 0);
  const title = `${marketName(market) || column.name} (${marketId})` +
                (lines > 1 ? ` — ${lines} lines, showing the main one` : '');

  const selections = sortedSelections(market).map(s => {
    const odd = oddOf(s);
    const locked = marketLocked || isOddLocked(odd);
    const name = selectionName(s);
    return `<div class="ov-sel${locked ? ' ov-sel-locked' : ''}" data-selection-id="${selectionIdOf(s)}" data-odd="${odd}" title="${_.escape(name)} (${selectionIdOf(s)})">` +
           `<span class="ov-sel-name">${_.escape(name)}</span>` +
           `<span class="ov-sel-odd">${isOddLocked(odd) ? '🔒' : odd.toFixed(2)}</span>` +
           `</div>`;
  }).join('');

  return `<td class="ov-cell${marketLocked ? ' ov-cell-locked' : ''}" data-market-type="${column.id}" data-market-id="${marketId}" title="${_.escape(title)}">` +
         (spread !== 0 ? `<span class="ov-spread">${spread}</span>` : '') +
         (lines > 1 ? `<span class="ov-lines">+${lines - 1}</span>` : '') +
         `<div class="ov-sels">${selections || '<span class="ov-no-sel">–</span>'}</div>` +
         `</td>`;
}

function groupKey(ev) {
  return `${ev.IDCategory || ev.idCategory}|${ev.IDTournament || ev.idTournament}`;
}

/** Row HTML for an event (without the message ID badge, which is added on the DOM) */
function renderRow(ev, columns) {
  const id = eventIdOf(ev);
  const name = eventName(ev);
  const removed = isRemoved(ev);
  const stopped = !!(ev.StopBetting ?? ev.stopBetting);
  const activeMarkets = (ev.Markets || ev.markets || [])
    .filter(m => !isRemoved(m) && programStatusOf(m) !== 0).length;

  let info;
  if (state.feedType === 'live') {
    // Score from the scoreboards (IdResultType = IDFactCode); tooltip lists every decoded fact
    const { score, detail, clock, facts } = getScoreSummary(ev);
    const minute = matchMinute(ev);
    const tooltip = facts.length > 0
      ? facts.map(f => `${f.label} (${f.code}): ${f.value === '' ? '—' : f.value}`).join('\n')
      : 'No scoreboard facts';
    info = `<span class="ov-score-box" title="${_.escape(tooltip)}">` +
           `<span class="ov-score">${_.escape(score || '-')}</span>` +
           (detail ? `<span class="ov-score-detail">${_.escape(detail)}</span>` : '') +
           (minute ? `<span class="ov-minute">${minute}</span>` : '') +
           (clock ? `<span class="ov-clock" title="Last clock">${_.escape(clock)}</span>` : '') +
           `</span>`;
  } else {
    info = `<span class="ov-date">${_.escape(formatEventDate(toDate(ev.EventDate ?? ev.eventDate)))}</span>`;
  }

  const classes = ['ov-row'];
  if (removed) classes.push('ov-row-removed');
  if (stopped) classes.push('ov-row-stopped');

  return `<tr class="${classes.join(' ')}" data-event-id="${id}" data-group="${groupKey(ev)}" data-search="${_.escape(`${name} ${id}`.toLowerCase())}">` +
         `<td class="ov-info">${info}</td>` +
         `<td class="ov-event">` +
           `<a class="ov-event-name" data-event-id="${id}" title="Open event detail">${_.escape(name)}</a>` +
           `<span class="entity-id">(${id})</span>` +
           (stopped ? '<span class="ov-stop" title="Stop betting">⛔</span>' : '') +
         `</td>` +
         columns.map(c => renderCell(ev, c)).join('') +
         `<td class="ov-markets-count" title="${activeMarkets} active market${activeMarkets !== 1 ? 's' : ''}">${activeMarkets}</td>` +
         `</tr>`;
}

function sortEvents(events) {
  const num = v => Number(v) || 0;
  const dateMs = e => toDate(e.EventDate ?? e.eventDate)?.getTime() ?? 0;
  return [...events].sort((a, b) =>
    (num(a.CategoryOrder) - num(b.CategoryOrder)) ||
    categoryName(a).localeCompare(categoryName(b)) ||
    (num(a.TournamentOrder) - num(b.TournamentOrder)) ||
    tournamentName(a).localeCompare(tournamentName(b)) ||
    (dateMs(a) - dateMs(b)) ||
    (num(a.EventOrder) - num(b.EventOrder)) ||
    (eventIdOf(a) - eventIdOf(b)));
}

/** Full render of the overview page (keeps scroll position and filter text) */
function render() {
  state.rerenderTimer = null;
  state.feedType = state.getFeedType();

  const $panel = $('#detail-panel');
  const scrollTop = $panel.scrollTop();

  const events = sortEvents(sportEvents());
  state.marketTypes = collectMarketTypes(events);
  state.columns = resolveColumns(state.marketTypes);
  state.rowHtml.clear();

  const isLive = state.feedType === 'live';
  const removedCount = events.filter(isRemoved).length;
  const activeCount = events.length - removedCount;
  const title = events.length > 0 ? sportName(events[0]) : `Sport ${state.sportId}`;

  let html = `
    <div class="ov-content">
      <div class="ov-header">
        <div class="ov-title">
          <span class="tree-sport-id">${state.sportId}</span>
          <h1>${_.escape(title)} — Overview</h1>
          <span class="event-badge ${isLive ? 'live' : 'fixed'}">${isLive ? 'LIVE' : 'PREMATCH'}</span>
          <span class="markets-active-count" title="Active events">${activeCount}</span>
          ${removedCount > 0 ? `<span class="markets-removed-count" title="Removed events">${removedCount} removed</span>` : ''}
        </div>
        <div class="ov-toolbar">
          <div class="ov-feed-switch">
            <button class="ov-feed-btn${!isLive ? ' active' : ''}" data-type="fixed">Prematch</button>
            <button class="ov-feed-btn${isLive ? ' active' : ''}" data-type="live">Live</button>
          </div>
          <div class="ov-filter">
            <input type="text" class="ov-filter-input" placeholder="Filter by event name or ID…" autocomplete="off" value="${_.escape(state.filterText)}">
          </div>
          <span class="ov-groups-expand-all" title="Expand all tournaments">⊞</span>
          <span class="ov-groups-collapse-all" title="Collapse all tournaments">⊟</span>
          <button class="btn ov-btn-markets" title="Choose the markets shown for this sport">⚙ Markets (${state.columns.length})</button>
        </div>
      </div>
  `;

  if (events.length === 0) {
    html += `<div class="empty-state"><p>No ${isLive ? 'live' : 'prematch'} events for this sport</p></div></div>`;
    $('#event-detail').html(html);
    attachHandlers();
    return;
  }

  html += `
      <div class="ov-table-wrapper">
        <table class="ov-table">
          <thead>
            <tr>
              <th class="ov-info">${isLive ? 'Score' : 'Date'}</th>
              <th class="ov-event">Event</th>
              ${state.columns.map(c => `<th class="ov-market-col" title="Market type ${c.id}">${_.escape(c.name)} <span class="entity-id">(${c.id})</span></th>`).join('')}
              <th class="ov-markets-count" title="Active markets">#</th>
            </tr>
          </thead>
          <tbody>
  `;

  const colspan = state.columns.length + 3;
  let currentGroup = null;
  const groupCounts = _.countBy(events.filter(e => !isRemoved(e)), groupKey);

  events.forEach(ev => {
    const key = groupKey(ev);
    if (key !== currentGroup) {
      currentGroup = key;
      const collapsed = state.collapsedGroups.has(key);
      html += `<tr class="ov-group ${collapsed ? 'collapsed' : 'expanded'}" data-group="${key}" title="Click to expand / collapse"><td colspan="${colspan}">` +
              `<span class="ov-group-toggle"></span>` +
              `${_.escape(categoryName(ev))} <span class="ov-group-sep">›</span> ${_.escape(tournamentName(ev))}` +
              ` <span class="event-count">(${groupCounts[key] || 0})</span></td></tr>`;
    }
    const rowHtml = renderRow(ev, state.columns);
    state.rowHtml.set(eventIdOf(ev), rowHtml);
    html += rowHtml;
  });

  html += `</tbody></table></div></div>`;

  $('#event-detail').html(html);

  // Restore badges and highlights that must survive the re-render
  state.lastMessageId.forEach((messageId, eventId) => setRowBadge(rowElement(eventId), messageId));
  state.pendingAdded.forEach(eventId => flashRow(rowElement(eventId), 'ov-row-added', ROW_ADDED_MS));
  state.pendingAdded.clear();

  applyCollapsedGroups();
  attachHandlers();
  applyFilter();
  $panel.scrollTop(scrollTop);

  if (isMarketPanelOpen()) renderMarketPanel();
}

function scheduleRerender() {
  if (state.rerenderTimer) return;
  state.rerenderTimer = setTimeout(() => {
    if (state.active) render();
  }, RERENDER_DELAY_MS);
}

function rowElement(eventId) {
  return $(`#event-detail .ov-row[data-event-id="${eventId}"]`);
}

function setRowBadge($row, messageId) {
  if (!messageId || $row.length === 0) return;
  const $cell = $row.find('.ov-event');
  let $badge = $cell.find('.tree-msg-badge');
  if ($badge.length === 0) {
    $badge = $('<span class="tree-msg-badge"></span>');
    $cell.append($badge);
  }
  $badge.text(messageId);
}

function flashRow($row, cssClass, duration) {
  if ($row.length === 0) return;
  $row.removeClass('ov-row-added ov-row-updated').addClass(cssClass);
  setTimeout(() => $row.removeClass(cssClass), duration);
}

/** Hide the rows of collapsed groups (separate class from the filter's ov-hidden) */
function applyCollapsedGroups() {
  $('#event-detail .ov-row').each(function() {
    $(this).toggleClass('ov-collapsed', state.collapsedGroups.has(this.getAttribute('data-group')));
  });
}

function setGroupCollapsed(key, collapsed) {
  if (collapsed) {
    state.collapsedGroups.add(key);
  } else {
    state.collapsedGroups.delete(key);
  }
  $(`#event-detail .ov-group[data-group="${key}"]`)
    .toggleClass('collapsed', collapsed)
    .toggleClass('expanded', !collapsed);
  $(`#event-detail .ov-row[data-group="${key}"]`).toggleClass('ov-collapsed', collapsed);
}

/** Variation on an event of a collapsed group: flash the group header so the change is not lost */
function flashCollapsedGroup(key) {
  if (!state.collapsedGroups.has(key)) return;
  const $group = $(`#event-detail .ov-group[data-group="${key}"]`);
  $group.addClass('ov-group-changed');
  setTimeout(() => $group.removeClass('ov-group-changed'), ROW_UPDATED_MS);
}

function applyFilter() {
  const q = state.filterText.trim().toLowerCase();
  const $rows = $('#event-detail .ov-row');
  if (!q) {
    $rows.removeClass('ov-hidden');
    $('#event-detail .ov-group').removeClass('ov-hidden');
    return;
  }
  $rows.each(function() {
    $(this).toggleClass('ov-hidden', !(this.getAttribute('data-search') || '').includes(q));
  });
  $('#event-detail .ov-group').each(function() {
    const group = this.getAttribute('data-group');
    const hasVisible = $(`#event-detail .ov-row[data-group="${group}"]:not(.ov-hidden)`).length > 0;
    $(this).toggleClass('ov-hidden', !hasVisible);
  });
}

function attachHandlers() {
  const $detail = $('#event-detail');

  $detail.find('.ov-event-name').on('click', function() {
    const eventId = Number(this.getAttribute('data-event-id'));
    if (state.onEventOpen) state.onEventOpen(eventId);
  });

  $detail.find('.ov-feed-btn').on('click', function() {
    const type = this.getAttribute('data-type');
    if (type !== state.feedType && window.feedTypeManager) {
      window.feedTypeManager.setFilter(type); // fires feedFilterChanged → app refreshes the overview
    }
  });

  $detail.find('.ov-filter-input').on('input', function() {
    state.filterText = $(this).val();
    applyFilter();
  });

  $detail.find('.ov-btn-markets').on('click', () => openMarketPanel());

  $detail.find('.ov-group').on('click', function() {
    const key = this.getAttribute('data-group');
    setGroupCollapsed(key, !state.collapsedGroups.has(key));
  });

  $detail.find('.ov-groups-expand-all').on('click', () => {
    $detail.find('.ov-group').each(function() {
      setGroupCollapsed(this.getAttribute('data-group'), false);
    });
  });

  $detail.find('.ov-groups-collapse-all').on('click', () => {
    $detail.find('.ov-group').each(function() {
      setGroupCollapsed(this.getAttribute('data-group'), true);
    });
  });
}

// ----------------------------------------------------------------------------
// Incremental updates
// ----------------------------------------------------------------------------

/**
 * Re-render a single event row from the merged event, flashing the odds that moved.
 * Returns true when something visible changed.
 */
function patchRow($row, mergedEvent) {
  const eventId = eventIdOf(mergedEvent);
  const html = renderRow(mergedEvent, state.columns);
  if (html === state.rowHtml.get(eventId)) return false;

  const oldOdds = new Map();
  $row.find('.ov-sel').each(function() {
    oldOdds.set(this.getAttribute('data-selection-id'), parseFloat(this.getAttribute('data-odd')));
  });

  const $newRow = $($.parseHTML(html));
  $newRow.toggleClass('ov-collapsed', state.collapsedGroups.has(groupKey(mergedEvent)));
  $newRow.toggleClass('ov-hidden', $row.hasClass('ov-hidden'));
  $row.replaceWith($newRow);
  state.rowHtml.set(eventId, html);

  $newRow.find('.ov-sel').each(function() {
    const oldOdd = oldOdds.get(this.getAttribute('data-selection-id'));
    const newOdd = parseFloat(this.getAttribute('data-odd'));
    if (oldOdd === undefined || oldOdd === newOdd) return;

    const $sel = $(this);
    if (isOddLocked(oldOdd) || isOddLocked(newOdd)) {
      flashClass($sel, 'ov-odd-changed');
    } else if (newOdd > oldOdd) {
      $sel.find('.ov-sel-odd').append('<span class="odd-arrow odd-up">▲</span>');
      flashClass($sel, 'ov-odd-up');
    } else {
      $sel.find('.ov-sel-odd').append('<span class="odd-arrow odd-down">▼</span>');
      flashClass($sel, 'ov-odd-down');
    }
  });

  return true;
}

function flashClass($el, cssClass) {
  $el.addClass(cssClass);
  setTimeout(() => $el.removeClass(cssClass), ODD_FLASH_MS);
}

/**
 * Apply the events of an incremental message to the open overview.
 * Must be called after the message has been merged into the app data,
 * so getEvents() already returns the up-to-date events.
 */
export function updateOverview(changedEvents, messageId) {
  if (!state.active || !changedEvents || changedEvents.length === 0) return;

  const relevant = changedEvents.filter(e =>
    sportIdOf(e) === state.sportId &&
    (e.feedsType || '').toLowerCase() === state.feedType);
  if (relevant.length === 0) return;

  const merged = new Map(sportEvents().map(e => [eventIdOf(e), e]));
  let needsRerender = false;

  relevant.forEach(diffEvent => {
    const eventId = eventIdOf(diffEvent);
    const mergedEvent = merged.get(eventId);
    if (!mergedEvent) return;

    if (messageId) state.lastMessageId.set(eventId, messageId);

    let $row = rowElement(eventId);
    if ($row.length === 0) {
      // New event: it needs a slot in its tournament group → full (debounced) re-render
      needsRerender = true;
      if (!isRemoved(mergedEvent)) state.pendingAdded.add(eventId);
      return;
    }

    const changed = patchRow($row, mergedEvent);
    $row = rowElement(eventId);
    setRowBadge($row, messageId);
    if (changed) flashCollapsedGroup(groupKey(mergedEvent));

    const diffType = diffTypeOf(diffEvent);
    if (diffType === DiffType.ADDED) {
      flashRow($row, 'ov-row-added', ROW_ADDED_MS);
    } else if (diffType === DiffType.UPDATED && changed) {
      flashRow($row, 'ov-row-updated', ROW_UPDATED_MS);
    }
    if (diffType === DiffType.REMOVED || diffType === DiffType.ADDED) {
      needsRerender = true; // refresh header and group counters
    }
  });

  if (needsRerender) {
    scheduleRerender();
  } else {
    applyFilter();
  }
}

// ----------------------------------------------------------------------------
// Market selection panel
// ----------------------------------------------------------------------------

function isMarketPanelOpen() {
  return $('#ov-market-panel').length > 0;
}

function openMarketPanel() {
  if (!isMarketPanelOpen()) {
    $('body').append(`
      <div id="ov-market-panel-backdrop"></div>
      <div id="ov-market-panel">
        <div class="ov-panel-header">
          <h3 class="ov-panel-title"></h3>
          <button class="ov-panel-close" title="Close">✕</button>
        </div>
        <div class="ov-panel-body">
          <div class="ov-panel-section">
            <h4>Shown markets <span class="ov-panel-hint">(column order)</span></h4>
            <ul class="ov-panel-selected"></ul>
          </div>
          <div class="ov-panel-section ov-panel-available-section">
            <h4>Available markets <span class="ov-panel-hint">(by importance)</span></h4>
            <input type="text" class="ov-panel-search" placeholder="Search market name or type ID…" autocomplete="off">
            <ul class="ov-panel-available"></ul>
          </div>
        </div>
        <div class="ov-panel-footer">
          <button class="btn btn-secondary ov-panel-default" title="Use the most important markets for this sport">Restore defaults</button>
          <button class="btn btn-secondary ov-panel-clear">Clear</button>
          <button class="btn ov-panel-done">Done</button>
        </div>
      </div>
    `);

    $('#ov-market-panel-backdrop, #ov-market-panel .ov-panel-close, #ov-market-panel .ov-panel-done')
      .on('click', closeMarketPanel);

    $('#ov-market-panel .ov-panel-search').on('input', renderMarketPanel);

    $('#ov-market-panel .ov-panel-default').on('click', () => {
      clearSavedColumns();
      render();
    });

    $('#ov-market-panel .ov-panel-clear').on('click', () => {
      setColumns([]);
    });

    // Delegated handlers: lists are re-rendered on every change
    $('#ov-market-panel')
      .on('change', '.ov-panel-available input[type="checkbox"]', function() {
        const typeId = Number(this.getAttribute('data-type-id'));
        if (this.checked) {
          const type = state.marketTypes.find(t => t.id === typeId);
          setColumns([...state.columns, { id: typeId, name: type?.name || `Market type ${typeId}` }]);
        } else {
          setColumns(state.columns.filter(c => c.id !== typeId));
        }
      })
      .on('click', '.ov-panel-move', function() {
        const index = Number(this.getAttribute('data-index'));
        const target = index + Number(this.getAttribute('data-dir'));
        if (target < 0 || target >= state.columns.length) return;
        const columns = [...state.columns];
        [columns[index], columns[target]] = [columns[target], columns[index]];
        setColumns(columns);
      })
      .on('click', '.ov-panel-remove', function() {
        const index = Number(this.getAttribute('data-index'));
        setColumns(state.columns.filter((_c, i) => i !== index));
      });

    $(document).on('keydown.ovPanel', e => {
      if (e.key === 'Escape') closeMarketPanel();
    });
  }

  renderMarketPanel();
  $('#ov-market-panel .ov-panel-search').trigger('focus');
}

function closeMarketPanel() {
  $('#ov-market-panel, #ov-market-panel-backdrop').remove();
  $(document).off('keydown.ovPanel');
}

function setColumns(columns) {
  saveColumns(columns);
  render(); // re-renders the panel too
}

function renderMarketPanel() {
  const $panel = $('#ov-market-panel');
  if ($panel.length === 0) return;

  const events = sportEvents().filter(e => !isRemoved(e));
  const sport = events.length > 0 ? sportName(events[0]) : `Sport ${state.sportId}`;
  const feedLabel = state.feedType === 'live' ? 'Live' : 'Prematch';
  $panel.find('.ov-panel-title').text(`${sport} · ${feedLabel} — overview markets`);

  const typeById = new Map(state.marketTypes.map(t => [t.id, t]));
  const coverage = id => {
    const t = typeById.get(id);
    return t ? `${t.events}/${events.length}` : `0/${events.length}`;
  };

  // Selected (ordered) list
  const selectedHtml = state.columns.length === 0
    ? '<li class="ov-panel-empty">No market selected</li>'
    : state.columns.map((c, i) => `
        <li class="ov-panel-item ov-panel-item-selected">
          <span class="ov-panel-pos">${i + 1}</span>
          <span class="ov-panel-name">${_.escape(c.name)} <span class="entity-id">(${c.id})</span></span>
          <span class="ov-panel-coverage" title="Events offering this market">${coverage(c.id)}</span>
          <button class="ov-panel-move" data-index="${i}" data-dir="-1" title="Move left"${i === 0 ? ' disabled' : ''}>▲</button>
          <button class="ov-panel-move" data-index="${i}" data-dir="1" title="Move right"${i === state.columns.length - 1 ? ' disabled' : ''}>▼</button>
          <button class="ov-panel-remove" data-index="${i}" title="Remove">✕</button>
        </li>`).join('');
  $panel.find('.ov-panel-selected').html(selectedHtml);

  // Available list (filtered by search)
  const q = ($panel.find('.ov-panel-search').val() || '').trim().toLowerCase();
  const selectedIds = new Set(state.columns.map(c => c.id));
  const available = state.marketTypes.filter(t =>
    !q || t.name.toLowerCase().includes(q) || String(t.id).includes(q));

  const availableHtml = available.length === 0
    ? `<li class="ov-panel-empty">${state.marketTypes.length === 0 ? 'No markets for this sport' : 'No match'}</li>`
    : available.map(t => `
        <li class="ov-panel-item">
          <label>
            <input type="checkbox" data-type-id="${t.id}"${selectedIds.has(t.id) ? ' checked' : ''}>
            <span class="ov-panel-name">${_.escape(t.name)} <span class="entity-id">(${t.id})</span></span>
          </label>
          <span class="ov-panel-coverage" title="Events offering this market">${t.events}/${events.length}</span>
        </li>`).join('');
  $panel.find('.ov-panel-available').html(availableHtml);
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * @param {Object} options
 * @param {Function} options.getEvents   - returns the merged events of the current feed filter
 * @param {Function} options.getFeedType - returns 'fixed' or 'live'
 * @param {Function} options.onEventOpen - called with an event ID when the user clicks an event
 */
export function initOverview({ getEvents, getFeedType, onEventOpen }) {
  state.getEvents = getEvents;
  state.getFeedType = getFeedType;
  state.onEventOpen = onEventOpen;
}

export function openOverview(sportId) {
  if (state.sportId !== sportId) {
    state.filterText = '';
    state.collapsedGroups.clear();
    state.lastMessageId.clear();
    state.pendingAdded.clear();
  }
  state.active = true;
  state.sportId = sportId;
  $('#detail-panel').scrollTop(0);
  render();
}

/** Full re-render (Full snapshot loaded, feed filter changed, …) */
export function refreshOverview() {
  if (!state.active) return;
  if (state.rerenderTimer) {
    clearTimeout(state.rerenderTimer);
    state.rerenderTimer = null;
  }
  render();
}

/** Mark the overview as closed (the caller renders something else in the detail panel) */
export function closeOverview() {
  state.active = false;
  if (state.rerenderTimer) {
    clearTimeout(state.rerenderTimer);
    state.rerenderTimer = null;
  }
  closeMarketPanel();
}

export function isOverviewActive() {
  return state.active;
}

export function getOverviewSportId() {
  return state.sportId;
}
