/** 大肥鱼的小屋 · Coopanion World 定义。 */
import { themeOptions } from './options.ts';
import { TOOL_DECLS } from './tools.ts';
import type { FishHouseSection, WorldContextLike } from './types.ts';
import { FishHouseWorld } from './world.ts';

export const DEFAULTS: FishHouseSection = {
  enabled: false,
  port: 47821,
  theme: '',
  crossfadeMs: 400,
  showBubble: true,
  idleSeconds: 60,
  followRunPhase: true,
  openOnStart: false,
  browserPath: '',
};

export const fishHouseDefinition = {
  id: 'fish-house',
  label: '大肥鱼的小屋',
  defaults: () => ({ ...DEFAULTS }),
  preflight: () => {
    if (typeof structuredClone !== 'function') throw new Error('大肥鱼的小屋需要 Node 22+ 的 structuredClone。');
  },
  create: (ctx: WorldContextLike) => new FishHouseWorld(ctx),
  configOptions: (kind: string, language: string) => {
    if (kind !== 'fishhouse-themes') return [];
    const zh = String(language).toLowerCase().startsWith('zh');
    return themeOptions().map((theme) => ({
      value: theme.id,
      label: theme.name + (theme.author ? ' · ' + theme.author : '') + (zh ? '（' + theme.nodes + ' 个节点）' : ' (' + theme.nodes + ' nodes)'),
    }));
  },
  describe: {
    tools: TOOL_DECLS.map((decl) => ({
      name: decl.name,
      description: decl.description,
      parameters: decl.parameters,
      tags: [...decl.tags],
      summary: decl.summary,
    })),
    events: [],
  },
};

export default fishHouseDefinition;
