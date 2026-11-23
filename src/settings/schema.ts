import { s, DAYS, type Field } from './dsl.ts';

const allDays = (start: string, end: string) => Object.fromEntries(DAYS.map(d => [d, [{ start, end }]]));

// =============================== PRESET =======================================
// Everything that differs between "Food research", "Tech research", ... lives here.

export const watchSchema = s.group('Watching', {
  instructions: s.textarea('Watch instructions',
    'Watch Malaysian street food in Malay or English. Skip ads, live streams and dance videos. Focus on recipes under 60s.',
    { rows: 5, help: 'Plain language. Sent to the AI with every watch/skip decision.' }),
  sources: s.group('Sources', {
    mix: s.weights('Source mix (%)', { foryou: 100, search: 0, hashtag: 0, creator: 0 },
      [{ value: 'foryou', label: 'For You feed' }, { value: 'search', label: 'Search keywords' }, { value: 'hashtag', label: 'Hashtags' }, { value: 'creator', label: 'Creators' }],
      { help: 'Relative weights. A source with 0 is never used. Sources with an empty list are skipped.' }),
    keywords: s.list('Search keywords', [], { placeholder: 'nasi lemak recipe' }),
    hashtags: s.list('Hashtags (without #)', [], { placeholder: 'malaysianfood' }),
    creators: s.list('Creators (without @)', [], { placeholder: 'username' }),
    videosPerSource: s.number('Videos before switching source', 8, 1, 200),
  }),
  filters: s.group('Filters', {
    includeKeywords: s.list('Include keywords (caption must contain one; empty = any)'),
    excludeKeywords: s.list('Exclude keywords (skip if caption contains any)'),
    languages: s.list('Preferred languages', ['Malay', 'English'], { help: 'Passed to the AI. Leave empty for any language.' }),
    minLength: s.number('Min video length', 0, 0, 3600, { unit: 's' }),
    maxLength: s.number('Max video length', 600, 1, 36000, { unit: 's' }),
    skipAds: s.bool('Skip ads / sponsored', true),
    skipLive: s.bool('Skip live streams', true),
  }),
  behaviour: s.group('Watch behaviour', {
    strictness: s.slider('"Interesting" strictness', 6, 1, 10, { help: '1 = watch almost everything, 10 = only exceptional videos.' }),
    glanceSeconds: s.number('Glance before deciding', 4, 1, 30, { unit: 's' }),
    glanceFrames: s.number('Frames sampled during glance', 3, 1, 12),
    framesPerVideo: s.number('Total frames sampled per watched video', 6, 1, 16),
    maxSecondsPerVideo: s.number('Max seconds per video', 45, 3, 600, { unit: 's' }),
    analyzeWatched: s.bool('Second AI look after watching (extracts hook/format/etc.)', true),
    rewatch: s.bool('Allow rewatching videos already seen', false),
    delayMin: s.number('Random pause between actions — min', 1.5, 0, 60, { unit: 's', step: 0.5 }),
    delayMax: s.number('Random pause between actions — max', 4, 0, 120, { unit: 's', step: 0.5 }),
  }),
});

export const scheduleSchema = s.group('Schedule', {
  enabled: s.bool('Run automatically on schedule', false, { help: 'Off = only runs when you press Start.' }),
  dailyMinutes: s.number('Total watch time per day', 60, 1, 1440, { unit: 'min', warn: { above: 240, message: 'More than 4 hours a day raises the risk of TikTok restricting the account.' } }),
  sessions: s.number('Split into sessions', 3, 1, 48),
  breakMinutes: s.number('Break between sessions', 45, 0, 720, { unit: 'min' }),
  jitter: s.bool('Random time jitter', true),
  jitterMinutes: s.number('Jitter amount (±)', 10, 0, 180, { unit: 'min' }),
  windows: s.windows('Allowed time windows', allDays('09:00', '23:00'), { help: 'Sessions only start/run inside these windows (dashboard timezone).' }),
  manualMinutes: s.number('"Start now" session length', 10, 1, 600, { unit: 'min' }),
});

export const SAVE_FIELDS = [
  { value: 'link', label: 'Link' }, { value: 'author', label: 'Creator' }, { value: 'caption', label: 'Caption' },
  { value: 'hashtags', label: 'Hashtags' }, { value: 'topic', label: 'Topic' }, { value: 'hook', label: 'Hook' },
  { value: 'format', label: 'Format' }, { value: 'reason', label: 'Why it is interesting' },
  { value: 'audio', label: 'Audio / sound used' }, { value: 'stats', label: 'Stats (likes, comments…)' },
  { value: 'summary', label: 'Short summary' },
];

export const saveSchema = s.group('Saving & picks', {
  fields: s.checkboxes('What to save per video', SAVE_FIELDS.map(f => f.value), SAVE_FIELDS),
  saveThreshold: s.slider('Save videos scoring at least', 70, 0, 100, { help: 'AI score 0–100 from the second look.' }),
  picksCount: s.number('Number of "Today\'s picks"', 5, 1, 50),
  pickCriteria: s.textarea('Pick criteria', 'Pick videos with a strong hook and an idea I could remake as an original video for a Malaysian audience. Prefer trends that are rising today.', { rows: 4 }),
  autoPicks: s.bool('Build picks automatically after the last session of the day', true),
  notify: s.group('Notify when picks are ready', {
    telegram: s.bool('Telegram', false), email: s.bool('Email', false),
  }, { phase: 4, help: 'Set up the Telegram bot / email account in Settings.' }),
});

const capGroup = (label: string, daily: number, session: number) => s.group(label, {
  enabled: s.bool('Enabled', false), dailyCap: s.number('Daily cap', daily, 0, 1000), sessionCap: s.number('Per-session cap', session, 0, 1000),
});
export const engagementSchema = s.group('Engagement', {
  like: capGroup('Like', 30, 10),
  follow: capGroup('Follow', 5, 2),
  favourite: capGroup('Save to favourites', 10, 5),
  comment: s.group('Comments', {
    enabled: s.bool('Enabled', false),
    requireApproval: s.locked('Require my approval for each comment', 'Every comment waits in the approval queue.'),
    dailyCap: s.number('Daily cap', 5, 0, 100),
    style: s.textarea('Comment style', 'Short, friendly, relevant to the video. No links, no self-promotion.'),
  }),
}, { phase: 3, help: 'All off by default. Engagement only happens on videos the AI chose to watch.' });

export const presetSchema = s.group('Preset', {
  watch: watchSchema,
  schedule: scheduleSchema,
  save: saveSchema,
  engagement: engagementSchema,
});

// ================================ APP =========================================
export const DEFAULT_SELECTORS = {
  activeVideo: ['video'],
  container: ['[data-e2e="recommend-list-item-container"]', 'article', '[data-e2e="feed-video"]', '[class*="DivItemContainer"]', '[class*="BrowserMode"]'],
  desc: ['[data-e2e="browse-video-desc"]', '[data-e2e="video-desc"]', '[data-e2e="search-card-video-caption"]'],
  author: ['[data-e2e="browse-username"]', '[data-e2e="video-author-uniqueid"]', '[data-e2e="video-author-avatar"]', 'a[href^="/@"]'],
  music: ['[data-e2e="browse-music"]', '[data-e2e="video-music"]', 'a[href*="/music/"]'],
  likeCount: ['[data-e2e="browse-like-count"]', '[data-e2e="like-count"]'],
  commentCount: ['[data-e2e="browse-comment-count"]', '[data-e2e="comment-count"]'],
  shareCount: ['[data-e2e="share-count"]'],
  saveCount: ['[data-e2e="undefined-count"]', '[data-e2e="favorite-count"]', '[data-e2e="collect-count"]'],
  videoLink: ['a[href*="/video/"]'],
  gridItem: ['[data-e2e="search_video-item"]', '[data-e2e="search_top-item"]', '[data-e2e="challenge-item"]', '[data-e2e="user-post-item"]', 'div[id^="grid-item-container"]', 'div[id^="column-item-video-container"]'],
  nextButton: ['[data-e2e="arrow-right"]', 'button[aria-label*="next" i]', 'button[aria-label*="Go to next video" i]'],
  adMarkers: ['[data-e2e="ad-tag"]', '[data-e2e="video-ad-tag"]'],
  adTexts: ['Sponsored', 'Ad', 'Promoted', 'Ditaja', 'Iklan'],
  liveMarkers: ['[data-e2e="live-tag"]', '[data-e2e="video-live-tag"]', 'a[href*="/live"]'],
  liveTexts: ['LIVE'],
  captcha: ['#captcha-verify-container', '#captcha_container', '.captcha_verify_container', '[class*="captcha-verify" i]', 'iframe[src*="captcha"]', '[id*="secsdk-captcha" i]'],
  captchaTexts: ['Verify to continue', 'Drag the slider', 'Select 2 objects', 'Sahkan untuk teruskan'],
  loginModal: ['[data-e2e="login-modal"]', '#loginContainer', '[data-e2e="login-title"]'],
  loginTexts: ['Log in to TikTok', 'Log in to follow', 'Log masuk ke TikTok'],
};

export const VISION_PROVIDERS = [
  { value: 'gemini', label: 'Google Gemini (cheap, has a free tier)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash-lite' },
  { value: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  { value: 'openrouter', label: 'OpenRouter (many models, one key)', baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemini-2.5-flash-lite' },
  { value: 'ollama', label: 'Ollama on this PC (free, no key)', baseUrl: 'http://localhost:11434/v1', model: 'gemma3:4b' },
  { value: 'custom', label: 'Custom (any OpenAI-compatible endpoint)', baseUrl: '', model: '' },
];

// Prices are editable because they change. Values are USD per 1M tokens.
// Verify against https://api-docs.deepseek.com/quick_start/pricing — update here if they differ.
export const DEFAULT_PRICING = [
  { provider: 'deepseek', model: 'deepseek-chat', inputCacheHit: 0.028, inputCacheMiss: 0.28, output: 0.42 },
  { provider: 'deepseek', model: 'deepseek-reasoner', inputCacheHit: 0.028, inputCacheMiss: 0.28, output: 0.42 },
  // Vision helper presets (USD per 1M tokens; images are billed as input tokens by these providers).
  { provider: 'vision', model: 'gpt-4.1-mini', inputCacheHit: 0.1, inputCacheMiss: 0.4, output: 1.6 },
  { provider: 'vision', model: 'gpt-4.1-nano', inputCacheHit: 0.025, inputCacheMiss: 0.1, output: 0.4 },
  { provider: 'vision', model: 'gpt-4o-mini', inputCacheHit: 0.075, inputCacheMiss: 0.15, output: 0.6 },
  { provider: 'vision', model: 'gemini-2.5-flash-lite', inputCacheHit: 0.025, inputCacheMiss: 0.1, output: 0.4 },
  { provider: 'vision', model: 'gemini-2.5-flash', inputCacheHit: 0.075, inputCacheMiss: 0.3, output: 2.5 },
  { provider: 'vision', model: 'google/gemini-2.5-flash-lite', inputCacheHit: 0.025, inputCacheMiss: 0.1, output: 0.4 },
  { provider: 'vision', model: 'openai/gpt-4.1-mini', inputCacheHit: 0.1, inputCacheMiss: 0.4, output: 1.6 },
  { provider: 'vision', model: 'gemma3:4b', inputCacheHit: 0, inputCacheMiss: 0, output: 0 },
  { provider: 'vision', model: 'qwen2.5vl:7b', inputCacheHit: 0, inputCacheMiss: 0, output: 0 },
  { provider: 'vision', model: '*', inputCacheHit: 0, inputCacheMiss: 0, output: 0 },
];

const step = (label: string, model: string, temperature: number, extra: Record<string, Field> = {}) => s.group(label, {
  model: s.select('Model', model, ['deepseek-chat', 'deepseek-reasoner'], { allowCustom: true, help: 'Pick from the list or type any model ID (use “Load models” to see what your key can use).' }),
  temperature: s.slider('Temperature', temperature, 0, 2, { step: 0.1 }),
  reasoning: s.bool('Reasoning (thinking) mode', false, { help: 'Uses the reasoning model below instead. Slower and pricier.' }),
  maxTokens: s.number('Max output tokens', 1200, 100, 32000),
  ...extra,
});

export const appSchema = s.group('App', {
  general: s.group('General', {
    timezone: s.text('Timezone (IANA)', 'Asia/Kuala_Lumpur'),
    currencyRate: s.number('Exchange rate (RM per 1 USD)', 4.2, 0.01, 100, { step: 0.01 }),
    dashboardPassword: s.secret('Dashboard password (optional)', { help: 'If set, phones/PCs must enter it to open the dashboard.' }),
  }),
  browser: s.group('Browser', {
    channel: s.select('Browser', 'msedge', [{ value: 'msedge', label: 'Microsoft Edge' }, { value: 'chrome', label: 'Google Chrome' }, { value: 'custom', label: 'Custom executable' }]),
    executablePath: s.text('Custom executable path', '', { showIf: { field: 'channel', equals: 'custom' } }),
    headless: s.bool('Headless (hidden window)', false, { help: 'Headed is recommended; TikTok is stricter with headless browsers.' }),
    muteAudio: s.bool('Mute audio', true),
    profileName: s.text('Watcher profile name', 'watcher', { help: 'Folder under data/edge-profiles. Log in to TikTok once in this profile.' }),
    baseUrl: s.text('TikTok base URL', 'https://www.tiktok.com'),
    windowWidth: s.number('Window width', 1280, 800, 3840),
    windowHeight: s.number('Window height', 860, 600, 2160),
    screenshotSeconds: s.number('Live screenshot every', 3, 1, 60, { unit: 's' }),
    frameQuality: s.number('Frame JPEG quality', 60, 20, 95),
    hangTimeoutSeconds: s.number('Watchdog: treat browser as hung after', 45, 10, 600, { unit: 's' }),
    maxRestarts: s.number('Watchdog: max restarts per session', 5, 0, 50),
  }),
  llm: s.group('AI provider', {
    baseUrl: s.text('API base URL', 'https://api.deepseek.com', { help: 'Any OpenAI-compatible endpoint.' }),
    apiKey: s.secret('API key'),
    reasoningModel: s.text('Reasoning model', 'deepseek-reasoner'),
    imageMode: s.select('Send video frames as images', 'auto', [
      { value: 'auto', label: 'Auto (try, fall back to text if the model refuses images)' },
      { value: 'on', label: 'Always' }, { value: 'off', label: 'Never (text only: caption, creator, sound, stats)' }]),
    timeoutSeconds: s.number('Request timeout', 90, 10, 600, { unit: 's' }),
    retries: s.number('Retries on network error', 2, 0, 5),
  }),
  vision: s.group('Vision helper (image understanding)', {
    enabled: s.bool('Describe video frames with a vision model first', false, { help: 'DeepSeek cannot see images. Turn this on so a vision model describes the frames, then DeepSeek decides from that text.' }),
    provider: s.select('Provider', 'gemini', VISION_PROVIDERS.map(p => ({ value: p.value, label: p.label })), {
      fills: Object.fromEntries(VISION_PROVIDERS.filter(p => p.baseUrl).map(p => [p.value, { baseUrl: p.baseUrl, model: p.model }])),
      help: 'Choosing a provider fills in the address and a suggested model. Change the model if you like.' }),
    baseUrl: s.text('API base URL', 'https://generativelanguage.googleapis.com/v1beta/openai'),
    apiKey: s.secret('API key', { help: 'Not needed for Ollama.' }),
    model: s.text('Model', 'gemini-2.5-flash-lite'),
    maxTokens: s.number('Max description length (tokens)', 600, 100, 4000),
    detail: s.select('Image detail', 'auto', ['auto', 'low', 'high'], { help: 'low = cheaper and faster (OpenAI/OpenRouter).' }),
  }),
  steps: s.group('Models per step', {
    watch: step('Watch decision', 'deepseek-chat', 0.3),
    analyze: step('Second look / save', 'deepseek-chat', 0.3),
    picks: step("Today's picks", 'deepseek-chat', 0.5),
    plan: step('Video planning', 'deepseek-chat', 0.7, {}),
    script: step('Script writing', 'deepseek-chat', 0.8, {}),
  }),
  budget: s.group('Budget', {
    dailyCapRM: s.number('Daily spending cap (0 = none)', 5, 0, 100000, { unit: 'RM', step: 0.5 }),
    monthlyCapRM: s.number('Monthly spending cap (0 = none)', 60, 0, 1000000, { unit: 'RM', step: 1 }),
    pricing: s.json('Price table (USD per 1M tokens)', DEFAULT_PRICING, { help: 'Edit if prices change. Unknown models are counted at the deepseek-chat price.' }),
  }),
  notifications: s.group('Notifications', {
    telegramBotToken: s.secret('Telegram bot token'),
    telegramChatId: s.text('Telegram chat ID', ''),
    smtpHost: s.text('SMTP host', ''), smtpPort: s.number('SMTP port', 587, 1, 65535),
    smtpUser: s.text('SMTP user', ''), smtpPassword: s.secret('SMTP password'), emailTo: s.text('Send to', ''),
  }, { phase: 4, collapsed: true }),
  selectors: s.json('TikTok page selectors', DEFAULT_SELECTORS, { rows: 20, help: 'Advanced. If TikTok changes its website, fix selectors here without touching code.' }),
});

