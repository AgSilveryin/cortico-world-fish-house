import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DEFAULTS } from '../src/definition.ts';
import { FishHouseWorld } from '../src/world.ts';

const root = join(process.cwd());

function makeWorld(port) {
  const dataDir = mkdtempSync(join(tmpdir(), 'fishhouse-world-'));
  const cfg = { ...DEFAULTS, port };
  const ctx = {
    id: 'fish-house',
    cfg,
    timezone: 'Asia/Shanghai',
    botName: '测试',
    botDir: root,
    packageDir: root,
    dataDir,
    repoRoot: root,
    secret: () => '',
    storeSecret: () => {},
    persist: (patch) => Object.assign(cfg, patch),
    restart: async () => {},
  };
  const host = {
    log: { info() {}, warn() {}, error() {}, debug() {} },
    pushEvent: async () => ({}),
  };
  return { world: new FishHouseWorld(ctx), dataDir, cfg };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('World starts, serves the page, follows phases and tools', async () => {
  const { world, dataDir } = makeWorld(48321);
  try {
    await world.start({ log: { info() {}, warn() {}, error() {} }, pushEvent: async () => ({}) });
    const status = await world.invoke('main', 'status');
    assert.equal(status.server, true);
    assert.equal(status.themes.length, 1);
    assert.equal(status.node.id, 'rest');
    const baseUrl = status.url.replace(/\/$/, '');
    assert.match(baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);

    const page = await fetch(baseUrl + '/');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /大肥鱼的小屋/);

    const state = await (await fetch(baseUrl + '/state.json')).json();
    assert.equal(state.node_id, 'rest');
    assert.equal(state.node_loop, true);
    assert.match(state.node_video, /^\/media\/videos\//);
    assert.ok(state.seq > 0);

    const config = await (await fetch(baseUrl + '/config.json')).json();
    assert.equal(config.crossfade_ms, 400);
    assert.equal(config.show_bubble, true);

    const video = await fetch(baseUrl + encodeURI(state.node_video), { headers: { Range: 'bytes=0-99' } });
    assert.equal(video.status, 206);
    assert.equal(video.headers.get('content-type'), 'video/mp4');
    assert.equal((await video.arrayBuffer()).byteLength, 100);

    const health = await (await fetch(baseUrl + '/health')).json();
    assert.equal(health.ok, true);

    const ws = new WebSocket(baseUrl.replace('http', 'ws') + '/ws');
    const frames = [];
    ws.addEventListener('message', (event) => frames.push(JSON.parse(event.data)));
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
      setTimeout(() => reject(new Error('ws open timeout')), 3000);
    });

    // 启动后的几秒内会补投旧事件，跳过启动保护再模拟一条新消息。
    world.startedAt = 0;
    world.onRunPhase({ state: 'delivering', running: [] });
    await sleep(120);
    const latest = await (await fetch(baseUrl + '/state.json')).json();
    assert.equal(latest.event, 'wait_loop_end');
    assert.ok(frames.some((frame) => frame.type === 'state' && frame.state.event === 'wait_loop_end'));

    world.onClientMessage({ type: 'loop_end' });
    await sleep(60);
    assert.equal((await (await fetch(baseUrl + '/state.json')).json()).node_id, 'phone_pickup');

    await sleep(4400);
    assert.equal((await (await fetch(baseUrl + '/state.json')).json()).node_id, 'phone_loop');

    world.onTurnEnded();
    await sleep(1500);
    assert.equal((await (await fetch(baseUrl + '/state.json')).json()).node_id, 'phone_putdown');

    world.onClientMessage({ type: 'playing', node_id: 'phone_putdown' });
    assert.equal((await (await fetch(baseUrl + '/state.json')).json()).playing_node, 'phone_putdown');

    const tools = new Map(world.tools().map((tool) => [tool.name, tool]));
    const statusText = await tools.get('fishhouse_status').handler({});
    assert.match(statusText, /大肥鱼的小屋/);
    const bubbleText = await tools.get('fishhouse_activity').handler({ text: '测试气泡', ttl_seconds: 2 });
    assert.match(bubbleText, /2/);
    assert.equal((await (await fetch(baseUrl + '/state.json')).json()).bubble, '测试气泡');

    const gotoText = await tools.get('fishhouse_goto').handler({ node_id: 'computer_go' });
    assert.match(gotoText, /computer_go/);
    world.onClientMessage({ type: 'loop_end' });
    await sleep(60);
    assert.equal((await (await fetch(baseUrl + '/state.json')).json()).node_id, 'computer_go');

    const badGoto = await tools.get('fishhouse_goto').handler({ node_id: 'nope' });
    assert.match(badGoto, /没有这个节点/);

    ws.close();
  } finally {
    await world.stop();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
