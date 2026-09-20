import test from 'node:test';
import assert from 'node:assert/strict';
import { isUaeRelated, parseNewsNowItems, parseRssItems } from '../server.mjs';

const bbcFeed = {
  id: 'bbc-middle-east',
  name: 'BBC News',
  requireUaeMatch: true
};

test('识别标题中的阿联酋关键词', () => {
  assert.equal(isUaeRelated('Dubai announces a new transport plan'), true);
  assert.equal(isUaeRelated('الإمارات تعلن مبادرة جديدة'), true);
  assert.equal(isUaeRelated('Saudi Arabia hosts regional summit'), false);
});

test('只保留与阿联酋相关的 RSS 条目并解析基础字段', () => {
  const xml = `<?xml version="1.0"?>
    <rss version="2.0"><channel>
      <item>
        <title>UAE launches new technology programme</title>
        <link>https://example.com/uae-story?source=rss&amp;id=1</link>
        <pubDate>Sun, 20 Sep 2026 12:30:00 GMT</pubDate>
        <description><![CDATA[The programme is based in <b>Abu Dhabi</b>.]]></description>
      </item>
      <item>
        <title>Regional summit opens in Riyadh</title>
        <link>https://example.com/other-story</link>
        <pubDate>Sun, 20 Sep 2026 11:00:00 GMT</pubDate>
        <description>Leaders met in Saudi Arabia.</description>
      </item>
    </channel></rss>`;

  const items = parseRssItems(xml, bbcFeed, '2026-09-20T13:00:00.000Z');

  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'UAE launches new technology programme');
  assert.equal(items[0].url, 'https://example.com/uae-story?source=rss&id=1');
  assert.equal(items[0].source, 'BBC News');
  assert.equal(items[0].publishedAt, '2026-09-20T12:30:00.000Z');
  assert.equal('summary' in items[0], false);
});

test('专属阿联酋 feed 不需要再次做关键词过滤', () => {
  const xml = `<rss><channel><item>
    <title>Community event brings residents together</title>
    <link>https://example.com/local-event</link>
    <pubDate>Sun, 20 Sep 2026 10:00:00 GMT</pubDate>
  </item></channel></rss>`;

  const items = parseRssItems(xml, { id: 'khaleej-times', name: 'Khaleej Times', requireUaeMatch: false });
  assert.equal(items.length, 1);
});

test('清理 Google News 标题中的来源后缀', () => {
  const xml = `<rss><channel><item>
    <title>UAE energy company expands production - reuters.com</title>
    <link>https://news.google.com/rss/articles/example</link>
    <pubDate>Sun, 20 Sep 2026 09:00:00 GMT</pubDate>
  </item></channel></rss>`;

  const items = parseRssItems(xml, {
    id: 'reuters-google',
    name: 'Reuters',
    requireUaeMatch: false,
    titleCleanup: /\s+-\s+reuters\.com\s*$/i
  });

  assert.equal(items[0].title, 'UAE energy company expands production');
});

test('解析 NewsNow 公开 HTML 新闻列表', () => {
  const html = `
    <div class="hl " data-id="1324881556">
      <span class="f f_LB" c="LB"></span>
      <div class="hl__inner">
        <a class="hll" href="https://c.newsnow.co.uk/A/1324881556?-15565:1965" target="_blank" rel="nofollow">Dubai unveils new transport plan</a>
        <span class="meta"><span class="src src-part" data-pub="EXAMPLE">Example News<i class="fas fa-cog"></i></span><span class="time" data-time="1789914495">15:28</span></span>
        <span class="favtags"></span>
      </div>
    </div>`;

  const items = parseNewsNowItems(html, { id: 'newsnow-uae', name: 'NewsNow' });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Dubai unveils new transport plan');
  assert.equal(items[0].source, 'Example News');
  assert.equal(items[0].publishedAt, '2026-09-20T14:28:15.000Z');
});


