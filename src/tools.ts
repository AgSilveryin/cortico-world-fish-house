/** 工具声明：describe 与运行时共用，避免两边漂移。 */
export const TOOL_DECLS = [
  {
    name: 'fishhouse_status',
    description: '查看大肥鱼的小屋壁纸：当前主题、正在播放的节点、可选的出边、气泡和壁纸链接。想知道壁纸现在演到哪、有哪些节点可去时先看这个。',
    parameters: { type: 'object', properties: {} },
    tags: ['read'],
    summary: {
      zh: '看壁纸：当前主题、正在播放的节点、可去的出边、气泡和壁纸链接。',
      en: 'Show the wallpaper: theme, current node, outgoing edges, bubble and link.',
    },
  },
  {
    name: 'fishhouse_goto',
    description: '把壁纸切到画布上的某个节点。多分支时用它选择路线；节点 id 来自 fishhouse_status 或环境提示词里的画布。切到循环节点会等当前循环视频播完再切。',
    parameters: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: '目标节点 id，例如 phone_loop、computer_go。' },
      },
      required: ['node_id'],
      additionalProperties: false,
    },
    tags: ['write'],
    summary: {
      zh: '切到画布上的一个节点；多分支时由模型选路。',
      en: 'Switch to a canvas node; the model picks the branch when there are several.',
    },
  },
  {
    name: 'fishhouse_activity',
    description: '让壁纸底部气泡说一句话，可指定停留秒数；不填就按主题默认 4 秒。气泡是壁纸自己的，和桌宠的气泡相互独立。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '一句话，最多 120 字。' },
        ttl_seconds: { type: 'number', description: '停留秒数，0 表示用默认的 4 秒。' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    tags: ['write'],
    summary: {
      zh: '更新壁纸底部气泡，可指定停留秒数。',
      en: 'Update the wallpaper bubble, optionally for a given number of seconds.',
    },
  },
] as const;

export type ToolName = (typeof TOOL_DECLS)[number]['name'];
