/** 主题库：默认主题、导入/删除/应用、磁盘布局。 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { normalizeTheme, isVideoPath } from './flow.ts';
import type { Theme, ThemeSummary } from './types.ts';
import { readZip } from './zip.ts';

const ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const COVER_RE = /\.(jpg|jpeg|png|webp)$/i;

export class ThemeStore {
  readonly root: string;
  readonly themesDir: string;
  readonly activeFile: string;
  private readonly defaultZip: string;

  constructor(dataDir: string, packageDir: string) {
    this.root = join(dataDir, 'fish-house');
    this.themesDir = join(this.root, 'themes');
    this.activeFile = join(this.root, 'active.json');
    this.defaultZip = join(packageDir, 'assets', 'default_theme.zip');
  }

  ensure(): void {
    mkdirSync(this.themesDir, { recursive: true });
  }

  /** 一个主题都没有时，把包内默认主题装进来。 */
  ensureDefault(): void {
    this.ensure();
    if (this.list().length) return;
    if (!existsSync(this.defaultZip)) return;
    try {
      this.importZip(readFileSync(this.defaultZip), { preferredId: 'default' });
    } catch (error) {
      throw new Error('默认主题安装失败：' + (error instanceof Error ? error.message : String(error)));
    }
  }

  list(): ThemeSummary[] {
    this.ensure();
    const out: ThemeSummary[] = [];
    for (const entry of readdirSync(this.themesDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !ID_RE.test(entry.name)) continue;
      try {
        const theme = this.load(entry.name);
        if (!theme) continue;
        out.push({
          id: entry.name,
          name: theme.meta.name,
          author: theme.meta.author,
          version: theme.meta.version,
          description: theme.meta.description,
          nodes: theme.config.flow.nodes.length,
          editable: true,
        });
      } catch {
        /* 坏主题跳过 */
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  }

  load(id: string): Theme | null {
    if (!ID_RE.test(String(id ?? ''))) return null;
    const dir = join(this.themesDir, id);
    const file = join(dir, 'theme.json');
    if (!existsSync(file)) return null;
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    return normalizeTheme(raw, id);
  }

  activeId(): string {
    try {
      const parsed = JSON.parse(readFileSync(this.activeFile, 'utf8')) as { theme?: string };
      if (parsed?.theme && this.load(parsed.theme)) return parsed.theme;
    } catch {
      /* 没有记录 */
    }
    return this.list()[0]?.id ?? '';
  }

  setActive(id: string): void {
    if (!this.load(id)) throw new Error('找不到主题：' + id);
    mkdirSync(this.root, { recursive: true });
    writeFileSync(this.activeFile, JSON.stringify({ theme: id, updated_at: Date.now() }, null, 2), 'utf8');
  }

  themeDir(id: string): string | null {
    if (!ID_RE.test(String(id ?? ''))) return null;
    const dir = resolve(this.themesDir, id);
    if (!dir.startsWith(resolve(this.themesDir) + sep)) return null;
    return existsSync(dir) ? dir : null;
  }

  coverFile(id: string): string | null {
    const dir = this.themeDir(id);
    if (!dir) return null;
    const theme = this.load(id);
    const declared = String(theme?.meta.cover ?? '').trim();
    if (declared && COVER_RE.test(declared)) {
      const candidate = resolve(dir, declared);
      if (candidate.startsWith(resolve(dir) + sep) && existsSync(candidate)) return candidate;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && COVER_RE.test(entry.name)) return join(dir, entry.name);
    }
    return null;
  }

  /** 导入主题包：只收 theme.json、videos/**、封面。 */
  importZip(buffer: Buffer, opts: { preferredId?: string } = {}): ThemeSummary {
    const entries = readZip(buffer);
    const themeRaw = entries.get('theme.json');
    if (!themeRaw) throw new Error('主题包里没有 theme.json');
    let parsed: unknown;
    try {
      parsed = JSON.parse(themeRaw.toString('utf8'));
    } catch {
      throw new Error('theme.json 不是有效 JSON');
    }
    const theme = normalizeTheme(parsed, '导入的主题');
    if (!theme.config.flow.nodes.length) throw new Error('主题里没有可用节点');

    this.ensure();
    let id = String(opts.preferredId ?? '').trim();
    if (!ID_RE.test(id)) id = 't_' + Date.now().toString(36) + Math.random().toString(16).slice(2, 6);
    while (existsSync(join(this.themesDir, id))) id = 't_' + Math.random().toString(16).slice(2, 10);
    const dir = join(this.themesDir, id);
    mkdirSync(dir, { recursive: true });

    const accepted = ['videos/', 'assets/'];
    for (const [name, data] of entries) {
      if (name === 'theme.json') continue;
      const allowed = accepted.some((prefix) => name.startsWith(prefix) && isVideoPath(name))
        || (!name.includes('/') && COVER_RE.test(name));
      if (!allowed) continue;
      const target = resolve(dir, name);
      if (!target.startsWith(resolve(dir) + sep)) continue;
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, data);
    }
    theme.meta.cover = this.findCoverName(dir) || '';
    writeFileSync(join(dir, 'theme.json'), JSON.stringify(theme, null, 2), 'utf8');
    return {
      id,
      name: theme.meta.name,
      author: theme.meta.author,
      version: theme.meta.version,
      description: theme.meta.description,
      nodes: theme.config.flow.nodes.length,
      editable: true,
    };
  }

  delete(id: string): void {
    const dir = this.themeDir(id);
    if (!dir) throw new Error('找不到主题：' + id);
    rmSync(dir, { recursive: true, force: true });
    try {
      const active = this.activeId();
      if (!active) rmSync(this.activeFile, { force: true });
    } catch {
      /* 忽略 */
    }
  }

  private findCoverName(dir: string): string {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && COVER_RE.test(entry.name)) return entry.name;
    }
    return '';
  }
}
