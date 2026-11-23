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

1. **Install Node.js 24 LTS** (any version from 22.18 up works) from https://nodejs.org. Use the official **Windows Installer (.msi)** and keep the default options. Don't use a ZIP of Node.
2. **Install Git** from https://git-scm.com/download/win (default options).
3. **Microsoft Edge** comes with Windows, so there's nothing to install. **ffmpeg** is needed for video creation; see [Video creation](#video-creation-phase-2).
4. **Get the app with `git clone`. Don't download the ZIP.** Files from a ZIP downloaded in a browser are marked "from the internet", and Smart App Control / SmartScreen may block them. Cloned files aren't marked. Open *Terminal* (or PowerShell) and run:
   ```powershell
   cd $HOME
   git clone -b claude/clever-dirac-tbpwhd https://github.com/bibacau/tpot-lazer.git tiktok-agent
   cd tiktok-agent
   ```
   To update later: `git pull` inside that folder.
5. **Start it.** Either double-click **`start.bat`**, or start it without any .bat file, which always works even if Windows blocks .bat files:
   ```powershell
   npm install --omit=dev
   npm start
   ```
   Keep that window open; press **Ctrl+C** to stop. Then open http://localhost:8004.
6. **DeepSeek API key:** create one at https://platform.deepseek.com, add a little credit, then paste the key in *AI & Prompts → AI provider → API key* and press **Save**. Press **Test AI connection** to check it.
7. **Image understanding:** DeepSeek can't see images, so set up a [vision helper](#image-understanding-vision-helper). Gemini or Ollama cost little or nothing.
8. **Log in to TikTok once:** on the *Status* tab press **Open browser (to log in)**. A separate Edge window opens with its own profile, kept in `data/edge-profiles/watcher`. Log in to TikTok there yourself. You stay logged in between runs.
9. **Phone access (optional):** allow the port through Windows Firewall. Open *PowerShell as Administrator* and run:
   ```powershell
   netsh advfirewall firewall add rule name="TikTok Agent 8004" dir=in action=allow protocol=TCP localport=8004
   ```
   Then open the address shown under *Settings → Open on your phone* (e.g. `http://192.168.1.23:8004`). If other people use your Wi-Fi, set a **dashboard password** in Settings.

To stop everything, double-click **`stop.bat`**, or press Ctrl+C in the `npm start` window. When started with `start.bat`, the app restarts itself if it crashes. Logs are in `data/logs/app.log`.

## Windows blocked the app (Smart App Control / SmartScreen)

Windows 11 **Smart App Control** blocks programs and scripts that are unsigned and come from the internet. What to do, in order:

1. **Unblock the folder.** Open PowerShell **in the app folder** and run:
   ```powershell
   Get-ChildItem -Recurse -File | Unblock-File
   ```
   `start.bat` does this itself on every start. If `start.bat` itself is the blocked file, it can't run, so use this command once by hand.
2. **Use `git clone` instead of the ZIP** (see step 4 above). Cloned files are never marked as downloaded.
3. **Start without .bat files:** in a terminal in the app folder, run `npm install --omit=dev` and then `npm start`. This only runs `node.exe` and `npm`, both installed and signed by the official Node.js installer. The app ships no other executables. Earlier versions included `esbuild.exe`, which Smart App Control blocked; it has been removed.
4. **If the blocked file is `node.exe`:** your Node.js probably came from a ZIP or a third-party tool (nvm, fnm, Volta, a portable build), and those copies may lack a trusted signature. Fix:
   1. Settings → Apps → Installed apps → uninstall every *Node.js* entry. If you used nvm-windows, uninstall it too.
   2. Delete leftovers if they exist: `C:\Program Files\nodejs` and `%AppData%\npm`.
   3. Download the **Windows Installer (.msi)** for the LTS version from https://nodejs.org/en/download (it is signed by the OpenJS Foundation) and install with default options.
   4. Open a **new** terminal and check `node -v` (needs 22.18 or newer). Then in the app folder: `Remove-Item -Recurse -Force node_modules` → `npm install --omit=dev` → `npm start`.
5. **If ffmpeg.exe is blocked** (video creation): install it with `winget install Gyan.FFmpeg`. If it's still blocked, set the path to a different build in *Settings → Video tools*.

> ⚠️ **Don't turn Smart App Control off just to run this app.** Once you switch it off, you can't turn it back on without resetting or reinstalling Windows. The steps above avoid the need.

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
npm install        # includes TypeScript for type checking
npm start          # http://localhost:8004 — runs src/index.ts directly with Node's built-in type stripping
npm test           # unit + end-to-end (needs ffmpeg + a Chromium; set BROWSER_PATH)
npm run typecheck
```
TypeScript is restricted to "erasable" syntax (no enums or parameter properties) so plain Node can run it without a compiler.
