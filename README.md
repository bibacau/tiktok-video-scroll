# TikTok Research Agent

A local Windows app that scrolls TikTok for you in its own Microsoft Edge window, uses DeepSeek to decide what is worth watching, saves the interesting videos, and builds a daily list of picks. You control everything from a web dashboard on your PC or phone (`http://localhost:8004`).

Everything is a setting: what to watch, when and for how long, what to save, the AI models and every prompt. Settings are stored locally in `data/`. You can export or import them as JSON.

> Based on [LockyBee/dsh-douyin-agent](https://github.com/LockyBee/dsh-douyin-agent) (MIT). Thanks to LockyBee. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Status

| Phase | What | State |
|---|---|---|
| 1 | Settings system, dashboard, watcher, picks, schedule, budget tracking | ✅ done |
| 2 | Video creator (plan, script, voice, visuals, subtitles, music, logo) — local only, no upload | ✅ done |
| 3 | Posting (approval queue, scheduling, QR accounts, **AI-generated label always on**), analytics, engagement | ✅ done |
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
5. **Start it the first time** from that same terminal. Smart App Control can't block this: it only runs `node.exe`, which is signed. No .bat, .cmd or PowerShell script is involved.
   ```powershell
   node scripts/launch.mjs
   ```
   The first time it installs the dependencies (about a minute). Then the app starts in the background and the dashboard opens at http://localhost:8004. You can close the terminal.
6. **Make shortcuts** so you never need the terminal again:
   ```powershell
   node scripts/launch.mjs --install-shortcuts
   ```
   This puts **TikTok Agent** (start + open the dashboard) and **Stop TikTok Agent** on your desktop and in the Start menu. Both run `node.exe` directly. Add `--autostart` to also start the app (without opening the dashboard) when you sign in to Windows. If Windows won't let the command create shortcuts, it prints the exact text to paste into *right-click desktop → New → Shortcut*.
7. **DeepSeek API key:** create one at https://platform.deepseek.com, add a little credit, then paste the key in *AI & Prompts → AI provider → API key* and press **Save**. Press **Test AI connection** to check it.
8. **Image understanding:** DeepSeek can't see images, so set up a [vision helper](#image-understanding-vision-helper). Gemini or Ollama cost little or nothing.
9. **Log in to TikTok once:** on the *Status* tab press **Log in to TikTok**. A normal Edge window opens with the agent's own profile (`data/edge-profiles/watcher`). It is a completely ordinary window with no automation. Log in there yourself (QR code with the TikTok app, phone or email). The dashboard notices when you're logged in, usually within 30 seconds or as soon as you close the window. You stay logged in between runs.
10. **Phone access (optional):** allow the port through Windows Firewall. Open *PowerShell as Administrator* and run:
   ```powershell
   netsh advfirewall firewall add rule name="TikTok Agent 8004" dir=in action=allow protocol=TCP localport=8004
   ```
   Then open the address shown under *Settings → Open on your phone* (e.g. `http://192.168.1.23:8004`). If other people use your Wi-Fi, set a **dashboard password** in Settings.

**Starting and stopping:**
- Start: the **TikTok Agent** shortcut, or `node scripts/launch.mjs`. If it's already running, this just opens the dashboard.
- Stop: the **Stop TikTok Agent** shortcut, **Settings → ⏻ Stop the app** in the dashboard (also works from your phone), or `node scripts/launch.mjs --stop`.
- If the app crashes, it restarts by itself after 5 seconds. Logs are in `data/logs/app.log`.
- For developers: `npm run dev` runs it in the foreground; Ctrl+C stops it.

## Windows blocked the app (Smart App Control / SmartScreen)

Windows 11 **Smart App Control** blocks programs and scripts that are unsigned and come from the internet. What to do, in order:

1. **Unblock the folder.** Open PowerShell **in the app folder** and run:
   ```powershell
   Get-ChildItem -Recurse -File | Unblock-File
   ```
   `scripts/launch.mjs` does this itself on every start.
2. **Use `git clone` instead of the ZIP** (see step 4 above). Cloned files are never marked as downloaded.
3. **Start with node.exe only:** there are no .bat files any more. Smart App Control blocked `start.bat` ("explorer.exe loading cmd.exe didn't meet the signing level"). Use the shortcuts or `node scripts/launch.mjs`, which only run `node.exe` (signed by the OpenJS Foundation). Dependencies are installed by running npm's own JavaScript through node.exe, so `npm.cmd` is never needed. The app ships no executables of its own. Earlier versions included `esbuild.exe`, which Smart App Control also blocked; it has been removed.
4. **If the blocked file is `node.exe`:** your Node.js probably came from a ZIP or a third-party tool (nvm, fnm, Volta, a portable build), and those copies may lack a trusted signature. Fix:
   1. Settings → Apps → Installed apps → uninstall every *Node.js* entry. If you used nvm-windows, uninstall it too.
   2. Delete leftovers if they exist: `C:\Program Files\nodejs` and `%AppData%\npm`.
   3. Download the **Windows Installer (.msi)** for the LTS version from https://nodejs.org/en/download (it is signed by the OpenJS Foundation) and install with default options.
   4. Open a **new** terminal and check `node -v` (needs 22.18 or newer). Then in the app folder: `Remove-Item -Recurse -Force node_modules` → `node scripts/launch.mjs`. Re-create the shortcuts with `node scripts/launch.mjs --install-shortcuts`, because they point to node.exe.
5. **Windows built-in voices** use PowerShell's speech feature, which Smart App Control's locked-down PowerShell mode can block. If they fail, use the Microsoft Edge voices instead.
6. **If ffmpeg.exe is blocked** (video creation): install it with `winget install Gyan.FFmpeg`. If it's still blocked, set the path to a different build in *Settings → Video tools*.

> ⚠️ **Don't turn Smart App Control off just to run this app.** Once you switch it off, you can't turn it back on without resetting or reinstalling Windows. The steps above avoid the need.

## First test (10 minutes)

1. *Watch* tab: write your **Watch instructions** and pick sources. Default is the For You feed.
2. *Status* tab: press **▶ Start now** (default 10 minutes). Watch the live screenshot, what the AI is thinking, the session timer and the counters.
3. Afterwards: *Picks* → **Build picks now**. *History* shows every video, the decision and the reason.

## How settings are saved

- **Autosave:** changes save by themselves about 1.5 seconds after you stop typing ("Saved ✓" at the top right). The Save bar is still there as a fallback.
- **Only what you changed is sent:** each section (Watch, Schedule, …) and each Settings group is saved on its own and merged on the PC, so a page left open on your phone can't overwrite other sections.
- **Changed elsewhere?** If the same section was changed on another device after you opened it, your save is refused with *"These settings were changed elsewhere — reload to see the latest"* instead of silently overwriting. Other open dashboards update by themselves.
- **API keys** show **✓ Saved (sk-…abcd)** under the field once stored.
- **Data folder:** *Settings → Data folder* shows where everything is stored, and the path is written to the log at every start. If settings seem to vanish, check you aren't running a second copy of the app from another folder.
- **Updates keep your data:** the database is upgraded in place, and `data/app.sqlite`, `data/secrets.json` and `data/edge-profiles` are never reset.

## The agent's Edge window

- The agent starts **Microsoft Edge itself, as an ordinary program**, with its own profile folder (`data/edge-profiles/<name>`). It then connects to it through Edge's remote-debugging port, the same approach as dsh-douyin-agent. Playwright never launches the browser, so none of its automation switches are present.
- **Logging in** happens in a completely normal Edge window with no debugging port at all (*Log in to TikTok* on the Status page or for each posting account). Be aware that a debugging port by itself makes Edge report `navigator.webdriver = true`. That's why login gets its own fully normal window. Watching and posting need the port, and the agent does **not** try to hide that it is being driven.
- **Profile already open?** If the agent's profile is open in another window (opened by hand or left over), the agent stops with a clear message instead of a blank window. **Close it for me** closes only the processes using that profile folder. Your normal Edge is never touched.
- **No window jitter:** screenshots are taken straight from Edge's compositor without changing the window size or zoom, and only while a session is running. When idle there's a manual **📷 Take a snapshot** button.

## How it watches

For each video:

1. **Free filters first:** ads, lives, length, include/exclude keywords and already-seen videos are skipped without calling the AI.
2. **Glance:** it samples a few frames over the first seconds and makes one numbered storyboard image.
3. **AI decides** watch or skip, using your instructions, the strictness slider, your persona and learned interests.
4. **If watching:** it stays longer (more interest means longer, up to your max), samples more frames, and optionally takes a **second AI look**. That extracts topic, hook, format, sound and reason, plus a score. Videos scoring above your threshold are saved with the fields you ticked.
5. **Interests** are updated from what was actually watched.

**AI-chosen search (off by default):** *Watch → Sources → Let the AI choose what to search*. Based on your Watch instructions, learned interests and what it just saw, the AI may decide to search instead of scrolling on. The query (max 60 characters) is checked against your exclude words, the creation banned words, the block-list and the optional allow-list. It is then **typed into TikTok's search bar character by character** with small random pauses and Enter, just like a person. Only if no search box is found does it open the search link instead. There's a daily limit. The Status page shows the current query, and *History → AI searches* lists every search with its reason (including rejected ones and why). The search-box selectors are in *Settings → TikTok page selectors* (`searchInput`, `searchOpen`).

**About images:** if the [vision helper](#image-understanding-vision-helper) is on, it describes the frames first. Otherwise the app tries sending the images to the main model. If the model refuses them (DeepSeek does), it notices once and switches to text only for that model. Each decision shows which way it went: 🖼 images, 👁 vision helper, or 📝 text only (Status and History pages). Model IDs aren't hard-coded: press **Load models** to see what your key offers, and type any model ID.

## Image understanding (vision helper)

**DeepSeek's API is text-only**, so it can't see the video frames. Without help it decides from the caption, creator, hashtags, sound and stats only, and the Status page shows **📝 text only**. To let the agent see what's in the video, add a **vision helper**. It looks at the frames, writes a short description (including on-screen text), and DeepSeek decides from that. The Status page then shows **👁 vision helper**.

Setup is the same for every provider: *AI & Prompts → Vision helper (image understanding)* → choose **Provider** (this fills in the address and a suggested model) → paste the key → switch on **Describe video frames with a vision model first** → **Save** → press **👁 Test vision**. You should see a sample image and the model's description of it.

| Provider | Key from | Suggested model | Rough cost* |
|---|---|---|---|
| **Google Gemini** | https://aistudio.google.com/apikey → *Create API key* | `gemini-2.5-flash-lite` | lowest; Google has a free tier with rate limits |
| **OpenAI** | https://platform.openai.com/api-keys (add billing credit first) | `gpt-4.1-mini` (cheaper: `gpt-4.1-nano`) | low |
| **OpenRouter** | https://openrouter.ai/keys (add credit) — one key for many models | `google/gemini-2.5-flash-lite` | same as the underlying model |
| **Ollama** (on your PC) | no key | `gemma3:4b` (better at reading text: `qwen2.5vl:7b`) | free, uses your PC |

\*Default prices are in *Budget → Price table*, so their cost is counted. I couldn't check them against the providers' websites from where I built this, and providers change prices and model names. Check them, and if you choose a newer model, type its name and add a row to the price table.

### Ollama step by step (free, runs on your PC)

1. Download and install Ollama for Windows from https://ollama.com/download. It runs in the background after install (llama icon in the tray).
2. Open a terminal and download a vision model (about 3–6 GB, one time):
   ```powershell
   ollama pull gemma3:4b
   ```
   For better reading of on-screen text, if your PC has 8 GB+ of graphics memory or 16 GB+ RAM: `ollama pull qwen2.5vl:7b`
3. Check it works: `ollama run gemma3:4b "hello"`. It should answer. Type `/bye` to exit.
4. In the dashboard choose **Provider: Ollama on this PC**. The address `http://localhost:11434/v1` and model are filled in. Leave the key empty, switch the helper on, **Save**, then **Test vision**.
5. On a PC without a strong graphics card each description can take 10–60 seconds, which makes watching slower. Raise *Glance before deciding* if needed, or use Gemini.

### Gemini step by step
1. Go to https://aistudio.google.com/apikey and sign in with a Google account → **Create API key** → copy it.
2. In the dashboard choose **Provider: Google Gemini**, paste the key, switch the helper on, **Save**, **Test vision**.

### OpenAI / OpenRouter
Same as Gemini. Create the key on their site (links in the table), add a little credit, choose the provider, paste, **Save**, **Test vision**.

The prompt the vision model gets is editable under *AI & Prompts → Prompts → Vision helper: describe frames*.

## Video creation (phase 2)

*Create* tab → **Studio**: type a topic (or leave it empty so the AI picks from today's research) → **🎬 Create**. Each video goes through **plan → script → voice → visuals → render**, and you can watch the progress live. Nothing is posted. Finished videos wait in the Studio for you to preview, download, and copy the caption and hashtags.

On each video you can:
- **↻ Script**: write a new script (also redoes voice and visuals)
- **↻ Voice**: record the voice again, e.g. after changing voice, speed or pitch. Visuals are kept.
- **↻ Visuals**: get new stock footage or AI images. The voice is kept.
- **↻ Re-render**: apply changed subtitle, logo, music, colour or font settings without any AI cost
- **✎ Edit script**: change any line, headline, scene order, caption or hashtags yourself, then *Save & re-render*. Only changed lines get a new voice.

Everything is set per preset under *Create → Creation settings*: video instructions, videos per day (and auto-create after today's picks), length, aspect ratio (default 9:16), language, tone, audience, hook style, structure, call to action, banned words and topics, voice, visuals, colours, font, logo, subtitles, music, and caption and hashtag rules. The prompts are on *AI & Prompts → Prompts* (*Create: plan…*, *Create: write the script*, *Create: AI image prompt*). Every cost (AI, images, AI video) goes into the budget and is shown on each video.

### What you need to install or set up for video creation

1. **ffmpeg** (required). Open a terminal and run:
   ```powershell
   winget install Gyan.FFmpeg
   ```
   Close and reopen the terminal (and restart the app), then check `ffmpeg -version`. If you put ffmpeg somewhere else, set the full path in *Settings → Video tools*.
2. **Voice:**
   - *Microsoft Edge voices* are free and need no key. They include Malay (Yasmin, Osman), English, Chinese, Tamil and Indonesian. They use the same free online service as Edge's "Read aloud". It isn't an official API, so if it ever stops working, update *Settings → Video tools → Edge voices client version* to your current Edge version, or switch to *Windows built-in voices*, which work offline but sound more robotic and have no Malay.
   - *No voice — text only* makes silent videos with on-screen text. Add music if you like.
3. **Visuals** (pick one in *Creation settings → Visuals*):
   - *Animated text slides*: free and offline. Uses your colours and font.
   - *Stock footage*: get a free key from https://www.pexels.com/api/ or https://pixabay.com/api/docs/ and paste it in *Settings → Media providers*. Credits are listed on each video.
   - *AI images*: an OpenAI key (https://platform.openai.com/api-keys) with model `gpt-image-1-mini`, or any OpenAI-compatible images API, or Replicate (e.g. `black-forest-labs/flux-schnell`). Set the price per image so the budget is right.
   - *AI video*: a Replicate token and a text-to-video model name. Look up the model's input fields on its Replicate page and adjust *AI video input template*. If it fails, the scene uses an AI image or a slide instead. Video models are slow and cost more per clip.
4. **Your music:** upload tracks in *Creation settings → Background music → Upload*. They go into `data/music`. Only use music you have the rights to. TikTok may mute copyrighted music.
5. **Logo / font (optional):** upload a PNG logo and a .ttf/.otf font in *Creation settings → Visuals*. With no font chosen, Arial Bold is used.

**Tested here with fakes:** the whole pipeline is tested with real ffmpeg rendering, but against fake AI, voice, Pexels and image servers. The real Edge voice service, Pexels/Pixabay, OpenAI images and Replicate couldn't be reached from where this was built, so check each once with a short video.

## Share saved videos to your main account

*Save → Share saved videos to my main account* is **on by default**, sending to **@bibacau**. Every video the agent saves is sent right away with TikTok's own **Share → Send to → @bibacau → Send**, in the watcher's Edge window. If @bibacau isn't in the short recent list, the name is typed into the share panel's search box.
- **Modes:** every saved video (default), only Today's picks (once a day, sent between sessions), or only saved videos scoring at least X. There's also a daily cap.
- **Require my approval:** off by default. When on, shares wait in *Post → Queue → Shares waiting for your approval*.
- **Never twice:** a video is only ever sent once to the same account. Every share (video, time, result) is in *History → Shares*.
- **What you must do once:** TikTok only lets you send to people you can message. **On the watcher account follow @bibacau, and on @bibacau follow the watcher account back.** If TikTok can't find @bibacau or won't allow messaging, the Status page explains this, sharing pauses for the day (TikTok isn't asked again and again), and after you've followed each other you press **Retry sharing**.
- **Telegram fallback:** *Also send the link to Telegram* = only when sharing fails, or always. Set the bot token and chat ID in *Settings → Notifications*.
- **Every save is accounted for:** History → Shares shows each saved video's outcome: sent, queued, waiting for approval, failed, or *skipped* with the reason (sharing off, picks mode, score too low, daily cap, duplicate). Failed and skipped shares have a **Retry** button.
- **Feed without links:** TikTok's For You feed often doesn't show a video's link. The agent reads the video id from the player, or uses the share panel's **Copy link**. If the video moved on before it could be shared, it is queued and sent from the video's own page after the session.
- **Test share now** (under the Save settings): opens your latest saved video in the watcher's Edge window and runs the whole flow while you watch. It then lists each step (share button found, panel opened, Send to, recipient found or typed, Send clicked, confirmed). If a step fails it shows a screenshot and the text in the share panel; send me those if TikTok's panel needs different selectors.
- Captcha or login screens pause and alert you as usual; the agent never solves them.
- The share panel's texts and selectors (`shareButton`, `shareDialog`, `shareSearch`, `shareSendTexts`, …) are in *Settings → TikTok page selectors*. I built this against a fake share panel because the real one couldn't be reached from here. If TikTok's panel differs, the failed shares in *History → Shares* say which step failed.

## Posting (phase 3)

### 1. Add your TikTok account(s)
*Post → Accounts* → type a name → **Add** → **Log in (QR code)**. A **normal Edge window** (no automation) opens on your PC with TikTok's QR login page. On your phone, open the TikTok app, tap its QR-scan icon and scan the code. The dashboard shows ✅ when it notices the login (within about 30 seconds, or when you close the window). Each account has its own Edge profile (`data/edge-profiles/acct-…`), so logins never mix. Add as many accounts as you like.

### 2. Choose how videos get posted (per preset, *Post → Posting settings*)
- **Account:** which TikTok account this preset posts to.
- **Posting mode:**
  - **Save for my approval** (default): finished videos wait in *Post → Queue*. For each one you choose **Approve → next slot**, **Post now**, a specific time, or **Reject**.
  - **Schedule automatically after I approve:** the same, but approving always takes the next free posting time.
  - **Auto-post:** finished videos are approved and scheduled without you. The dashboard shows a clear warning while this is on.
- **Posting times** (e.g. 12:30 and 20:30) and **max posts per day**. Videos get the next free time.
- **How scheduled posts are published:**
  - *TikTok's own scheduler* (default): the video is uploaded right away and TikTok publishes it at the time, so your PC can be off. TikTok needs the time to be 15 minutes to 10 days ahead.
  - *This app*: it uploads at the time, so the PC and app must be on.
- **Who can see it**, and whether comments, Duet and Stitch are allowed.
- **🔒 AI-generated label: always on.** Every upload turns on TikTok's "AI-generated content" switch and checks it is on, again right before pressing Post. If it can't be confirmed, **the video is not posted** and shows as failed with the reason.

### 3. Performance → tomorrow's plan
Every few hours (setting) the app reads each account's post list in TikTok Studio (views, likes, comments) and keeps a history (*Post → Analytics*). With *Use performance when planning* on, tomorrow's video planning gets a short summary of your best and weakest recent videos and their hooks. You can see exactly what it gets under *What tomorrow's planning sees*.

### Engagement (optional, all off by default: *Engage* tab)
While watching, the agent can **like**, **save to favourites** and **follow**, each with a daily cap, a per-session cap and a minimum AI score. It only does this on videos the AI actually watched and rated highly, never presses a button that's already pressed (so nothing is un-liked), and follows a creator at most once. **Comments** are only *drafted* by the AI. Each one waits in *Post → Queue → Comments* where you can edit, approve or reject it. Approved comments are posted between watching sessions.

### Safety and honesty notes for posting
- If TikTok shows a login or verification screen, posting stops with *"not logged in / verification"*. The app never logs in or solves checks itself; use the account's **Log in** button.
- If TikTok doesn't confirm a post, the video is marked *"Not confirmed — check TikTok Studio before retrying"* instead of being posted again automatically (to avoid duplicates).
- If TikTok's scheduler or the audience setting can't be set and checked, the upload is cancelled, so a scheduled or private post is never published immediately or publicly by mistake.
- Only videos made by this app (from `data/renders`) can be uploaded.
- **Tested with fakes:** the upload flow, AI label, audience, slots, modes, analytics and engagement are all tested against a fake TikTok Studio and a fake feed that mirror the real pages as far as I know them. The real TikTok Studio couldn't be reached from where this was built. Try your first post with *Only me*, and check the label and caption in TikTok before going public. If TikTok's pages differ, fix *Settings → Posting page selectors* without changing code.

## Safety rules (built in, not settings)

- **Captcha / login / verification on screen → the agent pauses and alerts you** (dashboard banner, sound and vibration on phones). It never tries to solve or get around them. Fix it yourself in the Edge window and press **Resume**.
- **Watchdog:** if Edge crashes or stops responding, it is restarted and the session continues. There's a limit on restarts per session, which you can set in Settings → Browser.
- The browser profile is used only by this app. Your normal Edge is never touched.
- Engagement (likes/follows/favourites/comments) is **off by default**, and every comment needs your approval.
- **Original videos only:** videos are made only from your text, stock voices, licensed stock footage (Pexels/Pixabay), AI images or video, and your own music and logo. Video downloads are only allowed from Pexels, Pixabay and Replicate, and TikTok's servers are always refused, so other people's videos can't be downloaded or re-uploaded.
- **No cloned faces or voices:** only stock TTS voices (no voice cloning). Every AI image or video prompt gets a fixed rule: no real, famous or identifiable people, no logos, no text.
- Banned words are checked in code: a script that contains one is rewritten once, then the words are removed.
- Every upload gets TikTok's **AI-generated label**. It can't be turned off, and if it can't be confirmed the post is cancelled.
- Setting more than 4 hours a day shows a warning about ban risk, but it's allowed.

## Budget

Every AI call is logged with tokens and cost in **RM** (exchange rate in Settings). Daily and monthly caps stop runs when reached. Prices live in an editable table (*Budget → Price table*). **Check them against https://api-docs.deepseek.com/quick_start/pricing**: the defaults are my best knowledge and may be out of date.

## If TikTok changes its website

All page selectors are in *Settings → TikTok page selectors* and *Settings → Posting page selectors* (JSON). If something stops being detected, you can fix it there without changing code.

## Files

```
scripts/launch.mjs       start / stop / create shortcuts (node.exe only); scripts/supervise.mjs keeps it running
src/                     server (TypeScript, run directly by Node)
  settings/              settings schema (one place defines defaults, validation and the dashboard forms), presets, prompts
  prompts/*.md           default prompts (your edits are stored in the database; "Reset" restores these)
  browser/               Edge launch + watchdog, tiktok.com page driving, captcha/login detection
  watch/                 watch session loop, storyboard, interest memory, picks
  create/                video creator: plan/script, voices (Edge/Windows), visuals (slides/stock/AI), ffmpeg render, job pipeline
  post/                  accounts, TikTok Studio uploader (AI label), approval queue / slots / modes, analytics
  schedule/              daily planner (sessions, breaks, jitter, windows)
  llm/                   OpenAI-compatible client, budget ledger
web/                     dashboard (Preact, no build step)
data/                    YOUR data — database, API keys (secrets.json), Edge profiles, media. Never commit it.
test/                    tests (fake tiktok.com, fake TikTok Studio, fake AI / voice / stock / image APIs)
```

## Developing

```
npm install        # includes TypeScript for type checking
npm run dev        # http://localhost:8004 in the foreground — runs src/index.ts with Node's built-in type stripping
npm test           # unit + end-to-end (needs ffmpeg + a Chromium; set BROWSER_PATH)
npm run typecheck
```
TypeScript is restricted to "erasable" syntax (no enums or parameter properties) so plain Node can run it without a compiler.
