import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.dirname(__filename);
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const CACHE_DIR = path.join(ROOT_DIR, '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'news.json');
const TRANSLATION_CACHE_FILE = path.join(CACHE_DIR, 'translations.json');
const HISTORY_FILE = path.join(CACHE_DIR, 'history.json');

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const CACHE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12 * 1000;
const REQUEST_GAP_MS = 450;
const MAX_ITEMS_PER_SOURCE = 18;
const MAX_TOTAL_ITEMS = 80;
const MAX_TRANSLATIONS_PER_REQUEST = 80;
const TRANSLATION_CONCURRENCY = 3;
const TRANSLATION_TIMEOUT_MS = 10 * 1000;
const TRANSLATION_PROVIDER = 'MyMemory';
const MAX_ARTICLE_AGE_HOURS = 48;
const STALE_REPORT_PATTERN = /\b(?:yesterday|last night|last week|last month|last year|days ago|weeks ago|months ago|years ago|earlier this week|previous week|anniversary|commemorat\w*|retrospect\w*|roundup|recap|weekly review)\b|(?:昨天|前天|上周|上个月|去年|日前|近日|回顾|盘点|纪念|周年)/i;
const MONTH_NUMBERS = Object.freeze({ jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 });

// 只读取 RSS/公开列表元数据；应用不会请求或保存文章正文。
const FEEDS = Object.freeze([
  {
    id: 'bbc-middle-east',
    name: 'BBC News',
    url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml',
    home: 'https://www.bbc.com/news/world/middle_east',
    requireUaeMatch: true
  },
  {
    id: 'al-jazeera',
    name: 'Al Jazeera',
    url: 'https://www.aljazeera.com/xml/rss/all.xml',
    home: 'https://www.aljazeera.com/',
    requireUaeMatch: true
  },
  {
    id: 'sky-news',
    name: 'Sky News',
    url: 'https://feeds.skynews.com/feeds/rss/world.xml',
    home: 'https://news.sky.com/world',
    requireUaeMatch: true
  },
  {
    id: 'the-guardian',
    name: 'The Guardian',
    url: 'https://www.theguardian.com/world/rss',
    home: 'https://www.theguardian.com/world',
    requireUaeMatch: true
  },
  {
    id: 'arab-news',
    name: 'Arab News',
    url: 'https://www.arabnews.com/rss.xml',
    home: 'https://www.arabnews.com/',
    requireUaeMatch: true
  },
  {
    id: 'reuters-google',
    name: 'Reuters',
    url: 'https://news.google.com/rss/search?q=site%3Areuters.com+%28UAE+OR+%22United+Arab+Emirates%22+OR+Dubai+OR+%22Abu+Dhabi%22%29&hl=en-US&gl=AE&ceid=AE%3Aen',
    home: 'https://www.reuters.com/',
    requireUaeMatch: true,
    discovery: 'Google News RSS',
    note: 'Reuters 官方 RSS 已停止公开；此源通过 Google News RSS 检索，点击后跳转至 Reuters 原文。',
    titleCleanup: /\s+-\s+reuters\.com\s*$/i
  },
  {
    id: 'china-uae-opinion',
    name: '涉华舆论',
    url: 'https://news.google.com/rss/search?q=%28UAE+OR+%22United+Arab+Emirates%22+OR+Dubai+OR+%22Abu+Dhabi%22%29+AND+%28China+OR+Chinese+OR+Beijing+OR+%22Belt+and+Road%22+OR+Huawei%29+when%3A7d&hl=zh-CN&gl=AE&ceid=AE%3Azh-Hans',
    home: 'https://news.google.com/',
    requireUaeMatch: true,
    requireChinaMatch: true,
    categoryHint: 'china',
    discovery: 'Google News RSS',
    note: '公开检索“阿联酋语境 + 中国 / Chinese / Beijing / Belt and Road / Huawei”的近期新闻。'
  },
  {
    id: 'uae-diplomacy-google',
    name: 'UAE 外交',
    url: 'https://news.google.com/rss/search?q=%28UAE+OR+%22United+Arab+Emirates%22%29+AND+%28diplomacy+OR+diplomatic+OR+bilateral+OR+summit+OR+%22foreign+minister%22+OR+agreement%29+when%3A7d&hl=en-US&gl=AE&ceid=AE%3Aen',
    home: 'https://news.google.com/',
    requireUaeMatch: true,
    categoryHint: 'diplomacy',
    discovery: 'Google News RSS',
    note: '公开检索 UAE 外交、双边关系、访问、峰会和协议新闻。'
  },
  {
    id: 'uae-military-google',
    name: 'UAE 军事安全',
    url: 'https://news.google.com/rss/search?q=%28UAE+OR+%22United+Arab+Emirates%22+OR+Dubai+OR+%22Abu+Dhabi%22%29+AND+%28military+OR+defence+OR+defense+OR+missile+OR+drone+OR+Houthi%29+when%3A7d&hl=en-US&gl=AE&ceid=AE%3Aen',
    home: 'https://news.google.com/',
    requireUaeMatch: true,
    categoryHint: 'military',
    discovery: 'Google News RSS',
    note: '公开检索 UAE 防务、军事合作地区和地区安全新闻。'
  },
  {
    id: 'uae-social-google',
    name: '社交媒体关注',
    url: 'https://news.google.com/rss/search?q=%28UAE+OR+Dubai+OR+%22Abu+Dhabi%22%29+AND+%28%22social+media%22+OR+viral+OR+trending+OR+Twitter+OR+TikTok+OR+Instagram+OR+%22X+post%22%29+when%3A3d&hl=en-US&gl=AE&ceid=AE%3Aen',
    home: 'https://news.google.com/',
    requireUaeMatch: true,
    categoryHint: 'social',
    discovery: 'Google News RSS',
    note: '公开新闻与 Google Trends 反映的 UAE 社交媒体关注；X 登录后接口和付费数据不接入。'
  },
  {
    id: 'newsnow-uae',
    name: 'NewsNow',
    type: 'html',
    url: 'https://www.newsnow.co.uk/h/World+News/Middle+East/United+Arab+Emirates',
    home: 'https://www.newsnow.co.uk/h/World+News/Middle+East/United+Arab+Emirates',
    requireUaeMatch: true,
    discovery: '公开网页',
    note: 'NewsNow 是新闻聚合页；标题、来源和时间来自公开 HTML，原文链接通过 NewsNow 跳转。'
  },
  {
    id: 'khaleej-times',
    name: 'Khaleej Times',
    url: 'https://www.khaleejtimes.com/api/v1/collections/uae.rss',
    home: 'https://www.khaleejtimes.com/uae',
    requireUaeMatch: false
  },
  {
    id: 'google-trends-uae',
    name: 'Google Trends UAE',
    type: 'trends',
    url: 'https://trends.google.com/trending/rss?geo=AE',
    home: 'https://trends.google.com/trending?geo=AE',
    requireUaeMatch: false,
    discovery: '公开趋势 RSS',
    note: 'Google Trends 阿联酋当日公开热门搜索，仅用于热度加权，不直接作为新闻展示。'
  }
]);

export const CATEGORY_DEFINITIONS = Object.freeze([
  { id: 'all', label: '综合热榜', description: '跨分类按多源热度指数排序' },
  { id: 'domestic', label: '国内', description: '阿联酋本地政务、社会与民生' },
  { id: 'diplomacy', label: '外交', description: '对外关系、访问、峰会和协议' },
  { id: 'economy', label: '经济', description: '贸易、市场、企业与投资' },
  { id: 'technology', label: '科技', description: 'AI、数字化、航天与创新' },
  { id: 'military', label: '军事热点', description: '防务、冲突与地区安全' },
  { id: 'social', label: '社交媒体', description: 'UAE 国内社交传播与 Google Trends 关注话题' },
  { id: 'china', label: '每日涉华舆论', description: '阿联酋语境下的中国相关报道与舆论' }
]);

const CATEGORY_RULES = Object.freeze({
  social: [
    'social media', 'viral', 'trending', 'twitter', 'x post', 'tiktok', 'instagram', 'influencer',
    'hashtag', 'netizen', 'online video', 'social post', 'facebook', 'youtube', 'views', 'followers'
  ],
  domestic: [
    'uae', 'emirati', 'dubai', 'abu dhabi', 'sharjah', 'ajman', 'ras al khaimah', 'fujairah',
    'umm al quwain', 'al ain', 'weather', 'rain', 'temperature', 'traffic', 'police', 'resident',
    'visa', 'emirates id', 'school', 'education', 'hospital', 'health', 'court', 'municipality',
    'public holiday', 'ramadan', 'eid', 'community', 'family', 'transport', 'metro', 'salik',
    'national day', 'sheikh mohamed', 'sheikh mohammed', 'sheikh mansour', 'uae government'
  ],
  diplomacy: [
    'diplomatic', 'diplomacy', 'foreign minister', 'foreign ministry', 'ambassador', 'embassy',
    'bilateral', 'state visit', 'official visit', 'summit', 'talks', 'treaty', 'agreement',
    'memorandum', 'relations', 'cooperation', 'united nations', 'g20', 'brics', 'arab league',
    'gulf cooperation council', 'gcc', 'ceasefire', 'peace', 'minister of state', 'crown prince'
  ],
  economy: [
    'economy', 'economic', 'trade', 'business', 'market', 'stock', 'investment', 'investor',
    'oil', 'gas', 'adnoc', 'etihad', 'flydubai', 'airline', 'airport', 'real estate', 'property',
    'finance', 'bank', 'dirham', 'gdp', 'inflation', 'tourism', 'hotel', 'logistics', 'cargo',
    'exports', 'imports', 'company', 'earnings', 'profit', 'startup funding', 'wealth fund'
  ],
  technology: [
    'artificial intelligence', ' ai ', 'technology', 'technological', 'digital', 'data centre',
    'data center', 'cyber', 'cybersecurity', 'satellite', 'space', 'robot', 'innovation', 'startup',
    'telecom', 'smartphone', 'chip', 'cloud', 'smart city', 'g42', 'e&', 'amazon', 'microsoft',
    'google', 'openai', 'quantum', '5g', '6g', 'huawei'
  ],
  military: [
    'military', 'defence', 'defense', 'armed forces', 'army', 'navy', 'air force', 'missile',
    'drone', 'war', 'airstrike', 'air strike', 'conflict', 'troops', 'weapons', 'houthi',
    'attack', 'security exercise', 'naval', 'fighter jet', 'ballistic', 'strike'
  ]
});

const CHINA_KEYWORDS = Object.freeze([
  'china', 'chinese', 'beijing', 'xi jinping', 'hong kong', 'taiwan', 'belt and road',
  'huawei', 'alibaba', 'tencent', 'byd', 'sinopec', 'cnpc', 'renminbi', 'yuan', 'الصين', 'الصينية', 'بكين', 'هواوي', 'طريق الحرير',
  '中国', '中方', '北京', '习近平', '香港', '台湾', '一带一路', '华为', '人民币', '中阿'
]);

const UAE_KEYWORDS = Object.freeze([
  'uae', 'u.a.e.', 'united arab emirates', 'emirati', 'dubai', 'abu dhabi', 'sharjah',
  'ajman', 'ras al khaimah', 'fujairah', 'umm al quwain', 'mohamed bin zayed',
  'mohammed bin zayed', 'mohamed bin rashid', 'mohammed bin rashid', 'الإمارات',
  'الإمارات العربية المتحدة', 'دبي', 'أبوظبي', 'الشارقة', 'عجمان', 'رأس الخيمة',
  'الفجيرة', 'أم القيوين', 'محمد بن زايد', 'محمد بن راشد'
]);

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'it', 'of',
  'on', 'or', 'the', 'to', 'with', 'after', 'before', 'over', 'under', 'new', 'says', 'say',
  'amid', 'into', 'its', 'their', 'this', 'that', 'will', 'has', 'have', 'was', 'were'
]);

let refreshPromise = null;
let memoryCache = null;
let memoryTranslationCache = null;
let memoryHistoryCache = null;

function emptyCache() {
  return { version: 3, updatedAt: null, itemsBySource: {}, sources: {} };
}

function emptyTranslationCache() {
  return { version: 1, updatedAt: null, entries: {} };
}

function decodeEntities(value = '') {
  const named = { amp: '&', apos: "'", gt: '>', lt: '<', quot: '"', nbsp: ' ' };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    const key = entity.toLowerCase();
    if (key.startsWith('#x')) {
      const codePoint = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    if (key.startsWith('#')) {
      const codePoint = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return named[key] ?? match;
  });
}

function cleanText(value = '') {
  return decodeEntities(String(value).replace(/<[^>]*>/g, ' '))
    .replace(/\u0085/g, '…')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTag(itemXml, tagName) {
  const expression = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = itemXml.match(expression);
  if (!match) return '';
  return match[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim();
}

function normalizeDate(value = '') {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function normalizeText(value = '') {
  return cleanText(value).toLocaleLowerCase('en-US');
}

export function isUaeRelated(text = '') {
  const normalized = normalizeText(text);
  return UAE_KEYWORDS.some((keyword) => normalized.includes(keyword.toLocaleLowerCase('en-US')));
}

function isChinaRelatedText(text = '') {
  const normalized = normalizeText(text);
  return CHINA_KEYWORDS.some((keyword) => normalized.includes(keyword.toLowerCase()));
}
function normalizePublisher(value, fallback) {
  const publisher = cleanText(value);
  if (!publisher || /google news|news\.google/i.test(publisher)) return fallback;
  if (/reuters\.com|^reuters$/i.test(publisher)) return 'Reuters';
  return publisher;
}

function hasOlderExplicitDate(text, now) {
  const match = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:,\s*(\d{4}))?\b/i);
  if (!match) return false;
  const month = MONTH_NUMBERS[match[1].toLowerCase()];
  const day = Number.parseInt(match[2], 10);
  const year = Number.parseInt(match[3] || String(new Date(now).getUTCFullYear()), 10);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return false;
  const date = Date.UTC(year, month, day);
  return (now - date) / 3_600_000 > 36;
}

function isStaleReport(title, description, publishedAt, now = Date.now()) {
  const text = `${title} ${description}`;
  if (STALE_REPORT_PATTERN.test(text)) return true;
  if (hasOlderExplicitDate(text, now)) return true;

  const publishedTimestamp = Date.parse(publishedAt || '');
  if (Number.isFinite(publishedTimestamp) && (now - publishedTimestamp) / 3_600_000 > MAX_ARTICLE_AGE_HOURS) {
    return true;
  }
  return false;
}
function cleanupFeedTitle(title, feed) {
  const cleaned = feed.titleCleanup ? title.replace(feed.titleCleanup, '') : title;
  return cleaned.trim();
}

export function parseRssItems(xml, feed, fetchedAt = new Date().toISOString()) {
  const itemBlocks = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  const items = [];

  for (const [feedRank, itemXml] of itemBlocks.entries()) {
    const title = cleanupFeedTitle(cleanText(extractTag(itemXml, 'title')), feed);
    const url = cleanText(extractTag(itemXml, 'link'));
    if (!title || !/^https?:\/\//i.test(url)) continue;

    // 短摘要只用于相关性判断，不保存、不返回、不显示。
    const shortDescription = cleanText(extractTag(itemXml, 'description'));
    const publishedAt = normalizeDate(extractTag(itemXml, 'pubDate'));
    if (isStaleReport(title, shortDescription, publishedAt, Date.parse(fetchedAt))) continue;
    if (feed.requireUaeMatch && !isUaeRelated(`${title} ${shortDescription}`)) continue;
    if (feed.requireChinaMatch && !isChinaRelatedText(`${title} ${shortDescription}`)) continue;

    const publisher = normalizePublisher(extractTag(itemXml, 'source'), feed.name);
    items.push({
      id: `${feed.id}:${url}`,
      title,
      url,
      source: publisher,
      sourceId: feed.id,
      categoryHint: feed.categoryHint || null,
      feedRank,
      publishedAt,
      fetchedAt
    });
  }

  return items.sort(compareByPublishedAt).slice(0, MAX_ITEMS_PER_SOURCE);
}

export function parseTrendItems(xml, feed, fetchedAt = new Date().toISOString()) {
  const itemBlocks = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  return itemBlocks.map((itemXml, index) => ({
    id: `${feed.id}:${index}`,
    type: 'trend',
    title: cleanText(extractTag(itemXml, 'title')),
    approxTraffic: cleanText(extractTag(itemXml, 'ht:approx_traffic')),
    publishedAt: normalizeDate(extractTag(itemXml, 'pubDate')),
    fetchedAt
  })).filter((item) => item.title).slice(0, 30);
}

export function parseNewsNowItems(html, feed, fetchedAt = new Date().toISOString()) {
  const blocks = html
    .split(/(?=<div class="hl(?:\s[^"]*)?"\s+data-id=")/i)
    .filter((block) => /^<div class="hl(?:\s[^"]*)?"\s+data-id="/i.test(block));
  const items = [];

  for (const [newsNowRank, block] of blocks.entries()) {
    const anchorMatch = block.match(/<a\s+class="hll"\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!anchorMatch) continue;

    const url = cleanText(anchorMatch[1]);
    const title = cleanText(anchorMatch[2]);
    if (!title || !/^https?:\/\//i.test(url)) continue;
    if (feed.requireUaeMatch && !isUaeRelated(title)) continue;

    const publisherMatch = block.match(/<span\s+class="src src-part"[^>]*>([\s\S]*?)<i\b/i);
    const publisher = cleanText(publisherMatch?.[1] || '');
    const timeMatch = block.match(/<span\s+class="time"\s+data-time="(\d+)"/i);
    const seconds = Number.parseInt(timeMatch?.[1] || '', 10);
    const publishedAt = Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
    if (isStaleReport(title, '', publishedAt, Date.parse(fetchedAt))) continue;

    items.push({
      id: `${feed.id}:${url}`,
      title,
      url,
      source: publisher || feed.name,
      sourceId: feed.id,
      feedRank: newsNowRank,
      publishedAt,
      fetchedAt
    });
  }

  return items.sort(compareByPublishedAt).slice(0, MAX_ITEMS_PER_SOURCE);
}

function parseSourceItems(sourceContent, feed, fetchedAt) {
  if (feed.type === 'html') return parseNewsNowItems(sourceContent, feed, fetchedAt);
  if (feed.type === 'trends') return parseTrendItems(sourceContent, feed, fetchedAt);
  return parseRssItems(sourceContent, feed, fetchedAt);
}

function compareByPublishedAt(left, right) {
  const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : 0;
  const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : 0;
  return rightTime - leftTime;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function tokenizeTitle(title) {
  return normalizeText(title)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function storySimilarity(leftTitle, rightTitle) {
  const leftTokens = tokenizeTitle(leftTitle);
  const rightTokens = tokenizeTitle(rightTitle);
  if (!leftTokens.length || !rightTokens.length) return { score: 0, threshold: 1 };

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  const jaccard = union ? intersection / union : 0;
  const prefixLength = Math.min(leftTokens.length, rightTokens.length);
  let sharedPrefix = 0;
  while (sharedPrefix < prefixLength && leftTokens[sharedPrefix] === rightTokens[sharedPrefix]) sharedPrefix += 1;

  const minimumLength = Math.min(leftTokens.length, rightTokens.length);
  const threshold = minimumLength < 6 ? 0.78 : 0.54;
  return { score: Math.max(jaccard, sharedPrefix >= 6 ? 0.76 : 0), threshold };
}

function linkPriority(item) {
  if (item.sourceId === 'newsnow-uae') return 20;
  if (item.sourceId?.includes('google')) return 30;
  if (item.sourceId === 'khaleej-times') return 90;
  return 80;
}

function mergeStory(target, candidate) {
  const sources = [...new Set([...(target.sources || [target.source]), candidate.source].filter(Boolean))];
  const sourceIds = [...new Set([...(target.sourceIds || [target.sourceId]), candidate.sourceId].filter(Boolean))];
  const candidateIsBetterLink = sourceWeight(candidate.source) > sourceWeight(target.source) || (sourceWeight(candidate.source) === sourceWeight(target.source) && linkPriority(candidate) > linkPriority(target));

  if (candidateIsBetterLink) {
    target.url = candidate.url;
    target.source = candidate.source;
    target.sourceId = candidate.sourceId;
  }

  target.sources = sources;
  target.sourceIds = sourceIds;
  target.sourceCount = sources.length;
  target.publishedAt = [target.publishedAt, candidate.publishedAt].filter(Boolean).sort().at(-1) || null;
  target.feedRank = Math.min(target.feedRank ?? 999, candidate.feedRank ?? 999);
  if (tokenizeTitle(candidate.title).length > tokenizeTitle(target.title).length) target.title = candidate.title;
  if (candidate.categoryHint === 'china') target.categoryHint = 'china';
  return target;
}

export function dedupeStories(items) {
  const stories = [];
  const sorted = [...items].sort(compareByPublishedAt);

  for (const item of sorted) {
    let matched = null;
    for (const story of stories) {
      const similarity = storySimilarity(item.title, story.title);
      if (similarity.score >= similarity.threshold) {
        matched = story;
        break;
      }
    }
    if (matched) mergeStory(matched, item);
    else stories.push({ ...item, sources: [item.source], sourceIds: [item.sourceId], sourceCount: 1 });
  }

  return stories;
}

function scoreCategory(title, keywords) {
  const normalized = ` ${normalizeText(title)} `;
  return keywords.reduce((score, keyword) => score + (normalized.includes(keyword.toLowerCase()) ? 1 : 0), 0);
}

export function classifyStory(title, categoryHint = null, sourceText = '') {
  const combined = `${title} ${sourceText}`;
  const scores = Object.fromEntries(
    Object.entries(CATEGORY_RULES).map(([categoryId, keywords]) => [categoryId, scoreCategory(combined, keywords)])
  );

  if (categoryHint === 'domestic') scores.domestic += 2;
  if (categoryHint === 'economy') scores.economy += 2;
  if (categoryHint === 'technology') scores.technology += 2;
  if (categoryHint === 'social') scores.social += 3;
  if (categoryHint === 'diplomacy') scores.diplomacy += 2;
  if (categoryHint === 'military') scores.military += 2;

  let primaryCategoryId = 'domestic';
  let highestScore = 0;
  for (const categoryId of ['social', 'military', 'diplomacy', 'technology', 'economy', 'domestic']) {
    if (scores[categoryId] > highestScore) {
      highestScore = scores[categoryId];
      primaryCategoryId = categoryId;
    }
  }

  const normalized = normalizeText(combined);
  const chinaRelated = CHINA_KEYWORDS.some((keyword) => normalized.includes(keyword.toLowerCase()));
  const categoryIds = [primaryCategoryId];
  if (chinaRelated && !categoryIds.includes('china')) categoryIds.push('china');

  return { primaryCategoryId, categoryIds, chinaRelated };
}
function parseTrafficValue(value = '') {
  const normalized = value.replace(/,/g, '').trim().toUpperCase();
  const amount = Number.parseFloat(normalized.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(amount)) return 1;
  return amount;
}

function trendBoostForTitle(title, trends) {
  const normalizedTitle = ` ${normalizeText(title)} `;
  let bestBoost = 0;
  for (const trend of trends) {
    const normalizedTrend = normalizeText(trend.title);
    if (!normalizedTrend) continue;
    const trendTokens = tokenizeTitle(normalizedTrend);
    const exactMatch = normalizedTrend.length >= 5 && normalizedTitle.includes(` ${normalizedTrend} `);
    const tokenMatch = trendTokens.length >= 2 && trendTokens.every((token) => normalizedTitle.includes(` ${token} `));
    if (!exactMatch && !tokenMatch) continue;

    const traffic = parseTrafficValue(trend.approxTraffic);
    const boost = Math.min(30, Math.log10(traffic + 10) * 6);
    bestBoost = Math.max(bestBoost, boost);
  }
  return Math.round(bestBoost * 10) / 10;
}

function sourceWeight(source) {
  const name = String(source || '').toLowerCase();
  if (name.includes('wam') || name.includes('emirates news agency') || name.includes('uae government')) return 13;
  if (name.includes('reuters')) return 12;
  if (name.includes('bbc') || name.includes('sky') || name.includes('al jazeera') || name.includes('guardian') || name.includes('associated press') || name.includes('ap news') || name.includes('cnn') || name.includes('bloomberg') || name.includes('financial times')) return 11;
  if (name.includes('khaleej') || name.includes('national') || name.includes('arab news') || name.includes('gulf news')) return 10;
  return 4;
}

function calculateHeatScore(story, now, trendBoost = 0) {
  const publishedAt = story.publishedAt ? Date.parse(story.publishedAt) : now;
  const ageHours = Math.max(0, (now - publishedAt) / 3_600_000);
  const recencyScore = Math.max(0, 28 - ageHours * 1.15);
  const sourceScore = sourceWeight(story.source) * 2.3;
  const officialMediaBonus = sourceWeight(story.source) >= 10 ? 8 : 0;
  const crossSourceScore = Math.max(0, (story.sourceCount || 1) - 1) * 16;
  const rankScore = Math.max(0, 7 - (story.feedRank || 0) * 0.35);
  const raw = 18 + recencyScore + sourceScore + officialMediaBonus + crossSourceScore + trendBoost + rankScore;
  return Math.min(99, Math.max(20, Math.round(raw)));
}

function heatLabel(score) {
  if (score >= 90) return '爆';
  if (score >= 75) return '热';
  if (score >= 60) return '升';
  return '新';
}

async function fetchSource(feed) {
  let lastError;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(feed.url, {
        headers: {
          'User-Agent': 'UAEHotNews/1.0 (+local news reader; contact: local-preview)',
          Accept: feed.type === 'html'
            ? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1'
            : 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
          'Accept-Language': 'en-US,en;q=0.8,ar;q=0.6,zh-CN;q=0.5'
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });

      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.doNotRetry = response.status >= 400 && response.status < 500;
        throw error;
      }

      const contentType = response.headers.get('content-type') || '';
      const charsetMatch = contentType.match(/charset=([^;\s]+)/i);
      const declaredCharset = charsetMatch?.[1]?.toLowerCase() || 'utf-8';
      const charset = /iso-8859-1|latin1/.test(declaredCharset) ? 'windows-1252' : declaredCharset;
      const bytes = Buffer.from(await response.arrayBuffer());
      let sourceContent;
      try {
        sourceContent = new TextDecoder(charset).decode(bytes);
      } catch {
        sourceContent = new TextDecoder('utf-8').decode(bytes);
      }

      if (feed.type === 'html') {
        if (!/<html\b/i.test(sourceContent) || !/class="hl(?:\s[^"]*)?"/i.test(sourceContent)) {
          const error = new Error('返回页面中未找到 NewsNow 新闻列表');
          error.doNotRetry = true;
          throw error;
        }
      } else if (!/<(?:rss|feed)\b/i.test(sourceContent)) {
        const error = new Error('返回内容不是 RSS/Atom');
        error.doNotRetry = true;
        throw error;
      }

      return sourceContent;
    } catch (error) {
      lastError = error;
      if (attempt === 0 && !error?.doNotRetry) await delay(800);
      else break;
    }
  }

  throw lastError;
}

async function readCache() {
  if (memoryCache) return memoryCache;
  try {
    memoryCache = JSON.parse(await readFile(CACHE_FILE, 'utf8'));
    return memoryCache;
  } catch {
    memoryCache = emptyCache();
    return memoryCache;
  }
}

async function saveCache(cache) {
  memoryCache = cache;
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

function isCacheFresh(cache) {
  return Boolean(cache.updatedAt) && Date.now() - Date.parse(cache.updatedAt) < CACHE_TTL_MS;
}

async function refreshNews() {
  const previous = await readCache();
  const next = {
    version: 3,
    updatedAt: new Date().toISOString(),
    itemsBySource: { ...previous.itemsBySource },
    sources: { ...previous.sources }
  };

  for (const [index, feed] of FEEDS.entries()) {
    if (index > 0) await delay(REQUEST_GAP_MS);
    const previousItems = Array.isArray(previous.itemsBySource[feed.id]) ? previous.itemsBySource[feed.id] : [];
    const previousSource = previous.sources[feed.id] || {};

    try {
      const sourceContent = await fetchSource(feed);
      const fetchedAt = new Date().toISOString();
      const items = parseSourceItems(sourceContent, feed, fetchedAt);

      next.itemsBySource[feed.id] = items;
      next.sources[feed.id] = {
        id: feed.id,
        name: feed.name,
        home: feed.home,
        url: feed.url,
        note: feed.note || null,
        discovery: feed.discovery || '官方 RSS',
        ok: true,
        stale: false,
        error: null,
        itemCount: items.length,
        lastSuccessAt: fetchedAt
      };
    } catch (error) {
      next.itemsBySource[feed.id] = previousItems;
      next.sources[feed.id] = {
        ...previousSource,
        id: feed.id,
        name: feed.name,
        home: feed.home,
        url: feed.url,
        note: feed.note || null,
        discovery: feed.discovery || '官方 RSS',
        ok: false,
        stale: previousItems.length > 0,
        error: error?.name === 'TimeoutError' ? `请求超时（${FETCH_TIMEOUT_MS / 1000} 秒）` : (error?.message || '未知错误'),
        itemCount: previousItems.length
      };
    }
  }

  await saveCache(next);
  return next;
}

async function getNews({ force = false } = {}) {
  const cache = await readCache();
  if (!force && isCacheFresh(cache)) return cache;
  if (!refreshPromise) refreshPromise = refreshNews().finally(() => { refreshPromise = null; });
  return refreshPromise;
}
async function readTranslationCache() {
  if (memoryTranslationCache) return memoryTranslationCache;
  try {
    const parsed = JSON.parse(await readFile(TRANSLATION_CACHE_FILE, 'utf8'));
    memoryTranslationCache = {
      version: 1,
      updatedAt: parsed.updatedAt || null,
      entries: parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {}
    };
  } catch {
    memoryTranslationCache = emptyTranslationCache();
  }
  return memoryTranslationCache;
}

async function saveTranslationCache(cache) {
  memoryTranslationCache = cache;
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(TRANSLATION_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

function translationKey(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 24);
}

function detectSourceLanguage(text) {
  return /[\u0600-\u06ff]/.test(text) ? 'ar' : 'en';
}

function isAlreadyChinese(text) {
  return /[\u3400-\u9fff]/.test(text);
}

async function requestTranslation(text) {
  const sourceLanguage = detectSourceLanguage(text);
  const endpoint = new URL('https://api.mymemory.translated.net/get');
  endpoint.searchParams.set('q', text);
  endpoint.searchParams.set('langpair', `${sourceLanguage}|zh-CN`);

  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          'User-Agent': 'UAEHotNews/1.0 (+local title translator)',
          Accept: 'application/json'
        },
        signal: AbortSignal.timeout(TRANSLATION_TIMEOUT_MS)
      });
      if (!response.ok) {
        const error = new Error(`翻译接口 HTTP ${response.status}`);
        error.doNotRetry = response.status >= 400 && response.status < 500;
        throw error;
      }

      const payload = await response.json();
      const translatedText = cleanText(payload?.responseData?.translatedText || '');
      if (!translatedText || /MYMEMORY WARNING|NO QUERY SPECIFIED|INVALID/i.test(translatedText)) {
        const error = new Error('翻译接口未返回有效结果');
        error.doNotRetry = true;
        throw error;
      }

      return {
        sourceText: text,
        translatedText,
        sourceLanguage,
        provider: TRANSLATION_PROVIDER,
        translatedAt: new Date().toISOString()
      };
    } catch (error) {
      lastError = error;
      if (attempt === 0 && !error?.doNotRetry) await delay(700);
      else break;
    }
  }
  throw lastError;
}

async function translateItems(items) {
  const cache = await readTranslationCache();
  const targets = items.slice(0, MAX_TRANSLATIONS_PER_REQUEST);
  let cursor = 0;
  let changed = false;

  const worker = async () => {
    while (cursor < targets.length) {
      const index = cursor;
      cursor += 1;
      const item = targets[index];
      const key = translationKey(item.title);
      if (cache.entries[key] || isAlreadyChinese(item.title)) continue;
      try {
        cache.entries[key] = await requestTranslation(item.title);
        changed = true;
      } catch (error) {
        console.warn(`[translation] 跳过失败标题：“${item.title}”：${error?.message || '未知错误'}`);
      }
      await delay(150);
    }
  };

  await Promise.all(Array.from({ length: TRANSLATION_CONCURRENCY }, () => worker()));

  if (changed) {
    cache.updatedAt = new Date().toISOString();
    const keys = Object.keys(cache.entries);
    if (keys.length > 4000) {
      for (const key of keys.slice(0, keys.length - 4000)) delete cache.entries[key];
    }
    try {
      await saveTranslationCache(cache);
    } catch (error) {
      console.warn('[translation] 翻译缓存写入失败:', error?.message || error);
    }
  }

  return items.map((item) => {
    const key = translationKey(item.title);
    const entry = cache.entries[key];
    const nativeChinese = isAlreadyChinese(item.title);
    return {
      ...item,
      originalTitle: item.title,
      translatedTitle: nativeChinese ? item.title : (entry?.translatedText || item.title),
      translationStatus: nativeChinese ? 'native' : (entry ? 'translated' : 'unavailable'),
      translationProvider: nativeChinese ? null : (entry?.provider || null)
    };
  });
}

function emptyHistory() {
  return { version: 1, updatedAt: null, days: {} };
}

async function readHistory() {
  if (memoryHistoryCache) return memoryHistoryCache;
  try {
    const parsed = JSON.parse(await readFile(HISTORY_FILE, 'utf8'));
    memoryHistoryCache = {
      version: 1,
      updatedAt: parsed.updatedAt || null,
      days: parsed.days && typeof parsed.days === 'object' ? parsed.days : {}
    };
  } catch {
    memoryHistoryCache = emptyHistory();
  }
  return memoryHistoryCache;
}

async function saveHistory(history) {
  memoryHistoryCache = history;
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
}

function dubaiDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function historyItem(item, index) {
  return {
    rank: index + 1,
    translatedTitle: item.translatedTitle,
    originalTitle: item.originalTitle,
    url: item.url,
    source: item.source,
    sources: item.sources || [item.source],
    heatScore: item.heatScore,
    publishedAt: item.publishedAt
  };
}

async function updateDailyHistory(items, categories) {
  const history = await readHistory();
  const date = dubaiDateKey();
  const categorySnapshots = {};

  for (const category of categories) {
    const categoryItems = category.id === 'all'
      ? items
      : items.filter((item) => item.categoryIds.includes(category.id));
    categorySnapshots[category.id] = categoryItems.slice(0, 10).map(historyItem);
  }

  history.updatedAt = new Date().toISOString();
  history.days[date] = { date, updatedAt: history.updatedAt, categories: categorySnapshots };
  const dayKeys = Object.keys(history.days).sort().reverse();

  try {
    await saveHistory(history);
  } catch (error) {
    console.warn('[history] 历史记录写入失败:', error?.message || error);
  }

  return {
    date,
    totalDays: dayKeys.length,
    recentDays: dayKeys.map((day) => history.days[day])
  };
}
function enrichStore(cache) {
  const newsItems = Object.values(cache.itemsBySource)
    .flat()
    .filter((item) => item?.type !== 'trend' && item?.title && item?.url);
  const trendItems = cache.itemsBySource['google-trends-uae'] || [];
  const now = Date.now();
  const scoredStories = dedupeStories(newsItems).map((story) => {
    const classification = classifyStory(story.title, story.categoryHint, story.sources.join(' '));
    const trendBoost = trendBoostForTitle(story.title, trendItems);
    const categoryIds = [...classification.categoryIds];
    if (trendBoost > 0 && !categoryIds.includes('social')) categoryIds.push('social');
    const rawHeatScore = calculateHeatScore(story, now, trendBoost);
    const mediaWeight = sourceWeight(story.source);
    return { ...story, ...classification, categoryIds, trendBoost, rawHeatScore, sourceTier: mediaWeight >= 10 ? 'mainstream' : 'other' };
  });

  const rawScores = scoredStories.map((story) => story.rawHeatScore);
  const minimumRaw = rawScores.length ? Math.min(...rawScores) : 0;
  const maximumRaw = rawScores.length ? Math.max(...rawScores) : 100;

  return scoredStories
    .map((story) => {
      const relative = maximumRaw === minimumRaw
        ? 1
        : (story.rawHeatScore - minimumRaw) / (maximumRaw - minimumRaw);
      const heatScore = Math.min(99, Math.round(42 + relative * 57));
      return { ...story, heatScore, heatLabel: heatLabel(heatScore) };
    })
    .sort((left, right) => right.heatScore - left.heatScore || sourceWeight(right.source) - sourceWeight(left.source) || compareByPublishedAt(left, right))
    .slice(0, MAX_TOTAL_ITEMS)
    .map((story, index) => ({ ...story, heatRank: index + 1 }));
}

async function apiPayload(cache) {
  const rankedStories = enrichStore(cache);
  const translatedItems = await translateItems(rankedStories);
  const translatedCount = translatedItems.filter((item) => item.translationStatus === 'translated' || item.translationStatus === 'native').length;
  const history = await updateDailyHistory(translatedItems, CATEGORY_DEFINITIONS.map((category) => ({
    ...category,
    count: category.id === 'all' ? translatedItems.length : translatedItems.filter((item) => item.categoryIds.includes(category.id)).length
  })));
  const categories = CATEGORY_DEFINITIONS.map((category) => ({
    ...category,
    count: category.id === 'all'
      ? translatedItems.length
      : translatedItems.filter((item) => item.categoryIds.includes(category.id)).length
  }));

  return {
    updatedAt: cache.updatedAt,
    cacheTtlMinutes: CACHE_TTL_MS / 60_000,
    heatMethod: '主流媒体权重、多源报道数、24 小时时效、Google Trends UAE 和社交传播信号加权的相对热度指数',
    translation: {
      provider: TRANSLATION_PROVIDER,
      targetLanguage: 'zh-CN',
      translatedCount,
      unavailableCount: translatedItems.length - translatedCount
    },
    categories,
    history,
    items: translatedItems,
    sources: FEEDS.map((feed) => cache.sources[feed.id] || {
      id: feed.id,
      name: feed.name,
      home: feed.home,
      url: feed.url,
      note: feed.note || null,
      discovery: feed.discovery || '官方 RSS',
      ok: null,
      stale: false,
      error: null,
      itemCount: 0,
      lastSuccessAt: null
    })
  };
}
function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
  });
  response.end(body);
}

const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
});

async function serveStatic(request, response, pathname) {
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const candidate = path.resolve(PUBLIC_DIR, relativePath);
  if (candidate !== PUBLIC_DIR && !candidate.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    sendJson(response, 403, { error: '禁止访问该路径' });
    return;
  }

  try {
    const fileStat = await stat(candidate);
    if (!fileStat.isFile()) throw new Error('不是文件');
    const extension = path.extname(candidate).toLowerCase();
    const content = await readFile(candidate);
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
      'Content-Length': content.length,
      'Cache-Control': ['.html', '.js', '.css'].includes(extension) ? 'no-cache, no-store, must-revalidate' : 'public, max-age=86400',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'",
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Content-Type-Options': 'nosniff',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
    });
    response.end(content);
  } catch {
    sendJson(response, 404, { error: '页面不存在' });
  }
}

export async function buildNewsPayload({ force = false } = {}) {
  const cache = await getNews({ force });
  return apiPayload(cache);
}
export async function handleRequest(request, response) {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (requestUrl.pathname === '/api/news') {
    try {
      const force = requestUrl.searchParams.get('refresh') === '1';
      sendJson(response, 200, await buildNewsPayload({ force }));
    } catch (error) {
      sendJson(response, 502, { error: error?.message || '新闻抓取失败' });
    }
    return;
  }
  if (requestUrl.pathname === '/api/health') {
    sendJson(response, 200, { ok: true });
    return;
  }
  await serveStatic(request, response, requestUrl.pathname);
}

export function createServer() {
  return http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      console.error('[server] 未处理错误:', error);
      if (!response.headersSent) sendJson(response, 500, { error: '服务器内部错误' });
      else response.end();
    });
  });
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMainModule) {
  const server = createServer();
  server.listen(PORT, HOST, () => {
    console.log(`阿联酋新闻热点已启动：http://localhost:${PORT}`);
    console.log('打开页面会自动刷新，页面内刷新按钮会强制重新抓取。');
  });
}



















