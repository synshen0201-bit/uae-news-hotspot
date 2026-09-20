import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNewsPayload } from '../server.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const cacheDir = path.join(rootDir, '.cache');
const dataDir = path.join(rootDir, 'public', 'data');
const cacheHistoryFile = path.join(cacheDir, 'history.json');
const publicHistoryFile = path.join(dataDir, 'history.json');
const latestFile = path.join(dataDir, 'latest.json');

await mkdir(cacheDir, { recursive: true });
await mkdir(dataDir, { recursive: true });

// GitHub Actions 每次运行前先恢复已提交的历史，确保每日 Top 10 连续累积。
try {
  const existingHistory = await readFile(publicHistoryFile, 'utf8');
  await writeFile(cacheHistoryFile, existingHistory, 'utf8');
} catch {
  // 首次运行时还没有历史文件，直接继续生成即可。
}

const payload = await buildNewsPayload({ force: true });
const output = {
  ...payload,
  generatedAt: new Date().toISOString(),
  deploymentMode: 'static'
};

await writeFile(latestFile, JSON.stringify(output, null, 2), 'utf8');
await writeFile(publicHistoryFile, JSON.stringify(payload.history, null, 2), 'utf8');

console.log(`已生成静态新闻数据：${output.items.length} 条，历史 ${output.history.totalDays} 天。`);
