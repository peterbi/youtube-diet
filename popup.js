(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const ledger = require('./src/ledger');
    const classifier = require('./src/classifier');
    module.exports = factory(ledger, classifier);
  } else {
    root.YouTubeDietPopup = factory(root.YouTubeDietLedger, root.YouTubeDietClassifier);
    if (typeof document !== 'undefined') {
      document.addEventListener('DOMContentLoaded', () => {
        root.YouTubeDietPopup.initPopup();
      });
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Ledger, Classifier) {
  'use strict';

  function initPopup(options = {}) {
    const doc = options.document || (typeof document !== 'undefined' ? document : null);
    const storage = options.storage || undefined;
    if (!doc) {
      return null;
    }

    const els = {
      dateLabel: doc.getElementById('current-date-label'),
      headerBankPill: doc.getElementById('header-bank-pill'),
      eduTimeValue: doc.getElementById('edu-time-value'),
      eduPctValue: doc.getElementById('edu-pct-value'),
      entTimeValue: doc.getElementById('ent-time-value'),
      entPctValue: doc.getElementById('ent-pct-value'),
      actualSplitLabel: doc.getElementById('actual-split-label'),
      targetSplitLabel: doc.getElementById('target-split-label'),
      actualEduBar: doc.getElementById('actual-edu-bar'),
      targetEduMarker: doc.getElementById('target-edu-marker'),
      remainingBankDetail: doc.getElementById('remaining-bank-detail'),
      targetEduSlider: doc.getElementById('target-edu-slider'),
      sliderSplitDisplay: doc.getElementById('slider-split-display'),
      graceBufferInput: doc.getElementById('grace-buffer-input'),
      enforcementToggle: doc.getElementById('enforcement-toggle'),
      enforcementModeHint: doc.getElementById('enforcement-mode-hint'),
      classificationModeSelect: doc.getElementById('classification-mode-select'),
      classificationModeHint: doc.getElementById('classification-mode-hint'),
      overrideSectionTitle: doc.getElementById('override-section-title'),
      overrideCountBadge: doc.getElementById('override-count-badge'),
      addOverrideForm: doc.getElementById('add-override-form'),
      overrideChannelInput: doc.getElementById('override-channel-input'),
      overrideTypeSelect: doc.getElementById('override-type-select'),
      channelOverrideList: doc.getElementById('channel-override-list')
    };

    let currentState = Ledger.createInitialState();

    function render(state) {
      currentState = state;
      const stats = Ledger.getStateStats(state);

      if (els.dateLabel) {
        els.dateLabel.textContent = `Today (${state.currentDay.dateKey})`;
      }

      if (els.headerBankPill) {
        els.headerBankPill.textContent = `Bank: ${Ledger.formatClock(stats.remainingBankSeconds)}`;
        els.headerBankPill.classList.toggle('depleted', stats.isDepleted);
      }

      if (els.eduTimeValue) {
        els.eduTimeValue.textContent = Ledger.formatClock(stats.educationalSeconds);
      }
      if (els.eduPctValue) {
        els.eduPctValue.textContent = `Actual: ${stats.actualEduPct}%`;
      }

      if (els.entTimeValue) {
        els.entTimeValue.textContent = Ledger.formatClock(stats.entertainmentSeconds);
      }
      if (els.entPctValue) {
        els.entPctValue.textContent = `Actual: ${stats.actualEntPct}%`;
      }

      if (els.actualSplitLabel) {
        els.actualSplitLabel.textContent = `Actual: ${stats.actualEduPct}% Edu / ${stats.actualEntPct}% Ent`;
      }
      if (els.targetSplitLabel) {
        els.targetSplitLabel.textContent = `Target: ${stats.targetEduPct}% / ${stats.targetEntPct}%`;
      }

      if (els.actualEduBar) {
        els.actualEduBar.style.width = `${stats.actualEduPct}%`;
      }
      if (els.targetEduMarker) {
        els.targetEduMarker.style.left = `${stats.targetEduPct}%`;
      }

      if (els.remainingBankDetail) {
        if (stats.isDepleted) {
          const unlock1m = Ledger.formatDuration(stats.eduSecondsToUnlockOneMin);
          els.remainingBankDetail.textContent = `0:00 (Need ${unlock1m} Edu for +1m)`;
        } else {
          els.remainingBankDetail.textContent = Ledger.formatClock(stats.remainingBankSeconds);
        }
      }

      if (els.targetEduSlider) {
        els.targetEduSlider.value = String(stats.targetEduPct);
      }
      if (els.sliderSplitDisplay) {
        els.sliderSplitDisplay.textContent = `${stats.targetEduPct}% Edu / ${stats.targetEntPct}% Ent`;
      }

      if (els.graceBufferInput) {
        const mins = Math.round(stats.graceBufferSeconds / 60);
        if (doc.activeElement !== els.graceBufferInput) {
          els.graceBufferInput.value = String(mins);
        }
      }

      if (els.enforcementToggle) {
        els.enforcementToggle.checked = Boolean(state.settings.enforcementEnabled);
      }
      if (els.enforcementModeHint) {
        els.enforcementModeHint.textContent = state.settings.enforcementEnabled
          ? 'Strict block: pause & lock player when bank hits 0:00'
          : 'Gentle warning: show HUD status without pausing video';
      }

      const mode =
        state.settings.classificationMode === 'channels-only' ? 'channels-only' : 'heuristics';
      if (els.classificationModeSelect) {
        els.classificationModeSelect.value = mode;
      }
      if (els.classificationModeHint) {
        els.classificationModeHint.textContent =
          mode === 'channels-only'
            ? 'Only user-defined channels vs. everything else (Entertainment)'
            : 'Auto category & keyword heuristics + pinned channels';
      }
      if (els.overrideSectionTitle) {
        els.overrideSectionTitle.textContent =
          mode === 'channels-only'
            ? 'User-Defined Channels (vs. Everything Else)'
            : 'Saved Channel Overrides';
      }

      renderOverrides(state.channelOverrides || {});
    }

    function renderOverrides(channelOverrides) {
      if (!els.channelOverrideList) {
        return;
      }
      const entries = Object.entries(channelOverrides);
      if (els.overrideCountBadge) {
        els.overrideCountBadge.textContent = String(entries.length);
      }

      els.channelOverrideList.innerHTML = '';
      if (entries.length === 0) {
        const emptyLi = doc.createElement('li');
        emptyLi.className = 'override-empty';
        emptyLi.textContent = 'No pinned channels yet.';
        els.channelOverrideList.appendChild(emptyLi);
        return;
      }

      for (const [key, rawValue] of entries) {
        const classification =
          typeof rawValue === 'object' ? rawValue.classification : rawValue;
        const displayName =
          (typeof rawValue === 'object' && rawValue.channelName) ||
          key.replace(/^name:/, '');

        const li = doc.createElement('li');
        li.className = 'override-item';

        const nameSpan = doc.createElement('span');
        nameSpan.className = 'override-name';
        nameSpan.textContent = displayName;
        nameSpan.title = displayName;

        const actionsDiv = doc.createElement('div');
        actionsDiv.className = 'override-actions';

        const tagBtn = doc.createElement('button');
        tagBtn.type = 'button';
        const isEdu = classification === 'educational';
        tagBtn.className = `override-tag ${isEdu ? 'override-tag-edu' : 'override-tag-ent'}`;
        tagBtn.textContent = isEdu ? 'Educational' : 'Entertainment';
        tagBtn.title = 'Click to switch classification';
        tagBtn.addEventListener('click', async () => {
          const nextClass = isEdu ? 'entertainment' : 'educational';
          const { state } = await Ledger.updateState(
            (draft) => {
              draft.channelOverrides = draft.channelOverrides || {};
              draft.channelOverrides[key] = {
                ...(typeof rawValue === 'object' ? rawValue : {}),
                classification: nextClass,
                channelName: displayName,
                updatedAt: Date.now()
              };
              return draft;
            },
            { storage }
          );
          render(state);
        });

        const removeBtn = doc.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'override-remove';
        removeBtn.textContent = '×';
        removeBtn.title = 'Remove channel override';
        removeBtn.addEventListener('click', async () => {
          const { state } = await Ledger.updateState(
            (draft) => {
              if (draft.channelOverrides) {
                delete draft.channelOverrides[key];
              }
              return draft;
            },
            { storage }
          );
          render(state);
        });

        actionsDiv.appendChild(tagBtn);
        actionsDiv.appendChild(removeBtn);
        li.appendChild(nameSpan);
        li.appendChild(actionsDiv);
        els.channelOverrideList.appendChild(li);
      }
    }

    if (els.targetEduSlider) {
      els.targetEduSlider.addEventListener('input', async (e) => {
        const targetEduPct = Number(e.target.value);
        const { state } = await Ledger.updateState(
          (draft) => {
            draft.settings.targetEduPct = Ledger.normalizeTargetEduPct(targetEduPct);
            return draft;
          },
          { storage }
        );
        render(state);
      });
    }

    if (els.graceBufferInput) {
      els.graceBufferInput.addEventListener('change', async (e) => {
        const mins = Math.max(0, Math.min(180, Number(e.target.value) || 0));
        const { state } = await Ledger.updateState(
          (draft) => {
            draft.settings.graceBufferSeconds = Math.round(mins * 60);
            return draft;
          },
          { storage }
        );
        render(state);
      });
    }

    if (els.enforcementToggle) {
      els.enforcementToggle.addEventListener('change', async (e) => {
        const enabled = Boolean(e.target.checked);
        const { state } = await Ledger.updateState(
          (draft) => {
            draft.settings.enforcementEnabled = enabled;
            return draft;
          },
          { storage }
        );
        render(state);
      });
    }

    if (els.classificationModeSelect) {
      els.classificationModeSelect.addEventListener('change', async (e) => {
        const mode = Ledger.normalizeClassificationMode
          ? Ledger.normalizeClassificationMode(e.target.value)
          : e.target.value === 'channels-only'
          ? 'channels-only'
          : 'heuristics';
        const { state } = await Ledger.updateState(
          (draft) => {
            draft.settings.classificationMode = mode;
            return draft;
          },
          { storage }
        );
        render(state);
      });
    }

    if (els.addOverrideForm) {
      els.addOverrideForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const rawName = els.overrideChannelInput ? els.overrideChannelInput.value.trim() : '';
        if (!rawName) {
          return;
        }
        const classification = els.overrideTypeSelect
          ? els.overrideTypeSelect.value
          : 'educational';
        const key = rawName.startsWith('UC')
          ? rawName
          : Classifier.getChannelKey({ channelName: rawName });

        const { state } = await Ledger.updateState(
          (draft) => {
            draft.channelOverrides = draft.channelOverrides || {};
            draft.channelOverrides[key] = {
              classification,
              channelName: rawName,
              updatedAt: Date.now()
            };
            return draft;
          },
          { storage }
        );

        if (els.overrideChannelInput) {
          els.overrideChannelInput.value = '';
        }
        render(state);
      });
    }

    Ledger.loadState({ storage }).then(render);

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes[Ledger.STORAGE_KEY]) {
          const newVal = changes[Ledger.STORAGE_KEY].newValue;
          if (newVal) {
            render(Ledger.ensureDailyLedger(newVal));
          }
        }
      });
    } else if (typeof window !== 'undefined') {
      const refreshFromStorage = () => {
        Ledger.loadState({ storage }).then(render);
      };
      window.addEventListener('yt-diet-storage-updated', refreshFromStorage);
      window.addEventListener('storage', (e) => {
        if (!e.key || e.key === Ledger.STORAGE_KEY) {
          refreshFromStorage();
        }
      });
    }

    return { render, getState: () => currentState };
  }

  return {
    initPopup
  };
});
