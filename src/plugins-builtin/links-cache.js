/**
 * 内置插件：友链缓存（links-cache）—— 对应 Blog 主题 friends.php 页面的数据源
 * 页面正文每行：名称||URL||头像||描述||背景色，字段 mode 设为 links 生效。
 * 只有名称/URL 时也能工作；头像为空时用 weavatar 兜底。
 */
import { escapeHtml } from '../render/markdown.js';

const COLORS = [
  '#F072B6', '#4C83FF', '#46c47c', '#f9bb3c', '#EA5455', '#7367F0',
  '#ff9a9e', '#0396FF', '#FA742B', '#9F44D3', '#49C628', '#6fa3ef',
];

function safeUrl(value) {
  const url = String(value || '').trim();
  if (/^https?:\/\//i.test(url) || /^\//.test(url)) return escapeHtml(url);
  return '#';
}

function safeColor(value, index) {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : COLORS[index % COLORS.length];
}

export function register(api) {
  api.registerHook('renderContent', async (text, { post }) => {
    if (post?.fields?.mode === 'links' && !String(text).includes('class="blog_links')) {
      const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);
      const links = lines
        .map((l) => l.split('||').map((s) => s.trim()))
        .filter((p) => p.length >= 2 && p[0] && p[1])
        .map(([name, url, avatar, desc, color], index) => ({
          name,
          url: safeUrl(url),
          avatar: avatar || `https://weavatar.com/avatar/${encodeURIComponent(name)}?default=mp&size=100`,
          desc: desc || '',
          color: safeColor(color, index),
        }));

      return `<div class="blog_links">
  <ul class="blog_links__list">
    ${links
      .map(
        (l) => `<li class="blog_links__item">
      <a class="blog_links__card" href="${l.url}" target="_blank" rel="noopener noreferrer" style="background:${l.color}">
        <span class="blog_links__title">${escapeHtml(l.name)}</span>
        <div class="blog_links__content">
          <div class="blog_links__desc">${escapeHtml(l.desc)}</div>
          <img width="40" height="40" class="blog_links__avatar lazyload" src="${escapeHtml(l.avatar)}" alt="${escapeHtml(l.name)}" loading="lazy" />
        </div>
      </a>
    </li>`
      )
      .join('')}
  </ul>
</div>`;
    }
    return text;
  });
}

export const meta = {
  title: 'LinksCache',
  desc: '友链页面：正文每行「名称||URL||头像||描述||颜色」，字段 mode 设为 links 生效',
  author: '5iblog',
  version: '1.1.0',
};