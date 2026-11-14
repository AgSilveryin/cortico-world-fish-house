/** WebUI 配置下拉用的主题选项来源（由当前 World 实例注册）。 */
import type { ThemeSummary } from './types.ts';

let source: () => ThemeSummary[] = () => [];

export function setThemeOptionSource(fn: () => ThemeSummary[]): void {
  source = typeof fn === 'function' ? fn : () => [];
}

export function themeOptions(): ThemeSummary[] {
  try {
    return source() ?? [];
  } catch {
    return [];
  }
}
