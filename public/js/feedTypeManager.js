/**
 * Feed Type Manager
 * Handles Fixed/Live feed type filtering and display
 */

export class FeedTypeManager {
  constructor() {
    this.currentFilter = 'fixed'; // 'fixed' or 'live'
    this.lastFixedUpdate = null;
    this.lastLiveUpdate = null;

    this.initUI();
  }

  initUI() {
    // Feed type toggle buttons
    const btnFixed = document.getElementById('btn-fixed');
    const btnLive = document.getElementById('btn-live');

    if (btnFixed) {
      btnFixed.addEventListener('click', () => this.setFilter('fixed'));
    }
    if (btnLive) {
      btnLive.addEventListener('click', () => this.setFilter('live'));
    }
  }

  setFilter(filterType) {
    this.currentFilter = filterType;

    // Update button states
    document.querySelectorAll('.btn-feed-type').forEach(btn => {
      btn.classList.remove('active');
      if (btn.dataset.type === filterType) {
        btn.classList.add('active');
      }
    });

    // Trigger filter update event
    window.dispatchEvent(new CustomEvent('feedFilterChanged', {
      detail: { filter: filterType }
    }));

    this.updateIndicator();
  }

  updateIndicator() {
    const indicator = document.getElementById('message-type-indicator');
    if (!indicator) return;

    indicator.className = ''; // Reset classes

    switch (this.currentFilter) {
      case 'fixed':
        indicator.textContent = 'Fixed (Pre-match)';
        indicator.classList.add('type-fixed');
        break;
      case 'live':
        indicator.textContent = 'Live (In-play)';
        indicator.classList.add('type-live');
        break;

    }
  }

  recordUpdate(feedsType) {
    const now = new Date();
    if (feedsType === 'Fixed') {
      this.lastFixedUpdate = now;
    } else if (feedsType === 'Live') {
      this.lastLiveUpdate = now;
    }

    this.updateDataStatus();
  }

  updateDataStatus() {
    const statusEl = document.getElementById('data-last-update');
    if (!statusEl) return;

    const parts = [];

    if (this.lastFixedUpdate) {
      const ago = this.getTimeAgo(this.lastFixedUpdate);
      parts.push(`🔵 Fixed: ${ago}`);
    }

    if (this.lastLiveUpdate) {
      const ago = this.getTimeAgo(this.lastLiveUpdate);
      parts.push(`🟢 Live: ${ago}`);
    }

    statusEl.textContent = parts.join(' | ');
  }

  getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);

    if (seconds < 5) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  }

  shouldShowEvent(event) {
    // Determine event type from metadata (normalize to lowercase for comparison)
    let eventType = event.feedsType || (event.IsAntepost === false ? 'live' : 'fixed');
    eventType = eventType.toLowerCase(); // Normalize to lowercase

    return eventType === this.currentFilter;
  }

  getEventBadge(event) {
    const isLive = event.IsAntepost === false;
    const type = isLive ? 'live' : 'fixed';
    const label = isLive ? 'LIVE' : 'FIXED';

    return `<span class="event-badge ${type}">${label}</span>`;
  }

  getFilter() {
    return this.currentFilter;
  }
}

// Auto-update time ago every 10 seconds
setInterval(() => {
  const manager = window.feedTypeManager;
  if (manager) {
    manager.updateDataStatus();
  }
}, 10000);
