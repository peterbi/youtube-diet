const test = require('node:test');
const assert = require('node:assert/strict');
const Classifier = require('../src/classifier');
const Content = require('../src/content');

test('Classifier: maps standard YouTube categories to educational vs entertainment', () => {
  assert.equal(Classifier.mapYouTubeCategory('Education'), 'educational');
  assert.equal(Classifier.mapYouTubeCategory('Science & Technology'), 'educational');
  assert.equal(Classifier.mapYouTubeCategory('Howto & Style'), 'educational');
  assert.equal(Classifier.mapYouTubeCategory('News & Politics'), 'educational');

  assert.equal(Classifier.mapYouTubeCategory('Entertainment'), 'entertainment');
  assert.equal(Classifier.mapYouTubeCategory('Gaming'), 'entertainment');
  assert.equal(Classifier.mapYouTubeCategory('Comedy'), 'entertainment');
  assert.equal(Classifier.mapYouTubeCategory('Music'), 'entertainment');
  assert.equal(Classifier.mapYouTubeCategory('Film & Animation'), 'entertainment');
  assert.equal(Classifier.mapYouTubeCategory('Sports'), 'entertainment');
  assert.equal(Classifier.mapYouTubeCategory('People & Blogs'), 'entertainment');
});

test('Classifier: combines category and keyword heuristics accurately', () => {
  // Pure category + matching educational keywords
  const mitLecture = Classifier.classifyVideo({
    videoId: 'vid-1',
    title: 'Lecture 1: Introduction to Algorithms — MIT OpenCourseWare',
    category: 'Education',
    channelName: 'MIT OpenCourseWare'
  });
  assert.equal(mitLecture.classification, 'educational');
  assert.equal(mitLecture.source, 'heuristic');
  assert.ok(mitLecture.matchedEduKeywords.includes('lecture'));

  // Educational tutorial uploaded under "People & Blogs"
  const blogTutorial = Classifier.classifyVideo({
    videoId: 'vid-2',
    title: 'Distributed Systems Explained: Raft Consensus Full Tutorial',
    category: 'People & Blogs',
    channelName: 'Systems Dev'
  });
  assert.equal(blogTutorial.classification, 'educational');

  // Gaming / Prank video with entertainment keywords
  const gamingHighlights = Classifier.classifyVideo({
    videoId: 'vid-3',
    title: 'INSANE Ranked Gameplay Highlights & Funny Moments React!',
    category: 'Gaming',
    channelName: 'ProGamer'
  });
  assert.equal(gamingHighlights.classification, 'entertainment');
  assert.ok(gamingHighlights.matchedEntKeywords.includes('gameplay'));

  // Vlog/prank uploaded under "Howto & Style"
  const prankVideo = Classifier.classifyVideo({
    videoId: 'vid-4',
    title: '24 Hour Overnight Challenge Prank Vlog with Friends!',
    category: 'Howto & Style',
    channelName: 'DailyVlogger'
  });
  assert.equal(prankVideo.classification, 'entertainment');
});

test('Classifier: respects user videoOverrides and channelOverrides over heuristics', () => {
  const baseVideo = {
    videoId: 'game-doc-123',
    title: 'Speedrun History Documentary',
    category: 'Gaming',
    channelId: 'UC_SUMMONING_SALT',
    channelName: 'Summoning Salt'
  };

  // Channel pinned as educational overrides Gaming category
  const byChannel = Classifier.classifyVideo(baseVideo, {
    channelOverrides: {
      UC_SUMMONING_SALT: { classification: 'educational', channelName: 'Summoning Salt' }
    }
  });
  assert.equal(byChannel.classification, 'educational');
  assert.equal(byChannel.source, 'channel-override');

  // Video override takes highest priority even over channel override
  const byVideo = Classifier.classifyVideo(baseVideo, {
    channelOverrides: {
      UC_SUMMONING_SALT: { classification: 'educational', channelName: 'Summoning Salt' }
    },
    videoOverrides: {
      'game-doc-123': { classification: 'entertainment' }
    }
  });
  assert.equal(byVideo.classification, 'entertainment');
  assert.equal(byVideo.source, 'video-override');
});

test('Classifier: extracts metadata from ytInitialPlayerResponse and handles SPA URL changes', () => {
  const playerResponse = {
    videoDetails: {
      videoId: 'dQw4w9WgXcQ',
      title: 'Linear Algebra Full Course Lecture',
      author: 'Math Academy',
      channelId: 'UC_MATH_101',
      shortDescription: 'Complete university course on linear algebra.',
      keywords: ['linear algebra', 'course', 'mathematics']
    },
    microformat: {
      playerMicroformatRenderer: {
        category: 'Education'
      }
    }
  };

  const meta = Classifier.extractVideoMetadata({
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    playerResponse
  });

  assert.equal(meta.videoId, 'dQw4w9WgXcQ');
  assert.equal(meta.title, 'Linear Algebra Full Course Lecture');
  assert.equal(meta.category, 'Education');
  assert.equal(meta.channelId, 'UC_MATH_101');
  assert.equal(meta.channelName, 'Math Academy');

  // If SPA navigated to a new URL (?v=newVideo999), stale playerResponse for old videoId is ignored
  const staleMeta = Classifier.extractVideoMetadata({
    url: 'https://www.youtube.com/watch?v=newVideo999',
    playerResponse
  });
  assert.equal(staleMeta.videoId, 'newVideo999');
  assert.equal(staleMeta.title, '');
});

test('Content: detects active HTML5 video playback and watch URLs', () => {
  assert.equal(Content.isWatchPageUrl('https://www.youtube.com/watch?v=abc123XYZ'), true);
  assert.equal(Content.isWatchPageUrl('https://www.youtube.com/shorts/abc123XYZ'), true);
  assert.equal(Content.isWatchPageUrl('https://www.youtube.com/feed/subscriptions'), false);

  assert.equal(
    Content.isVideoActivelyPlaying({ paused: false, ended: false, readyState: 4 }),
    true
  );
  assert.equal(
    Content.isVideoActivelyPlaying({ paused: true, ended: false, readyState: 4 }),
    false
  );
  assert.equal(
    Content.isVideoActivelyPlaying({ paused: false, ended: true, readyState: 4 }),
    false
  );
  assert.equal(
    Content.isVideoActivelyPlaying({ paused: false, ended: false, readyState: 1 }),
    false
  );
});

