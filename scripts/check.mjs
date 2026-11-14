/** 用 Coopanion 自带的 manifest / dry-mount / describe 检查这个扩展包。 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = process.env.CORTICO_APP_DIR;
if (!app) {
  console.error('CORTICO_APP_DIR is not set. Point it at the Coopanion resources/app folder (the one containing build/cortico).');
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const manifestMod = await import(pathToFileURL(join(app, 'build', 'cortico', 'src', 'extensions', 'manifest.ts')).href);
const dry = await import(pathToFileURL(join(app, 'build', 'cortico', 'src', 'extensions', 'dry-mount.ts')).href);
const describeMod = await import(pathToFileURL(join(app, 'build', 'cortico', 'src', 'extensions', 'describe-export.ts')).href);

const parsed = manifestMod.parseExtensionManifest(pkg, 'zh');
if (!parsed.ok) {
  console.error('manifest FAILED:', parsed.reasons.join('\n'));
  process.exit(1);
}
for (const warning of parsed.warnings) console.warn('manifest warning:', warning);
console.log('manifest ok:', parsed.manifest.kind, 'api', parsed.manifest.api);

const mod = await import(pathToFileURL(join(root, 'src', 'index.ts')).href);
const def = mod.default;
const scratch = mkdtempSync(join(tmpdir(), 'fishhouse-check-'));
let failed = false;
try {
  const report = await dry.dryMountWorld(def, {
    scratchDir: scratch,
    packageDir: root,
    repoRoot: root,
    language: 'zh',
    hasWebUiClient: Boolean(parsed.manifest.webUiClient),
  });
  const self = await describeMod.checkDescribe('world', def, parsed.manifest.describe, {
    scratchDir: scratch,
    packageDir: root,
    repoRoot: root,
  });
  for (const item of [...report.ok, ...self.ok]) console.log('ok:', item);
  for (const item of [...report.warnings, ...self.warnings]) console.log('warn:', item);
  for (const item of [...report.failures, ...self.failures]) {
    console.error('FAIL:', item);
    failed = true;
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
if (failed) process.exit(1);
console.log('check passed');
