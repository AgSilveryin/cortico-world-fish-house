import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const edge = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((file) => existsSync(file));
const url = process.env.PREVIEW_URL || 'http://127.0.0.1:47821/';
const out = join(process.cwd(), 'live-wallpaper.png');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = join(process.env.TEMP || '.', 'fishhouse-shot-' + Date.now());
const child = spawn(edge, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--window-size=1280,720', '--remote-debugging-port=9444', '--user-data-dir=' + profile, url], { stdio: 'ignore' });
try {
  let target = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(250);
    try {
      const list = await (await fetch('http://127.0.0.1:9444/json')).json();
      target = list.find((item) => item.type === 'page' && String(item.url).startsWith('http://127.0.0.1:47821'));
      if (target) break;
    } catch {}
  }
  if (!target) throw new Error('target not found');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
    setTimeout(() => reject(new Error('cdp timeout')), 5000);
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const next = ++id;
    pending.set(next, resolve);
    ws.send(JSON.stringify({ id: next, method, params }));
  });
  await send('Page.enable');
  await send('Runtime.enable');
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await sleep(500);
    const result = await send('Runtime.evaluate', { expression: "(() => { const v = document.querySelector('video:not([src=\"\"])'); return v ? { paused: v.paused, time: v.currentTime } : null; })()", returnByValue: true });
    const value = result.result?.result?.value;
    if (value && !value.paused && value.time > 0.3) break;
  }
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('saved', out);
  ws.close();
} finally {
  try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
}
