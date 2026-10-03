/** HTML 辅助：分页、日期、头像等 */
import { escapeHtml } from './markdown.js';

/** Joe 风格分页（ul.joe_pagination） */
export function pageNav(page, pages, baseUrl, edge = 2) {
  if (pages <= 1) return '';
  const make = (p, html, cls = '') => {
    const url = p === 1 ? baseUrl : `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}page=${p}`;
    return `<li class="${cls}"><a href="${url}" title="第 ${p} 页">${html}</a></li>`;
  };
  let html = '<ul class="joe_pagination">';
  if (page > 1) html += make(page - 1, '&laquo;', 'prev');
  const nums = new Set([1, pages, page]);
  for (let d = 1; d <= edge; d++) {
    if (page - d >= 1) nums.add(page - d);
    if (page + d <= pages) nums.add(page + d);
  }
  const sorted = [...nums].sort((a, b) => a - b);
  let last = 0;
  for (const n of sorted) {
    if (n - last > 1) html += '<li class="gap"><a>...</a></li>';
    html += make(n, String(n), n === page ? 'active' : '');
    last = n;
  }
  if (page < pages) html += make(page + 1, '&raquo;', 'next');
  html += '</ul>';
  return html;
}

/** Cravatar/WeAvatar 兼容头像（国内可用） */
export function avatarUrl(mail, size = 100) {
  const m = String(mail || '').trim().toLowerCase();
  if (!m) return 'https://cravatar.cn/avatar/?d=mp&s=' + size;
  // 简易 MD5 不引入；使用 WeAvatar 的邮箱直传模式
  return `https://weavatar.com/avatar/${encodeURIComponent(m)}?default=mp&size=${size}`;
}

export function formatDate(ts, fmt = 'Y-m-d') {
  const d = new Date(ts * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return fmt
    .replace(/Y/g, d.getFullYear())
    .replace(/m/g, pad(d.getMonth() + 1))
    .replace(/d/g, pad(d.getDate()))
    .replace(/H/g, pad(d.getHours()))
    .replace(/i/g, pad(d.getMinutes()))
    .replace(/s/g, pad(d.getSeconds()));
}

/**
 * 内容缩略图：fields.thumb > 正文第一图 > 随机默认图
 *
 * 正文取图原来只认 Markdown 的 ![alt](url)。但从网页复制、或用富文本编辑器
 * 粘贴进来的正文里是 HTML 的 <img src="...">，那种文章即使有图也会一路
 * 回落到默认图。所以两种语法都认，并取文本上更靠前的那张，符合「正文第一图」。
 * data: 占位图（比如懒加载的 1x1 gif）不能当封面，遇到就跳过。
 */
export function thumbnail(content, themeAssets) {
  const f = content.fields || {};
  if (f.thumb) return f.thumb;
  const text = content.text || '';
  const first = [
    text.match(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/),
    text.match(/<img[^>]*\ssrc=["']([^"']+)["']/i),
  ]
    .filter((m) => m && !/^data:/i.test(m[1]))
    .sort((a, b) => a.index - b.index)[0];
  if (first) return first[1];
  const n = (content.cid % 42) + 1;
  return `${themeAssets}/thumb/${n}.jpg`;
}

export { escapeHtml };
