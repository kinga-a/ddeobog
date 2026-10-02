/**
 * 内置插件：友链缓存（links-cache）—— 对应 Joe 主题 friends.php 页面的数据源
 * 提供独立页面模板 [friends]（slug 为 friends 的页面正文按行解析 友链||URL||头像）
 * 同时演示 themeInit 钩子用法
 */
export function register(api) {
  api.registerHook('renderContent', async (text, { post }) => {
    if (post?.fields?.mode === 'links') {
      // 友链页面：text 每行 "名称||https://...||头像URL"
      const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);
      const links = lines
        .map((l) => l.split('||').map((s) => s.trim()))
        .filter((p) => p.length >= 2)
        .map(([name, url, avatar]) => ({ name, url, avatar: avatar || '' }));
      return `<div class="joe_links">
  <ul class="joe_links__list">
    ${links
      .map(
        (l) => `<li class="item">
      <a class="link" href="${l.url}" target="_blank" rel="noopener noreferrer">
        <img class="avatar" src="${l.avatar || `https://weavatar.com/avatar/${encodeURIComponent(l.name)}?default=mp&size=100`}" alt="${l.name}" loading="lazy" />
        <div class="info"><div class="name">${l.name}</div><div class="url">${l.url}</div></div>
      </a>
    </li>`
      )
      .join('')}
  </ul>
</div>
<style>.joe_links__list{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:15px;list-style:none;padding:0}.joe_links__list .item .link{display:flex;align-items:center;padding:15px;border:1px solid var(--classB);border-radius:8px;text-decoration:none;color:var(--routine)}.joe_links__list .item .avatar{width:48px;height:48px;border-radius:50%;margin-right:12px}.joe_links__list .item .name{font-weight:600}.joe_links__list .item .url{font-size:12px;opacity:.6;word-break:break-all}</style>`;
    }
    return text;
  });
}

export const meta = {
  title: 'LinksCache',
  desc: '友链页面渲染：正文每行 "名称||URL||头像"，字段 mode 设为 links 生效',
  author: 'TypechoEdge',
  version: '1.0.0',
};
