/** 起一个临时 World，用无头 Edge + CDP 截一张壁纸页预览（等视频真的播起来）。 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS } from '../src/definition.ts';
import { FishHouseWorld } from '../src/world.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(join(tmpdir(), 'fishhouse-preview-'));
const cfg = { ...DEFAULTS, port: 48356 };
const world = new FishHouseWorld({
  id: 'fish-house', cfg, timezone: 'Asia/Shanghai', botName: 'preview', botDir: root, packageDir: root, dataDir, repoRoot: root,
  secret: () => '', storeSecret: () => {}, persist: () => {}, restart: async () => {},
});
const edge = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((file) => existsSync(file));
const out = join(root, 'preview-wallpaper.png');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let child = null;
try {
  await world.start({ log: { info() {}, warn: console.warn, error: console.error } });
  const status = await world.invoke('main', 'status');
  if (!edge) throw new Error('Edge not found');
  const profile = join(dataDir, 'edge-profile');
  child = spawn(edge, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=1280,720', '--remote-debugging-port=9333',
    '--user-data-dir=' + profile, status.url,
  ], { stdio: 'ignore' });
  let target = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(250);
    try {
      const list = await (await fetch('http://127.0.0.1:9333/json')).json();
      target = list.find((item) => item.type === 'page' && String(item.url).startsWith('http://127.0.0.1:'));
      if (target) break;
    } catch { /* 还没起来 */ }
  }
  if (!target) throw new Error('CDP target not found');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
    setTimeout(() => reject(new Error('cdp connect timeout')), 5000);
  });
  let nextId = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send('Page.enable');
  await send('Runtime.enable');
  // 等主题视频真的进到 playing 状态（最多 12 秒）。
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await sleep(500);
    const result = await send('Runtime.evaluate', {
      expression: "(() => { const v = document.querySelector('video:not([src=\"\"])'); return v ? { paused: v.paused, time: v.currentTime, ready: v.readyState, src: v.currentSrc } : null; })()",
      returnByValue: true,
    });
    const value = result.result && result.result.result && result.result.result.value;
    if (value && !value.paused && value.time > 0.2) break;
  }
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  const state = await (await fetch(status.url + 'state.json')).json();
  console.log('screenshot', out, 'node', state.node_id, 'video', state.node_video);
  ws.close();
} finally {
  if (child) {
    try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
  }
  await world.stop();
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch {
    /* Edge 退出慢时临时目录可能还锁着，留给系统清理 */
  }
}
