/** 用 Coopanion 真正的 loadExtensions 装一遍扩展（临时 extensions 目录），验证真实装载路径。 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = process.env.CORTICO_APP_DIR;
if (!app) {
  console.error('CORTICO_APP_DIR is not set. Point it at the Coopanion resources/app folder (the one containing build/cortico).');
  process.exit(1);
}
const temp = mkdtempSync(join(tmpdir(), 'fishhouse-load-'));
const extDir = join(temp, 'extensions');
const pkgDir = join(extDir, 'node_modules', 'cortico-world-fish-house');
try {
  mkdirSync(pkgDir, { recursive: true });
  const source = process.env.FISHHOUSE_PACKAGE_DIR || root;
  cpSync(source, pkgDir, {
    recursive: true,
    filter: (src) => !src.split(/[\\/]/).some((part) => ['node_modules', 'test', 'scripts', '.git'].includes(part)),
  });
  writeFileSync(join(extDir, 'package.json'), JSON.stringify({
    name: 'coopanion-extensions',
    private: true,
    dependencies: { 'cortico-world-fish-house': '0.1.0' },
  }, null, 2));
  process.env.CORTICO_EXTENSIONS_DIR = extDir;
  const mod = await import(pathToFileURL(join(app, 'build', 'cortico', 'src', 'extensions.ts')).href);
  const set = await mod.loadExtensions(app, { log: { info() {}, warn: (...args) => console.warn('warn:', ...args), error: (...args) => console.error('error:', ...args), debug() {} } });
  const record = set.records.find((item) => item.name === 'cortico-world-fish-house');
  if (!record) throw new Error('loader did not see the package');
  if (!record.loaded) throw new Error('not loaded: ' + (record.reason ? record.reason('zh') : 'unknown'));
  if (record.kind !== 'world' || record.worldId !== 'fish-house') throw new Error('wrong kind/id: ' + record.kind + '/' + record.worldId);
  if (record.webUi !== 'served') throw new Error('panel asset not served: ' + record.webUi);
  if (set.worlds.length !== 1) throw new Error('expected one world');
  const world = set.worlds[0];
  if (world.id !== 'fish-house') throw new Error('world id mismatch');
  console.log('loader ok:', record.name, 'v' + record.version, record.kind, record.worldId, 'panel=' + record.webUi, 'assets=' + set.webUiAssets.length);
  console.log('tools:', world.create({ ...fakeCtx() }).tools().map((tool) => tool.name).join(', '));
} finally {
  rmSync(temp, { recursive: true, force: true });
}

function fakeCtx() {
  const cfg = { enabled: false, port: 47821, theme: '', crossfadeMs: 400, showBubble: true, idleSeconds: 60, followRunPhase: true, openOnStart: false, browserPath: '' };
  return {
    id: 'fish-house', cfg, timezone: 'Asia/Shanghai', botName: 'x', botDir: temp, packageDir: pkgDir, dataDir: temp, repoRoot: temp,
    secret: () => '', storeSecret: () => {}, persist: () => {}, restart: async () => {},
  };
}
