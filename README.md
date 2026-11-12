# YouTube Diet

A zero-API Manifest V3 browser extension for `https://www.youtube.com/*` that controls the composition of your YouTube watch time between **Educational** and **Entertainment** videos (default **50/50 split**).

---

## How the Watch-Time Budget Works

YouTube Diet tracks active playback time (in seconds) only while a YouTube video is actively playing (not paused, buffering, or ended) across two primary buckets:

- **Educational** (`educational_seconds`)
- **Entertainment** (`entertainment_seconds`)

### Entertainment Allowance Formula

To avoid locking entertainment videos at `0:00` first thing in the morning, each day starts with a configurable **Daily Grace Buffer** (default **15 minutes / 900 seconds**). Your available entertainment bank is dynamically computed as:

```text
entertainment_allowance =
  grace_buffer_seconds
  + educational_seconds * ((100 - target_edu_pct) / target_edu_pct)
  - entertainment_seconds
```

- **Default 50% Educational / 50% Entertainment (1:1 ratio):**
  - Every `1 minute` of educational video watched earns `1 minute` of entertainment allowance on top of your daily `15 minute` grace buffer.
- **Custom Splits (20/80 to 80/20):**
  - At **80% Edu / 20% Ent** (4:1 ratio), `4 minutes` of educational video unlocks `1 minute` of entertainment.
  - At **20% Edu / 80% Ent** (1:4 ratio), `1 minute` of educational video unlocks `4 minutes` of entertainment.
- **Automatic Midnight Reset:**
  - Counters automatically reset at local midnight (`YYYY-MM-DD`) while archiving each previous day's watch-time summary into `chrome.storage.local` (`history`).

---

## Features

1. **Zero-API Video Classifier (`src/classifier.js`):**
   - Extracts metadata directly from YouTube watch pages (`ytInitialPlayerResponse`, microformat genre metadata, title, channel ID/name, and description) and tracks YouTube SPA navigations (`yt-navigate-finish`).
   - Combines YouTube category mappings (`Education`, `Science & Technology`, `Howto & Style`, `News & Politics` vs. `Entertainment`, `Gaming`, `Comedy`, `Music`, `Film & Animation`, `Sports`, `People & Blogs`) with title/description keyword heuristics (`lecture`, `tutorial`, `course`, `explained`, `documentary` vs. `gameplay`, `vlog`, `prank`, `highlights`, `react`).
   - Supports one-click **Video Overrides** and persistent **Channel Overrides** stored in `chrome.storage.local`.

2. **Floating HUD Pill & In-Player Enforcement (`src/content.js`, `src/content.css`):**
   - Displays a floating HUD pill on YouTube watch pages showing:
     - Current video badge (`Educational` / `Entertainment`)
     - Today's actual watch-time split (`Edu X% / Ent Y%`)
     - Remaining Entertainment bank (`Ent Bank: MM:SS`)
     - Quick buttons to reclassify the current video or pin the entire channel
   - When an **Entertainment** video is playing and your Entertainment bank reaches `0:00` (with strict enforcement enabled), the extension pauses the video and displays an in-player overlay showing how much educational watch time will unlock more entertainment time, along with quick override and emergency `+5m` snooze buttons.

3. **Extension Popup & Settings (`popup.html`, `popup.js`, `popup.css`):**
   - View today's Educational and Entertainment watch time, actual vs. target split progress bar, and remaining Entertainment bank.
   - Configure the target split slider (`20/80` to `80/20`, default `50/50`), daily grace buffer minutes, strict enforcement toggle, and manage pinned channel overrides.

---

## Loading the Unpacked Extension (Chrome / Brave / Edge)

1. Open your Chromium browser and navigate to:
   - **Chrome:** `chrome://extensions`
   - **Brave:** `brave://extensions`
   - **Edge:** `edge://extensions`
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select this repository folder (`youtube-diet`).
5. Open any video on `https://www.youtube.com/watch?v=...` to see the floating HUD pill in the bottom-right corner, or click the **YouTube Diet** extension icon in your browser toolbar to open the settings popup.

---

## Running Automated Unit Tests

Unit tests use Node's built-in `node --test` runner with zero external dependencies:

```bash
npm test
# or directly:
node --test test/*.test.js
```
