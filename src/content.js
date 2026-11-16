(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const ledger = require('./ledger');
    const classifier = require('./classifier');
    module.exports = factory(ledger, classifier);
  } else {
    root.YouTubeDietContent = factory(root.YouTubeDietLedger, root.YouTubeDietClassifier);
    if (typeof document !== 'undefined') {
      root.YouTubeDietContent.initContentController();
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Ledger, Classifier) {
  'use strict';

  const HUD_ID = 'yt-diet-hud';
  const OVERLAY_ID = 'yt-diet-overlay';
  const SNOOZE_DURATION_MS = 5 * 60 * 1000; // 5 minutes emergency snooze

  /**
   * Determines whether an HTML5 video element is actively playing (not paused, ended, or buffering).
   * @param {HTMLVideoElement|null} video
   * @returns {boolean}
   */
  function isVideoActivelyPlaying(video) {
    if (!video) {
      return false;
    }
    const readyState = typeof video.readyState === 'number' ? video.readyState : 4;
    return !video.paused && !video.ended && readyState >= 2;
  }

  /**
   * Determines if the current URL is a YouTube watch or shorts page.
   * @param {string} url
   * @returns {boolean}
   */
  function isWatchPageUrl(url) {
    return Boolean(Classifier.extractVideoIdFromUrl(url));
  }

  /**
   * Creates and initializes the YouTube Diet content script controller.
   * @param {object} [options]
   * @param {Document} [options.document]
   * @param {Window} [options.window]
   * @param {object} [options.storage]
   */
  function initContentController(options = {}) {
    const doc = options.document || (typeof document !== 'undefined' ? document : null);
    const win = options.window || (typeof window !== 'undefined' ? window : null);
    const storage = options.storage || undefined;

    if (!doc || !win) {
      return null;
    }

    let currentState = Ledger.createInitialState();
    let currentMetadata = {
      videoId: '',
      title: '',
      category: '',
      channelId: '',
      channelName: '',
      description: '',
      keywords: []
    };
    let currentClassification = Classifier.classifyVideo(currentMetadata);
    let lastKnownUrl = win.location ? win.location.href : '';
    let attachedVideo = null;
    let isEnforcingPause = false;

    /**
     * Refreshes video metadata from the page and re-evaluates classification.
     */
    function refreshMetadataAndClassification() {
      const url = win.location ? win.location.href : '';
      if (!isWatchPageUrl(url)) {
        currentMetadata = {
          videoId: '',
          title: '',
          category: '',
          channelId: '',
          channelName: '',
          description: '',
          keywords: []
        };
        renderUI();
        return;
      }

      currentMetadata = Classifier.extractVideoMetadata({
        document: doc,
        url
      });

      currentClassification = Classifier.classifyVideo(currentMetadata, {
        channelOverrides: currentState.channelOverrides,
        videoOverrides: currentState.videoOverrides,
        classificationMode: currentState.settings.classificationMode,
        defaultCategory: currentState.settings.defaultCategory
      });

      renderUI();
      enforceBudgetIfNeeded();
    }

    /**
     * Attaches play listener to the active <video> element to block playback when budget is depleted.
     */
    function attachVideoElement() {
      const video =
        doc.querySelector('video.html5-main-video') || doc.querySelector('video');
      if (video && video !== attachedVideo) {
        if (attachedVideo) {
          attachedVideo.removeEventListener('play', onVideoPlay);
          attachedVideo.removeEventListener('playing', onVideoPlay);
        }
        attachedVideo = video;
        attachedVideo.addEventListener('play', onVideoPlay);
        attachedVideo.addEventListener('playing', onVideoPlay);
      }
      return attachedVideo;
    }

    function onVideoPlay() {
      enforceBudgetIfNeeded();
    }

    /**
     * Checks if the current video should be paused due to depleted entertainment bank.
     */
    function shouldBlockPlayback(stats) {
      const url = win.location ? win.location.href : '';
      if (!isWatchPageUrl(url)) {
        return false;
      }
      if (!currentState.settings.enforcementEnabled) {
        return false;
      }
      if (currentClassification.classification !== 'entertainment') {
        return false;
      }
      if (stats.isSnoozed) {
        return false;
      }
      return stats.isDepleted;
    }

    /**
     * Pauses the video and displays the in-player overlay if the entertainment bank is 0:00.
     */
    function enforceBudgetIfNeeded() {
      const stats = Ledger.getStateStats(currentState);
      const block = shouldBlockPlayback(stats);
      const video = attachVideoElement();

      if (block) {
        if (video && !video.paused && !isEnforcingPause) {
          isEnforcingPause = true;
          try {
            video.pause();
          } finally {
            isEnforcingPause = false;
          }
        }
        renderOverlay(stats, true);
      } else {
        renderOverlay(stats, false);
      }
    }

    /**
     * Toggles the classification override for the current video.
     * @param {'educational'|'entertainment'} [targetClass]
     */
    async function toggleVideoOverride(targetClass) {
      const videoId =
        currentMetadata.videoId ||
        Classifier.extractVideoIdFromUrl(win.location ? win.location.href : '');
      if (!videoId) {
        return;
      }
      const nextClass =
        targetClass ||
        (currentClassification.classification === 'educational'
          ? 'entertainment'
          : 'educational');

      const { state } = await Ledger.updateState(
        (draft) => {
          draft.videoOverrides = draft.videoOverrides || {};
          draft.videoOverrides[videoId] = {
            classification: nextClass,
            title: currentMetadata.title || videoId,
            updatedAt: Date.now()
          };
          return draft;
        },
        { storage }
      );
      currentState = state;
      refreshMetadataAndClassification();
    }

    /**
     * Pins or toggles the current channel's classification override in storage.
     * @param {'educational'|'entertainment'} [targetClass]
     */
    async function pinChannelOverride(targetClass) {
      const channelKey = Classifier.getChannelKey(currentMetadata);
      if (!channelKey) {
        return toggleVideoOverride(targetClass);
      }
      const nextClass =
        targetClass ||
        (currentClassification.classification === 'educational'
          ? 'entertainment'
          : 'educational');

      const { state } = await Ledger.updateState(
        (draft) => {
          draft.channelOverrides = draft.channelOverrides || {};
          const existingMatch = Classifier.findChannelOverride
            ? Classifier.findChannelOverride(currentMetadata, draft.channelOverrides)
            : null;
          const targetKey = existingMatch ? existingMatch.key : channelKey;
          draft.channelOverrides[targetKey] = {
            classification: nextClass,
            channelId: currentMetadata.channelId || '',
            channelName: currentMetadata.channelName || channelKey,
            updatedAt: Date.now()
          };
          return draft;
        },
        { storage }
      );
      currentState = state;
      refreshMetadataAndClassification();
    }

    /**
     * Grants an emergency snooze so the user can continue watching for 5 minutes.
     */
    async function triggerEmergencySnooze() {
      const { state } = await Ledger.updateState(
        (draft) => {
          draft.snoozeUntil = Date.now() + SNOOZE_DURATION_MS;
          return draft;
        },
        { storage }
      );
      currentState = state;
      renderUI();
      enforceBudgetIfNeeded();
      if (attachedVideo && attachedVideo.paused) {
        attachedVideo.play().catch(() => {});
      }
    }

    /**
     * Ensures the floating HUD pill exists in the DOM and updates its contents.
     */
    function renderUI() {
      const url = win.location ? win.location.href : '';
      let hud = doc.getElementById(HUD_ID);

      if (!isWatchPageUrl(url)) {
        if (hud) {
          hud.style.display = 'none';
        }
        renderOverlay(Ledger.getStateStats(currentState), false);
        return;
      }

      if (!hud && doc.body) {
        hud = doc.createElement('div');
        hud.id = HUD_ID;
        hud.className = 'yt-diet-hud';
        hud.innerHTML = `
          <div class="yt-diet-hud-row">
            <span class="yt-diet-badge" data-role="badge">Educational</span>
            <span class="yt-diet-metric" data-role="split" title="Actual watch-time split today">Edu 50% / Ent 50%</span>
            <span class="yt-diet-divider">•</span>
            <span class="yt-diet-bank" data-role="bank" title="Remaining entertainment bank">Bank: 15:00</span>
            <button type="button" class="yt-diet-btn" data-action="toggle-video" title="Switch classification for this video">Switch Video</button>
            <button type="button" class="yt-diet-btn yt-diet-btn-pin" data-action="pin-channel" title="Always classify this channel as the opposite type">Pin Channel</button>
          </div>
        `;

        hud.addEventListener('click', (e) => {
          const btn = e.target.closest('button[data-action]');
          if (!btn) {
            return;
          }
          const action = btn.getAttribute('data-action');
          if (action === 'toggle-video') {
            toggleVideoOverride();
          } else if (action === 'pin-channel') {
            pinChannelOverride();
          }
        });

        doc.body.appendChild(hud);
      }

      if (!hud) {
        return;
      }

      hud.style.display = 'flex';
      const stats = Ledger.getStateStats(currentState);
      const isEdu = currentClassification.classification === 'educational';
      const oppositeLabel = isEdu ? 'Ent' : 'Edu';

      const badgeEl = hud.querySelector('[data-role="badge"]');
      const splitEl = hud.querySelector('[data-role="split"]');
      const bankEl = hud.querySelector('[data-role="bank"]');
      const toggleVideoBtn = hud.querySelector('[data-action="toggle-video"]');
      const pinChannelBtn = hud.querySelector('[data-action="pin-channel"]');

      if (badgeEl) {
        badgeEl.textContent = isEdu ? 'Educational' : 'Entertainment';
        badgeEl.className = `yt-diet-badge ${isEdu ? 'yt-diet-badge-edu' : 'yt-diet-badge-ent'}`;
        badgeEl.title = currentClassification.reason || '';
      }

      if (splitEl) {
        splitEl.textContent = `Edu ${stats.actualEduPct}% / Ent ${stats.actualEntPct}%`;
        splitEl.title = `Target split: ${stats.targetEduPct}% Edu / ${stats.targetEntPct}% Ent`;
      }

      if (bankEl) {
        if (stats.isSnoozed) {
          bankEl.textContent = `Snoozed (${Ledger.formatClock(stats.snoozeRemainingSeconds)})`;
          bankEl.className = 'yt-diet-bank yt-diet-bank-warn';
        } else {
          bankEl.textContent = `Ent Bank: ${Ledger.formatClock(stats.remainingBankSeconds)}`;
          bankEl.className = `yt-diet-bank ${
            stats.isDepleted ? 'yt-diet-bank-depleted' : ''
          }`;
        }
      }

      if (toggleVideoBtn) {
        toggleVideoBtn.textContent = `Mark Video ${oppositeLabel}`;
      }

      if (pinChannelBtn) {
        const hasChannel = Boolean(Classifier.getChannelKey(currentMetadata));
        pinChannelBtn.style.display = hasChannel ? 'inline-flex' : 'none';
        pinChannelBtn.textContent =
          currentClassification.source === 'channel-override'
            ? `Channel Pinned (${isEdu ? 'Edu' : 'Ent'})`
            : `Always ${oppositeLabel} Channel`;
      }
    }

    /**
     * Renders or hides the in-player enforcement overlay when Entertainment budget hits 0:00.
     */
    function renderOverlay(stats, visible) {
      let overlay = doc.getElementById(OVERLAY_ID);
      if (!visible) {
        if (overlay) {
          overlay.style.display = 'none';
        }
        return;
      }

      const playerContainer =
        doc.querySelector('#movie_player') ||
        doc.querySelector('#player-container-inner') ||
        doc.querySelector('ytd-player') ||
        doc.body;

      if (!overlay && playerContainer) {
        overlay = doc.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.className = 'yt-diet-overlay';
        overlay.innerHTML = `
          <div class="yt-diet-overlay-card">
            <div class="yt-diet-overlay-tag">YouTube Diet • Budget Reached</div>
            <h2 class="yt-diet-overlay-title">Entertainment Bank Depleted (0:00)</h2>
            <p class="yt-diet-overlay-desc" data-role="overlay-explanation"></p>
            <div class="yt-diet-overlay-stats" data-role="overlay-stats"></div>
            <div class="yt-diet-overlay-actions">
              <button type="button" class="yt-diet-overlay-btn yt-diet-overlay-btn-primary" data-overlay-action="reclassify-video">
                This Video is Educational
              </button>
              <button type="button" class="yt-diet-overlay-btn yt-diet-overlay-btn-secondary" data-overlay-action="reclassify-channel">
                Always Mark Channel Educational
              </button>
              <button type="button" class="yt-diet-overlay-btn yt-diet-overlay-btn-ghost" data-overlay-action="snooze">
                Emergency Snooze (+5m)
              </button>
            </div>
          </div>
        `;

        overlay.addEventListener('click', (e) => {
          const btn = e.target.closest('button[data-overlay-action]');
          if (!btn) {
            return;
          }
          e.stopPropagation();
          const action = btn.getAttribute('data-overlay-action');
          if (action === 'reclassify-video') {
            toggleVideoOverride('educational');
          } else if (action === 'reclassify-channel') {
            pinChannelOverride('educational');
          } else if (action === 'snooze') {
            triggerEmergencySnooze();
          }
        });

        playerContainer.appendChild(overlay);
      }

      if (!overlay) {
        return;
      }

      if (overlay.parentElement !== playerContainer && playerContainer) {
        playerContainer.appendChild(overlay);
      }

      overlay.style.display = 'flex';
      const explanationEl = overlay.querySelector('[data-role="overlay-explanation"]');
      const statsEl = overlay.querySelector('[data-role="overlay-stats"]');

      const unlockFiveMin = Ledger.formatDuration(stats.eduSecondsToUnlockFiveMin);
      const unlockOneMin = Ledger.formatDuration(stats.eduSecondsToUnlockOneMin);

      if (explanationEl) {
        explanationEl.textContent =
          `Your target split is ${stats.targetEduPct}% Educational / ${stats.targetEntPct}% Entertainment. ` +
          `Watch ${unlockOneMin} of educational videos to unlock 1 minute of entertainment (or ${unlockFiveMin} for 5 minutes).`;
      }

      if (statsEl) {
        statsEl.textContent =
          `Today: ${Ledger.formatDuration(stats.educationalSeconds)} Educational (${stats.actualEduPct}%) • ` +
          `${Ledger.formatDuration(stats.entertainmentSeconds)} Entertainment (${stats.actualEntPct}%)`;
      }
    }

    /**
     * 1-second heartbeat that accrues watch time only when the active <video> is playing.
     */
    async function onTick() {
      const currentUrl = win.location ? win.location.href : '';
      if (currentUrl !== lastKnownUrl) {
        lastKnownUrl = currentUrl;
        setTimeout(refreshMetadataAndClassification, 250);
      }

      if (!isWatchPageUrl(currentUrl)) {
        return;
      }

      // If metadata was not ready on initial navigation, retry extraction
      if (!currentMetadata.title || !currentMetadata.videoId) {
        refreshMetadataAndClassification();
      }

      const video = attachVideoElement();
      if (!isVideoActivelyPlaying(video)) {
        enforceBudgetIfNeeded();
        return;
      }

      const preTickStats = Ledger.getStateStats(currentState);
      if (shouldBlockPlayback(preTickStats)) {
        enforceBudgetIfNeeded();
        return;
      }

      const activeCategory = currentClassification.classification;
      const { state } = await Ledger.updateState(
        (draft) => {
          const { state: next } = Ledger.recordWatchTime(draft, activeCategory, 1);
          return next;
        },
        { storage }
      );

      currentState = state;
      renderUI();
      enforceBudgetIfNeeded();
    }

    // Load initial state from storage and start listeners
    Ledger.loadState({ storage }).then((loaded) => {
      currentState = loaded;
      refreshMetadataAndClassification();
    });

    // Listen to YouTube SPA navigation events
    const onNavigate = () => {
      lastKnownUrl = win.location ? win.location.href : '';
      refreshMetadataAndClassification();
      setTimeout(refreshMetadataAndClassification, 600);
      setTimeout(refreshMetadataAndClassification, 1800);
    };

    win.addEventListener('yt-navigate-finish', onNavigate);
    win.addEventListener('yt-page-data-updated', onNavigate);
    win.addEventListener('popstate', onNavigate);

    // Sync with popup settings changes in real time
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes[Ledger.STORAGE_KEY]) {
          const newVal = changes[Ledger.STORAGE_KEY].newValue;
          if (newVal) {
            currentState = Ledger.ensureDailyLedger(newVal);
            refreshMetadataAndClassification();
          }
        }
      });
    }

    const tickInterval = setInterval(onTick, 1000);

    return {
      refreshMetadataAndClassification,
      toggleVideoOverride,
      pinChannelOverride,
      triggerEmergencySnooze,
      onTick,
      stop: () => clearInterval(tickInterval)
    };
  }

  return {
    HUD_ID,
    OVERLAY_ID,
    SNOOZE_DURATION_MS,
    isVideoActivelyPlaying,
    isWatchPageUrl,
    initContentController
  };
});
