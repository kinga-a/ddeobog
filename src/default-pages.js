/**
 * 默认独立页面（关于本站 / 留言板）
 *
 * 安装时创建一次；若站长在后台删除页面，边缘端首次访问对应路由时会按需重建，
 * 保证 /about/ 与 /guestbook/ 始终可用。
 *
 * 本地 Node 预览与自动化测试不触发自动创建，以免打乱测试依赖的固定 cid 序列。
 */

/** @typedef {'about' | 'guestbook'} DefaultPageKind */

export const DEFAULT_PAGES = {
  about: {
    title: '关于本站',
    slug: 'about',
    type: 'page',
    status: 'publish',
    allowComment: false,
    authorId: 1,
    text: '### 关于本站\n\n这里是记录技术与生活的一隅。',
  },
  guestbook: {
    title: '留言板',
    slug: 'guestbook',
    type: 'page',
    status: 'publish',
    allowComment: true,
    authorId: 1,
    text: '欢迎在这里留下你的想法、建议，或者只是打个招呼。',
  },
};

/** 当前是否运行在 Node（本地预览/测试）；边缘运行时没有 process */
export const IS_NODE = !!globalThis.process?.versions?.node;

/**
 * 获取默认页面，不存在则创建（仅边缘端调用）。
 * @param {any} db
 * @param {DefaultPageKind} kind
 * @returns {Promise<any>}
 */
export async function ensureDefaultPage(db, kind) {
  const exists = await db.getContentBySlug(kind, 'page');
  if (exists) return exists;
  return await db.createContent(DEFAULT_PAGES[kind]);
}