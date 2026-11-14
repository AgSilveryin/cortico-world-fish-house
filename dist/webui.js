/** 大肥鱼的小屋面板：打开窗口、导入/应用主题、手动切节点。 */

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, cls, onClick) {
  const node = el('button', 'btn ' + (cls || ''));
  node.type = 'button';
  node.textContent = label;
  node.addEventListener('click', onClick);
  return node;
}

function sheet(title, desc) {
  const box = el('section', 'fh-sheet');
  const head = el('div', 'fh-sheet-head');
  head.appendChild(el('h3', 'fh-sheet-title', title));
  if (desc) head.appendChild(el('p', 'fh-desc', desc));
  box.appendChild(head);
  return box;
}

function line(label, value) {
  const row = el('div', 'fh-line');
  row.appendChild(el('span', 'fh-k', label));
  const v = el('span', 'fh-v');
  v.textContent = value == null ? '—' : String(value);
  row.appendChild(v);
  return row;
}

function toast(ctx, text, bad) {
  if (ctx.ui && typeof ctx.ui.toast === 'function') {
    ctx.ui.toast(text, bad ? 'bad' : 'ok');
    return;
  }
  console.log('[fish-house]', text);
}

export const panels = {
  main: {
    async mount(ctx) {
      ctx.root.innerHTML = '';
      const wrap = el('div', 'fh');
      ctx.root.appendChild(wrap);
      let data = null;
      let busy = false;

      const header = sheet('大肥鱼的小屋', '主题画布驱动的视频壁纸。Coopanion 的回合会带着画布往前走，视频在节点之间叠化。');
      wrap.appendChild(header);
      const statusLine = el('div', 'fh-status');
      header.appendChild(statusLine);
      const urlRow = el('div', 'fh-urlrow');
      const urlInput = el('input', 'field fh-url');
      urlInput.readOnly = true;
      urlRow.appendChild(urlInput);
      urlRow.appendChild(button('复制链接', 'sm', async () => {
        try {
          await navigator.clipboard.writeText(urlInput.value);
          toast(ctx, '链接已复制');
        } catch {
          urlInput.select();
          toast(ctx, '复制失败，请手动复制', true);
        }
      }));
      header.appendChild(urlRow);
      const actions = el('div', 'fh-actions');
      actions.appendChild(button('打开壁纸窗口', 'primary', () => act('openWindow', [false])));
      actions.appendChild(button('全屏窗口', '', () => act('openWindow', [true])));
      actions.appendChild(button('关闭窗口', '', () => act('closeWindow', [])));
      actions.appendChild(button('重启服务', '', () => act('restartServer', [])));
      header.appendChild(actions);

      const themeBox = sheet('主题', '导入 .zip 主题包，应用后立刻换画布。');
      wrap.appendChild(themeBox);
      const themeRow = el('div', 'fh-row');
      const select = el('select', 'field fh-select');
      themeRow.appendChild(select);
      themeRow.appendChild(button('应用', 'primary', async () => {
        if (!select.value) return;
        await act('applyTheme', [select.value], '主题已应用');
      }));
      themeRow.appendChild(button('导入主题…', '', async () => {
        await importTheme();
      }));
      themeRow.appendChild(button('打开数据目录', 'sm', () => act('openFolder', [])));
      themeBox.appendChild(themeRow);
      const themeList = el('div', 'fh-themes');
      themeBox.appendChild(themeList);

      const canvasBox = sheet('画布', '当前播放的节点和出边。点节点可手动切过去。');
      wrap.appendChild(canvasBox);
      const canvasInfo = el('div', 'fh-canvas');
      canvasBox.appendChild(canvasInfo);

      async function act(method, args, okText) {
        if (busy) return;
        busy = true;
        try {
          data = await ctx.invoke(method, args);
          render();
          if (okText) toast(ctx, okText);
        } catch (error) {
          toast(ctx, (error && error.message) || String(error), true);
        } finally {
          busy = false;
        }
      }

      async function importTheme() {
        let path = '';
        try {
          if (typeof ctx.pickPath === 'function') {
            path = await ctx.pickPath({ kind: 'file', title: '选择主题包', extensions: ['zip'] });
          }
        } catch {
          path = '';
        }
        if (path) {
          await act('importThemeFile', [path], '主题已导入并应用');
          return;
        }
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip,application/zip';
        input.addEventListener('change', async () => {
          const file = input.files && input.files[0];
          if (!file) return;
          if (file.size > 120 * 1024 * 1024) {
            toast(ctx, '主题包太大（超过 120MB）', true);
            return;
          }
          const reader = new FileReader();
          reader.onload = async () => {
            const result = String(reader.result || '');
            const comma = result.indexOf(',');
            const b64 = comma >= 0 ? result.slice(comma + 1) : '';
            if (!b64) return;
            await act('importTheme', [b64, file.name], '主题已导入并应用');
          };
          reader.readAsDataURL(file);
        });
        input.click();
      }

      function render() {
        if (!data) return;
        statusLine.textContent = data.server
          ? '服务运行中 · 端口 ' + data.port + ' · ' + data.clients + ' 个观众' + (data.windowOpen ? ' · 窗口已打开' : '')
          : '服务未启动（看日志里的端口错误）';
        statusLine.classList.toggle('bad', !data.server);
        urlInput.value = data.url;
        select.innerHTML = '';
        for (const theme of data.themes || []) {
          const option = el('option', '', theme.name + (theme.version ? '  v' + theme.version : '') + '  ·  ' + theme.nodes + ' 节点');
          option.value = theme.id;
          if (theme.id === data.themeId) option.selected = true;
          select.appendChild(option);
        }
        if (!(data.themes || []).length) {
          const option = el('option', '', '还没有主题，先导入一个');
          option.value = '';
          select.appendChild(option);
        }
        themeList.innerHTML = '';
        for (const theme of data.themes || []) {
          const row = el('div', 'fh-theme' + (theme.id === data.themeId ? ' current' : ''));
          const info = el('div', 'fh-theme-info');
          info.appendChild(el('div', 'fh-theme-name', theme.name + (theme.id === data.themeId ? '（使用中）' : '')));
          info.appendChild(el('div', 'fh-theme-meta', [theme.author, theme.version, theme.nodes + ' 节点'].filter(Boolean).join(' · ')));
          row.appendChild(info);
          const ops = el('div', 'fh-theme-ops');
          if (theme.id !== data.themeId) {
            ops.appendChild(button('应用', 'sm', () => act('applyTheme', [theme.id], '主题已应用')));
          }
          ops.appendChild(button('删除', 'sm danger', async () => {
            const ok = ctx.ui && typeof ctx.ui.confirm === 'function'
              ? await ctx.ui.confirm({ title: '删除主题', body: '删除「' + theme.name + '」？视频文件会一起删掉。', danger: true })
              : true;
            if (ok) await act('deleteTheme', [theme.id], '主题已删除');
          }));
          row.appendChild(ops);
          themeList.appendChild(row);
        }
        canvasInfo.innerHTML = '';
        canvasInfo.appendChild(line('当前主题', data.themeName));
        canvasInfo.appendChild(line('当前节点', data.node ? data.node.label + '（' + data.node.id + '）' : '无'));
        canvasInfo.appendChild(line('气泡', data.bubble || '无'));
        const nodes = el('div', 'fh-nodes');
        for (const node of data.nodes || []) {
          const chip = button(node.label + (node.loop ? ' ↻' : ''), 'fh-node' + (node.current ? ' current' : ''), () => act('gotoNode', [node.id]));
          chip.title = node.id + ' · ' + node.role + (node.video ? ' · ' + node.video : ' · 未配视频');
          nodes.appendChild(chip);
        }
        canvasInfo.appendChild(nodes);
      }

      try {
        data = await ctx.invoke('status');
        render();
      } catch (error) {
        statusLine.textContent = '读取状态失败：' + ((error && error.message) || error);
        statusLine.classList.add('bad');
      }
      ctx.interval(() => {
        if (busy) return;
        ctx.invoke('status').then((next) => { data = next; render(); }).catch(() => {});
      }, 4000);
    },
  },
};

export default { panels };
