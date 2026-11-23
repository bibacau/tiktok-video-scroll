# TikTok Research Agent

A local Windows app that scrolls TikTok for you in its own Microsoft Edge window, uses DeepSeek to decide what is worth watching, saves the interesting videos, and builds a daily list of picks. You control everything from a web dashboard on your PC or phone (`http://localhost:8004`).

Everything is a setting: what to watch, when and for how long, what to save, the AI models and every prompt. Settings are stored locally in `data/`. You can export or import them as JSON.

> Based on [LockyBee/dsh-douyin-agent](https://github.com/LockyBee/dsh-douyin-agent) (MIT). Thanks to LockyBee. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Status

| Phase | What | State |
|---|---|---|
| 1 | Settings system, dashboard, watcher, picks, schedule, budget tracking | ✅ done |
| 2 | Video creator (script, voice, visuals, subtitles, music) — local only, no upload | next |
| 3 | Posting (approval queue, scheduling, QR accounts, **AI-generated label always on**), analytics, engagement | |
| 4 | Notifications (Telegram/email), polish | |

## What you need to do by hand (one time)

1. **Install Node.js 22 LTS** (22.13 or newer) from https://nodejs.org. Use the default options.
2. **Microsoft Edge** comes with Windows 10/11, so there's nothing to install.
3. **Download this repo** (green *Code* button → *Download ZIP*, then unzip it) or `git clone` it. Put it somewhere like `C:\tiktok-agent`.
4. Double-click **`start.bat`**. The first run installs dependencies, which takes about a minute. Your browser then opens the dashboard.
5. **DeepSeek API key:** create one at https://platform.deepseek.com, add a little credit, then paste the key in *AI & Prompts → AI provider → API key* and press **Save**. Press **Test AI connection** to check it.
6. **Log in to TikTok once:** on the *Status* tab press **Open browser (to log in)**. A separate Edge window opens with its own profile, kept in `data/edge-profiles/watcher`. Log in to TikTok there yourself, and then you can leave it open. You stay logged in between runs.
7. **Phone access (optional):** allow the port through Windows Firewall. Open *PowerShell as Administrator* and run:
   ```powershell
   netsh advfirewall firewall add rule name="TikTok Agent 8004" dir=in action=allow protocol=TCP localport=8004
   ```
   Then open the address shown under *Settings → Open on your phone* (e.g. `http://192.168.1.23:8004`). If other people use your Wi-Fi, set a **dashboard password** in Settings.

To stop everything, double-click **`stop.bat`**. If the app crashes, it restarts by itself. Logs are in `data/logs/app.log`.

## First test (10 minutes)

1. *Watch* tab: write your **Watch instructions** and pick sources. Default is the For You feed.
2. *Status* tab: press **▶ Start now** (default 10 minutes). Watch the live screenshot, what the AI is thinking, the session timer and the counters.
3. Afterwards: *Picks* → **Build picks now**. *History* shows every video, the decision and the reason.

## How it watches

For each video:

1. **Free filters first:** ads, lives, length, include/exclude keywords and already-seen videos are skipped without calling the AI.
2. **Glance:** it samples a few frames over the first seconds and makes one numbered storyboard image.
3. **AI decides** watch or skip, using your instructions, the strictness slider, your persona and learned interests.
4. **If watching:** it stays longer (more interest means longer, up to your max), samples more frames, and optionally takes a **second AI look**. That extracts topic, hook, format, sound and reason, plus a score. Videos scoring above your threshold are saved with the fields you ticked.
5. **Interests** are updated from what was actually watched.

**About images:** the app first tries sending the storyboard images. If your model refuses images (DeepSeek's chat API may be text-only), it notices once and switches to text-only decisions for that model, using caption, creator, hashtags, sound and stats. For real frame understanding, turn on *AI & Prompts → Vision helper*, which accepts any OpenAI-compatible vision endpoint. Model IDs aren't hard-coded: press **Load models** to see what your key offers, and type any model ID.

## Safety rules (built in, not settings)

- **Captcha / login / verification on screen → the agent pauses and alerts you** (dashboard banner, sound and vibration on phones). It never tries to solve or get around them. Fix it yourself in the Edge window and press **Resume**.
- **Watchdog:** if Edge crashes or stops responding, it is restarted and the session continues. There's a limit on restarts per session, which you can set in Settings → Browser.
- The browser profile is used only by this app. Your normal Edge is never touched.
- Engagement (likes/follows/favourites/comments) is **off by default**, and comments always need your approval (phase 3).
- Phases 2 and 3: videos are made only from your own text, TTS, licensed stock and AI media. Other people's videos are never downloaded or re-uploaded. Every upload gets TikTok's **AI-generated label**, and it can't be turned off.
- Setting more than 4 hours a day shows a warning about ban risk, but it's allowed.

## Budget

Every AI call is logged with tokens and cost in **RM** (exchange rate in Settings). Daily and monthly caps stop runs when reached. Prices live in an editable table (*Budget → Price table*). **Check them against https://api-docs.deepseek.com/quick_start/pricing**: the defaults are my best knowledge and may be out of date.

## If TikTok changes its website

All page selectors are in *Settings → TikTok page selectors* (JSON). If something stops being detected, you can fix it there without changing code.

## Files

```
start.bat / stop.bat     start and stop (scripts/run.bat keeps it running)
src/                     server (TypeScript, run directly with tsx)
  settings/              settings schema (one place defines defaults, validation and the dashboard forms), presets, prompts
  prompts/*.md           default prompts (your edits are stored in the database; "Reset" restores these)
  browser/               Edge launch + watchdog, tiktok.com page driving, captcha/login detection
  watch/                 watch session loop, storyboard, interest memory, picks
  schedule/              daily planner (sessions, breaks, jitter, windows)
  llm/                   OpenAI-compatible client, budget ledger
web/                     dashboard (Preact, no build step)
data/                    YOUR data — database, API keys (secrets.json), Edge profiles, media. Never commit it.
test/                    tests (fake tiktok.com + fake AI API)
```

## Developing

```
npm install
npm start          # http://localhost:8004
npm test           # unit + end-to-end (needs ffmpeg + a Chromium; set BROWSER_PATH)
npm run typecheck
```
