/** 用本机 Chromium 浏览器开一个无地址栏的壁纸窗口。 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
];

function fromEnv(): string[] {
  const out: string[] = [];
  const local = process.env.LOCALAPPDATA;
  if (local) {
    out.push(join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    out.push(join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    out.push(join(local, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'));
  }
  return out;
}

export function findBrowser(configured: string): string | null {
  const explicit = String(configured ?? '').trim();
  if (explicit && existsSync(explicit)) return explicit;
  for (const file of [...CANDIDATES, ...fromEnv()]) {
    if (existsSync(file)) return file;
  }
  return null;
}

export interface WallpaperWindow {
  pid: number | null;
  mode: 'app' | 'browser';
  browser: string;
}

export class WindowHost {
  private pid: number | null = null;
  private readonly profileDir: string;
  private readonly dataRoot: string;

  constructor(dataRoot: string) {
    this.dataRoot = dataRoot;
    this.profileDir = join(dataRoot, 'browser-profile');
  }

  get open(): boolean {
    if (!this.pid) return false;
    try {
      process.kill(this.pid, 0);
      return true;
    } catch {
      this.pid = null;
      return false;
    }
  }

  openWindow(url: string, opts: { fullscreen?: boolean; browserPath?: string } = {}): WallpaperWindow {
    if (this.open) this.close();
    const browser = findBrowser(opts.browserPath ?? '');
    if (!browser) {
      this.openInBrowser(url);
      return { pid: null, mode: 'browser', browser: '' };
    }
    mkdirSync(this.profileDir, { recursive: true });
    const args = [
      '--app=' + url,
      '--user-data-dir=' + this.profileDir,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=TranslateUI',
      '--autoplay-policy=no-user-gesture-required',
      '--window-size=1280,760',
    ];
    if (opts.fullscreen) args.push('--start-fullscreen');
    const child = spawn(browser, args, { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    this.pid = child.pid ?? null;
    return { pid: this.pid, mode: 'app', browser };
  }

  openInBrowser(url: string): void {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      return;
    }
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
    spawn(opener, [url], { detached: true, stdio: 'ignore' }).unref();
  }

  close(): void {
    if (!this.pid) return;
    const pid = this.pid;
    this.pid = null;
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      return;
    }
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* 已经退出 */
    }
  }
}
