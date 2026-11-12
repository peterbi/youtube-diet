(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.YouTubeDietLedger = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_KEY = 'youtubeDietState';
  const MAX_HISTORY_DAYS = 90;

  const DEFAULT_SETTINGS = Object.freeze({
    targetEduPct: 50,
    graceBufferSeconds: 900, // 15 minutes
    enforcementEnabled: true,
    defaultCategory: 'entertainment'
  });

  /**
   * Returns a YYYY-MM-DD key in local timezone for the provided Date or timestamp.
   * @param {Date|number|string} [dateInput]
   * @returns {string}
   */
  function getLocalDateKey(dateInput = new Date()) {
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Clamps target educational percentage between 1 and 99 (or 0..100 for extreme configs).
   * UI slider uses 20..80, default 50.
   * @param {number} pct
   * @returns {number}
   */
  function normalizeTargetEduPct(pct) {
    const num = Number(pct);
    if (!Number.isFinite(num)) {
      return DEFAULT_SETTINGS.targetEduPct;
    }
    return Math.min(100, Math.max(0, Math.round(num)));
  }

  /**
   * Normalizes grace buffer seconds to a non-negative number.
   * @param {number} seconds
   * @returns {number}
   */
  function normalizeGraceBufferSeconds(seconds) {
    const num = Number(seconds);
    if (!Number.isFinite(num) || num < 0) {
      return DEFAULT_SETTINGS.graceBufferSeconds;
    }
    return Math.round(num);
  }

  /**
   * Core entertainment allowance formula:
   * entertainment_allowance = grace_buffer_seconds + educational_seconds * ((100 - target_edu_pct) / target_edu_pct) - entertainment_seconds
   *
   * @param {number} educationalSeconds
   * @param {number} entertainmentSeconds
   * @param {number} [targetEduPct=50]
   * @param {number} [graceBufferSeconds=900]
   * @returns {number} Raw allowance in seconds (can be negative when in deficit)
   */
  function computeEntertainmentAllowance(
    educationalSeconds,
    entertainmentSeconds,
    targetEduPct = DEFAULT_SETTINGS.targetEduPct,
    graceBufferSeconds = DEFAULT_SETTINGS.graceBufferSeconds
  ) {
    const edu = Math.max(0, Number(educationalSeconds) || 0);
    const ent = Math.max(0, Number(entertainmentSeconds) || 0);
    const pct = normalizeTargetEduPct(targetEduPct);
    const grace = normalizeGraceBufferSeconds(graceBufferSeconds);

    if (pct <= 0) {
      return Infinity;
    }
    if (pct >= 100) {
      return grace - ent;
    }

    const ratio = (100 - pct) / pct;
    return grace + edu * ratio - ent;
  }

  /**
   * Computes how many additional seconds of educational watch time are needed
   * to bring the entertainment allowance to `desiredPositiveAllowanceSeconds` (default 0 to break even,
   * or e.g. 60 seconds to have 1 minute of playable bank).
   *
   * @param {number} educationalSeconds
   * @param {number} entertainmentSeconds
   * @param {number} [targetEduPct=50]
   * @param {number} [graceBufferSeconds=900]
   * @param {number} [desiredPositiveAllowanceSeconds=0]
   * @returns {number} Required educational seconds (>= 0)
   */
  function computeEducationalNeededToUnlock(
    educationalSeconds,
    entertainmentSeconds,
    targetEduPct = DEFAULT_SETTINGS.targetEduPct,
    graceBufferSeconds = DEFAULT_SETTINGS.graceBufferSeconds,
    desiredPositiveAllowanceSeconds = 0
  ) {
    const pct = normalizeTargetEduPct(targetEduPct);
    if (pct <= 0) {
      return 0;
    }
    if (pct >= 100) {
      return Infinity;
    }

    const currentAllowance = computeEntertainmentAllowance(
      educationalSeconds,
      entertainmentSeconds,
      pct,
      graceBufferSeconds
    );
    const targetAllowance = Math.max(0, Number(desiredPositiveAllowanceSeconds) || 0);
    const deficit = targetAllowance - currentAllowance;
    if (deficit <= 0) {
      return 0;
    }

    const entPerEduRatio = (100 - pct) / pct;
    return Math.ceil(deficit / entPerEduRatio);
  }

  /**
   * Computes comprehensive watch-time and ratio statistics for UI and enforcement.
   *
   * @param {object} params
   * @param {number} [params.educationalSeconds=0]
   * @param {number} [params.entertainmentSeconds=0]
   * @param {number} [params.unclassifiedSeconds=0]
   * @param {number} [params.targetEduPct=50]
   * @param {number} [params.graceBufferSeconds=900]
   * @param {number} [params.snoozeUntil=0]
   * @param {number} [params.nowMs=Date.now()]
   */
  function computeSplitStats(params = {}) {
    const educationalSeconds = Math.max(0, Number(params.educationalSeconds) || 0);
    const entertainmentSeconds = Math.max(0, Number(params.entertainmentSeconds) || 0);
    const unclassifiedSeconds = Math.max(0, Number(params.unclassifiedSeconds) || 0);
    const targetEduPct = normalizeTargetEduPct(
      params.targetEduPct !== undefined ? params.targetEduPct : DEFAULT_SETTINGS.targetEduPct
    );
    const targetEntPct = 100 - targetEduPct;
    const graceBufferSeconds = normalizeGraceBufferSeconds(
      params.graceBufferSeconds !== undefined
        ? params.graceBufferSeconds
        : DEFAULT_SETTINGS.graceBufferSeconds
    );
    const snoozeUntil = Number(params.snoozeUntil) || 0;
    const nowMs = params.nowMs !== undefined ? Number(params.nowMs) : Date.now();

    const totalClassifiedSeconds = educationalSeconds + entertainmentSeconds;
    const totalSeconds = totalClassifiedSeconds + unclassifiedSeconds;

    let actualEduPct = targetEduPct;
    let actualEntPct = targetEntPct;
    if (totalClassifiedSeconds > 0) {
      actualEduPct = Math.round((educationalSeconds / totalClassifiedSeconds) * 100);
      actualEntPct = 100 - actualEduPct;
    }

    const allowanceSeconds = computeEntertainmentAllowance(
      educationalSeconds,
      entertainmentSeconds,
      targetEduPct,
      graceBufferSeconds
    );
    const remainingBankSeconds = Math.max(0, Math.floor(allowanceSeconds));
    const isDepleted = allowanceSeconds <= 0;
    const isSnoozed = snoozeUntil > nowMs;
    const snoozeRemainingSeconds = isSnoozed ? Math.ceil((snoozeUntil - nowMs) / 1000) : 0;

    // How much educational time needed to break even (0:00) + unlock at least 1 minute of entertainment
    const eduSecondsToBreakEven = computeEducationalNeededToUnlock(
      educationalSeconds,
      entertainmentSeconds,
      targetEduPct,
      graceBufferSeconds,
      0
    );
    const eduSecondsToUnlockOneMin = computeEducationalNeededToUnlock(
      educationalSeconds,
      entertainmentSeconds,
      targetEduPct,
      graceBufferSeconds,
      60
    );
    const eduSecondsToUnlockFiveMin = computeEducationalNeededToUnlock(
      educationalSeconds,
      entertainmentSeconds,
      targetEduPct,
      graceBufferSeconds,
      300
    );

    return {
      educationalSeconds,
      entertainmentSeconds,
      unclassifiedSeconds,
      totalClassifiedSeconds,
      totalSeconds,
      actualEduPct,
      actualEntPct,
      targetEduPct,
      targetEntPct,
      graceBufferSeconds,
      allowanceSeconds,
      remainingBankSeconds,
      isDepleted,
      isSnoozed,
      snoozeRemainingSeconds,
      eduSecondsToBreakEven,
      eduSecondsToUnlockOneMin,
      eduSecondsToUnlockFiveMin
    };
  }

  /**
   * Creates a fresh daily counter entry for the given dateKey.
   * @param {string} dateKey
   */
  function createDailyRecord(dateKey) {
    return {
      dateKey,
      educationalSeconds: 0,
      entertainmentSeconds: 0,
      unclassifiedSeconds: 0,
      updatedAt: Date.now()
    };
  }

  /**
   * Creates a complete initial ledger state object.
   * @param {Date|number} [now=new Date()]
   * @param {Partial<typeof DEFAULT_SETTINGS>} [customSettings]
   */
  function createInitialState(now = new Date(), customSettings = {}) {
    const dateKey = getLocalDateKey(now);
    return {
      settings: {
        ...DEFAULT_SETTINGS,
        ...customSettings,
        targetEduPct: normalizeTargetEduPct(
          customSettings.targetEduPct !== undefined
            ? customSettings.targetEduPct
            : DEFAULT_SETTINGS.targetEduPct
        ),
        graceBufferSeconds: normalizeGraceBufferSeconds(
          customSettings.graceBufferSeconds !== undefined
            ? customSettings.graceBufferSeconds
            : DEFAULT_SETTINGS.graceBufferSeconds
        )
      },
      currentDay: createDailyRecord(dateKey),
      history: {},
      channelOverrides: {},
      videoOverrides: {},
      snoozeUntil: 0
    };
  }

  /**
   * Normalizes and migrates any partial state object into a valid state structure,
   * and performs automatic daily reset at local midnight while preserving historical daily summaries.
   *
   * @param {object} [rawState]
   * @param {Date|number} [now=new Date()]
   * @returns {object} Updated state
   */
  function ensureDailyLedger(rawState, now = new Date()) {
    const nowDate = now instanceof Date ? now : new Date(now);
    const todayKey = getLocalDateKey(nowDate);
    const base = createInitialState(nowDate);

    if (!rawState || typeof rawState !== 'object') {
      return base;
    }

    const settings = {
      ...DEFAULT_SETTINGS,
      ...(rawState.settings || {})
    };
    settings.targetEduPct = normalizeTargetEduPct(settings.targetEduPct);
    settings.graceBufferSeconds = normalizeGraceBufferSeconds(settings.graceBufferSeconds);
    settings.enforcementEnabled = Boolean(
      settings.enforcementEnabled !== undefined
        ? settings.enforcementEnabled
        : DEFAULT_SETTINGS.enforcementEnabled
    );

    const history = { ...(rawState.history || {}) };
    const channelOverrides = { ...(rawState.channelOverrides || {}) };
    const videoOverrides = { ...(rawState.videoOverrides || {}) };
    let snoozeUntil = Number(rawState.snoozeUntil) || 0;

    let currentDay = rawState.currentDay
      ? {
          dateKey: String(rawState.currentDay.dateKey || todayKey),
          educationalSeconds: Math.max(0, Number(rawState.currentDay.educationalSeconds) || 0),
          entertainmentSeconds: Math.max(0, Number(rawState.currentDay.entertainmentSeconds) || 0),
          unclassifiedSeconds: Math.max(0, Number(rawState.currentDay.unclassifiedSeconds) || 0),
          updatedAt: Number(rawState.currentDay.updatedAt) || nowDate.getTime()
        }
      : createDailyRecord(todayKey);

    if (currentDay.dateKey !== todayKey) {
      // Archive previous day's summary before resetting for the new local day
      const prevKey = currentDay.dateKey;
      const prevTotal =
        currentDay.educationalSeconds +
        currentDay.entertainmentSeconds +
        currentDay.unclassifiedSeconds;
      if (prevKey && (prevTotal > 0 || history[prevKey])) {
        const prevStats = computeSplitStats({
          educationalSeconds: currentDay.educationalSeconds,
          entertainmentSeconds: currentDay.entertainmentSeconds,
          unclassifiedSeconds: currentDay.unclassifiedSeconds,
          targetEduPct: settings.targetEduPct,
          graceBufferSeconds: settings.graceBufferSeconds
        });
        history[prevKey] = {
          dateKey: prevKey,
          educationalSeconds: currentDay.educationalSeconds,
          entertainmentSeconds: currentDay.entertainmentSeconds,
          unclassifiedSeconds: currentDay.unclassifiedSeconds,
          actualEduPct: prevStats.actualEduPct,
          actualEntPct: prevStats.actualEntPct,
          targetEduPct: settings.targetEduPct,
          graceBufferSeconds: settings.graceBufferSeconds,
          archivedAt: nowDate.getTime()
        };
      }

      // Prune oldest history entries if exceeding MAX_HISTORY_DAYS
      const keys = Object.keys(history).sort();
      while (keys.length > MAX_HISTORY_DAYS) {
        const oldest = keys.shift();
        delete history[oldest];
      }

      currentDay = createDailyRecord(todayKey);
      snoozeUntil = 0;
    }

    return {
      settings,
      currentDay,
      history,
      channelOverrides,
      videoOverrides,
      snoozeUntil
    };
  }

  /**
   * Records active watch time (in seconds) into the ledger for the given category,
   * ensuring local midnight rollover first.
   *
   * @param {object} rawState
   * @param {'educational'|'entertainment'|'unclassified'} category
   * @param {number} deltaSeconds
   * @param {Date|number} [now=new Date()]
   * @returns {{ state: object, stats: object }}
   */
  function recordWatchTime(rawState, category, deltaSeconds, now = new Date()) {
    const nowDate = now instanceof Date ? now : new Date(now);
    const state = ensureDailyLedger(rawState, nowDate);
    const delta = Math.max(0, Number(deltaSeconds) || 0);

    if (delta > 0) {
      if (category === 'educational') {
        state.currentDay.educationalSeconds += delta;
      } else if (category === 'entertainment') {
        state.currentDay.entertainmentSeconds += delta;
      } else {
        state.currentDay.unclassifiedSeconds += delta;
      }
      state.currentDay.updatedAt = nowDate.getTime();
    }

    const stats = getStateStats(state, nowDate);
    return { state, stats };
  }

  /**
   * Computes split and budget stats directly from a ledger state object.
   * @param {object} rawState
   * @param {Date|number} [now=new Date()]
   */
  function getStateStats(rawState, now = new Date()) {
    const nowDate = now instanceof Date ? now : new Date(now);
    const state = ensureDailyLedger(rawState, nowDate);
    return computeSplitStats({
      educationalSeconds: state.currentDay.educationalSeconds,
      entertainmentSeconds: state.currentDay.entertainmentSeconds,
      unclassifiedSeconds: state.currentDay.unclassifiedSeconds,
      targetEduPct: state.settings.targetEduPct,
      graceBufferSeconds: state.settings.graceBufferSeconds,
      snoozeUntil: state.snoozeUntil,
      nowMs: nowDate.getTime()
    });
  }

  /**
   * Formats seconds as M:SS or H:MM:SS.
   * @param {number} seconds
   * @returns {string}
   */
  function formatClock(seconds) {
    if (!Number.isFinite(seconds)) {
      return '∞';
    }
    const sign = seconds < 0 ? '-' : '';
    const abs = Math.floor(Math.abs(seconds));
    const hrs = Math.floor(abs / 3600);
    const mins = Math.floor((abs % 3600) / 60);
    const secs = abs % 60;
    if (hrs > 0) {
      return `${sign}${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${sign}${mins}:${String(secs).padStart(2, '0')}`;
  }

  /**
   * Formats seconds as human-readable "Xh Ym" or "Ym Zs".
   * @param {number} seconds
   * @returns {string}
   */
  function formatDuration(seconds) {
    if (!Number.isFinite(seconds)) {
      return 'Unlimited';
    }
    const abs = Math.max(0, Math.round(seconds));
    const hrs = Math.floor(abs / 3600);
    const mins = Math.floor((abs % 3600) / 60);
    const secs = abs % 60;
    if (hrs > 0) {
      return `${hrs}h ${mins}m`;
    }
    if (mins > 0) {
      return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    }
    return `${secs}s`;
  }

  /**
   * Resolves the active storage area (chrome.storage.local or an injected mock storage).
   * @param {object} [customStorage]
   */
  function resolveStorage(customStorage) {
    if (customStorage) {
      return customStorage;
    }
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return chrome.storage.local;
    }
    return null;
  }

  /**
   * Reads the current ledger state from storage, running `ensureDailyLedger` so midnight
   * rollovers are persisted automatically.
   *
   * @param {object} [options]
   * @param {object} [options.storage]
   * @param {Date|number} [options.now]
   * @returns {Promise<object>}
   */
  async function loadState(options = {}) {
    const storage = resolveStorage(options.storage);
    const now = options.now || new Date();
    if (!storage) {
      return ensureDailyLedger(null, now);
    }

    const raw = await new Promise((resolve) => {
      storage.get([STORAGE_KEY], (result) => {
        resolve(result ? result[STORAGE_KEY] : null);
      });
    });

    const ensured = ensureDailyLedger(raw, now);
    if (!raw || !raw.currentDay || raw.currentDay.dateKey !== ensured.currentDay.dateKey) {
      await saveState(ensured, { storage });
    }
    return ensured;
  }

  /**
   * Saves the ledger state to storage.
   * @param {object} state
   * @param {object} [options]
   * @param {object} [options.storage]
   * @returns {Promise<object>}
   */
  async function saveState(state, options = {}) {
    const storage = resolveStorage(options.storage);
    if (!storage) {
      return state;
    }
    await new Promise((resolve) => {
      storage.set({ [STORAGE_KEY]: state }, () => resolve());
    });
    return state;
  }

  /**
   * Atomically loads, mutates, and saves the ledger state.
   * @param {(state: object) => object|void} mutator
   * @param {object} [options]
   * @param {object} [options.storage]
   * @param {Date|number} [options.now]
   * @returns {Promise<{ state: object, stats: object }>}
   */
  async function updateState(mutator, options = {}) {
    const now = options.now || new Date();
    const current = await loadState(options);
    const maybeNext = mutator(current);
    const nextState = ensureDailyLedger(maybeNext || current, now);
    await saveState(nextState, options);
    return {
      state: nextState,
      stats: getStateStats(nextState, now)
    };
  }

  return {
    STORAGE_KEY,
    MAX_HISTORY_DAYS,
    DEFAULT_SETTINGS,
    getLocalDateKey,
    normalizeTargetEduPct,
    normalizeGraceBufferSeconds,
    computeEntertainmentAllowance,
    computeEducationalNeededToUnlock,
    computeSplitStats,
    createDailyRecord,
    createInitialState,
    ensureDailyLedger,
    recordWatchTime,
    getStateStats,
    formatClock,
    formatDuration,
    loadState,
    saveState,
    updateState
  };
});
