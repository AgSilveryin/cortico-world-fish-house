/** 画布流程图：归一化、起点、出边、气泡与主题兼容。 */
import type { LibraryItem, Theme, ThemeEdge, ThemeFlow, ThemeNode } from './types.ts';

const NODE_ID = /^[A-Za-z0-9_.-]{1,64}$/;
const VIDEO_RE = /\.(mp4|webm|mov|m4v|ogv)$/i;

export function isVideoPath(value: string): boolean {
  return VIDEO_RE.test(String(value || ''));
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function text(value: unknown, max = 300): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function normalizeFlow(raw: unknown): ThemeFlow {
  const nodes: ThemeNode[] = [];
  const ids = new Set<string>();
  if (raw && typeof raw === 'object' && Array.isArray((raw as { nodes?: unknown }).nodes)) {
    for (const item of (raw as { nodes: unknown[] }).nodes) {
      if (!item || typeof item !== 'object') continue;
      const source = item as Record<string, unknown>;
      const id = String(source.id ?? '').trim();
      if (!NODE_ID.test(id) || ids.has(id)) continue;
      ids.add(id);
      const role = text(source.role, 20) || 'action';
      nodes.push({
        id,
        label: text(source.label, 40) || id,
        video: String(source.video ?? '').trim(),
        loop: role === 'both_done' || role === 'work_done' ? false : Boolean(source.loop),
        role,
        prompt: text(source.prompt, 300),
        note: text(source.note, 80),
        duration: Math.max(0, num(source.duration)),
        media_id: String(source.media_id ?? '').trim(),
        x: num(source.x, 100),
        y: num(source.y, 100),
      });
    }
  }
  const edges: ThemeEdge[] = [];
  const used = new Set<string>();
  if (raw && typeof raw === 'object' && Array.isArray((raw as { edges?: unknown }).edges)) {
    for (const item of (raw as { edges: unknown[] }).edges) {
      if (!item || typeof item !== 'object') continue;
      const source = item as Record<string, unknown>;
      const from = String(source.from ?? '');
      const to = String(source.to ?? '');
      if (!ids.has(from) || !ids.has(to) || from === to) continue;
      let id = String(source.id ?? from + '->' + to);
      while (used.has(id)) id += '-x';
      used.add(id);
      edges.push({ id, from, to, label: text(source.label, 120) });
    }
  }
  return { nodes, edges };
}

export function normalizeLibrary(raw: unknown): LibraryItem[] {
  const items: LibraryItem[] = [];
  const ids = new Set<string>();
  if (!Array.isArray(raw)) return items;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const source = item as Record<string, unknown>;
    const id = String(source.id ?? '').trim();
    const video = String(source.video ?? '').trim();
    if (!id || !video || ids.has(id) || !isVideoPath(video)) continue;
    ids.add(id);
    items.push({
      id,
      name: text(source.name, 40) || video.split('/').pop() || id,
      video,
      duration: Math.max(0, num(source.duration)),
    });
  }
  return items;
}

/** 节点实际指向的视频：优先素材库，其次节点自带的路径。 */
export function nodeVideo(theme: Theme, node: ThemeNode | null): string {
  if (!node) return '';
  const item = theme.config.library.find((entry) => entry.id === node.media_id);
  return (item?.video || node.video || '').trim();
}

export function flowNode(flow: ThemeFlow, id: string): ThemeNode | null {
  return flow.nodes.find((node) => node.id === id) ?? null;
}

export function outgoing(flow: ThemeFlow, id: string): ThemeEdge[] {
  return flow.edges.filter((edge) => edge.from === id);
}

/** 画布起点：第一个可循环的等待/工作/回消息节点，没有就用第一个。 */
export function startNode(flow: ThemeFlow): ThemeNode | null {
  const first = flow.nodes[0] ?? null;
  return (
    flow.nodes.find((node) => ['wait', 'both', 'work', 'phone'].includes(node.role) && node.loop) ?? first
  );
}

export function bubbleText(node: ThemeNode | null): string {
  if (!node) return '';
  return text(node.prompt || node.note || node.label, 40);
}

/** 从循环节点切出时优先走「回消息」那条边，找不到再走第一条。 */
export function preferredMessageEdge(flow: ThemeFlow, id: string): ThemeEdge | null {
  const edges = outgoing(flow, id);
  if (!edges.length) return null;
  if (edges.length === 1) return edges[0];
  const phone = edges.find((edge) => {
    const target = flowNode(flow, edge.to);
    return target?.role === 'phone' || /手机|消息|回复|phone|reply/i.test(edge.label + ' ' + (target?.label ?? ''));
  });
  return phone ?? edges[0];
}

/** 沿出边找一条能在 depth 步内走到 target 的第一跳。 */
export function nextToward(flow: ThemeFlow, from: string, target: string, depth = 5): string {
  for (const edge of outgoing(flow, from)) {
    const first = edge.to;
    if (!first) continue;
    if (first === target) return first;
    const seen = new Set([from, first]);
    let frontier = [first];
    for (let step = 1; step < Math.max(1, depth); step += 1) {
      const following: string[] = [];
      for (const current of frontier) {
        for (const item of outgoing(flow, current)) {
          const to = item.to;
          if (!to || seen.has(to)) continue;
          if (to === target) return first;
          seen.add(to);
          following.push(to);
        }
      }
      frontier = following;
      if (!frontier.length) break;
    }
  }
  return '';
}

export function pathBetween(flow: ThemeFlow, start: string, target: string): string[] | null {
  if (start === target) return [start];
  const prev = new Map<string, string | null>([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const current = queue.shift() as string;
    if (prev.size > 200) return null;
    for (const edge of outgoing(flow, current)) {
      const to = edge.to;
      if (!to || prev.has(to)) continue;
      prev.set(to, current);
      if (to === target) {
        const path = [to];
        let cursor: string | null = current;
        while (cursor !== null) {
          path.push(cursor);
          cursor = prev.get(cursor) ?? null;
        }
        return path.reverse();
      }
      queue.push(to);
    }
  }
  return null;
}

/** 节点播一轮的秒数：节点时长 > 素材时长 > 5 秒。 */
export function nodeDuration(theme: Theme, node: ThemeNode | null): number {
  if (!node) return 5;
  if (node.duration > 0) return node.duration;
  const item = theme.config.library.find((entry) => entry.id === node.media_id);
  if (item && item.duration > 0) return item.duration;
  return 5;
}

/** 旧主题（只有 actions/videos/durations）补一张默认画布。 */
function legacyFlow(config: Record<string, unknown>): ThemeFlow {
  const actions = Array.isArray(config.actions) ? (config.actions as Array<Record<string, unknown>>) : [];
  const videos = (config.videos && typeof config.videos === 'object' ? config.videos : {}) as Record<string, string>;
  const durations = (config.durations && typeof config.durations === 'object' ? config.durations : {}) as Record<string, number>;
  const nodes: ThemeNode[] = [];
  const push = (key: string, index: number): ThemeNode | null => {
    const video = String(videos[key] ?? '').trim();
    if (!video) return null;
    const meta = actions.find((item) => String(item.key ?? '') === key) as Record<string, unknown> | undefined;
    const loop = meta ? Boolean(meta.loop) : /loop/i.test(key);
    const role = key === 'rest' ? 'wait' : /phone/i.test(key) ? (loop ? 'phone' : 'action') : /computer/i.test(key) ? (loop ? 'both' : 'transition') : loop ? 'both' : 'action';
    const node: ThemeNode = {
      id: key.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64) || 'n' + index,
      label: text(meta?.label ?? key, 40),
      video,
      loop,
      role,
      prompt: text(meta?.hint ?? '', 300),
      note: '',
      duration: Math.max(0, num(durations[key])),
      media_id: '',
      x: 120 + (index % 4) * 230,
      y: 120 + Math.floor(index / 4) * 180,
    };
    nodes.push(node);
    return node;
  };
  let index = 0;
  for (const action of actions) {
    const key = String(action.key ?? '');
    if (key) push(key, index++);
  }
  for (const key of Object.keys(videos)) {
    if (!nodes.some((node) => node.id === key)) push(key, index++);
  }
  const edges: ThemeEdge[] = [];
  const link = (from: string, to: string, label = '') => {
    if (!nodes.some((node) => node.id === from) || !nodes.some((node) => node.id === to)) return;
    edges.push({ id: 'e_' + from + '_' + to, from, to, label });
  };
  const byId = (id: string) => nodes.find((node) => node.id === id);
  if (byId('rest') && byId('phone_pickup')) {
    link('rest', 'phone_pickup', '有人找、要回消息');
    link('rest', 'computer_go', '要干活、查资料');
    link('phone_pickup', 'phone_loop');
    link('phone_loop', 'phone_putdown');
    link('phone_putdown', 'rest');
    link('computer_go', 'computer_loop');
    link('computer_loop', 'computer_rest');
    link('computer_rest', 'rest');
  } else {
    for (let i = 0; i < nodes.length - 1; i += 1) link(nodes[i].id, nodes[i + 1].id);
  }
  return { nodes, edges };
}

/** 把画布里的视频补进素材库，并给节点补 media_id。 */
function ensureLibrary(flow: ThemeFlow, library: LibraryItem[]): LibraryItem[] {
  const result = [...library];
  const byVideo = new Map(result.filter((item) => item.video).map((item) => [item.video, item]));
  const used = new Set(result.map((item) => item.id));
  for (const node of flow.nodes) {
    if (node.media_id && result.some((item) => item.id === node.media_id)) continue;
    const video = String(node.video || '').trim();
    if (!video || !isVideoPath(video)) continue;
    let item = byVideo.get(video);
    if (!item) {
      let id = 'm_' + Math.random().toString(16).slice(2, 10);
      while (used.has(id)) id = 'm_' + Math.random().toString(16).slice(2, 10);
      used.add(id);
      item = { id, name: text(node.label, 40) || id, video, duration: Math.max(0, node.duration) };
      result.push(item);
      byVideo.set(video, item);
    }
    node.media_id = item.id;
  }
  return result;
}

export function normalizeTheme(raw: unknown, fallbackName = '未命名主题'): Theme {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const metaRaw = (source.meta && typeof source.meta === 'object' ? source.meta : {}) as Record<string, unknown>;
  const configRaw = (source.config && typeof source.config === 'object' ? source.config : {}) as Record<string, unknown>;
  let flow = normalizeFlow(configRaw.flow);
  if (!flow.nodes.length) flow = legacyFlow(configRaw);
  const library = ensureLibrary(flow, normalizeLibrary(configRaw.library));
  const settingsRaw = (configRaw.settings && typeof configRaw.settings === 'object' ? configRaw.settings : {}) as Record<string, unknown>;
  const crossfade = Math.max(0, Math.min(3000, num(settingsRaw.crossfade_ms, 400)));
  return {
    schema: 1,
    meta: {
      id: text(metaRaw.id, 64) || 'theme',
      name: text(metaRaw.name, 60) || fallbackName,
      author: text(metaRaw.author, 60),
      description: text(metaRaw.description, 300),
      version: text(metaRaw.version, 24) || '1.0.0',
      created_at: num(metaRaw.created_at, Math.floor(Date.now() / 1000)),
      cover: String(metaRaw.cover ?? '').trim(),
    },
    config: {
      ...configRaw,
      library,
      flow,
      settings: { ...settingsRaw, crossfade_ms: crossfade },
    },
  };
}
