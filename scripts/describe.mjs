/** 用 Coopanion 自带的 exportDescribe 生成 describe.json。 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = process.env.CORTICO_APP_DIR;
if (!app) {
  console.error('CORTICO_APP_DIR is not set. Point it at the Coopanion resources/app folder (the one containing build/cortico).');
  process.exit(1);
}
const { exportDescribe } = await import(pathToFileURL(join(app, 'build', 'cortico', 'src', 'extensions', 'describe-export.ts')).href);
const mod = await import(pathToFileURL(join(root, 'src', 'index.ts')).href);
const def = mod.default;
const scratch = mkdtempSync(join(tmpdir(), 'fishhouse-describe-'));
try {
  const file = await exportDescribe('world', def, { scratchDir: scratch, packageDir: root });
  if (!file) throw new Error('definition has no describe');
  writeFileSync(join(root, 'describe.json'), JSON.stringify(file, null, 2) + '\n', 'utf8');
  console.log('describe.json written:', file.tools.length, 'tools,', (file.prompts || []).length, 'prompt doc(s)');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
