# Third-party notices

## LockyBee/dsh-douyin-agent — main design base
https://github.com/LockyBee/dsh-douyin-agent — MIT License, Copyright (c) 2026 LockyBee and contributors.
Thanks to LockyBee for the original Douyin watching agent. This project ports its ideas to TypeScript and tiktok.com:
the watch loop (one run at a time, bounded rounds, persistent daily budget), frame sampling into a numbered storyboard,
behaviour-based persona/interest memory, the usage ledger and per-feature caps. The storyboard resize helper in
`src/watch/storyboard/index.ts` is adapted from its `video-storyboard.mjs`. The browser code is rewritten for tiktok.com.

```
MIT License

Copyright (c) 2026 LockyBee and contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## SAOS-3624/dsh-video-storyboard (via dsh-douyin-agent)
`src/watch/storyboard/vendor/plan.mjs` and `sheet.mjs` — MIT License, Copyright (c) 2026 SAOS-3624. Full text in
`src/watch/storyboard/vendor/LICENSE`.

## 0xArtex/tiktok-mcp — upload & analytics reference (phase 3)
https://github.com/0xArtex/tiktok-mcp — MIT License. Posting/scheduling flow, QR login with per-account profiles,
analytics scraping, hook analysis and the ordered-fallback element resolver will be ported from it in phase 3.
Its license and copyright notice will be reproduced here when that code lands.

## sonpiaz/watch-cli — reference only
https://github.com/sonpiaz/watch-cli — idea of scene-change key frames + transcript for cheaper video understanding.
No code copied.

## npm dependencies
fastify, @fastify/static, @fastify/websocket, playwright-core (Apache-2.0), jpeg-js (BSD-3-Clause / Apache-2.0),
preact, htm, tsx — see each package's license in `node_modules`.
