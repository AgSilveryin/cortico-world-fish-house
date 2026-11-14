/** 大肥鱼的小屋 · Coopanion World 的数据形状与宿主最小类型。 */

export interface FishHouseSection {
  enabled: boolean;
  port: number;
  theme: string;
  crossfadeMs: number;
  showBubble: boolean;
  idleSeconds: number;
  followRunPhase: boolean;
  openOnStart: boolean;
  browserPath: string;
}

export type NodeRole = 'wait' | 'both' | 'work' | 'phone' | 'action' | 'transition' | 'both_done' | 'work_done' | string;

export interface ThemeNode {
  id: string;
  label: string;
  video: string;
  loop: boolean;
  role: NodeRole;
  prompt: string;
  note: string;
  duration: number;
  media_id: string;
  x: number;
  y: number;
}

export interface ThemeEdge {
  id: string;
  from: string;
  to: string;
  label: string;
}

export interface ThemeFlow {
  nodes: ThemeNode[];
  edges: ThemeEdge[];
}

export interface LibraryItem {
  id: string;
  name: string;
  video: string;
  duration: number;
}

export interface ThemeMeta {
  id: string;
  name: string;
  author: string;
  description: string;
  version: string;
  created_at: number;
  cover: string;
}

export interface ThemeSettings {
  crossfade_ms: number;
  [key: string]: unknown;
}

export interface Theme {
  schema: number;
  meta: ThemeMeta;
  config: {
    library: LibraryItem[];
    flow: ThemeFlow;
    settings: ThemeSettings;
    [key: string]: unknown;
  };
}

export interface WallpaperState {
  mode: string;
  event: string;
  seq: number;
  node_id: string;
  node_video: string;
  node_loop: boolean;
  node_label: string;
  bubble: string;
  bubble_until: number;
  bubble_source: string;
  playing_node: string;
  playing_at: number;
  updated_at: number;
  theme_id: string;
  theme_name: string;
}

export interface ThemeSummary {
  id: string;
  name: string;
  author: string;
  version: string;
  description: string;
  nodes: number;
  editable: boolean;
}

/** 框架注入的宿主（只声明本扩展用到的成员）。 */
export interface WorldHostLike {
  log?: {
    info?: (message: string, detail?: Record<string, unknown>) => void;
    warn?: (message: string, detail?: Record<string, unknown>) => void;
    error?: (message: string, detail?: Record<string, unknown>) => void;
  };
  pushEvent?: (event: Record<string, unknown>, opts?: Record<string, unknown>) => Promise<unknown>;
  store?: {
    latestCursor(): number;
    range(opts?: { fromCursor?: number; toCursor?: number; limit?: number }): Array<{
      cursor: number;
      origin?: string;
      source?: string;
    }>;
  };
  cognition?: {
    request(request: { brief: string; tools?: string[]; hint?: { rounds?: number } }): Promise<{ text?: string; error?: string }>;
  };
}

export interface PhaseLike {
  state: 'idle' | 'delivering' | 'model' | 'tools' | 'backoff' | 'handoff';
  round?: number;
  running: readonly string[];
}

export interface WorldContextLike {
  id: string;
  cfg: FishHouseSection;
  timezone: string;
  botName: string;
  botDir: string;
  packageDir: string;
  dataDir: string;
  repoRoot: string;
  secret(name: string): string;
  storeSecret(name: string, value: string): void;
  persist(patch: Partial<FishHouseSection>): void;
  restart(): Promise<void>;
}

export interface ToolDefLike {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  tags: string[];
  handler: (args: Record<string, unknown>) => Promise<string>;
}
