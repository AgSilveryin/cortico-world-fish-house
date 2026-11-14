/** 壁纸页服务：静态页、state/config、视频 Range 与 WebSocket 推送。 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { WallpaperState } from './types.ts';
import { WsHub } from './ws.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.ogv': 'video/ogg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

export interface ServerOptions {
  liveDir: string;
  host: string;
  port: number;
  snapshot: () => WallpaperState;
  config: () => { crossfade_ms: number; show_bubble: boolean };
  activeThemeDir: () => string | null;
  coverOf: (id: string) => string | null;
  onClientMessage: (payload: Record<string, unknown>) => void;
  log?: (message: string) => void;
}

export class WallpaperServer {
  private server: Server | null = null;
  private readonly hub: WsHub;
  private readonly opts: ServerOptions;
  private readonly sockets = new Set<import('node:stream').Duplex>();
  actualPort = 0;

  constructor(opts: ServerOptions) {
    this.opts = opts;
    this.hub = new WsHub((text) => {
      try {
        const payload = JSON.parse(text) as Record<string, unknown>;
        if (payload && typeof payload === 'object') this.opts.onClientMessage(payload);
      } catch {
        /* 忽略非 JSON */
      }
    });
  }

  get clients(): number {
    return this.hub.size;
  }

  get url(): string {
    return 'http://127.0.0.1:' + (this.actualPort || this.opts.port) + '/';
  }

  get running(): boolean {
    return this.server !== null;
  }

  broadcast(payload: Record<string, unknown>): void {
    if (!this.hub.size) return;
    this.hub.sendText(JSON.stringify(payload));
  }

  async start(): Promise<number> {
    if (this.server) return this.actualPort;
    const base = Math.max(1, Math.min(65535, Number(this.opts.port) || 47821));
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const port = base + attempt;
      if (port > 65535) break;
      try {
        await this.listen(port);
        this.actualPort = port;
        this.opts.log?.('壁纸服务已启动：' + this.url);
        return port;
      } catch (error) {
        lastError = error;
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code !== 'EADDRINUSE' && code !== 'EACCES') break;
      }
    }
    throw new Error('壁纸端口启动失败：' + (lastError instanceof Error ? lastError.message : String(lastError)));
  }

  private listen(port: number): Promise<void> {
    return new Promise((resolvePromise, reject) => {
      const server = createServer((req, res) => {
        Promise.resolve(this.handle(req, res)).catch((error) => {
          if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('500 ' + (error instanceof Error ? error.message : String(error)));
        });
      });
      server.on('upgrade', (req, socket) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== '/ws') {
          socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
          return;
        }
        this.hub.handleUpgrade(req, socket);
      });
      server.on('connection', (socket) => {
        this.sockets.add(socket);
        socket.on('close', () => this.sockets.delete(socket));
      });
      server.once('error', reject);
      server.listen(port, this.opts.host, () => {
        server.off('error', reject);
        this.server = server;
        resolvePromise();
      });
    });
  }

  async stop(): Promise<void> {
    this.hub.close();
    const server = this.server;
    this.server = null;
    this.actualPort = 0;
    if (!server) return;
    for (const socket of [...this.sockets]) {
      try {
        socket.destroy();
      } catch {
        /* 已经断了 */
      }
    }
    this.sockets.clear();
    await new Promise<void>((resolvePromise) => {
      server.close(() => resolvePromise());
      setTimeout(resolvePromise, 1200).unref?.();
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = decodeURIComponent(url.pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }
    if (path === '/health') {
      this.json(res, 200, { ok: true, port: this.actualPort, clients: this.hub.size, theme: this.opts.snapshot().theme_id });
      return;
    }
    if (path === '/state.json') {
      this.json(res, 200, this.opts.snapshot());
      return;
    }
    if (path === '/config.json') {
      this.json(res, 200, this.opts.config());
      return;
    }
    if (path.startsWith('/media/') || path.startsWith('/videos/')) {
      const dir = this.opts.activeThemeDir();
      if (!dir) return this.notFound(res);
      const prefix = path.startsWith('/media/') ? '/media/' : '/videos/';
      const rel = path.slice(prefix.length);
      const file = safeJoin(prefix === '/videos/' ? join(dir, 'videos') : dir, rel);
      if (!file) return this.notFound(res);
      return this.file(req, res, file, true);
    }
    if (path.startsWith('/themes/')) {
      const rest = path.slice('/themes/'.length);
      const slash = rest.indexOf('/');
      if (slash < 0) return this.notFound(res);
      const id = rest.slice(0, slash);
      const rel = rest.slice(slash + 1);
      const cover = this.opts.coverOf(id);
      if (!cover) return this.notFound(res);
      if (rel !== cover.split(/[\\/]/).pop()) return this.notFound(res);
      return this.file(req, res, cover, false);
    }
    const liveDir = this.opts.liveDir;
    const rel = path === '/' ? 'index.html' : path.replace(/^\/+/, '');
    const file = safeJoin(liveDir, rel);
    if (!file) return this.notFound(res);
    return this.file(req, res, file, false);
  }

  private json(res: ServerResponse, status: number, value: unknown): void {
    const body = JSON.stringify(value);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  private notFound(res: ServerResponse): void {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
  }

  private file(req: IncomingMessage, res: ServerResponse, file: string, rangeOk: boolean): void {
    let stat;
    try {
      stat = statSync(file);
    } catch {
      return this.notFound(res);
    }
    if (!stat.isFile()) return this.notFound(res);
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
    const headers: Record<string, string | number> = {
      'Content-Type': type,
      'Cache-Control': extname(file) === '.html' ? 'no-store' : 'no-cache',
      'Accept-Ranges': rangeOk ? 'bytes' : 'none',
    };
    if (rangeOk) {
      const range = String(req.headers.range ?? '');
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match && (match[1] || match[2])) {
        let start = match[1] ? Number(match[1]) : 0;
        let end = match[2] ? Number(match[2]) : stat.size - 1;
        if (!match[1] && match[2]) {
          start = Math.max(0, stat.size - Number(match[2]));
          end = stat.size - 1;
        }
        if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < stat.size) {
          end = Math.min(end, stat.size - 1);
          headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + stat.size;
          headers['Content-Length'] = end - start + 1;
          res.writeHead(206, headers);
          if (req.method === 'HEAD') return res.end();
          createReadStream(file, { start, end }).pipe(res);
          return;
        }
        res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size });
        res.end();
        return;
      }
    }
    headers['Content-Length'] = stat.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  }
}

/** 把相对路径限制在 root 内；越界或不存在的路径返回 null。 */
function safeJoin(root: string, rel: string): string | null {
  const clean = normalize(rel).replace(/^([/\\])+/, '');
  if (!clean || clean.startsWith('..') || clean.includes('..' + sep)) return null;
  const full = resolve(root, clean);
  const base = resolve(root);
  if (full !== base && !full.startsWith(base + sep)) return null;
  return existsSync(full) ? full : null;
}
