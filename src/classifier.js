(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.YouTubeDietClassifier = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EDUCATIONAL_CATEGORIES = new Set([
    'education',
    'science & technology',
    'howto & style',
    'news & politics',
    'nonprofits & activism'
  ]);

  const ENTERTAINMENT_CATEGORIES = new Set([
    'entertainment',
    'gaming',
    'comedy',
    'music',
    'film & animation',
    'sports',
    'people & blogs',
    'autos & vehicles',
    'pets & animals',
    'travel & events',
    'shows',
    'movies',
    'trailers'
  ]);

  const CATEGORY_WEIGHTS = Object.freeze({
    'education': 3.5,
    'science & technology': 3.0,
    'howto & style': 2.0,
    'news & politics': 2.0,
    'nonprofits & activism': 1.5,
    'people & blogs': -1.5,
    'autos & vehicles': -2.0,
    'pets & animals': -2.0,
    'travel & events': -2.0,
    'entertainment': -3.0,
    'gaming': -3.5,
    'comedy': -3.5,
    'music': -3.0,
    'film & animation': -2.5,
    'sports': -3.0,
    'shows': -3.0,
    'movies': -3.0,
    'trailers': -3.0
  });

  const EDUCATIONAL_KEYWORDS = Object.freeze([
    'lecture',
    'tutorial',
    'course',
    'explained',
    'documentary',
    'lesson',
    'syllabus',
    'calculus',
    'linear algebra',
    'mathematics',
    'physics',
    'chemistry',
    'biology',
    'neuroscience',
    'computer science',
    'algorithm',
    'algorithms',
    'data structures',
    'programming',
    'coding tutorial',
    'system design',
    'machine learning',
    'deep learning',
    'neural network',
    'history of',
    'deep dive',
    'seminar',
    'keynote',
    'colloquium',
    'textbook',
    'problem solving',
    'engineering',
    'research paper',
    'literature review',
    'study guide',
    'crash course',
    'opencourseware',
    'university',
    'professor',
    'dissertation',
    'theorem',
    'proof',
    'economics',
    'macroeconomics',
    'microeconomics',
    'philosophy',
    'anatomy',
    'medicine',
    'how to build',
    'step-by-step guide'
  ]);

  const ENTERTAINMENT_KEYWORDS = Object.freeze([
    'gameplay',
    'vlog',
    'prank',
    'highlights',
    'react',
    'reaction',
    'reacts',
    'funny moments',
    'bloopers',
    "let's play",
    'lets play',
    'walkthrough',
    'speedrun',
    'unboxing',
    'haul',
    'challenge',
    'roast',
    'parody',
    'skit',
    'meme',
    'memes',
    'compilation',
    'trailer',
    'music video',
    'official video',
    'official audio',
    'lyric video',
    'stream highlights',
    'tier list',
    'drama',
    'gossip',
    'try not to laugh',
    'tik tok',
    'tiktok compilation',
    'shorts compilation',
    'playthrough',
    'boss fight',
    'esports',
    'killcam',
    'montage'
  ]);

  /**
   * Normalizes a string key for case-insensitive matching.
   * @param {string} str
   * @returns {string}
   */
  function normalizeText(str) {
    return String(str || '')
      .trim()
      .toLowerCase();
  }

  /**
   * Normalizes a channel identifier (preferring channelId, or normalized handle/name).
   * @param {object} metadata
   * @returns {string}
   */
  function getChannelKey(metadata = {}) {
    if (metadata.channelId && String(metadata.channelId).trim()) {
      return String(metadata.channelId).trim();
    }
    if (metadata.channelName && String(metadata.channelName).trim()) {
      return `name:${normalizeText(metadata.channelName)}`;
    }
    return '';
  }

  /**
   * Maps a YouTube category string directly to 'educational', 'entertainment', or null.
   * @param {string} category
   * @returns {'educational'|'entertainment'|null}
   */
  function mapYouTubeCategory(category) {
    const norm = normalizeText(category);
    if (!norm) {
      return null;
    }
    if (EDUCATIONAL_CATEGORIES.has(norm)) {
      return 'educational';
    }
    if (ENTERTAINMENT_CATEGORIES.has(norm)) {
      return 'entertainment';
    }
    return null;
  }

  /**
   * Escapes special regex characters in a literal keyword.
   * @param {string} str
   */
  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Finds all keywords from `keywordList` that appear as whole words/phrases in `text`.
   * @param {string} text
   * @param {readonly string[]} keywordList
   * @returns {string[]}
   */
  function findMatchingKeywords(text, keywordList) {
    const norm = normalizeText(text);
    if (!norm) {
      return [];
    }
    const matches = [];
    for (const kw of keywordList) {
      const pattern = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(kw)}(?:$|[^a-z0-9])`, 'i');
      if (pattern.test(norm)) {
        matches.push(kw);
      }
    }
    return matches;
  }

  /**
   * Classifies a YouTube video given its extracted metadata and user overrides.
   *
   * @param {object} metadata
   * @param {string} [metadata.videoId]
   * @param {string} [metadata.title]
   * @param {string} [metadata.description]
   * @param {string} [metadata.category]
   * @param {string} [metadata.channelId]
   * @param {string} [metadata.channelName]
   * @param {string[]} [metadata.keywords]
   * @param {object} [options]
   * @param {Record<string, string|{classification: string, channelName?: string}>} [options.channelOverrides]
   * @param {Record<string, string|{classification: string, title?: string}>} [options.videoOverrides]
   * @param {'educational'|'entertainment'} [options.defaultCategory='entertainment']
   * @returns {{
   *   classification: 'educational'|'entertainment',
   *   source: 'video-override'|'channel-override'|'heuristic'|'default',
   *   score: number,
   *   categoryMapped: 'educational'|'entertainment'|null,
   *   matchedEduKeywords: string[],
   *   matchedEntKeywords: string[],
   *   reason: string
   * }}
   */
  function classifyVideo(metadata = {}, options = {}) {
    const videoOverrides = options.videoOverrides || {};
    const channelOverrides = options.channelOverrides || {};
    const defaultCategory =
      options.defaultCategory === 'educational' ? 'educational' : 'entertainment';

    const videoId = metadata.videoId ? String(metadata.videoId).trim() : '';
    const channelId = metadata.channelId ? String(metadata.channelId).trim() : '';
    const channelName = metadata.channelName ? String(metadata.channelName).trim() : '';
    const channelKey = getChannelKey(metadata);

    // 1. Check video-specific override
    if (videoId && videoOverrides[videoId]) {
      const entry = videoOverrides[videoId];
      const overrideVal = typeof entry === 'object' ? entry.classification : entry;
      if (overrideVal === 'educational' || overrideVal === 'entertainment') {
        return {
          classification: overrideVal,
          source: 'video-override',
          score: overrideVal === 'educational' ? 100 : -100,
          categoryMapped: mapYouTubeCategory(metadata.category),
          matchedEduKeywords: [],
          matchedEntKeywords: [],
          reason: `Video manually set to ${overrideVal}`
        };
      }
    }

    // 2. Check channel override (by channelKey, channelId, or normalized channelName)
    const candidateKeys = [
      channelKey,
      channelId,
      channelName ? `name:${normalizeText(channelName)}` : '',
      channelName ? normalizeText(channelName) : ''
    ].filter(Boolean);

    for (const key of candidateKeys) {
      if (channelOverrides[key]) {
        const entry = channelOverrides[key];
        const overrideVal = typeof entry === 'object' ? entry.classification : entry;
        if (overrideVal === 'educational' || overrideVal === 'entertainment') {
          return {
            classification: overrideVal,
            source: 'channel-override',
            score: overrideVal === 'educational' ? 100 : -100,
            categoryMapped: mapYouTubeCategory(metadata.category),
            matchedEduKeywords: [],
            matchedEntKeywords: [],
            reason: `Channel pinned as ${overrideVal}`
          };
        }
      }
    }

    // 3. Category + Title/Description Keyword Heuristics
    const normCategory = normalizeText(metadata.category);
    const categoryMapped = mapYouTubeCategory(normCategory);
    let score = 0;

    if (normCategory && Object.prototype.hasOwnProperty.call(CATEGORY_WEIGHTS, normCategory)) {
      score += CATEGORY_WEIGHTS[normCategory];
    }

    const titleText = String(metadata.title || '');
    const descText = [
      String(metadata.description || ''),
      Array.isArray(metadata.keywords) ? metadata.keywords.join(' ') : ''
    ].join(' ');

    const titleEdu = findMatchingKeywords(titleText, EDUCATIONAL_KEYWORDS);
    const titleEnt = findMatchingKeywords(titleText, ENTERTAINMENT_KEYWORDS);
    const descEdu = findMatchingKeywords(descText, EDUCATIONAL_KEYWORDS);
    const descEnt = findMatchingKeywords(descText, ENTERTAINMENT_KEYWORDS);

    // Title matches carry stronger weight than description matches
    score += titleEdu.length * 2.2;
    score -= titleEnt.length * 2.2;
    score += Math.min(descEdu.length, 3) * 0.8;
    score -= Math.min(descEnt.length, 3) * 0.8;

    const matchedEduKeywords = Array.from(new Set([...titleEdu, ...descEdu]));
    const matchedEntKeywords = Array.from(new Set([...titleEnt, ...descEnt]));

    if (score > 0) {
      const reasons = [];
      if (categoryMapped === 'educational') {
        reasons.push(`Category: ${metadata.category}`);
      }
      if (matchedEduKeywords.length > 0) {
        reasons.push(`Keywords: ${matchedEduKeywords.slice(0, 3).join(', ')}`);
      }
      return {
        classification: 'educational',
        source: 'heuristic',
        score: Number(score.toFixed(2)),
        categoryMapped,
        matchedEduKeywords,
        matchedEntKeywords,
        reason: reasons.join(' • ') || 'Educational signals'
      };
    }

    if (score < 0) {
      const reasons = [];
      if (categoryMapped === 'entertainment') {
        reasons.push(`Category: ${metadata.category}`);
      }
      if (matchedEntKeywords.length > 0) {
        reasons.push(`Keywords: ${matchedEntKeywords.slice(0, 3).join(', ')}`);
      }
      return {
        classification: 'entertainment',
        source: 'heuristic',
        score: Number(score.toFixed(2)),
        categoryMapped,
        matchedEduKeywords,
        matchedEntKeywords,
        reason: reasons.join(' • ') || 'Entertainment signals'
      };
    }

    // Tie or zero signals -> fall back to categoryMapped or defaultCategory
    const fallback = categoryMapped || defaultCategory;
    return {
      classification: fallback,
      source: categoryMapped ? 'heuristic' : 'default',
      score: 0,
      categoryMapped,
      matchedEduKeywords,
      matchedEntKeywords,
      reason: categoryMapped ? `Category: ${metadata.category}` : `Default (${fallback})`
    };
  }

  /**
   * Extracts the YouTube video ID from a URL string or Location object.
   * Supports standard `/watch?v=...` and `/shorts/...` URLs.
   *
   * @param {string|Location} urlInput
   * @returns {string}
   */
  function extractVideoIdFromUrl(urlInput) {
    if (!urlInput) {
      return '';
    }
    try {
      const urlStr = typeof urlInput === 'string' ? urlInput : urlInput.href;
      const url = new URL(urlStr, 'https://www.youtube.com');
      if (url.pathname === '/watch') {
        return url.searchParams.get('v') || '';
      }
      const shortsMatch = url.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{6,})/);
      if (shortsMatch) {
        return shortsMatch[1];
      }
    } catch (_) {
      // Ignore malformed URLs
    }
    return '';
  }

  /**
   * Attempts to parse `ytInitialPlayerResponse` JSON from inline <script> tags if present.
   * @param {Document} doc
   * @param {string} [expectedVideoId]
   * @returns {object|null}
   */
  function parsePlayerResponseFromScripts(doc, expectedVideoId = '') {
    if (!doc || typeof doc.querySelectorAll !== 'function') {
      return null;
    }
    const scripts = doc.querySelectorAll('script');
    const marker = 'ytInitialPlayerResponse';
    for (const script of scripts) {
      const text = script.textContent || '';
      const idx = text.indexOf(marker);
      if (idx === -1) {
        continue;
      }
      const braceStart = text.indexOf('{', idx);
      if (braceStart === -1) {
        continue;
      }
      // Extract balanced JSON object
      let depth = 0;
      let inString = false;
      let escaped = false;
      let endIdx = -1;
      for (let i = braceStart; i < text.length; i++) {
        const ch = text[i];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\' && inString) {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = !inString;
          continue;
        }
        if (!inString) {
          if (ch === '{') {
            depth++;
          } else if (ch === '}') {
            depth--;
            if (depth === 0) {
              endIdx = i + 1;
              break;
            }
          }
        }
      }
      if (endIdx !== -1) {
        try {
          const parsed = JSON.parse(text.slice(braceStart, endIdx));
          const parsedId = parsed?.videoDetails?.videoId || '';
          if (!expectedVideoId || !parsedId || parsedId === expectedVideoId) {
            return parsed;
          }
        } catch (_) {
          // Continue scanning other scripts
        }
      }
    }
    return null;
  }

  /**
   * Extracts video metadata from a YouTube watch page using `ytInitialPlayerResponse`,
   * microformat DOM elements, JSON-LD, and page DOM selectors.
   *
   * @param {object} [context]
   * @param {object} [context.playerResponse] Explicit ytInitialPlayerResponse object
   * @param {Document} [context.document] DOM Document
   * @param {string} [context.url] Page URL
   * @returns {{
   *   videoId: string,
   *   title: string,
   *   category: string,
   *   channelId: string,
   *   channelName: string,
   *   description: string,
   *   keywords: string[]
   * }}
   */
  function extractVideoMetadata(context = {}) {
    const doc =
      context.document || (typeof document !== 'undefined' ? document : null);
    const url =
      context.url ||
      (doc && doc.location ? doc.location.href : '') ||
      (typeof location !== 'undefined' ? location.href : '');

    const urlVideoId = extractVideoIdFromUrl(url);

    let playerResponse = context.playerResponse || null;
    if (!playerResponse && doc && doc.defaultView && doc.defaultView.ytInitialPlayerResponse) {
      playerResponse = doc.defaultView.ytInitialPlayerResponse;
    }
    // Check if playerResponse is stale from a previous SPA navigation
    if (
      playerResponse &&
      urlVideoId &&
      playerResponse.videoDetails &&
      playerResponse.videoDetails.videoId &&
      playerResponse.videoDetails.videoId !== urlVideoId
    ) {
      playerResponse = null;
    }

    if (!playerResponse && doc) {
      playerResponse = parsePlayerResponseFromScripts(doc, urlVideoId);
    }

    const details = (playerResponse && playerResponse.videoDetails) || {};
    const microformat =
      (playerResponse &&
        playerResponse.microformat &&
        playerResponse.microformat.playerMicroformatRenderer) ||
      {};

    let videoId = urlVideoId || details.videoId || '';
    let title = details.title || (microformat.title && microformat.title.simpleText) || '';
    let category = microformat.category || '';
    let channelId = details.channelId || microformat.externalChannelId || '';
    let channelName = details.author || microformat.ownerChannelName || '';
    let description =
      details.shortDescription ||
      (microformat.description && microformat.description.simpleText) ||
      '';
    let keywords = Array.isArray(details.keywords) ? details.keywords : [];

    // DOM fallbacks for SPA navigation or content script isolated world
    if (doc && typeof doc.querySelector === 'function') {
      if (!category) {
        const genreMeta =
          doc.querySelector('ytd-watch-flexy meta[itemprop="genre"]') ||
          doc.querySelector('#microformat meta[itemprop="genre"]') ||
          doc.querySelector('meta[itemprop="genre"]');
        if (genreMeta && genreMeta.getAttribute('content')) {
          category = genreMeta.getAttribute('content').trim();
        }
      }

      if (!category || !title || !channelName) {
        const ldJsonEl =
          doc.querySelector('ytd-player-microformat-renderer script[type="application/ld+json"]') ||
          doc.querySelector('#microformat script[type="application/ld+json"]');
        if (ldJsonEl && ldJsonEl.textContent) {
          try {
            const ld = JSON.parse(ldJsonEl.textContent);
            if (!category && ld.genre) {
              category = String(ld.genre).trim();
            }
            if (!title && ld.name) {
              title = String(ld.name).trim();
            }
            if (!channelName && ld.author) {
              channelName = String(
                typeof ld.author === 'object' ? ld.author.name || '' : ld.author
              ).trim();
            }
            if (!description && ld.description) {
              description = String(ld.description).trim();
            }
          } catch (_) {
            // Ignore malformed JSON-LD
          }
        }
      }

      if (!title) {
        const titleEl =
          doc.querySelector('ytd-watch-metadata h1 yt-formatted-string') ||
          doc.querySelector('h1.ytd-watch-metadata') ||
          doc.querySelector('#title h1');
        if (titleEl && titleEl.textContent) {
          title = titleEl.textContent.trim();
        } else if (doc.title) {
          title = doc.title.replace(/\s*-\s*YouTube\s*$/i, '').trim();
        }
      }

      if (!channelName || !channelId) {
        const channelLink =
          doc.querySelector('ytd-watch-metadata #owner #channel-name a') ||
          doc.querySelector('#owner #channel-name a') ||
          doc.querySelector('ytd-video-owner-renderer #channel-name a');
        if (channelLink) {
          if (!channelName && channelLink.textContent) {
            channelName = channelLink.textContent.trim();
          }
          const href = channelLink.getAttribute('href') || '';
          if (!channelId && href) {
            const chMatch = href.match(/\/channel\/(UC[a-zA-Z0-9_-]+)/);
            if (chMatch) {
              channelId = chMatch[1];
            } else if (href.startsWith('/@')) {
              channelId = href.slice(1).split('/')[0];
            }
          }
        }
      }

      if (!description) {
        const descEl =
          doc.querySelector('#description-inline-expander') ||
          doc.querySelector('#description ytd-text-inline-expander') ||
          doc.querySelector('meta[name="description"]');
        if (descEl) {
          description = (
            descEl.getAttribute?.('content') ||
            descEl.textContent ||
            ''
          ).trim();
        }
      }
    }

    return {
      videoId,
      title,
      category,
      channelId,
      channelName,
      description,
      keywords
    };
  }

  return {
    EDUCATIONAL_CATEGORIES,
    ENTERTAINMENT_CATEGORIES,
    CATEGORY_WEIGHTS,
    EDUCATIONAL_KEYWORDS,
    ENTERTAINMENT_KEYWORDS,
    normalizeText,
    getChannelKey,
    mapYouTubeCategory,
    findMatchingKeywords,
    classifyVideo,
    extractVideoIdFromUrl,
    extractVideoMetadata
  };
});
