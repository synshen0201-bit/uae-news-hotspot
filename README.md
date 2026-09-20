# 阿联酋新闻热点 · 中文简报

这是一个移动端优先的单页新闻聚合应用，展示与阿联酋相关的新闻标题、发布时间、来源、中文译文和原文链接。当前阶段只读取 RSS/页面列表元数据，不抓取文章正文，也不包含分类标签、领导人社交媒体、周报和 PWA 安装功能。

## 当前数据源

| 来源 | 公开 RSS | 筛选方式 | 实测状态 |
| --- | --- | --- | --- |
| BBC News | `https://feeds.bbci.co.uk/news/world/middle_east/rss.xml` | 标题和 RSS 短摘要中的阿联酋关键词 | 可访问 |
| Al Jazeera | `https://www.aljazeera.com/xml/rss/all.xml` | 标题和 RSS 短摘要中的阿联酋关键词 | 可访问 |
| Sky News | `https://feeds.skynews.com/feeds/rss/world.xml` | 标题和 RSS 短摘要中的阿联酋关键词 | 可访问 |
| The Guardian | `https://www.theguardian.com/world/rss` | 标题和 RSS 短摘要中的阿联酋关键词 | 可访问 |
| Arab News | `https://www.arabnews.com/rss.xml` | 标题和 RSS 短摘要中的阿联酋关键词 | 可访问 |
| Reuters | Google News RSS 的 `site:reuters.com` 检索 | 检索词限定 UAE、Dubai、Abu Dhabi 等 | 可用 |
| NewsNow | https://www.newsnow.co.uk/h/World+News/Middle+East/United+Arab+Emirates | 公开 UAE 聚合页的标题、来源和时间 | 可用 |
| Khaleej Times | `https://www.khaleejtimes.com/api/v1/collections/uae.rss` | 官方 UAE 栏目 | 可访问 |

Reuters 官方 RSS 的旧域名已经失效，官网 RSS 路径本身实测返回 404。因此本项目不硬闯 Reuters 网页，也不模拟登录；Reuters 内容明确标注为通过 Google News RSS 检索，点击后跳转至 Reuters 原文。`NewsNow` 的 robots.txt 未禁止本项目使用的 UAE 页面路径，页面也无需登录或验证码；应用只读取标题、来源、时间和跳转链接，不进入文章正文，原文链接通过 NewsNow 跳转。

## 标题翻译

- 使用无需密钥的 MyMemory 免费翻译接口，目标语言为简体中文。
- 根据标题字符自动选择英语或阿拉伯语作为源语言。
- 译文按原标题哈希缓存到 `.cache/translations.json`，同一标题不会重复请求。
- 翻译使用 3 个并发工作线程，每次请求之间有间隔；接口不可用或限流时，该标题暂显示原文，不会导致整个页面失败。
- RSS 中的短摘要只用于阿联酋相关性判断，不保存、不返回、不显示。
- 应用从不请求文章正文页面。

免费翻译接口可能存在每日配额或临时限流，机器翻译也可能存在偏差。

## 本地运行

需要 Node.js 20 或更高版本。

```powershell
cd D:\ai
node server.mjs
```

浏览器打开：

```text
http://localhost:3000
```

修改端口：

```powershell
$env:PORT=8080
node server.mjs
```

手机浏览器预览时，确保手机和电脑连接同一个 Wi-Fi，然后访问 `http://电脑局域网IP:3000`。Windows 防火墙如果弹出提示，只允许“专用网络”访问即可。

## 运行测试

```powershell
node --test
```

## 失败处理

- 请求设置明确的 User-Agent、Accept、12 秒超时和有限重试。
- RSS 源串行请求，间隔 500 毫秒。
- 403、404、429 等 4xx 响应不反复重试。
- 单个源失败时保留该源上一次成功缓存，并继续展示其它来源。
- 新闻缓存有效期为 10 分钟；点击页面的“刷新内容”可主动更新。
- 页面顶部会逐源显示正常、暂无匹配、缓存降级或不可用状态。


