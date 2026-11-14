/** 大肥鱼的小屋 · World 运行时：画布、壁纸服务、Coopanion 状态联动。 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import {
  bubbleText,
  flowNode,
  nodeDuration,
  nodeVideo,
  outgoing,
  preferredMessageEdge,
  startNode,
} from './flow.ts';
import { setThemeOptionSource } from './options.ts';
import { WallpaperServer } from './server.ts';
import { ThemeStore } from './theme-store.ts';
import type {
  FishHouseSection,
  PhaseLike,
  Theme,
  ThemeNode,
  ToolDefLike,
  WallpaperState,
  WorldContextLike,
  WorldHostLike,
} from './types.ts';
import { PACKAGE_ROOT, packagePath } from './paths.ts';
import { TOOL_DECLS } from './tools.ts';
import { WindowHost } from './window.ts';

const ROLE_LABEL: Record<string, { zh: string; en: string }> = {
  wait: { zh: '循环等待', en: 'wait loop' },
  both: { zh: '回消息 + 工作', en: 'reply + work' },
  work: { zh: '只工作', en: 'work only' },
  phone: { zh: '仅回消息', en: 'reply only' },
  action: { zh: '动作', en: 'action' },
  transition: { zh: '过渡', en: 'transition' },
  both_done: { zh: '回消息 + 工作（完即走）', en: 'reply + work (leave when done)' },
  work_done: { zh: '只工作（完即走）', en: 'work only (leave when done)' },
};

const roleText = (role: string, zh: boolean): string => (ROLE_LABEL[role] ?? { zh: role, en: role })[zh ? 'zh' : 'en'];

export class FishHouseWorld {
  readonly id = 'fish-house';
  private readonly ctx: WorldContextLike;
  private readonly store: ThemeStore;
  private readonly windowHost: WindowHost;
  private host: WorldHostLike | null = null;
  private theme: Theme | null = null;
  private state: WallpaperState;
  private server: WallpaperServer | null = null;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private advanceTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private idleDeadline = 0;
  private pendingNext = '';
  private started = false;
  private busy = false;
  private lastPhase: PhaseLike['state'] = 'idle';
  private lastUserAt = 0;
  private lastTurnDone = 0;
  private cursor = -1;
  private startedAt = 0;

  constructor(ctx: WorldContextLike) {
    this.ctx = ctx;
    this.store = new ThemeStore(ctx.dataDir, PACKAGE_ROOT);
    this.windowHost = new WindowHost(this.store.root);
    this.state = {
      mode: 'flow',
      event: 'boot',
      seq: 0,
      node_id: '',
      node_video: '',
      node_loop: false,
      node_label: '',
      bubble: '',
      bubble_until: 0,
      bubble_source: '',
      playing_node: '',
      playing_at: 0,
      updated_at: Date.now() / 1000,
      theme_id: '',
      theme_name: '',
    };
  }

  private get cfg(): FishHouseSection {
    return this.ctx.cfg;
  }

  private log(level: 'info' | 'warn' | 'error', message: string, detail?: Record<string, unknown>): void {
    const logger = this.host?.log;
    const fn = logger?.[level];
    if (fn) {
      fn.call(logger, message, detail);
      return;
    }
    if (level !== 'info') console.warn('[fish-house]', message, detail ?? '');
  }

  private get url(): string {
    return this.server?.url ?? 'http://127.0.0.1:' + this.cfg.port + '/';
  }

  private get stateFile(): string {
    return join(this.store.root, 'state.json');
  }

  async start(host: WorldHostLike): Promise<void> {
    this.host = host;
    try {
      this.cursor = host.store?.latestCursor() ?? -1;
    } catch {
      this.cursor = -1;
    }
    this.started = true;
    this.startedAt = Date.now();
    this.store.ensureDefault();
    setThemeOptionSource(() => this.store.list());
    const preferred = String(this.cfg.theme ?? '').trim();
    const active = preferred && this.store.load(preferred) ? preferred : this.store.activeId();
    if (active) {
      const theme = this.store.load(active);
      if (theme) {
        this.theme = theme;
        this.store.setActive(active);
        this.state.theme_id = active;
        this.state.theme_name = theme.meta.name;
      }
    }
    if (!this.theme) this.log('warn', '没有可用主题：壁纸页会显示空状态，先在面板导入一个主题');
    this.restoreState();
    this.server = this.makeServer();
    try {
      await this.server.start();
    } catch (error) {
      this.log('error', '壁纸服务启动失败', { error: error instanceof Error ? error.message : String(error) });
      this.server = null;
    }
    if (this.theme && !this.state.node_id) {
      const first = startNode(this.theme.config.flow);
      if (first) this.gotoNode(first.id, { event: 'boot' });
    } else if (!this.theme) {
      this.setState({ node_id: '', node_video: '', node_label: '', node_loop: false }, 'empty');
    }
    this.log('info', '大肥鱼的小屋已启动：' + this.url + '（主题：' + (this.theme?.meta.name ?? '无') + '）');
    if (this.cfg.openOnStart && this.theme) {
      try {
        this.windowHost.openWindow(this.url, { browserPath: this.cfg.browserPath });
      } catch (error) {
        this.log('warn', '打开壁纸窗口失败', { error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  async stop(): Promise<void> {
    this.started = false;
    this.clearNodeTimers();
    this.pendingNext = '';
    this.windowHost.close();
    const server = this.server;
    this.server = null;
    if (server) await server.stop();
    this.saveState();
    this.host = null;
  }

  private restoreState(): void {
    if (!this.theme) return;
    try {
      if (!existsSync(this.stateFile)) return;
      const saved = JSON.parse(readFileSync(this.stateFile, 'utf8')) as Partial<WallpaperState>;
      if (!saved || saved.mode !== 'flow' || saved.theme_id !== this.state.theme_id) return;
      let node = flowNode(this.theme.config.flow, String(saved.node_id ?? ''));
      if (!node || !this.videoReady(node)) node = startNode(this.theme.config.flow);
      if (!node) return;
      if (!node.loop || node.role === 'phone') {
        const loopNode = this.theme.config.flow.nodes.find((item) => item.loop && item.role !== 'phone');
        node = loopNode ?? startNode(this.theme.config.flow);
      }
      if (node) this.gotoNode(node.id, { event: 'restore' });
    } catch (error) {
      this.log('warn', '恢复画布状态失败', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private makeServer(): WallpaperServer {
    return new WallpaperServer({
      liveDir: packagePath('web', 'live'),
      host: '127.0.0.1',
      port: this.cfg.port,
      snapshot: () => this.snapshot(),
      config: () => this.configPayload(),
      activeThemeDir: () => (this.theme ? this.store.themeDir(this.state.theme_id) : null),
      coverOf: (id) => this.store.coverFile(id),
      onClientMessage: (payload) => this.onClientMessage(payload),
      log: (message) => this.log('info', message),
    });
  }

  private configPayload(): { crossfade_ms: number; show_bubble: boolean } {
    return { crossfade_ms: Math.max(0, Number(this.cfg.crossfadeMs) || 0), show_bubble: this.cfg.showBubble !== false };
  }

  private snapshot(): WallpaperState {
    return { ...this.state };
  }

  private onClientMessage(payload: Record<string, unknown>): void {
    const type = String(payload.type ?? '');
    if (type === 'playing') {
      const id = String(payload.node_id ?? '').trim();
      if (id && id === this.state.node_id) {
        this.state.playing_node = id;
        this.state.playing_at = Date.now() / 1000;
        this.saveState();
      }
      return;
    }
    if (type === 'loop_end') {
      if (this.pendingNext) {
        const target = this.pendingNext;
        this.pendingNext = '';
        this.clearAdvance();
        const node = flowNode(this.theme?.config.flow ?? { nodes: [], edges: [] }, target);
        if (node) this.gotoNode(target, { event: 'loop_end' });
      }
    }
  }

  private gotoNode(id: string, opts: { event?: string; bubble?: string; force?: boolean } = {}): boolean {
    const theme = this.theme;
    if (!theme) return false;
    const node = flowNode(theme.config.flow, id);
    if (!node) return false;
    this.clearNodeTimers();
    const video = nodeVideo(theme, node);
    const bubble = opts.bubble !== undefined ? String(opts.bubble).slice(0, 120) : this.cfg.showBubble === false ? '' : bubbleText(node);
    const ttl = bubble ? 4 : 0;
    this.state.node_id = node.id;
    this.state.node_label = node.label;
    this.state.node_video = this.mediaUrl(video);
    this.state.node_loop = Boolean(node.loop);
    this.state.bubble = bubble;
    this.state.bubble_until = bubble ? Date.now() / 1000 + ttl : 0;
    this.state.bubble_source = bubble ? 'node' : '';
    this.state.playing_node = '';
    this.state.playing_at = 0;
    if (this.pendingNext === id) this.pendingNext = '';
    this.setState({}, opts.event ?? 'flow_node');
    if (!node.loop || node.role === 'phone') {
      this.scheduleAdvance(node, nodeDuration(theme, node) + 0.25);
    } else if (node.role === 'work' || node.role === 'both') {
      this.scheduleIdle(node);
    } else if (this.pendingNext) {
      this.scheduleLoopFallback(nodeDuration(theme, node) + 8);
    }
    return true;
  }

  private mediaUrl(video: string): string {
    const value = String(video ?? '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
    if (!value) return '';
    const parts = value.split('/').filter((part) => part && part !== '.' && part !== '..');
    if (!parts.length) return '';
    return '/media/' + parts.map((part) => encodeURIComponent(part)).join('/');
  }

  private videoReady(node: ThemeNode): boolean {
    const theme = this.theme;
    if (!theme) return false;
    const video = nodeVideo(theme, node).replace(/\\/g, '/').replace(/^\/+/, '');
    if (!video) return false;
    const dir = this.store.themeDir(this.state.theme_id);
    if (!dir) return false;
    const full = resolve(dir, video);
    return full.startsWith(resolve(dir) + sep) && existsSync(full);
  }

  private setState(patch: Partial<WallpaperState>, event: string): void {
    Object.assign(this.state, patch, {
      event,
      seq: this.state.seq + 1,
      updated_at: Date.now() / 1000,
      theme_id: this.state.theme_id,
      theme_name: this.state.theme_name,
    });
    this.saveState();
    this.server?.broadcast({ type: 'state', state: this.snapshot() });
  }

  private saveState(): void {
    try {
      mkdirSync(this.store.root, { recursive: true });
      writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (error) {
      this.log('warn', '写入壁纸状态失败', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private scheduleAdvance(node: ThemeNode, delay: number): void {
    this.clearAdvance();
    const nodeId = node.id;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.advanceTimer = null;
      if (!this.started || this.state.node_id !== nodeId) return;
      this.advance(nodeId);
    }, Math.max(500, delay * 1000));
    this.advanceTimer = timer;
    this.timers.add(timer);
  }

  private clearAdvance(): void {
    if (!this.advanceTimer) return;
    clearTimeout(this.advanceTimer);
    this.timers.delete(this.advanceTimer);
    this.advanceTimer = null;
  }

  private scheduleLoopFallback(delaySeconds: number): void {
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.timers.delete(this.loopTimer);
    }
    const target = this.pendingNext;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.loopTimer = null;
      if (!this.started || !target || this.pendingNext !== target) return;
      this.pendingNext = '';
      this.gotoNode(target, { event: 'loop_fallback' });
    }, Math.max(2000, delaySeconds * 1000));
    this.loopTimer = timer;
    this.timers.add(timer);
  }

  private scheduleIdle(node: ThemeNode): void {
    this.clearIdle();
    this.idleDeadline = Date.now() + Math.max(5, Number(this.cfg.idleSeconds) || 60) * 1000;
    const nodeId = node.id;
    this.idleTimer = setInterval(() => {
      if (!this.started || this.state.node_id !== nodeId) {
        this.clearIdle();
        return;
      }
      if (Date.now() < this.idleDeadline) return;
      const current = flowNode(this.theme?.config.flow ?? { nodes: [], edges: [] }, nodeId);
      if (!current || !current.loop || (current.role !== 'work' && current.role !== 'both')) {
        this.clearIdle();
        return;
      }
      if (!outgoing(this.theme?.config.flow ?? { nodes: [], edges: [] }, nodeId).length) {
        this.clearIdle();
        return;
      }
      this.clearIdle();
      this.advance(nodeId);
    }, 1000);
  }

  private clearIdle(): void {
    if (!this.idleTimer) return;
    clearInterval(this.idleTimer);
    this.idleTimer = null;
  }

  private clearNodeTimers(): void {
    this.clearAdvance();
    this.clearIdle();
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.timers.delete(this.loopTimer);
      this.loopTimer = null;
    }
  }

  private advance(nodeId: string): void {
    const theme = this.theme;
    if (!theme || this.state.node_id !== nodeId) return;
    const edges = outgoing(theme.config.flow, nodeId);
    if (!edges.length) return;
    let target = this.pendingNext;
    if (!target || !edges.some((edge) => edge.to === target)) target = edges[0].to;
    this.pendingNext = '';
    this.gotoNode(target, { event: 'advance' });
  }

  private advanceAfterLoop(target: string): void {
    const theme = this.theme;
    if (!theme) return;
    const current = flowNode(theme.config.flow, this.state.node_id);
    if (current && current.loop && current.role !== 'phone') {
      this.pendingNext = target;
      this.scheduleLoopFallback(nodeDuration(theme, current) + 8);
      this.setState({}, 'wait_loop_end');
      return;
    }
    this.gotoNode(target, { event: 'advance' });
  }

  private onUserMessage(): void {
    const theme = this.theme;
    if (!theme) return;
    this.lastUserAt = Date.now();
    const current = flowNode(theme.config.flow, this.state.node_id);
    if (!current) {
      const first = startNode(theme.config.flow);
      if (first) this.gotoNode(first.id, { event: 'message' });
      return;
    }
    if (current.loop && (current.role === 'wait' || current.role === 'work' || current.role === 'both')) {
      const edge = preferredMessageEdge(theme.config.flow, current.id);
      if (edge) this.advanceAfterLoop(edge.to);
      return;
    }
    if (current.loop && current.role === 'phone') {
      this.touchIdle();
    }
  }

  private touchIdle(): void {
    if (!this.idleTimer) return;
    this.idleDeadline = Date.now() + Math.max(5, Number(this.cfg.idleSeconds) || 60) * 1000;
  }

  private onTurnDone(): void {
    const theme = this.theme;
    if (!theme) return;
    const current = flowNode(theme.config.flow, this.state.node_id);
    if (!current) return;
    if (current.role === 'phone') {
      this.scheduleAdvance(current, 1.2);
      return;
    }
    if (current.role === 'work' || current.role === 'both') this.touchIdle();
  }

  /** 只把真正新到的外部事件当作「有人说话」；启动时补投的旧事件不算。 */
  private hasNewExternalEvents(): boolean {
    const store = this.host?.store;
    if (!store) return true;
    try {
      const latest = store.latestCursor();
      if (this.cursor < 0) {
        this.cursor = latest;
        return false;
      }
      if (latest <= this.cursor) return false;
      const events = store.range({ fromCursor: this.cursor + 1, toCursor: latest, limit: 50 }) ?? [];
      this.cursor = latest;
      return events.some((event) => event.origin === 'external' && event.source !== this.id);
    } catch {
      return true;
    }
  }

  onRunPhase(phase: PhaseLike): void {
    if (!this.started || this.cfg.followRunPhase === false) return;
    const previous = this.lastPhase;
    this.lastPhase = phase.state;
    if (phase.state === 'delivering' && previous !== 'delivering') {
      this.busy = true;
      // 刚启动时主循环会把上次没投完的事件补投一遍，那不是「有人说话」。
      if (Date.now() - this.startedAt > 4000 && this.hasNewExternalEvents()) this.onUserMessage();
      return;
    }
    if (phase.state === 'model') {
      this.busy = true;
      return;
    }
    if (phase.state === 'tools') {
      this.busy = true;
      return;
    }
    if (phase.state === 'idle' && previous !== 'idle' && this.busy) {
      this.busy = false;
      this.onTurnDone();
    }
  }

  onTurnEnded(): void {
    if (!this.started || this.cfg.followRunPhase === false) return;
    const now = Date.now();
    if (now - this.lastTurnDone < 800) return;
    this.lastTurnDone = now;
    this.onTurnDone();
  }

  envPromptVars(): Record<string, string> {
    const theme = this.theme;
    if (!theme) {
      return { 'fishhouse.theme': '未选择主题', 'fishhouse.node': '无', 'fishhouse.flow': '', 'fishhouse.bubble': '', 'fishhouse.url': this.url };
    }
    const node = flowNode(theme.config.flow, this.state.node_id);
    const edges = node ? outgoing(theme.config.flow, node.id) : [];
    const lines: string[] = [];
    for (const item of theme.config.flow.nodes) {
      const targets = outgoing(theme.config.flow, item.id).map((edge) => edge.to + (edge.label ? '（' + edge.label + '）' : ''));
      lines.push('- ' + item.id + ' = ' + item.label + '｜' + roleText(item.role, true) + (targets.length ? ' → ' + targets.join('、') : ''));
    }
    return {
      'fishhouse.theme': theme.meta.name,
      'fishhouse.node': node ? node.id + '（' + node.label + '，' + roleText(node.role, true) + '）' : '无',
      'fishhouse.flow': lines.join('\n'),
      'fishhouse.bubble': this.state.bubble || '（无）',
      'fishhouse.url': this.url,
    };
  }

  tools(): ToolDefLike[] {
    return TOOL_DECLS.map((decl) => ({
      name: decl.name,
      description: decl.description,
      parameters: decl.parameters as Record<string, unknown>,
      tags: [...decl.tags],
      handler: async (args: Record<string, unknown>) => {
        if (decl.name === 'fishhouse_status') return this.toolStatus();
        if (decl.name === 'fishhouse_goto') return this.toolGoto(String(args.node_id ?? ''));
        return this.toolActivity(String(args.text ?? ''), Number(args.ttl_seconds ?? 0));
      },
    }));
  }

  private toolStatus(): string {
    const theme = this.theme;
    if (!theme) return '大肥鱼的小屋还没有主题。请在 Coopanion 设置 → 扩展 → 大肥鱼的小屋 导入一个主题包。';
    const node = flowNode(theme.config.flow, this.state.node_id);
    const edges = node ? outgoing(theme.config.flow, node.id) : [];
    const nodes = theme.config.flow.nodes.map((item) => item.id + '=' + item.label).join('、');
    return [
      '大肥鱼的小屋｜主题：' + theme.meta.name + '（' + theme.config.flow.nodes.length + ' 个节点）',
      '当前节点：' + (node ? node.id + '（' + node.label + '，' + roleText(node.role, true) + '）' : '无'),
      '出边：' + (edges.length ? edges.map((edge) => edge.to + (edge.label ? '（' + edge.label + '）' : '')).join('、') : '无'),
      '气泡：' + (this.state.bubble || '（无）'),
      '全部节点：' + nodes,
      '壁纸页：' + this.url,
    ].join('\n');
  }

  private toolGoto(id: string): string {
    const theme = this.theme;
    if (!theme) return '还没有主题，无法切换节点。';
    const node = flowNode(theme.config.flow, id.trim());
    if (!node) return '没有这个节点：' + id + '。可用节点：' + theme.config.flow.nodes.map((item) => item.id).join('、');
    const current = flowNode(theme.config.flow, this.state.node_id);
    if (current && current.loop && current.id !== node.id) {
      this.pendingNext = node.id;
      this.scheduleLoopFallback(nodeDuration(theme, current) + 8);
      this.setState({}, 'tool_goto');
      return '已安排：等当前循环视频播完再切到 ' + node.id + '（' + node.label + '）。';
    }
    this.gotoNode(node.id, { event: 'tool_goto' });
    return '已切到 ' + node.id + '（' + node.label + '）。';
  }

  private toolActivity(text: string, ttl: number): string {
    const value = String(text ?? '').trim().slice(0, 120);
    if (!value) return '气泡内容为空，没有显示。';
    const seconds = ttl > 0 ? Math.min(300, ttl) : 4;
    this.state.bubble = value;
    this.state.bubble_until = Date.now() / 1000 + seconds;
    this.state.bubble_source = 'tool';
    this.setState({}, 'bubble');
    return '气泡已更新，显示 ' + seconds + ' 秒。';
  }

  webUi(language = 'zh'): Record<string, unknown> {
    const zh = String(language).toLowerCase().startsWith('zh');
    const themes = this.store.list();
    const theme = this.theme;
    const node = theme ? flowNode(theme.config.flow, this.state.node_id) : null;
    const t = (a: string, b: string) => (zh ? a : b);
    const groups = [
      {
        id: 'world:fish-house/display',
        owner: 'world:fish-house',
        schema: {
          type: 'object',
          title: t('壁纸与显示', 'Wallpaper & display'),
          description: t('壁纸页端口、主题和画面衔接。改端口后点面板里的「重启壁纸服务」，或重启 Coopanion。', 'Port, theme and crossfade. After changing the port, click Restart wallpaper service in the panel, or restart Coopanion.'),
          properties: {
            'worlds.fish-house.port': {
              type: 'integer',
              title: t('壁纸页端口', 'Wallpaper port'),
              description: t('本机 127.0.0.1 上的端口，默认 47821；被占用时会自动往后找。', 'Port on 127.0.0.1, default 47821; moves up when taken.'),
              minimum: 1024,
              maximum: 65535,
              'x-hot': true,
            },
            'worlds.fish-house.theme': {
              type: 'string',
              title: t('当前主题', 'Theme'),
              description: t('画布、素材库和气泡都来自这套主题。导入新主题后在面板里应用。', 'Canvas, library and bubbles come from this theme. Apply a new one in the panel.'),
              'x-options': 'fishhouse-themes',
              'x-hot': true,
            },
            'worlds.fish-house.crossfadeMs': {
              type: 'integer',
              title: t('叠化时长（毫秒）', 'Crossfade (ms)'),
              description: t('节点之间视频叠化与音量交叉的时长，0 表示硬切。', 'Video and audio crossfade between nodes; 0 means a hard cut.'),
              minimum: 0,
              maximum: 3000,
              'x-suffix': 'ms',
              'x-hot': true,
            },
            'worlds.fish-house.showBubble': {
              type: 'boolean',
              title: t('显示底部气泡', 'Show bottom bubble'),
              description: t('关掉后壁纸底部不再出现气泡；桌宠自己的气泡不受影响。', 'Hide the wallpaper bubble; the pet bubble is unaffected.'),
              'x-hot': true,
            },
            'worlds.fish-house.openOnStart': {
              type: 'boolean',
              title: t('启动时打开壁纸窗口', 'Open the window on start'),
              description: t('用本机 Edge/Chrome 开一个无地址栏窗口。适合第二块屏或直播场景。', 'Open a frameless Edge/Chrome window for a second screen or streaming.'),
              'x-hot': false,
            },
            'worlds.fish-house.browserPath': {
              type: 'string',
              title: t('浏览器路径（可选）', 'Browser path (optional)'),
              description: t('留空自动找 Edge/Chrome/Brave。', 'Blank auto-detects Edge/Chrome/Brave.'),
              'x-path': { kind: 'file', extensions: ['exe'] },
              'x-hot': true,
            },
          },
        },
      },
      {
        id: 'world:fish-house/behavior',
        owner: 'world:fish-house',
        schema: {
          type: 'object',
          title: t('画布联动', 'Canvas reactions'),
          description: t('Coopanion 收到消息、思考、调用工具时，壁纸怎么沿画布走。', 'How the canvas follows messages, thinking and tool calls.'),
          properties: {
            'worlds.fish-house.followRunPhase': {
              type: 'boolean',
              title: t('跟随 Coopanion 回合', 'Follow Coopanion runs'),
              description: t('开启后：收到消息走进回消息节点，回合结束继续往下走；关闭后只能用工具手动切节点。', 'On: messages walk the reply branch and turn end continues; off: only tools switch nodes.'),
              'x-hot': true,
            },
            'worlds.fish-house.idleSeconds': {
              type: 'integer',
              title: t('工作节点空闲秒数', 'Work-node idle seconds'),
              description: t('停在「工作 / 回消息」节点多久没消息就自动走向下一步，默认 60。', 'How long a work/reply node waits without messages before continuing; default 60.'),
              minimum: 5,
              maximum: 3600,
              'x-suffix': 's',
              'x-hot': true,
            },
          },
        },
      },
    ];

    return {
      label: t('大肥鱼的小屋', 'Fish House'),
      lamps: [
        {
          label: t('壁纸页', 'Wallpaper'),
          state: this.server?.running ? 'online' : 'offline',
          hint: this.server?.running ? this.url : t('服务未启动', 'server not running'),
        },
      ],
      badges: [
        { label: t('主题', 'Theme'), value: theme?.meta.name ?? '—', tone: theme ? 'on' : 'off' },
        { label: t('节点', 'Node'), value: node?.label ?? '—', tone: node ? 'on' : 'off' },
        { label: t('观众', 'Viewers'), value: this.server?.clients ?? 0, tone: this.server?.clients ? 'on' : 'off' },
      ],
      panels: [
        {
          id: 'main',
          title: t('壁纸', 'Wallpaper'),
          description: t('打开壁纸窗口、复制链接、导入与应用主题。', 'Open the wallpaper window, copy the link, import and apply themes.'),
          getMethods: ['status', 'themes'],
        },
      ],
      links: [{ label: t('打开壁纸页', 'Open wallpaper page'), href: this.url, inheritTheme: false }],
      invoke: (panel: string, method: string, args: unknown[]) => this.invoke(panel, method, args),
      config: groups,
      promptDocs: [
        {
          key: 'worlds.fish-house.env',
          title: t('环境提示词', 'Environment prompt'),
          description: t('画布、当前节点与工具用法。修改后只影响发给模型的这一段，不改画布本身。', 'Canvas, current node and tool usage. Edits affect only this prompt section.'),
          path: packagePath('src', 'ENV_PROMPT.md'),
          role: 'envPrompt',
        },
      ],
    };
  }

  async invoke(panel: string, method: string, args: unknown[] = []): Promise<unknown> {
    if (panel !== 'main') throw new Error('不认识的面板：' + panel);
    if (method === 'status' || method === 'themes') return this.panelStatus();
    if (method === 'applyTheme') {
      this.activateTheme(String(args[0] ?? ''));
      return this.panelStatus();
    }
    if (method === 'importTheme') {
      const base64 = String(args[0] ?? '');
      const name = String(args[1] ?? '导入的主题.zip');
      if (!base64) throw new Error('没有收到主题文件');
      if (base64.length > 180 * 1024 * 1024) throw new Error('主题文件太大（超过约 130MB）');
      const summary = this.store.importZip(Buffer.from(base64, 'base64'));
      this.activateTheme(summary.id);
      return { imported: summary, ...this.panelStatus() };
    }
    if (method === 'importThemeFile') {
      const file = String(args[0] ?? '').trim();
      if (!file || !existsSync(file)) throw new Error('找不到主题文件：' + file);
      const buffer = readFileSync(file);
      if (buffer.length > 150 * 1024 * 1024) throw new Error('主题文件太大（超过 150MB）');
      const summary = this.store.importZip(buffer);
      this.activateTheme(summary.id);
      return { imported: summary, ...this.panelStatus() };
    }
    if (method === 'deleteTheme') {
      const id = String(args[0] ?? '');
      if (id === this.state.theme_id) {
        const other = this.store.list().find((item) => item.id !== id);
        if (!other) throw new Error('至少要留一个主题');
        this.activateTheme(other.id);
      }
      this.store.delete(id);
      return this.panelStatus();
    }
    if (method === 'openWindow') {
      const full = Boolean(args[0]);
      const result = this.windowHost.openWindow(this.url, { fullscreen: full, browserPath: this.cfg.browserPath });
      return { ...this.panelStatus(), window: result };
    }
    if (method === 'closeWindow') {
      this.windowHost.close();
      return this.panelStatus();
    }
    if (method === 'gotoNode') {
      this.gotoNode(String(args[0] ?? ''), { event: 'manual' });
      return this.panelStatus();
    }
    if (method === 'restartServer') {
      const old = this.server;
      this.server = null;
      if (old) await old.stop();
      this.server = this.makeServer();
      await this.server.start();
      return this.panelStatus();
    }
    if (method === 'openFolder') {
      const target = this.store.root;
      openFolder(target);
      return { ok: true, path: target };
    }
    throw new Error('不认识的方法：' + method);
  }

  private panelStatus(): Record<string, unknown> {
    const themes = this.store.list();
    const theme = this.theme;
    const node = theme ? flowNode(theme.config.flow, this.state.node_id) : null;
    const nodes = theme
      ? theme.config.flow.nodes.map((item) => ({
          id: item.id,
          label: item.label,
          role: item.role,
          loop: item.loop,
          video: nodeVideo(theme, item),
          current: item.id === this.state.node_id,
        }))
      : [];
    return {
      running: this.started,
      server: Boolean(this.server?.running),
      url: this.url,
      port: this.server?.actualPort ?? this.cfg.port,
      clients: this.server?.clients ?? 0,
      themeId: this.state.theme_id,
      themeName: theme?.meta.name ?? '',
      themes,
      node: node ? { id: node.id, label: node.label, role: node.role, loop: node.loop } : null,
      nodes,
      edges: theme ? theme.config.flow.edges : [],
      bubble: this.state.bubble,
      windowOpen: this.windowHost.open,
      config: this.configPayload(),
    };
  }

  private activateTheme(id: string): void {
    const theme = this.store.load(id);
    if (!theme) throw new Error('找不到主题：' + id);
    this.clearNodeTimers();
    this.pendingNext = '';
    this.theme = theme;
    this.store.setActive(id);
    this.state.theme_id = id;
    this.state.theme_name = theme.meta.name;
    try {
      this.ctx.persist({ theme: id });
      this.ctx.cfg.theme = id;
    } catch (error) {
      this.log('warn', '保存主题选择失败', { error: error instanceof Error ? error.message : String(error) });
    }
    const first = startNode(theme.config.flow);
    if (first) this.gotoNode(first.id, { event: 'theme' });
    else this.setState({ node_id: '', node_video: '', node_label: '', node_loop: false }, 'theme');
  }
}

function openFolder(target: string): void {
  const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(command, [target], { detached: true, stdio: 'ignore' }).unref();
}
