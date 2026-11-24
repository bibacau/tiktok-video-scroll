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
    aiSearch: s.group('Let the AI choose what to search', {
      enabled: s.bool('Let the AI choose what to search', false, { help: 'Based on your Watch instructions, learned interests and what it just saw, the AI may type a search into TikTok\'s search bar.' }),
      dailyLimit: s.number('Max AI searches per day', 10, 0, 200),
      allowTopics: s.list('Only search about these topics (optional)', [], { placeholder: 'kuih', help: 'If set, every AI search must contain one of these words.' }),
      blockList: s.list('Never search for', [], { placeholder: 'politics' }),
    }),
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
  share: s.group('Share saved videos to my main account', {
    enabled: s.bool('Share saved videos to my main account', true, { help: "Uses TikTok's own Share → Send to, in the watcher's Edge window. The watcher account and your main account must follow each other to message." }),
    to: s.text('Send to (TikTok username)', 'bibacau', { help: 'Without @.' }),
    mode: s.select('What to share', 'every', [
      { value: 'every', label: 'Every video the agent saves, right when it saves it' },
      { value: 'picks', label: "Only Today's picks, once a day" },
      { value: 'score', label: 'Only saved videos with a score of at least…' }]),
    minScore: s.slider('Minimum score (for "score" mode)', 85, 0, 100),
    dailyCap: s.number('Max shares per day', 30, 0, 500),
    requireApproval: s.bool('Require my approval for each share', false, { help: 'On: shares wait in Post → Queue until you approve them.' }),
    telegram: s.select('Also send the link to Telegram', 'off', [
      { value: 'off', label: 'No' }, { value: 'on_failure', label: 'Only when sharing on TikTok fails' }, { value: 'always', label: 'Always' }],
      { help: 'Needs the Telegram bot token and chat ID in Settings → Notifications.' }),
  }),
});

const capGroup = (label: string, daily: number, session: number, minScore: number, when: string) => s.group(label, {
  enabled: s.bool('Enabled', false), dailyCap: s.number('Daily cap', daily, 0, 1000), sessionCap: s.number('Per-session cap', session, 0, 1000),
  minScore: s.slider(`Only when the AI score is at least`, minScore, 0, 100, { help: when }),
});
export const engagementSchema = s.group('Engagement', {
  like: capGroup('Like', 30, 10, 75, 'Likes only videos the AI watched and scored this high.'),
  follow: capGroup('Follow', 5, 2, 90, 'Follows a creator at most once.'),
  favourite: capGroup('Save to favourites', 10, 5, 80, 'Also only videos that were saved to your research.'),
  comment: s.group('Comments', {
    enabled: s.bool('Enabled', false),
    requireApproval: s.locked('Require my approval for each comment', 'Every comment waits in the approval queue (Post → Queue). Nothing is posted without you.'),
    dailyCap: s.number('Daily cap', 5, 0, 100),
    minScore: s.slider('Only when the AI score is at least', 85, 0, 100),
    style: s.textarea('Comment style', 'Short, friendly, relevant to the video, in the video\'s language. No links, no self-promotion, no questions about personal details.'),
  }),
  messages: s.group('Private messages', {
    enabled: s.bool('Reply to private messages', false),
    inbox: s.select("Which account's inbox", 'watcher', [{ value: 'watcher', label: 'The watcher account' }, { value: 'account', label: 'A posting account' }]),
    account: s.account('Posting account', { showIf: { field: 'inbox', equals: 'account' } }),
    who: s.select('Who to reply to', 'allowlist', [
      { value: 'allowlist', label: 'Only these usernames' }, { value: 'friends', label: 'Friends (mutual follows)' }, { value: 'anyone', label: 'Anyone' }]),
    allowList: s.list('Usernames to reply to (without @)', ['bibacau']),
    requireApproval: s.bool('Require my approval for each reply', true, { help: 'On: drafts wait in Post → Queue → Messages waiting for your approval.' }),
    style: s.textarea('Reply style', 'Warm, short and natural, like a friendly creator. Reply in the same language as the message. One or two sentences. Use an emoji sometimes.', { rows: 3 }),
    dailyCap: s.number('Max replies per day', 20, 0, 500),
    perConversationPerHour: s.number('Max replies per conversation per hour', 3, 1, 60),
    checkEveryMinutes: s.number('Check the inbox every', 15, 2, 1440, { unit: 'min', help: 'While the app runs, and after each watching session. Never in the middle of a session.' }),
  }, { collapsed: false, help: 'Reads unread chats in TikTok Messages and drafts replies with the AI. Fixed safety rules: never sends links, phone numbers, addresses, passwords, payment info or codes; never agrees to money, deals or meetings; never claims to be human; ignores spam/scams/bots; stops and alerts you on anything sensitive or abusive.' }),
}, { help: 'All off by default. Engagement only happens on videos the AI chose to watch, in the watcher\'s Edge window.' });

export const postSchema = s.group('Posting', {
  mode: s.select('Posting mode', 'approval', [
    { value: 'approval', label: 'Save for my approval (I choose when to post)' },
    { value: 'schedule', label: 'Schedule automatically after I approve' },
    { value: 'auto', label: 'Auto-post (no approval)' }],
    { warnValues: { auto: 'Auto-post publishes every finished video without you checking it first. Mistakes (wrong facts, odd voice, bad visuals) go public. Only use this once you trust the output.' } }),
  account: s.account('TikTok account', { help: 'Add accounts in Post → Accounts. Each has its own Edge profile.' }),
  times: s.list('Posting times (24h, HH:MM)', ['12:30', '20:30'], { pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', help: 'Videos are given the next free time. Dashboard timezone.' }),
  maxPerDay: s.number('Max posts per day (per account)', 2, 1, 20),
  scheduleWith: s.select('How scheduled posts are published', 'tiktok', [
    { value: 'tiktok', label: "TikTok's own scheduler (uploaded now, published by TikTok — your PC can be off)" },
    { value: 'app', label: 'This app posts at the time (your PC and the app must be on)' }],
    { help: "TikTok's scheduler needs the time to be 15 minutes to 10 days ahead." }),
  privacy: s.select('Who can see the post', 'public', [{ value: 'public', label: 'Everyone' }, { value: 'friends', label: 'Friends' }, { value: 'private', label: 'Only me' }]),
  allowComments: s.bool('Allow comments', true),
  allowDuet: s.bool('Allow Duet', true),
  allowStitch: s.bool('Allow Stitch', true),
  aiLabel: s.locked('Label as AI-generated content', "Always on. Every upload gets TikTok's AI-generated label; if it can't be turned on and confirmed, the post is cancelled."),
  analytics: s.group('Performance tracking', {
    enabled: s.bool('Read post performance from TikTok Studio', true),
    refreshHours: s.number('Refresh every', 6, 1, 72, { unit: 'hours' }),
    feedIntoPlanning: s.bool("Use performance when planning tomorrow's videos", true),
    days: s.number('Look back', 14, 1, 90, { unit: 'days' }),
  }),
});

export const EDGE_VOICES = [
  { value: 'ms-MY-YasminNeural', label: 'Malay — Yasmin (female)' }, { value: 'ms-MY-OsmanNeural', label: 'Malay — Osman (male)' },
  { value: 'en-SG-LunaNeural', label: 'English (Singapore) — Luna' }, { value: 'en-SG-WayneNeural', label: 'English (Singapore) — Wayne' },
  { value: 'en-US-AriaNeural', label: 'English (US) — Aria' }, { value: 'en-US-GuyNeural', label: 'English (US) — Guy' },
  { value: 'en-US-JennyNeural', label: 'English (US) — Jenny' }, { value: 'en-GB-SoniaNeural', label: 'English (UK) — Sonia' },
  { value: 'id-ID-GadisNeural', label: 'Indonesian — Gadis' }, { value: 'id-ID-ArdiNeural', label: 'Indonesian — Ardi' },
  { value: 'zh-CN-XiaoxiaoNeural', label: 'Chinese (Mandarin) — Xiaoxiao' }, { value: 'zh-CN-YunxiNeural', label: 'Chinese (Mandarin) — Yunxi' },
  { value: 'ta-MY-KaniNeural', label: 'Tamil (Malaysia) — Kani' }, { value: 'ta-MY-SuryaNeural', label: 'Tamil (Malaysia) — Surya' },
];

export const createSchema = s.group('Video creation', {
  instructions: s.textarea('Video instructions', 'Make a 45s Malay video about the most interesting food trend today, fun tone, end with a question.', { rows: 5, help: 'Plain language. Used to plan and write every video.' }),
  basics: s.group('Basics', {
    autoCreate: s.bool('Create videos automatically after today\'s picks are ready', false),
    videosPerDay: s.number('Videos per day', 1, 1, 20),
    lengthSeconds: s.number('Target length', 45, 10, 180, { unit: 's' }),
    aspect: s.select('Aspect ratio', '9:16', [{ value: '9:16', label: '9:16 vertical (TikTok)' }, { value: '1:1', label: '1:1 square' }, { value: '4:5', label: '4:5 portrait' }, { value: '16:9', label: '16:9 landscape' }]),
    resolution: s.select('Resolution', '1080', [{ value: '1080', label: '1080p (best)' }, { value: '720', label: '720p (faster to render)' }]),
    language: s.text('Language', 'Malay', { help: 'Language of the script, subtitles and caption.' }),
    tone: s.text('Tone', 'fun, energetic, friendly'),
    audience: s.text('Target audience', 'Malaysians aged 18–35 who love food'),
    useResearch: s.bool("Base ideas on today's picks and research", true),
  }),
  script: s.group('Script', {
    hookStyle: s.select('Hook style', 'surprising fact', ['question', 'surprising fact', 'bold claim', 'POV', 'countdown', 'before/after', 'myth vs fact'], { allowCustom: true }),
    structure: s.textarea('Structure template', 'Hook (1 scene) → 3 quick points (1 scene each) → twist or tip → call to action', { rows: 3 }),
    sceneSeconds: s.number('Typical scene length', 5, 2, 15, { unit: 's' }),
    cta: s.text('Call to action', 'Ask viewers a question in the comments'),
    bannedWords: s.list('Banned words', [], { help: 'Never used in script or caption. A script that contains one is rewritten once, then the words are removed.' }),
    bannedTopics: s.list('Banned topics', ['politics', 'religion', 'medical claims']),
  }),
  voice: s.group('Voice', {
    provider: s.select('Voice provider', 'edge', [
      { value: 'edge', label: 'Microsoft Edge voices (free, online)' }, { value: 'windows', label: 'Windows built-in voices (offline)' }, { value: 'none', label: 'No voice — text only' }]),
    voice: s.select('Voice', 'ms-MY-YasminNeural', EDGE_VOICES, { allowCustom: true, help: 'Stock voices only. For Windows voices type the name (e.g. Microsoft Zira Desktop).' }),
    rate: s.slider('Speed', 5, -50, 100, { unit: '%' }),
    pitch: s.slider('Pitch', 0, -50, 50, { unit: 'Hz' }),
    volume: s.slider('Volume', 0, -50, 50, { unit: '%' }),
  }),
  visuals: s.group('Visuals', {
    source: s.select('Visual source', 'slides', [
      { value: 'slides', label: 'Animated text slides (free, offline)' }, { value: 'stock', label: 'Stock footage (Pexels / Pixabay)' },
      { value: 'ai_image', label: 'AI images' }, { value: 'ai_video', label: 'AI video' }, { value: 'mixed', label: 'Mix: stock footage + AI images' }],
      { help: 'Any scene whose visual fails falls back to a text slide. Set up keys in Settings → Media providers.' }),
    stockProvider: s.select('Stock provider', 'pexels', ['pexels', 'pixabay']),
    imageStyle: s.textarea('AI image style', 'bright, appetising food photography, vertical composition, natural light', { rows: 2 }),
    bgColor1: s.color('Background colour 1', '#fe2c55'), bgColor2: s.color('Background colour 2', '#25f4ee'),
    textColor: s.color('Text colour', '#ffffff'), accentColor: s.color('Accent / box colour', '#000000'),
    font: s.file('Font', 'fonts', { help: 'Empty = automatic (Arial Bold on Windows). Upload .ttf/.otf files to add more.' }),
    headlineSize: s.number('Headline text size', 72, 24, 200, { unit: 'px @1080p' }),
    transition: s.select('Transition between scenes', 'fade', ['none', 'fade']),
    logo: s.file('Logo / watermark', 'logos', { help: 'PNG with transparency works best.' }),
    logoPosition: s.select('Logo position', 'top-right', ['top-left', 'top-right', 'bottom-left', 'bottom-right']),
    logoSize: s.slider('Logo width', 18, 5, 50, { unit: '% of width' }),
    logoOpacity: s.slider('Logo opacity', 0.85, 0.1, 1, { step: 0.05 }),
  }),
  subtitles: s.group('Subtitles', {
    enabled: s.bool('Burn in subtitles', true),
    style: s.select('Style', 'box', [{ value: 'box', label: 'Text on a box' }, { value: 'outline', label: 'Outlined text' }]),
    position: s.select('Position', 'lower', [{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'lower', label: 'Lower third' }, { value: 'bottom', label: 'Bottom' }]),
    size: s.number('Text size', 58, 20, 160, { unit: 'px @1080p' }),
    wordsPerLine: s.number('Words per subtitle', 4, 1, 12),
    uppercase: s.bool('UPPERCASE', false),
  }),
  music: s.group('Background music', {
    enabled: s.bool('Add background music', false),
    file: s.file('Track', 'music', { help: 'Empty = random track from your music folder. Upload your own music (mp3/m4a/wav) — only use music you have the rights to.' }),
    volume: s.slider('Music volume', 0.15, 0, 1, { step: 0.05 }),
    duck: s.bool('Lower music while the voice speaks', true),
  }),
  caption: s.group('Caption & hashtags', {
    instructions: s.textarea('Caption rules', 'One or two short sentences with an emoji, ending with a question.', { rows: 2 }),
    maxChars: s.number('Caption max length', 150, 20, 2200),
    hashtagCount: s.number('Number of hashtags', 5, 0, 30),
    alwaysTags: s.list('Always include hashtags (without #)', ['fyp', 'malaysia']),
  }),
});

export const presetSchema = s.group('Preset', {
  watch: watchSchema,
  schedule: scheduleSchema,
  save: saveSchema,
  engagement: engagementSchema,
  create: createSchema,
  post: postSchema,
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
  searchOpen: ['[data-e2e="nav-search"]', 'button[aria-label="Search" i]', 'div[data-e2e="search-icon"]'],
  searchInput: ['input[data-e2e="search-user-input"]', 'input[type="search"]', 'input[name="q"]', 'input[placeholder*="Search" i]', 'input[placeholder*="Cari" i]'],
  captcha: ['#captcha-verify-container', '#captcha_container', '.captcha_verify_container', '[class*="captcha-verify" i]', 'iframe[src*="captcha"]', '[id*="secsdk-captcha" i]'],
  captchaTexts: ['Verify to continue', 'Drag the slider', 'Select 2 objects', 'Sahkan untuk teruskan'],
  loginModal: ['[data-e2e="login-modal"]', '#loginContainer', '[data-e2e="login-title"]'],
  loginTexts: ['Log in to TikTok', 'Log in to follow', 'Log masuk ke TikTok'],
  likeButton: ['[data-e2e="browse-like-icon"]', '[data-e2e="like-icon"]', 'button[aria-label*="like" i]'],
  followButton: ['[data-e2e="browse-follow"]', '[data-e2e="feed-follow"]', '[data-e2e="follow-button"]', 'button[aria-label*="follow" i]'],
  favouriteButton: ['[data-e2e="undefined-icon"]', '[data-e2e="favorite-icon"]', '[data-e2e="collect-icon"]', 'button[aria-label*="favourite" i]', 'button[aria-label*="favorite" i]'],
  commentInput: ['[data-e2e="comment-input"] [contenteditable="true"]', '[data-e2e="comment-input"]', 'div[contenteditable="true"][role="textbox"]'],
  commentPost: ['[data-e2e="comment-post"]', 'button[aria-label*="post" i]'],
  shareButton: ['[data-e2e="share-icon"]', '[data-e2e="browse-share-icon"]', '[data-e2e="video-share"]', 'button[aria-label*="share" i]'],
  shareDialog: ['[role="dialog"]', '[aria-modal="true"]', '[data-e2e="share-panel"]', '[class*="SharePanel" i]', '[class*="share-container" i]'],
  shareSearch: ['input[placeholder*="Search" i]', 'input[placeholder*="Cari" i]', 'input[type="search"]', 'input'],
  shareSendToTexts: ['Send to', 'Send to friends', 'Hantar kepada', 'Send'],
  shareSendTexts: ['Send', 'Hantar'],
  shareCopyLinkTexts: ['Copy link', 'Copy Link', 'Salin pautan'],
  msgPage: ['[data-e2e="chat-list"]', '[data-e2e="chat-list-item"]', '[class*="ConversationList" i]', '[class*="DivMessageContainer" i]', '[class*="ChatContainer" i]', '[class*="InboxContainer" i]'],
  msgConversation: ['[data-e2e="chat-list-item"]', '[class*="DivItemWrapper" i]', '[class*="ConversationListItem" i]', '[class*="ConversationItem" i]'],
  msgConversationName: ['[data-e2e="chat-list-item-name"]', '[class*="InfoNickname" i]', '[class*="Nickname" i]', 'p', 'span'],
  msgUnread: ['[data-e2e="chat-list-item-unread"]', '[class*="UnreadBadge" i]', '[class*="unread" i]', '[class*="RedDot" i]'],
  msgHeaderLink: ['[data-e2e="chat-header"] a[href*="/@"]', '[class*="ChatHeader" i] a[href*="/@"]', '[data-e2e="chat-uniqueid"]'],
  msgItem: ['[data-e2e="chat-item"]', '[class*="DivChatItemWrapper" i]', '[class*="ChatItem" i]', '[class*="MessageItem" i]'],
  msgMine: ['[data-e2e="chat-item-mine"]', '[class*="MyMessage" i]', '[class*="Myself" i]', '[class*="isSelf" i]'],
  msgText: ['[data-e2e="chat-item-text"]', '[class*="TextContainer" i]', '[class*="MessageText" i]', 'p'],
  msgInput: ['[data-e2e="message-input-area"] [contenteditable="true"]', '[data-e2e="message-input-area"]', 'div[contenteditable="true"]', 'textarea'],
  msgSend: ['[data-e2e="message-send"]', 'button[aria-label*="send" i]', 'svg[data-e2e="message-send"]'],
  msgFriendTexts: ['Friends', 'Rakan'],
  shareSentTexts: ['Sent', 'Dihantar', 'Message sent'],
  shareBlockedTexts: ["can't send", 'cannot send', 'unable to send', 'not allowed to message', 'only send messages to', 'Tidak dapat menghantar'],
  shareNotFoundTexts: ['No results', 'No users found', 'Tiada hasil'],
};

/** TikTok Studio upload page (editable in Settings → Posting page selectors). */
export const DEFAULT_POST_SELECTORS = {
  uploadPath: '/tiktokstudio/upload?from=webapp',
  contentPath: '/tiktokstudio/content',
  fileInput: ['input[type="file"]'],
  caption: ['[data-e2e="upload-editor-caption"] [contenteditable="true"]', '[data-e2e="upload-editor-caption"]', 'div[contenteditable="true"][role="textbox"]', 'div[contenteditable="true"]'],
  postButton: ['[data-e2e="post_video_button"]', 'button[data-e2e="post_video_button"]'],
  postButtonTexts: ['Post', 'Schedule', 'Siarkan', 'Jadualkan'],
  showMoreTexts: ['Show more', 'More options', 'Advanced settings', 'Tunjukkan lagi'],
  aiLabelTexts: ['AI-generated content', 'AI generated content', 'Kandungan yang dijana AI'],
  aiConfirmTexts: ['Turn on', 'Confirm', 'OK', 'Got it', 'Hidupkan'],
  successUrl: 'tiktokstudio/(content|posts)',
  successTexts: ['posted', 'uploaded', 'scheduled', 'published'],
  modalDismissTexts: ['cancel', 'skip', 'skip all', 'got it', 'no thanks', 'not now', 'maybe later', 'close', 'dismiss', 'done'],
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
    loginPath: s.text('Login page (path after base URL)', '/login'),
    messagesPath: s.text('Messages page (path after base URL)', '/messages'),
    loginCookieDomain: s.text('Login cookie domain', 'tiktok.com', { help: 'Advanced. Login is detected when a session cookie for this domain exists.' }),
    loginCookieNames: s.list('Login cookie names', ['sessionid', 'sessionid_ss', 'sid_tt']),
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
  tools: s.group('Video tools', {
    ffmpegPath: s.text('ffmpeg path', 'ffmpeg', { help: 'Leave as "ffmpeg" if it is installed with winget. Otherwise the full path to ffmpeg.exe.' }),
    ffprobePath: s.text('ffprobe path', 'ffprobe'),
    preset: s.select('Encoder speed', 'veryfast', ['ultrafast', 'veryfast', 'faster', 'medium'], { help: 'Faster = quicker render, slightly bigger file.' }),
    edgeTtsUrl: s.text('Edge voices service address', 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1', { help: 'Advanced. Only change if the free Edge voices stop working.' }),
    edgeTtsVersion: s.text('Edge voices client version', '1-130.0.2849.68', { help: 'Advanced. Update to a newer Edge version number if the voices return errors.' }),
  }, { collapsed: true }),
  media: s.group('Media providers (video creation)', {
    pexelsKey: s.secret('Pexels API key', { help: 'Free: https://www.pexels.com/api/' }),
    pixabayKey: s.secret('Pixabay API key', { help: 'Free: https://pixabay.com/api/docs/' }),
    imageProvider: s.select('AI image provider', 'openai', [{ value: 'openai', label: 'OpenAI-compatible images API' }, { value: 'replicate', label: 'Replicate' }]),
    imageBaseUrl: s.text('Images API base URL', 'https://api.openai.com/v1'),
    imageKey: s.secret('Images API key'),
    imageModel: s.text('Image model', 'gpt-image-1-mini', { help: 'e.g. gpt-image-1-mini, gpt-image-1, dall-e-3 — or a Replicate model like black-forest-labs/flux-schnell' }),
    imageSize: s.text('Image size', '1024x1536'),
    imageQuality: s.select('Image quality', 'low', ['low', 'medium', 'high', 'auto']),
    imagePriceUsd: s.number('Price per image (USD)', 0.011, 0, 5, { step: 0.001, help: 'Counted in the budget. Check your provider\'s current price.' }),
    replicateToken: s.secret('Replicate API token', { help: 'https://replicate.com/account/api-tokens — used for Replicate images and AI video.' }),
    videoModel: s.text('AI video model (Replicate)', '', { placeholder: 'e.g. wan-video/wan-2.2-t2v-fast', help: 'Leave empty to disable AI video. Scenes fall back to AI images or slides.' }),
    videoInput: s.json('AI video input template', { prompt: '{{prompt}}' }, { rows: 4, help: '{{prompt}}, {{seconds}} and {{aspect}} are filled in. Check the model page for its input fields.' }),
    videoPriceUsd: s.number('Price per AI video clip (USD)', 0.1, 0, 20, { step: 0.01 }),
  }, { collapsed: true }),
  notifications: s.group('Notifications', {
    telegramBotToken: s.secret('Telegram bot token'),
    telegramChatId: s.text('Telegram chat ID', ''),
    smtpHost: s.text('SMTP host', ''), smtpPort: s.number('SMTP port', 587, 1, 65535),
    smtpUser: s.text('SMTP user', ''), smtpPassword: s.secret('SMTP password'), emailTo: s.text('Send to', ''),
  }, { phase: 4, collapsed: true }),
  postSelectors: s.json('Posting page selectors (TikTok Studio)', DEFAULT_POST_SELECTORS, { rows: 16, help: 'Advanced. Fix here if TikTok changes its upload page.' }),
  selectors: s.json('TikTok page selectors', DEFAULT_SELECTORS, { rows: 20, help: 'Advanced. If TikTok changes its website, fix selectors here without touching code.' }),
});

