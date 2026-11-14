import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { normalizeFlow, normalizeTheme, preferredMessageEdge, startNode, nodeVideo, bubbleText } from '../src/flow.ts';
import { ThemeStore } from '../src/theme-store.ts';

test('normalizeFlow rejects bad ids and dangling edges', () => {
  const flow = normalizeFlow({
    nodes: [
      { id: 'ok_1', label: 'A' },
      { id: 'bad id', label: 'B' },
      { id: 'ok_1', label: 'dup' },
      { id: 'ok_2', label: 'C', role: 'phone', loop: true },
    ],
    edges: [
      { from: 'ok_1', to: 'ok_2' },
      { from: 'ok_1', to: 'missing' },
      { from: 'ok_2', to: 'ok_2' },
    ],
  });
  assert.deepEqual(flow.nodes.map((n) => n.id), ['ok_1', 'ok_2']);
  assert.equal(flow.edges.length, 1);
  assert.equal(startNode(flow)?.id, 'ok_2');
});

test('legacy theme gets a default canvas', () => {
  const theme = normalizeTheme({
    meta: { name: '旧主题' },
    config: {
      actions: [
        { key: 'rest', label: '休息', loop: true },
        { key: 'phone_pickup', label: '拿起手机', loop: false },
        { key: 'phone_loop', label: '回消息', loop: true },
        { key: 'phone_putdown', label: '放下手机', loop: false },
        { key: 'computer_go', label: '去电脑', loop: false },
        { key: 'computer_loop', label: '干活', loop: true },
        { key: 'computer_rest', label: '回休息', loop: false },
      ],
      videos: Object.fromEntries(['rest', 'phone_pickup', 'phone_loop', 'phone_putdown', 'computer_go', 'computer_loop', 'computer_rest'].map((key) => [key, 'videos/' + key + '.mp4'])),
      durations: { rest: 12, phone_pickup: 4, phone_loop: 8, phone_putdown: 3, computer_go: 5, computer_loop: 15, computer_rest: 10 },
    },
  });
  assert.equal(theme.config.flow.nodes.length, 7);
  assert.equal(theme.config.flow.edges.length, 8);
  assert.equal(startNode(theme.config.flow)?.id, 'rest');
  assert.equal(preferredMessageEdge(theme.config.flow, 'rest')?.to, 'phone_pickup');
  assert.equal(theme.config.library.length, 7);
  assert.equal(bubbleText(theme.config.flow.nodes[0]), '休息');
});

test('default theme zip imports and exposes the canvas', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'fishhouse-store-'));
  const root = join(process.cwd());
  try {
    const store = new ThemeStore(dataDir, root);
    store.ensureDefault();
    const list = store.list();
    assert.equal(list.length, 1);
    const theme = store.load(list[0].id);
    assert.ok(theme);
    assert.equal(theme.config.flow.nodes.length, 7);
    assert.equal(theme.config.flow.edges.length, 9);
    const rest = theme.config.flow.nodes.find((node) => node.id === 'rest');
    assert.ok(rest);
    assert.match(nodeVideo(theme, rest), /^videos\//);
    assert.ok(store.coverFile(list[0].id));
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
