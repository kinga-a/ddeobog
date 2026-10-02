/** 全局配置 */
export const CONFIG = {
  // KV 命名空间绑定变量名（在 EdgeOne 控制台将 KV 命名空间绑定到项目时的变量名）
  KV_BINDING: 'BLOG_KV',
  // Blob 命名空间（@edgeone/pages-blob getStore 名，自动创建）
  BLOB_STORE: 'typecho-uploads',
  // Cookie 名
  SESSION_COOKIE: 'te_sess',
  REMEMBER_COOKIE: 'te_remember',
  // 会话有效期（秒）
  SESSION_TTL: 60 * 60 * 24 * 7,
  // 默认每页文章数
  PAGE_SIZE: 10,
  // 评论每页数
  COMMENT_PAGE_SIZE: 10,
  // 默认主题
  DEFAULT_THEME: 'joe',
  // 版本
  VERSION: '1.0.0',
};
