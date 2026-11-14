/** 扩展包自己的根目录：ctx.packageDir 指向部署的 bot 包，不是扩展包。 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export function packagePath(...parts: string[]): string {
  return join(PACKAGE_ROOT, ...parts);
}
