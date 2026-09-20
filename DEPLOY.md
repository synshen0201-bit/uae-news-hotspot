# 部署到 GitHub Pages

部署后，手机访问 GitHub Pages 的网址即可，电脑关机或本机服务停止都不影响。

## 已经完成

- 静态数据文件：`public/data/latest.json`
- 历史数据文件：`public/data/history.json`
- 云端定时任务：`.github/workflows/update-news.yml`
- 页面会自动识别 GitHub Pages，并读取静态 JSON。
- GitHub Actions 每 15 分钟抓取新闻、翻译标题并更新历史 Top 10。

## 你需要做的步骤

1. 登录 GitHub，新建一个仓库，例如 `uae-news`。建议设为 Public。
2. 回到 `D:\ai`，执行：

```powershell
git init -b main
git config user.name "你的 GitHub 用户名"
git config user.email "你的 GitHub 邮箱"
git add .
git commit -m "Deploy UAE news site"
git remote add origin https://github.com/你的用户名/uae-news.git
git push -u origin main
```

3. 打开 GitHub 仓库的 `Settings` → `Pages`。
4. 在 `Build and deployment` 中将 `Source` 设为 `GitHub Actions`。
5. 打开仓库的 `Actions` 页面，等待 `Update news and deploy` 首次运行成功。
6. Pages 地址通常是：

```text
https://你的用户名.github.io/uae-news/
```

## 后续更新

- GitHub Actions 自动每 15 分钟运行一次。
- 新闻数据会提交到 `public/data/latest.json`。
- 历史记录会提交到 `public/data/history.json`。
- 电脑关机不影响云端任务和手机访问。

## 说明

GitHub Actions 的定时任务可能有几分钟排队延迟，免费账户通常可以正常使用。若仓库为 Private，请先确认账户套餐允许 GitHub Pages 和 Actions。
