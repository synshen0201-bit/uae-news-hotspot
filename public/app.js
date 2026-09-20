const categoryList = document.querySelector('#category-list');
const sourceList = document.querySelector('#source-list');
const historyList = document.querySelector('#history-list');
const sourceSummary = document.querySelector('#source-summary');
const refreshButton = document.querySelector('#refresh-button');
const updatedAt = document.querySelector('#updated-at');
const translationSummary = document.querySelector('#translation-summary');
const heatMethod = document.querySelector('#heat-method');
const newsList = document.querySelector('#news-list');
const newsCount = document.querySelector('#news-count');
const rankingKicker = document.querySelector('#ranking-kicker');
const rankingTitle = document.querySelector('#ranking-title');
const rankingDescription = document.querySelector('#ranking-description');
const loadMoreButton = document.querySelector('#load-more-button');

const PAGE_SIZE = 15;
const urlParams = new URLSearchParams(window.location.search);
const isLocalPreview = /^(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(window.location.hostname);
const staticMode = urlParams.get('static') === '1' || !isLocalPreview;
const staticDataUrl = new URL('./data/latest.json', document.baseURI).toString();
const categoryKickers = {
  all: 'COMPREHENSIVE',
  domestic: 'DOMESTIC',
  diplomacy: 'DIPLOMACY',
  economy: 'ECONOMY',
  technology: 'TECHNOLOGY',
  military: 'MILITARY',
  social: 'SOCIAL TREND',
  china: 'CHINA-RELATED'
};
const categoryMarks = { all: '全', domestic: '内', diplomacy: '外', economy: '经', technology: '科', military: '军', social: '社', china: '华' };

const dubaiDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Dubai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
});
const dubaiTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', hour12: false
});
let state = { payload: null, activeCategory: 'all', visibleCount: PAGE_SIZE, loading: false, lastLoadedAt: 0 };

function formatPublishedAt(value) {
  if (!value) return '时间未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  const ageMinutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (ageMinutes < 60) return `${Math.max(1, ageMinutes)} 分钟前`;
  if (ageMinutes < 24 * 60) return dubaiTimeFormatter.format(date);
  return dubaiDateFormatter.format(date);
}

function formatUpdatedAt(value) {
  if (!value) return '尚未更新';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '更新时间未知' : `更新于 ${dubaiTimeFormatter.format(date)}`;
}

function getActiveCategory() {
  return state.payload?.categories?.find((category) => category.id === state.activeCategory) || {
    id: 'all', label: '综合热榜', description: '跨分类按多源热度指数排序', count: 0
  };
}

function getFilteredItems() {
  const items = state.payload?.items || [];
  if (state.activeCategory === 'all') return items;
  return items.filter((item) => (item.categoryIds || [item.primaryCategoryId]).includes(state.activeCategory));
}

function renderCategories() {
  const categories = state.payload?.categories || [{ id: 'all', label: '综合热榜', count: 0 }];
  categoryList.replaceChildren();
  const fragment = document.createDocumentFragment();

  for (const category of categories) {
    const button = document.createElement('button');
    const mark = document.createElement('span');
    const label = document.createElement('span');
    const count = document.createElement('strong');

    button.type = 'button';
    button.className = 'category-button';
    button.dataset.category = category.id;
    button.classList.toggle('is-active', category.id === state.activeCategory);
    mark.className = 'category-button__mark';
    mark.textContent = categoryMarks[category.id] || '·';
    label.className = 'category-button__label';
    label.textContent = category.label;
    count.textContent = String(category.count || 0);
    button.append(mark, label, count);
    button.addEventListener('click', () => {
      state.activeCategory = category.id;
      state.visibleCount = PAGE_SIZE;
      renderCategories();
      renderRanking();
    });
    fragment.append(button);
  }

  categoryList.append(fragment);
}

function formatHistoryDate(value) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date());
  const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date(Date.now() - 86400000));
  if (value === today) return '今天';
  if (value === yesterday) return '昨天';
  const date = new Date(`${value}T12:00:00+04:00`);
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Dubai', month: 'long', day: 'numeric' }).format(date);
}

function renderHistory() {
  if (!historyList) return;
  const days = state.payload?.history?.recentDays || [];
  historyList.replaceChildren();

  if (!days.length) {
    const empty = document.createElement('p');
    empty.className = 'history-loading';
    empty.textContent = '今天完成首次刷新后会生成历史 Top 10。';
    historyList.append(empty);
    return;
  }

  const categoryLabels = Object.fromEntries((state.payload?.categories || []).map((category) => [category.id, category.label]));
  const fragment = document.createDocumentFragment();

  for (const [dayIndex, day] of days.entries()) {
    const dayDetails = document.createElement('details');
    const daySummary = document.createElement('summary');
    const dayLabel = document.createElement('span');
    const dayMeta = document.createElement('small');
    const categoryBox = document.createElement('div');

    dayDetails.className = 'history-day';
    dayDetails.open = dayIndex === 0 && window.matchMedia('(min-width: 901px)').matches;
    dayLabel.textContent = formatHistoryDate(day.date);
    dayMeta.textContent = day.date;
    daySummary.append(dayLabel, dayMeta);
    categoryBox.className = 'history-categories';

    for (const categoryId of ['all', 'domestic', 'diplomacy', 'economy', 'technology', 'military', 'social', 'china']) {
      const entries = day.categories?.[categoryId] || [];
      if (!entries.length) continue;
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      const label = document.createElement('span');
      const count = document.createElement('small');
      const list = document.createElement('ol');

      details.className = 'history-category';
      label.textContent = categoryLabels[categoryId] || categoryId;
      count.textContent = `${entries.length} 条`;
      summary.append(label, count);
      list.className = 'history-rank-list';

      for (const entry of entries) {
        const item = document.createElement('li');
        const link = document.createElement('a');
        const score = document.createElement('span');
        link.href = entry.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = entry.translatedTitle || entry.originalTitle;
        score.textContent = String(entry.heatScore || '');
        item.append(link, score);
        list.append(item);
      }

      details.append(summary, list);
      categoryBox.append(details);
    }

    dayDetails.append(daySummary, categoryBox);
    fragment.append(dayDetails);
  }

  historyList.append(fragment);
}
function renderSources() {
  const sources = state.payload?.sources || [];
  const available = sources.filter((source) => source.ok).length;
  const failed = sources.filter((source) => source.ok === false).length;
  sourceSummary.textContent = failed ? `${available} 正常 · ${failed} 降级` : `${available} 个正常`;

  sourceList.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const source of sources) {
    const item = document.createElement('li');
    const dot = document.createElement('span');
    const name = document.createElement('strong');
    const detail = document.createElement('small');

    item.className = 'source-item';
    dot.className = 'source-item__dot';
    name.textContent = source.name;
    if (source.ok === null) {
      detail.textContent = '等待更新';
      item.classList.add('source-item--pending');
    } else if (source.ok) {
      detail.textContent = source.id === 'google-trends-uae' ? `${source.itemCount} 个热词` : `${source.itemCount} 条`;
      item.classList.add('source-item--ok');
    } else {
      detail.textContent = source.stale ? `缓存 ${source.itemCount} 条` : '暂不可用';
      item.classList.add('source-item--error');
      item.title = source.error || '数据源不可用';
    }
    item.append(dot, name, detail);
    fragment.append(item);
  }
  sourceList.append(fragment);
}

function renderRankingHeader() {
  const category = getActiveCategory();
  const filtered = getFilteredItems();
  rankingKicker.textContent = categoryKickers[category.id] || 'RANKING';
  rankingTitle.textContent = category.label;
  rankingDescription.textContent = category.description || '按多源热度指数排序';
  newsCount.textContent = String(filtered.length);
}

function createSourceTags(item) {
  const wrapper = document.createElement('div');
  wrapper.className = 'story-sources';
  const sources = [...new Set(item.sources || [item.source])].filter(Boolean).slice(0, 3);
  for (const source of sources) {
    const tag = document.createElement('span');
    tag.textContent = source;
    wrapper.append(tag);
  }
  if ((item.sourceCount || sources.length) > sources.length) {
    const more = document.createElement('span');
    more.className = 'story-sources__more';
    more.textContent = `+${(item.sourceCount || sources.length) - sources.length}`;
    wrapper.append(more);
  }
  return wrapper;
}

function createVerificationLink(item) {
  const link = document.createElement('a');
  const label = document.createElement('span');
  const arrow = document.createElement('span');
  link.className = 'verify-link';
  link.href = item.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  label.textContent = '核实原文';
  arrow.textContent = '↗';
  arrow.setAttribute('aria-hidden', 'true');
  link.append(label, arrow);
  return link;
}

function createStoryCard(item, displayRank) {
  const listItem = document.createElement('li');
  const card = document.createElement('article');
  const rank = document.createElement('div');
  const body = document.createElement('div');
  const topLine = document.createElement('div');
  const categoryTag = document.createElement('span');
  const heatBadge = document.createElement('span');
  const title = document.createElement('a');
  const originalTitle = document.createElement('p');
  const footer = document.createElement('div');
  const meta = document.createElement('div');
  const time = document.createElement('time');
  const heatBar = document.createElement('div');
  const heatFill = document.createElement('span');

  listItem.className = 'story-item';
  card.className = 'story-card';
  rank.className = 'story-rank';
  rank.textContent = String(displayRank).padStart(2, '0');
  body.className = 'story-body';
  topLine.className = 'story-topline';
  categoryTag.className = 'story-category';
  heatBadge.className = 'heat-badge';
  title.className = 'story-title';
  originalTitle.className = 'story-original';
  footer.className = 'story-footer';
  meta.className = 'story-meta';
  heatBar.className = 'heat-bar';
  heatFill.className = 'heat-bar__fill';

  const category = state.payload?.categories?.find((entry) => entry.id === item.primaryCategoryId);
  categoryTag.textContent = item.chinaRelated && item.primaryCategoryId !== 'china'
    ? `${category?.label || '新闻'} · 涉华`
    : (category?.label || '新闻');
  heatBadge.textContent = `${item.heatLabel || '新'} ${item.heatScore || 0}`;
  title.href = item.url;
  title.target = '_blank';
  title.rel = 'noopener noreferrer';
  title.textContent = item.translatedTitle || item.originalTitle || item.title;

  if (item.originalTitle && item.originalTitle !== title.textContent) {
    originalTitle.textContent = `原题：${item.originalTitle}`;
  }
  const topLineTags = [categoryTag];
  if (item.sourceTier === 'mainstream') {
    const authorityTag = document.createElement('span');
    authorityTag.className = 'authority-tag';
    authorityTag.textContent = '权威媒体';
    topLineTags.push(authorityTag);
  }
  if (item.trendBoost > 0) {
    const trendTag = document.createElement('span');
    trendTag.className = 'trend-tag';
    trendTag.textContent = '趋势词命中';
    topLineTags.push(trendTag);
  }
  topLine.append(...topLineTags, heatBadge);

  time.textContent = formatPublishedAt(item.publishedAt);
  if (item.publishedAt) time.dateTime = item.publishedAt;
  meta.append(createSourceTags(item), time);
  footer.append(meta, createVerificationLink(item));
  heatFill.style.width = `${Math.min(100, Math.max(12, item.heatScore || 0))}%`;
  heatBar.append(heatFill);
  body.append(topLine, title);
  if (originalTitle.textContent) body.append(originalTitle);
  body.append(footer, heatBar);
  card.append(rank, body);
  listItem.append(card);
  return listItem;
}

function createEmptyState(titleText, detailText) {
  const item = document.createElement('li');
  const mark = document.createElement('span');
  const title = document.createElement('strong');
  const detail = document.createElement('small');
  item.className = 'empty-state';
  mark.className = 'empty-state__mark';
  mark.textContent = '0';
  title.textContent = titleText;
  detail.textContent = detailText;
  item.append(mark, title, detail);
  return item;
}

function renderRanking() {
  const filtered = getFilteredItems();
  const visible = filtered.slice(0, state.visibleCount);
  newsList.setAttribute('aria-busy', 'false');
  newsList.replaceChildren();
  renderRankingHeader();

  if (!visible.length) {
    newsList.append(createEmptyState('这个分类暂时没有匹配新闻', '下次刷新或查看其它分类'));
  } else {
    const fragment = document.createDocumentFragment();
    visible.forEach((item, index) => fragment.append(createStoryCard(item, index + 1)));
    newsList.append(fragment);
  }

  const hasMore = filtered.length > visible.length;
  loadMoreButton.hidden = !hasMore;
  loadMoreButton.textContent = hasMore ? `显示更多（剩余 ${filtered.length - visible.length} 条）` : '';
}

function renderLoading() {
  newsList.setAttribute('aria-busy', 'true');
  newsList.replaceChildren();
  const item = document.createElement('li');
  const title = document.createElement('strong');
  const detail = document.createElement('small');
  item.className = 'loading-state';
  title.textContent = '正在抓取最新新闻';
  detail.textContent = '合并来源、计算当日热度和翻译标题需要一点时间…';
  item.append(title, detail);
  newsList.append(item);
}

function renderTranslation(payload) {
  const translation = payload.translation || {};
  const total = payload.items?.length || 0;
  const translated = translation.translatedCount || 0;
  translationSummary.textContent = total
    ? `中文标题 ${translated}/${total} · ${translation.provider || '翻译服务'}`
    : '暂无新闻';
  heatMethod.textContent = payload.heatMethod || '同题媒体数、来源权重、时效与趋势词加权';
}

function applyPayload(payload) {
  state.payload = payload;
  state.lastLoadedAt = Date.now();
  const categoryExists = payload.categories?.some((category) => category.id === state.activeCategory);
  if (!categoryExists) state.activeCategory = 'all';
  updatedAt.textContent = formatUpdatedAt(payload.updatedAt);
  renderCategories();
  renderHistory();
  renderSources();
  renderTranslation(payload);
  renderRanking();
}

async function loadNews({ force = false, silent = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  refreshButton.disabled = true;
  refreshButton.classList.add('is-loading');
  if (!silent || !state.payload) {
    updatedAt.textContent = force ? '正在重新抓取…' : '正在加载…';
    renderLoading();
  }

  try {
    const endpoint = staticMode
      ? `${staticDataUrl}?t=${Date.now()}`
      : (force ? '/api/news?refresh=1' : '/api/news');
    const response = await fetch(endpoint, {
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      throw new Error(errorPayload.error || `HTTP ${response.status}`);
    }
    applyPayload(await response.json());
  } catch (error) {
    if (!state.payload) {
      newsList.replaceChildren(createEmptyState('暂时无法读取新闻', error?.message || '未知错误'));
      updatedAt.textContent = '加载失败';
    } else if (!silent) {
      updatedAt.textContent = '更新失败，继续显示上次结果';
    }
  } finally {
    state.loading = false;
    refreshButton.disabled = false;
    refreshButton.classList.remove('is-loading');
  }
}

refreshButton.addEventListener('click', () => loadNews({ force: true }));
loadMoreButton.addEventListener('click', () => {
  state.visibleCount += PAGE_SIZE;
  renderRanking();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (Date.now() - state.lastLoadedAt > 10 * 60 * 1000) loadNews({ force: true, silent: true });
});

setInterval(() => {
  if (document.visibilityState === 'visible') loadNews({ force: true, silent: true });
}, 10 * 60 * 1000);

loadNews({ force: true });







