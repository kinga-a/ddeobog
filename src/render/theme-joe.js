/**
 * Joe 主题渲染器 —— 复用 Joe 主题原版 CSS/JS/静态资源
 * 服务端输出与 Joe DOM 结构一致的 HTML
 */
import { renderMarkdown, escapeHtml, plainExcerpt } from './markdown.js';
import { pageNav, avatarUrl, formatDate, thumbnail, parseStickIds } from './html.js';
import { CONFIG } from '../config.js';

const LAZYLOAD = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
/** 侧栏/搜索联想默认热门文章数 */
const DEFAULT_HOT_COUNT = 5;
/** 侧栏、滑出层头像尺寸 */
const SIDEBAR_AVATAR_SIZE = 75;
const SLIDEOUT_AVATAR_SIZE = 100;
const DEFAULT_ASSETS_BASE = '/usr/themes/joe';
/** 首页归档时间线最多展示的文章数 */
const TIMELINE_LIMIT = 120;

/** 建站日期输入容错：支持 2024/1/1、2024-01-01、2024/01/01 08:30 等写法 */
export function normalizeBirthday(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const m = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (!m) return '';
  const [, y, mo, d, h = '0', mi = '0', sec = '0'] = m;
  const p2 = (n) => String(n).padStart(2, '0');
  return `${y}/${p2(mo)}/${p2(d)} ${p2(h)}:${p2(mi)}:${p2(sec)}`;
}

/** 服务端预计算已运行时长，保证禁用 JS 时页脚也不是 0 */
function runtimeParts(value) {
  const normalized = normalizeBirthday(value);
  if (!normalized) return null;
  const start = new Date(normalized).getTime();
  if (!Number.isFinite(start)) return null;
  const diff = Math.max(0, Date.now() - start);
  const p2 = (n) => String(n).padStart(2, '0');
  return {
    day: p2(Math.floor(diff / 86400000)),
    hour: p2(Math.floor(diff / 3600000) % 24),
    minute: p2(Math.floor(diff / 60000) % 60),
    second: p2(Math.floor(diff / 1000) % 60),
  };
}

/** Joe 主题配置默认值（后台可改，存于 option theme:joe） */
export const JOE_DEFAULTS = {
  JFavicon: '/usr/themes/joe/assets/img/link.png',
  JLogo: '/usr/themes/joe/assets/img/aside_author_image.jpg',
  JBirthDay: '',
  JDocumentTitle: '',
  JAside_Author_Image: '/usr/themes/joe/assets/img/aside_author_image.jpg',
  JAside_Author_Avatar: '',
  JAside_Author_Nick: '',
  JAside_Author_Link: '#',
  JAside_Author_Motto: '有钱终成眷属，没钱亲眼目睹',
  JAside_Author_Nav: 'on',
  JAside_Hot_Num: '5',
  JAside_Newreply_Status: 'on',
  JAside_Timelife_Status: 'on',
  JAside_Flatterer: 'on',
  JCommentStatus: 'on',
  JGuestbook_Wall: 'on',
  JIndex_Hot: 'off',
  JIndex_Carousel_Status: 'off',
  JIndex_Carousel: '',
  JIndex_Recommend: '',
  JIndex_Ad_Status: 'off',
  JIndex_Ad: '',
  JIndex_Notice: '',
  JList_Animate: 'off',
  JOverdue: 'off',
  JNavMaxNum: '6',
  JHeader_Slideout_Image: '/usr/themes/joe/assets/img/aside_author_image.jpg',
  JFooter_Custom: '',
  JICP: '',
  JAssetsURL: '',
  JAvatarSource: 'weavatar',
  JStickPosts: '',
};

function assetsUrl(opts, path) {
  const base = opts.themeAssetsBase || '/usr/themes/joe';
  return `${base}/${path}`;
}

/**
 * 列表/封面用的缩略图地址。
 *
 * 没有自定义封面时 thumbnail() 会回落到主题内置的 /usr/themes/joe/assets/thumb/N.jpg，
 * 这是个相对路径。而页面上其它封面全是绝对地址，实测只有相对地址的这批会被懒加载
 * 脚本搞坏——运行时 src 和 data-src 双双变成字符串 "undefined"，图片直接不显示。
 * 统一补成绝对地址，既修掉这个问题，也让子目录部署时不会失效。
 */
function coverUrl(ctx, content) {
  const url = thumbnail(content, assetsUrl(ctx.options, 'assets'));
  return url.startsWith('/') ? `${ctx.siteUrl}${url}` : url;
}

/** 博主（管理员）信息；未安装多用户时回落到空对象 */
async function findOwner(db) {
  const users = await db.listUsers();
  return users.find((u) => u.group === 'administrator') || {};
}

/**
 * 热门文章 + 阅读数。
 * 搜索联想（headerBlock）和侧栏热门文章（asideBlock）都需要这份数据，
 * 此前两处各自重复「查索引 → 批量取统计 → 合并」三步。
 */
async function hotContentsWithViews(ctx, limit) {
  const size = Math.max(limit, 5);
  if (!ctx._hotPostsPromise || (ctx._hotPostsSize || 0) < size) {
    ctx._hotPostsSize = size;
    ctx._hotPostsPromise = (async () => {
      const list = await ctx.db.listContentsIndex({ type: 'post', pageSize: size, order: 'views' });
      return (await ctx.db.enrichWithStats(list)).items;
    })();
  }
  return (await ctx._hotPostsPromise).slice(0, limit);
}

/**
 * 站点统计（文章数 / 评论数）。
 * 同一请求内 header 滑出层、侧栏、关于板块都会用到，缓存到 ctx 避免重复读 KV。
 */
async function siteCounts(ctx) {
  if (!ctx._siteCounts) {
    ctx._siteCounts = Promise.all([
      ctx.db.listContentsIndex({ type: 'post', pageSize: 1 }),
      ctx.db.listAllComments({ status: 'approved', pageSize: 1 }),
    ]).then(([posts, comments]) => ({ posts: posts.total, comments: comments.total }));
  }
  return ctx._siteCounts;
}

/** window.Joe 全局配置 + 通用 head */
function headBlock(ctx) {
  const { options } = ctx;
  const a = (p) => assetsUrl(options, p);
  const avatarHost =
    options.joe.JAvatarSource === 'cravatar' ? 'https://cravatar.cn'
      : options.joe.JAvatarSource === 'gravatar' ? 'https://gravatar.com'
        : 'https://weavatar.com';
  // 首页轮播/广告首图常为外链，提前建立连接可加快 LCP
  const imageHosts = [...new Set(
    [
      parseBannerRows(options.joe.JIndex_Carousel, true, 1)[0]?.image,
      parseBannerRows(options.joe.JIndex_Ad, false, 1)[0]?.image,
    ]
      .filter(Boolean)
      .map((url) => {
        try {
          return new URL(url, ctx.siteUrl).origin;
        } catch {
          return '';
        }
      })
      .filter((origin) => origin && origin !== ctx.siteUrl)
  )].slice(0, 2);
  const imagePreconnect = imageHosts.map((h) => `<link rel="preconnect" href="${h}" crossorigin>`).join('\n');
  return `<meta name="theme-color" content="#ffffff">
${imagePreconnect}
<link rel="preconnect" href="${avatarHost}" crossorigin>
<script>
  localStorage.getItem("data-night") && document.querySelector("html").setAttribute("data-night", "night");
  // iOS Safari：让底部工具栏与安全区跟随夜间模式
  (function(){
    var meta = document.querySelector('meta[name="theme-color"]');
    function sync(){
      var night = document.documentElement.getAttribute("data-night") === "night";
      if (meta) meta.setAttribute("content", night ? "#121212" : "#ffffff");
    }
    sync();
    if (window.MutationObserver) {
      new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ["data-night"] });
    }
  })();
  window.Joe = {
    THEME_URL: \`${a('')}\`,
    BASE_API: \`/joe/api\`,
    DYNAMIC_BACKGROUND: \`\`,
    WALLPAPER_BACKGROUND_PC: \`\`,
    IS_MOBILE: /windows phone|iphone|android/gi.test(window.navigator.userAgent),
    BAIDU_PUSH: false,
    DOCUMENT_TITLE: \`${escapeHtml(options.joe.JDocumentTitle || '')}\`,
    LAZY_LOAD: \`${LAZYLOAD}\`,
    BIRTHDAY: \`${escapeHtml(normalizeBirthday(options.joe.JBirthDay))}\`,
    MOTTO: \`${escapeHtml(options.joe.JAside_Author_Motto || '')}\`,
    PAGE_SIZE: ${ctx.pageSize || 10}
  }
</script>
<style>
  body { font-family: 'Helvetica Neue', Helvetica, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', '微软雅黑', Arial, sans-serif; }
</style>`;
}

function cssLinks(ctx, extra = []) {
  const a = (p) => assetsUrl(ctx.options, p);
  const withVersion = (h) => `${h}${h.includes('?') ? '&' : '?'}v=${encodeURIComponent(CONFIG.VERSION)}`;
  const bodyText = ctx.post?.text || '';
  const hasMusic = /<joe-(mp3|music|mlist)\b/i.test(bodyText);
  const links = [
    a('assets/css/joe.mode.min.css'),
    a('assets/css/joe.normalize.min.css'),
    a('assets/css/joe.global.min.css'),
    a('assets/css/joe.responsive.min.css'),
    a('assets/lib/qmsg/qmsg.min.css'),
    a('assets/lib/animate.css@4.1.1/animate.min.css'),
    a('assets/lib/font-awesome@4.7.0/font-awesome.min.css'),
    // 本移植版补的主题缺失样式（侧栏两栏布局、搜索高亮），放在最后以覆盖主题自带规则
    a('assets/css/joe.layout.css'),
    ...extra,
    // 仅内容详情页需要图片灯箱样式；音乐播放器样式按正文短代码加载
    ...(ctx.post ? [a('assets/lib/fancybox@3.5.7/fancybox.min.css')] : []),
    ...(hasMusic ? [a('assets/lib/APlayer@1.10.1/APlayer.min.css')] : []),
    // 视觉精修层：必须最后加载，才能覆盖各页面自带的样式
    a('assets/css/joe.refine.css'),
  ];
  // 非首屏关键的样式异步加载，避免阻塞首屏渲染
  const deferredCss = ['qmsg', 'fancybox', 'animate.css', 'APlayer'];
  return links
    .map((h) => {
      const href = withVersion(h);
      if (deferredCss.some((key) => h.includes(key))) {
        return `<link rel="stylesheet" href="${href}" media="print" onload="this.media='all'" />\n<noscript><link rel="stylesheet" href="${href}" /></noscript>`;
      }
      return `<link href="${href}" rel="stylesheet" />`;
    })
    .join('\n');
}

function scripts(ctx, extra = []) {
  const a = (p) => assetsUrl(ctx.options, p);
  const withVersion = (h) => `${h}${h.includes('?') ? '&' : '?'}v=${encodeURIComponent(CONFIG.VERSION)}`;
  const bodyText = ctx.post?.text || '';
  const hasMusic = /<joe-(mp3|music|mlist)\b/i.test(bodyText);
  const list = [
    a('assets/lib/jquery@3.6.1/jquery.min.js'),
    a('assets/lib/scroll/scroll.min.js'),
    a('assets/lib/lazysizes@5.3.2/lazysizes.min.js'),
    a('assets/lib/extend/extend.min.js'),
    a('assets/lib/qmsg/qmsg.min.js'),
    a('assets/js/joe.global.min.js'),
    a('assets/js/joe.short.min.js'),
    a('assets/js/joe.search.js'),
    // 仅内容详情页需要：图片灯箱与评论画图
    ...(ctx.post ? [a('assets/lib/fancybox@3.5.7/fancybox.min.js'), a('assets/lib/sketchpad/sketchpad.min.js')] : []),
    // 仅正文出现音乐短代码时才加载播放器
    ...(hasMusic ? [a('assets/lib/APlayer@1.10.1/APlayer.min.js')] : []),
    ...extra,
  ];
  // defer：保持原有执行顺序，同时不阻塞 HTML 解析
  return list.map((s) => `<script src="${s ? withVersion(s) : s}" defer></script>`).join('\n');
}

/** 页头：导航 + 搜索 + 移动端抽屉 */
/* ------------------------------------------------------------------ *
 * 侧边滑出面板 .joe_header__slideout
 *
 * 之前只输出了一层 .joe_header__slideout-wrap + 扁平的 a.item 列表：
 *  -wrap 在主题 CSS 里零命中；-slideout 自身有 padding:135px 15px 15px，
 *   多包一层反而挤掉定位；
 *  - a.item 也没有规则，菜单完全没有样式（真实结构是 .link + .icon 的手风琴）。
 *
 * 5i.ink 的结构（主题 CSS 逐条对应）：
 *   .joe_header__slideout
 *     > img.joe_header__slideout-image     absolute/top 0/满宽 150px/object-fit:cover/z-index:-1
 *     > .joe_header__slideout-author       .avatar(50x50) + .info(.link + .motto)
 *     > ul.joe_header__slideout-count      li.item > svg.icon(15) + 累计撰写/收到
 *     > ul.joe_header__slideout-menu.panel-box
 *         li > a.link（首页）
 *         li > a.link.panel + ul.slides.panel-body（栏目 / 页面的手风琴，
 *              .in 时 .icon 旋转 90 度，由 joe.global.js 驱动）
 * ------------------------------------------------------------------ */
const SLIDEOUT_ICONS = {
  post: `<path d="M606.227 985.923H164.75c-69.715 0-126.404-56.722-126.404-126.442V126.477C38.346 56.755 95.04 0 164.75 0h619.275c69.715 0 126.549 56.755 126.549 126.477v503.925c0 18.216-14.814 32.997-33.07 32.997-18.183 0-32.925-14.78-32.925-32.997V126.477c0-33.355-27.2-60.488-60.554-60.488H164.75c-33.353 0-60.41 27.133-60.41 60.488v733.004c0 33.353 27.057 60.441 60.41 60.441h441.477c18.183 0 32.925 14.787 32.925 33.004 0 18.211-14.742 32.997-32.925 32.997zm0 0" />
          <path d="M657.62 322.056H291.154c-18.183 0-32.924-14.786-32.924-33.003 0-18.21 14.74-32.998 32.924-32.998H657.62c18.256 0 33.07 14.787 33.07 32.998 0 18.217-14.814 33.003-33.07 33.003zm0 0M657.62 504.749H291.154c-18.183 0-32.924-14.78-32.924-32.993 0-18.222 14.74-32.997 32.924-32.997H657.62c18.256 0 33.07 14.775 33.07 32.997 0 18.218-14.814 32.993-33.07 32.993zm0 0M445.611 687.486H291.154c-18.183 0-32.924-14.78-32.924-33.004 0-18.21 14.74-32.991 32.924-32.991h154.457c18.184 0 32.998 14.78 32.998 32.991 0 18.224-14.814 33.004-32.998 33.004zm0 0M866.482 1024c-8.447 0-16.896-3.225-23.34-9.662L577.595 748.786c-7.156-7.123-10.592-17.07-9.446-27.056l8.733-77.728c1.788-15.321 13.885-27.378 29.2-29.06l77.45-8.52c10.443-.965 19.9 2.433 26.905 9.449l265.558 265.551c12.875 12.877 12.875 33.784 0 46.666l-86.184 86.25c-6.438 6.437-14.887 9.662-23.33 9.662zm-231.05-310.646l231.05 231.018 39.575-39.62-231.043-231.05-35.505 3.938-4.076 35.714zm0 0" />`,
  comment: `<path d="M921.6 153.6H102.4A102.4 102.4 0 0 0 0 256v512a102.4 102.4 0 0 0 102.4 102.4h819.2A102.4 102.4 0 0 0 1024 768V256a102.4 102.4 0 0 0-102.4-102.4zM687.616 473.088L972.8 258.304V791.04zM960 204.8L527.104 527.36 73.216 204.8zM371.2 483.584l-320 287.232V256zM73.984 819.2l339.2-307.2 83.456 59.392a51.2 51.2 0 0 0 60.416 0l89.6-67.328L931.072 819.2z" />`,
  arrow: `<path d="M624.865 512.247L332.71 220.088c-12.28-12.27-12.28-32.186 0-44.457 12.27-12.28 32.186-12.28 44.457 0l314.388 314.388c12.28 12.27 12.28 32.186 0 44.457L377.167 848.863c-6.136 6.14-14.183 9.211-22.228 9.211s-16.092-3.071-22.228-9.211c-12.28-12.27-12.28-32.186 0-44.457l292.155-292.16z" />`,
};

async function slideoutBlock(ctx) {
  const { options, pages, path, db } = ctx;
  const isIndex = path === '/';

  // 与侧栏 author 区同源：昵称/头像取管理员，缺省回落到站点配置
  const owner = await findOwner(db);
  const nick = options.joe.JAside_Author_Nick || owner.screenName || '博主';
  const avatarSource = options.joe.JAvatarSource || 'weavatar';
  const avatar = options.joe.JAside_Author_Avatar || avatarUrl(owner.mail, SLIDEOUT_AVATAR_SIZE, avatarSource);
  const link = options.joe.JAside_Author_Link || '#';

  // 并行查询：站点统计（请求内复用）、分类、标签
  const [stat, nav] = await Promise.all([siteCounts(ctx), navMetas(ctx)]);
  const catIdx = nav.cats;
  const tagIdx = nav.tags;

  const metaLinks = (list, prefix) => list.map((m) => ({
    name: m.name,
    permalink: `${prefix}/${encodeURIComponent(m.slug)}/`,
  }));

  const categories = metaLinks(catIdx, '/category');
  const tags = metaLinks(tagIdx, '/tag');

  const icon = (svg, size) =>
    `<svg class="icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${svg}</svg>`;

  const subLink = (it) =>
    `<li><a class="link${it.permalink === path ? ' current' : ''}" href="${it.permalink}" title="${escapeHtml(it.name || it.title)}">${escapeHtml(it.name || it.title)}</a></li>`;

  // 手风琴分组：有子项才渲染；.slides 默认 display:none，由 .in 展开
  const group = (label, items) => {
    if (!items.length) return '';
    return `<li>
      <a class="link panel" href="#" rel="nofollow"><span>${label}</span>${icon(SLIDEOUT_ICONS.arrow, 13)}</a>
      <ul class="slides panel-body">${items.map(subLink).join('')}</ul>
    </li>`;
  };

  return `<div class="joe_header__slideout">
    <img width="100%" height="150" class="joe_header__slideout-image" src="${escapeHtml(options.joe.JHeader_Slideout_Image || options.joe.JAside_Author_Image)}" alt="侧边栏壁纸" />
    <div class="joe_header__slideout-author">
      <img width="50" height="50" class="avatar lazyload" src="${LAZYLOAD}" data-src="${escapeHtml(avatar)}" alt="博主头像"  decoding="async" / decoding="async">
      <div class="info">
        <a class="link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(nick)}</a>
        <p class="motto joe_motto"></p>
      </div>
    </div>
    <ul class="joe_header__slideout-count">
      <li class="item">
        ${icon(SLIDEOUT_ICONS.post, 15)}
        <span>累计撰写 <strong>${stat.posts}</strong> 篇文章</span>
      </li>
      <li class="item">
        ${icon(SLIDEOUT_ICONS.comment, 15)}
        <span>累计收到 <strong>${stat.comments}</strong> 条评论</span>
      </li>
    </ul>
    <ul class="joe_header__slideout-menu panel-box">
      <li><a class="link${isIndex ? ' current' : ''}" href="/" title="首页"><span>首页</span></a></li>
      ${group('分类', categories)}
      ${group('标签', tags)}
      ${group('页面', pages)}
    </ul>
  </div>`;
}

/** 分类/标签导航数据（同一请求内 header、侧栏、归档筛选复用） */
async function navMetas(ctx) {
  if (!ctx._navMetas) {
    ctx._navMetas = Promise.all([ctx.db.listMetas('category'), ctx.db.listMetas('tag')]).then(
      ([cats, tags]) => ({ cats, tags })
    );
  }
  return ctx._navMetas;
}

async function headerBlock(ctx) {
  const { options, pages, path, db } = ctx;
  const navMax = parseInt(options.joe.JNavMaxNum || '6', 10);
  // 「关于本站」固定为一级导航，独立页面列表里不再重复
  const navSource = pages.filter((p) => p.slug !== 'about' && p.slug !== 'guestbook');
  const navPages = navSource.slice(0, navMax);
  const morePages = navSource.slice(navMax);
  const isIndex = path === '/';
  const isArchive = path === '/archive' || path === '/archive/';
  const isAbout = path === '/about' || path === '/about/';
  const isGuestbook = path === '/guestbook' || path === '/guestbook/';

  // 搜索下拉的初始内容。与 5i.ink 一致：面板里的条目是服务端渲染的热门文章，
  // 主题 CSS 期望 .result .item > .sort(排名徽标) + .text(标题) + .views(阅读量)，
  // 前三条徽标自带红/橙/黄配色，hover 底色也由主题给。
  const suggestNum = parseInt(options.joe.JSearch_Hot_Num || String(DEFAULT_HOT_COUNT), 10) || DEFAULT_HOT_COUNT;
  const hotViews = await hotContentsWithViews(ctx, suggestNum);
  const suggestHtml = hotViews
    .map(
      (p, i) =>
        `<a href="${permalink(p)}" title="${escapeHtml(p.title)}" class="item">` +
        `<span class="sort">${i + 1}</span>` +
        `<span class="text">${escapeHtml(p.title)}</span>` +
        `<span class="views">${p.views} 阅读</span>` +
        `</a>`
    )
    .join('\n');
  return `<header class="joe_header${ctx.isPost ? ' current' : ''}">
  <div class="joe_header__above">
    <div class="joe_container">
      <svg class="joe_header__above-slideicon" viewBox="0 0 1152 1024" xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path d="M76.032 872a59.968 59.968 0 1 0 0 120h999.936a59.968 59.968 0 1 0 0-120H76.032zm16-420.032a59.968 59.968 0 1 0 0 120h599.936a59.968 59.968 0 0 0 0-119.936H92.032zM76.032 32a59.968 59.968 0 1 0 0 120h999.936a60.032 60.032 0 0 0 0-120H76.032z"/></svg>
      <a title="${escapeHtml(options.title)}" class="joe_header__above-logo" href="/">
        <img class="lazyload" src="${LAZYLOAD}" data-src="${escapeHtml(options.joe.JLogo)}" alt="${escapeHtml(options.title)}"  decoding="async" / decoding="async">
      </a>
      <nav class="joe_header__above-nav">
        <a class="item${isIndex ? ' active' : ''}" href="/" title="首页">首页</a>
        <a class="item${isArchive ? ' active' : ''}" href="/archive/" title="归档">归档</a>
        <a class="item${isGuestbook ? ' active' : ''}" href="/guestbook/" title="留言板">留言板</a>
        <a class="item${isAbout ? ' active' : ''}" href="/about/" title="关于本站">关于本站</a>
        ${navPages.map((p) => `<a class="item${path === p.permalink ? ' active' : ''}" href="${p.permalink}" title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</a>`).join('')}
        ${morePages.length ? `<div class="joe_dropdown" trigger="hover" placement="60px" style="margin-right: 15px;">
          <div class="joe_dropdown__link"><a href="#" rel="nofollow">更多</a></div>
          <nav class="joe_dropdown__menu">${morePages.map((p) => `<a href="${p.permalink}">${escapeHtml(p.title)}</a>`).join('')}</nav>
        </div>` : ''}
      </nav>
      <form class="joe_header__above-search" method="get" action="/search">
        <input maxlength="16" autocomplete="off" placeholder="请输入关键字..." name="s" value="" class="input" type="text" />
        <button type="submit" class="submit">搜索</button>
        <span class="icon"></span>
        <nav class="result">
          ${suggestHtml}
        </nav>
      </form>
      <svg class="joe_header__above-searchicon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path d="M1004.257 874.846 768.898 639.488a385.526 385.526 0 0 0 44.851-178.637C813.749 259.91 654.353 100.513 457.287 100.513S100.825 259.91 100.825 456.977c0 197.066 159.396 356.462 356.462 356.462 64.819 0 125.602-17.36 178.637-44.851l235.358 235.358a35.607 35.607 0 0 0 50.397 0l42.578-42.578a35.607 35.607 0 0 0 0-50.397zM457.287 723.833c-147.386 0-266.856-119.47-266.856-266.856s119.47-266.856 266.856-266.856 266.856 119.47 266.856 266.856-119.47 266.856-266.856 266.856z"/></svg>
    </div>
  </div>
  ${await slideoutBlock(ctx)}
  <div class="joe_header__searchout">
    <div class="joe_container">
      <div class="joe_header__searchout-inner">
        <form class="search" method="get" action="/search">
          <input maxlength="16" autocomplete="off" placeholder="请输入关键字..." name="s" value="" class="input" type="text" />
          <button type="submit" class="submit">搜索</button>
        </form>
      </div>
    </div>
  </div>
  <div class="joe_header__mask"></div>
</header>`;
}

/** 侧栏 */
async function asideBlock(ctx) {
  const { options, db } = ctx;
  const avatarSource = options.joe.JAvatarSource || 'weavatar';
  const hotNum = parseInt(options.joe.JAside_Hot_Num || String(DEFAULT_HOT_COUNT), 10) || DEFAULT_HOT_COUNT;

  // 并行查询所有独立数据（站点统计在同一请求内复用）
  const [owner, stat, hotViews, recentComments] = await Promise.all([
    findOwner(db),
    siteCounts(ctx),
    hotContentsWithViews(ctx, hotNum),
    db.recentComments(DEFAULT_HOT_COUNT),
  ]);

  let html = `<aside class="joe_aside">
  <section class="joe_aside__item author">
    <img width="100%" height="120" class="image lazyload" src="${LAZYLOAD}" data-src="${escapeHtml(options.joe.JAside_Author_Image)}" alt="博主栏壁纸"  decoding="async" / decoding="async">
    <div class="user">
      <img width="75" height="75" class="avatar lazyload" src="${LAZYLOAD}" data-src="${escapeHtml(options.joe.JAside_Author_Avatar || avatarUrl(owner.mail, SIDEBAR_AVATAR_SIZE, avatarSource))}" alt="博主头像"  decoding="async" / decoding="async">
      <a class="link" href="${escapeHtml(options.joe.JAside_Author_Link)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(options.joe.JAside_Author_Nick || owner.screenName || '博主')}</a>
      <p class="motto joe_motto"></p>
    </div>
    <div class="count">
      <div class="item" title="累计文章数"><span class="num">${stat.posts}</span><span>文章数</span></div>
      <div class="item" title="累计评论数"><span class="num">${stat.comments}</span><span>评论量</span></div>
    </div>
  </section>`;

  if (options.joe.JAside_Timelife_Status === 'on') {
    html += `<section class="joe_aside__item timelife">
      <div class="joe_aside__item-title"><span class="text">人生倒计时</span><span class="line"></span></div>
      <div class="joe_aside__item-contain"></div>
    </section>`;
  }

  if (hotViews.length) {
    html += `<section class="joe_aside__item hot">
      <div class="joe_aside__item-title"><span class="text">热门文章</span><span class="line"></span></div>
      <ol class="joe_aside__item-contain">
        ${hotViews.map((p, i) => `<li class="item">
          <a class="link" href="${permalink(p)}" title="${escapeHtml(p.title)}">
            <i class="sort">${i + 1}</i>
            <img width="100%" height="130" class="image lazyload" src="${LAZYLOAD}" data-src="${escapeHtml(coverUrl(ctx, p))}" alt="${escapeHtml(p.title)}"  decoding="async" / decoding="async">
            <div class="describe"><h6>${escapeHtml(p.title)}</h6><span>${p.views} 阅读 - ${formatDate(p.created, 'm/d')}</span></div>
          </a>
        </li>`).join('')}
      </ol>
    </section>`;
  }

  if (options.joe.JAside_Newreply_Status === 'on' && recentComments.length) {
    html += `<section class="joe_aside__item newreply">
      <div class="joe_aside__item-title"><span class="text">最新回复</span><span class="line"></span></div>
      <ul class="joe_aside__item-contain">
        ${recentComments.map((c) => `<li class="item">
          <div class="user">
            <img width="40" height="40" class="avatar lazyload" src="${LAZYLOAD}" data-src="${avatarUrl(c.mail, 40, avatarSource)}" alt="${escapeHtml(c.author)}"  decoding="async" / decoding="async">
            <div class="info"><div class="author">${escapeHtml(c.author)}</div><span class="date">${formatDate(c.created, 'Y-m-d')}</span></div>
          </div>
          <div class="reply"><a class="link" href="${commentAnchor(c)}">${escapeHtml(plainExcerpt(c.text, 40))}</a></div>
        </li>`).join('')}
      </ul>
    </section>`;
  }

  if (options.joe.JAside_Flatterer === 'on') {
    html += `<section class="joe_aside__item flatterer">
      <div class="joe_aside__item-title"><span class="text">舔狗日记</span><span class="line"></span></div>
      <div class="joe_aside__item-contain"><div class="content"></div><div class="change">❤️</div></div>
    </section>`;
    html += `<style>.joe-aside__item.flatterer .change{display:flex;justify-content:center;align-items:center;font-size:20px;color:#e74c3c;cursor:pointer;transition:transform 0.2s;}.joe-aside__item.flatterer .change:hover{transform:scale(1.2);}</style>`;
  }

  html += `</aside>`;
  return html;
}

/** 评论定位锚点（文章页的 #comment-coid） */
function commentAnchor(c) {
  return `/archives/${c.cid}/#comment-${c.coid}`;
}

/** 页脚 + 侧边操作按钮 */
function footerBlock(ctx) {
  const { options } = ctx;
  const run = runtimeParts(options.joe.JBirthDay) || { day: '0', hour: '0', minute: '0', second: '0' };
  // 只有文章页才输出目录按钮和面板，独立页面/首页/归档页都不显示
  const tocHtml = (ctx.post && ctx.post.type === 'post') ? `
  <div class="joe_action_item toc" id="JoeTocBtn" role="button" tabindex="0"
       aria-controls="JoeTocPanel" aria-expanded="false" aria-label="文章目录" hidden>
    <svg class="icon-1" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="25" height="25">
      <path d="M384 170.667h512a42.667 42.667 0 1 1 0 85.333H384a42.667 42.667 0 0 1 0-85.333zM384 469.333h512a42.667 42.667 0 1 1 0 85.334H384a42.667 42.667 0 0 1 0-85.334zM384 768h512a42.667 42.667 0 1 1 0 85.333H384a42.667 42.667 0 0 1 0-85.333zM149.333 149.333a64 64 0 1 1 0 128 64 64 0 0 1 0-128zM149.333 448a64 64 0 1 1 0 128 64 64 0 0 1 0-128zM149.333 746.667a64 64 0 1 1 0 128 64 64 0 0 1 0-128z" />
    </svg>
    <svg class="icon-2" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="25" height="25">
      <path d="M320 170.667h576a42.667 42.667 0 1 1 0 85.333H320a42.667 42.667 0 0 1 0-85.333zM320 469.333h576a42.667 42.667 0 1 1 0 85.334H320a42.667 42.667 0 0 1 0-85.334zM320 768h576a42.667 42.667 0 1 1 0 85.333H320a42.667 42.667 0 0 1 0-85.333zM245.333 128 96 213.333l149.333 85.334V128zM245.333 426.667 96 512l149.333 85.333V426.667zM245.333 725.333 96 810.667l149.333 85.333V725.333z" />
    </svg>
  </div>
  <div class="joe_toc" id="JoeTocPanel" hidden>
    <div class="joe_toc__head">
      <span class="joe_toc__label">目录</span>
      <span class="joe_toc__count"></span>
    </div>
    <nav class="joe_toc__body" aria-label="文章目录"></nav>
  </div>` : '';
  return `<footer class="joe_footer">
  <div class="joe_container">
    <div class="joe_footer__above">
      <div class="joe_footer__above-item">
        <a href="/" title="${escapeHtml(options.title)}">${escapeHtml(options.title)}</a>
        <em>|</em>
        <span>Powered by <a href="https://github.com/typecho/typecho" target="_blank" rel="noopener noreferrer">Typecho</a> . Theme by <a href="https://78.al" target="_blank" rel="noopener noreferrer">Joe</a> . Hosted on <a href="https://edgeone.ai" target="_blank" rel="noopener noreferrer">EdgeOne</a></span>
      </div>
      <div class="joe_footer__above-item">
        ${options.joe.JICP ? `<a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">${escapeHtml(options.joe.JICP)}</a>` : ''}
        ${options.joe.JFooter_Custom || ''}
      </div>
    </div>
    <div class="joe_footer__below">
      <div class="joe_footer__below-item run">
        <span class="text">已运行</span>
        <span class="joe_run__day">${run.day}</span><span class="text">天</span>
        <span class="joe_run__hour">${run.hour}</span><span class="text">小时</span>
        <span class="joe_run__minute">${run.minute}</span><span class="text">分</span>
        <span class="joe_run__second">${run.second}</span><span class="text">秒</span>
      </div>
      <div class="joe_footer__below-item">
        <span>© ${new Date().getFullYear()} ${escapeHtml(options.title)} · ${escapeHtml(options.description || '')}</span>
      </div>
    </div>
  </div>
</footer>
<div class="joe_action">
  <div class="joe_action_item scroll">
    <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="25" height="25"> <path d="M725.902 498.916c18.205-251.45-93.298-410.738-205.369-475.592l-6.257-3.982-6.258 3.414c-111.502 64.853-224.711 224.142-204.8 475.59-55.751 53.476-80.214 116.623-80.214 204.8v15.36l179.2-35.27c11.378 40.39 58.596 69.973 113.21 69.973 54.613 0 101.262-29.582 112.64-68.836l180.337 36.41v-15.36c-.569-89.885-25.031-153.6-82.489-206.507zM571.733 392.533c-33.564 31.29-87.04 28.445-118.329-5.12s-28.444-87.04 5.12-117.76c33.565-31.289 87.04-28.444 118.33 5.12s28.444 86.471-5.12 117.76zm-56.32 368.64c-35.84 0-64.284 29.014-64.284 64.285 0 35.84 54.044 182.613 64.284 182.613s64.285-146.773 64.285-182.613c0-35.271-29.014-64.285-64.285-64.285z" /> </svg>
  </div>${tocHtml}
  <div class="joe_action_item mode">
    <svg class="icon-1" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="25" height="25"> <path d="M587.264 104.96c33.28 57.856 52.224 124.928 52.224 196.608 0 218.112-176.128 394.752-393.728 394.752-29.696 0-58.368-3.584-86.528-9.728C223.744 832.512 369.152 934.4 538.624 934.4c229.376 0 414.72-186.368 414.72-416.256 1.024-212.992-159.744-389.12-366.08-413.184z" /> <path d="M340.48 567.808l-23.552-70.144-70.144-23.552 70.144-23.552 23.552-70.144 23.552 70.144 70.144 23.552-70.144 23.552-23.552 70.144zM168.96 361.472l-30.208-91.136-91.648-30.208 91.136-30.208 30.72-91.648 30.208 91.136 91.136 30.208-91.136 30.208-30.208 91.648z" /> </svg>
    <svg class="icon-2" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="25" height="25"> <path d="M234.24 512a277.76 277.76 0 1 0 555.52 0 277.76 277.76 0 1 0-555.52 0zM512 187.733a42.667 42.667 0 0 1-42.667-42.666v-102.4a42.667 42.667 0 0 1 85.334 0v102.826A42.667 42.667 0 0 1 512 187.733zm-258.987 107.52a42.667 42.667 0 0 1-29.866-12.373l-72.96-73.387a42.667 42.667 0 0 1 59.306-59.306l73.387 72.96a42.667 42.667 0 0 1 0 59.733 42.667 42.667 0 0 1-29.867 12.373zm-107.52 259.414H42.667a42.667 42.667 0 0 1 0-85.334h102.826a42.667 42.667 0 0 1 0 85.334zm34.134 331.946a42.667 42.667 0 0 1-29.44-72.106l72.96-73.387a42.667 42.667 0 0 1 59.733 59.733l-73.387 73.387a42.667 42.667 0 0 1-29.866 12.373zM512 1024a42.667 42.667 0 0 1-42.667-42.667V878.507a42.667 42.667 0 0 1 85.334 0v102.826A42.667 42.667 0 0 1 512 1024zm332.373-137.387a42.667 42.667 0 0 1-29.866-12.373l-73.387-73.387a42.667 42.667 0 0 1 0-59.733 42.667 42.667 0 0 1 59.733 0l72.96 73.387a42.667 42.667 0 0 1-29.44 72.106zm136.96-331.946H878.507a42.667 42.667 0 1 1 0-85.334h102.826a42.667 42.667 0 0 1 0 85.334zM770.987 295.253a42.667 42.667 0 0 1-29.867-12.373 42.667 42.667 0 0 1 0-59.733l73.387-72.96a42.667 42.667 0 1 1 59.306 59.306l-72.96 73.387a42.667 42.667 0 0 1-29.866 12.373z" /> </svg>
  </div>
</div>`;
}

/** HTML 文档骨架 */
async function layout(ctx, { title, meta = '', css = [], js = [], bodyClass = '' }) {
  const { options } = ctx;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="renderer" content="webkit" />
  <meta name="viewport" content="width=device-width, user-scalable=no, initial-scale=1.0, shrink-to-fit=no, viewport-fit=cover">
  <link rel="shortcut icon" href="${escapeHtml(options.joe.JFavicon)}" />
  <title>${title}</title>
  ${meta}
  ${cssLinks(ctx, css)}
  ${headBlock(ctx)}
  ${scripts(ctx, js)}
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
  <div id="Joe">
    ${await headerBlock(ctx)}
    ${ctx.contentBody || ''}
    ${footerBlock(ctx)}
  </div>
</body>
</html>`;
}

/* ------------------------------------------------------------------ *
 * 文章底部：标签胶囊 + 分享面板
 *
 * 主题 CSS 只认 .joe_detail__operate（胶囊标签：::before 圆点 + ::after 的 # 号背景图，
 * 分享面板 .reach 靠 .active 上滑展开）。之前移植版输出的是 .joe_detail__tags，
 * 主题 CSS 里零命中——渲染出来就是一排没样式的裸链接。
 *
 * 结构与 5i.ink 一致：
 *   .joe_detail__operate
 *     > .joe_detail__operate-tags    无标签时输出「暂无标签」占位
 *     > .joe_detail__operate-share > svg(26) + .reach(QQ / QQ空间 / 新浪微博)
 *
 * 5i.ink 的模板里第四个「生成海报分享」是注释掉的（依赖海报插件），这里同样不输出。
 * ------------------------------------------------------------------ */
const SHARE_MAIN_SVG = `<path d="M13.4 512.8c0 276 224 500 500 500s500-224 500-500-224-500-500-500c-276.6 0-500 224-500 500z" fill="#8F7DF6" />
            <path d="M513.4 233.8c13 0 23.8 10.6 23.8 23.8 0 13-10.6 23.8-23.8 23.8-128 0-231.6 103.8-231.6 231.6s103.8 231.6 231.6 231.6S745 640.8 745 513c-.4-13 9.8-24 22.8-24.6 13-.4 24 9.8 24.6 22.8v1.6c0 154-125 279-279 279s-279-125-279-279 125-279 279-279zM657 352.4c-8.6-9.6-7.8-24.4 1.8-33 9-8 22.6-8 31.4.2l40.8 40.8c12.4 12.2 12.4 32.2 0 44.6l-40.8 41c-9.4 8.8-24 8.6-33-.8-8.6-9-8.6-23.2 0-32.2l7-7h-30c-81.8 0-109.6 34.8-109.6 140.2 0 12.8-10.4 23.2-23.2 23.2-12.8 0-23.2-10.4-23.2-23.2 0-130.2 47.6-186.8 156.2-186.8h30l-7.4-7z" fill="#FFF" />`;
const SHARE_ICONS = {
  qq: `<svg class="icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="30" height="30">
                    <path d="M512 73.28A438.72 438.72 0 1 0 950.72 512 438.72 438.72 0 0 0 512 73.28zM759.84 646.4c-9.6 8.16-20.8-6.08-29.76-20.32s-14.88-26.72-16-21.76a158.4 158.4 0 0 1-37.44 70.72c-1.28 1.6 28.8 12.48 37.44 35.68s24 57.6-80 68.8a145.76 145.76 0 0 1-80-16c-16.96-8.32-27.52-16-29.6-16a73.6 73.6 0 0 1-13.28 0 108 108 0 0 1-14.4 0c-1.76 0-22.24 32-113.12 32-70.4 0-88.64-44.32-74.4-68.8s37.76-32 34.4-35.36a192 192 0 0 1-34.4-57.6 98.56 98.56 0 0 1-4.16-13.44c-1.28-4.64-6.56 8.64-13.92 21.76s-14.4 22.72-22.88 22.72a11.52 11.52 0 0 1-6.56-2.4c-20.96-16-19.2-55.2-5.44-93.12s48-75.04 48-83.2c1.28-30.24-3.04-35.2 0-43.2 6.56-17.76 14.72-10.88 14.72-20.16 0-116.32 86.4-210.56 192.96-210.56s192.96 94.24 192.96 210.56c0 4.48 11.68 0 17.12 20.16a196.96 196.96 0 0 1 0 43.2c0 11.04 29.44 24.48 44.8 83.2S768 640 759.84 646.4z" fill="#68A5E1" />
                </svg>`,
  qzone: `<svg class="icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="30" height="30">
                    <path d="M512 73.28A438.72 438.72 0 1 0 950.72 512 438.72 438.72 0 0 0 512 73.28zM829.92 432c5.6 16-150.24 146.4-150.24 146.4s2.08 12.64 4.16 22.08c0 0-72.64 2.24-132.32 0-32-1.28-69.12-7.04-69.12-7.04L656 470.24a1005.44 1005.44 0 0 0-125.76-13.6A908 908 0 0 0 380 463.36c-6.4 1.76 44.8 1.6 103.04 6.88 40.8 3.68 94.56 13.44 94.56 13.44l-172.8 128s73.92 4.48 140.32 4.16c74.72 0 142.24-9.92 142.72-8 12.96 56.16 36.96 167.52 28 176-12.16 12.32-185.6-97.6-185.6-97.6S368 785.6 345.92 785.6a3.68 3.68 0 0 1-2.08 0c-10.72-8.8 35.52-206.72 35.52-206.72S222.72 448 229.12 432s208-30.24 208-30.24 74.88-188 92.48-188 92.8 188 92.8 188S824.32 416 829.92 432z" fill="#F5BE3F" />
                </svg>`,
  weibo: `<svg class="icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="30" height="30">
                    <path d="M480.8 457.76a271.04 271.04 0 0 0-37.28 2.72c-96 13.44-166.72 75.04-157.92 137.44s93.6 101.92 189.6 88.48 166.72-75.04 157.92-137.44c-7.68-54.08-73.12-91.04-152.32-91.2zm-23.36 211.52a122.08 122.08 0 0 1-24 2.4c-48 0-88-27.52-96-68.32-9.28-48 29.44-95.2 86.56-106.24s110.88 18.4 120 66.08-29.44 95.04-86.56 106.08z" fill="#F56467" />
                    <path d="M512 73.28A438.72 438.72 0 1 0 950.72 512 438.72 438.72 0 0 0 512 73.28zm-43.84 666.88c-150.24 0-272-78.56-272-176S378.56 314.72 448 314.72c29.28 0 86.56 21.76 46.4 90.88a246.24 246.24 0 0 0 34.08-10.08c32-9.12 76.96-18.24 107.68 0 51.04 29.6 0 77.12 0 82.4s102.4 5.28 102.4 87.2c.32 96.48-120.16 175.04-270.4 175.04zm213.76-358.88a56 56 0 0 0-47.2-16 16.96 16.96 0 0 1-17.28-14.4 12.16 12.16 0 0 0 0 2.4v-4.8a12.16 12.16 0 0 0 0 2.4 20.48 20.48 0 0 1 17.28-17.28 77.28 77.28 0 0 1 68.32 18.56c32 28.48 18.72 75.68 18.72 75.68a21.28 21.28 0 0 1-20.48 17.28h-1.76a12.48 12.48 0 0 1-12.8-16.8 49.44 49.44 0 0 0-4.8-47.04zm120.16 60.64A29.6 29.6 0 0 1 776 467.84a22.08 22.08 0 0 1-19.68-25.92A139.2 139.2 0 0 0 736 336c-34.88-50.08-109.92-41.28-109.92-41.28A26.24 26.24 0 0 1 599.84 272v2.88-5.6V272a26.56 26.56 0 0 1 26.24-23.52 188.32 188.32 0 0 1 136.16 47.04c58.08 55.04 39.84 146.4 39.84 146.4z" fill="#F56467" />
                    <path d="M459.36 547.04a17.6 17.6 0 1 0 17.6 17.6 17.6 17.6 0 0 0-17.6-17.6zm-44.32 23.2a43.52 43.52 0 0 0-18.4 4.32A32 32 0 0 0 376 613.12a32 32 0 0 0 42.88 9.12 32 32 0 0 0 20.64-38.72 25.76 25.76 0 0 0-24.48-13.28z" fill="#F56467" />
                </svg>`,
};

function operateBlock(ctx, post, tags) {
  const enc = encodeURIComponent;
  const url = `${ctx.siteUrl}${permalink(post)}`;
  const title = post.title || ctx.options.title;
  // 分享平台的封面图只吃绝对地址，主题自带的占位缩略图（相对路径）就不传了
  const thumb = thumbnail(post, assetsUrl(ctx.options, 'assets'));
  const pic = /^https?:\/\//.test(thumb) ? enc(thumb) : '';

  const tagsHtml = tags.length
    ? tags.map((t) => `<a href="${t.permalink}" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</a>`).join('')
    : `<a href="javascript: void(0);">暂无标签</a>`;

  const item = (href, label, svg) =>
    `<a href="${href}" target="_blank" rel="noopener noreferrer" title="${label}">${svg}</a>`;

  return `<div class="joe_detail__operate">
  <div class="joe_detail__operate-tags">${tagsHtml}</div>
  <div class="joe_detail__operate-share">
    <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="26" height="26">${SHARE_MAIN_SVG}</svg>
    <div class="reach">
      ${item(`https://connect.qq.com/widget/shareqq/index.html?url=${enc(url)}&title=${enc(title)}${pic ? `&pics=${pic}` : ''}`, '分享到QQ', SHARE_ICONS.qq)}
      ${item(`https://sns.qzone.qq.com/cgi-bin/qzshare/cgi_qzshare_onekey?url=${enc(url)}&sharesource=qzone&title=${enc(title)}${pic ? `&pics=${pic}` : ''}`, '分享到QQ空间', SHARE_ICONS.qzone)}
      ${item(`http://service.weibo.com/share/share.php?sharesource=weibo&title=${enc(`分享：${title}，原文链接：${url}`)}${pic ? `&pic=${pic}` : ''}`, '分享到新浪微博', SHARE_ICONS.weibo)}
    </div>
  </div>
</div>`;
}

export function permalink(content) {
  if (content.type === 'page') return `/${content.slug}/`;
  if (content.type === 'attachment') return `/attachment/${content.cid}/`;
  return `/archives/${content.cid}/`;
}

/** 分类/标签对象渲染辅助（批量加载） */
export async function contentMetas(db, content) {
  const allMids = [...(content.categories || []), ...(content.tags || [])];
  if (!allMids.length) return { cats: [], tags: [] };
  const metas = await db.getMetasBatch(allMids);
  const byMid = new Map(metas.map((m) => [m.mid, m]));
  const cats = [], tags = [];
  for (const mid of content.categories || []) {
    const m = byMid.get(mid);
    if (m) cats.push({ ...m, permalink: `/category/${encodeURIComponent(m.slug)}/` });
  }
  for (const mid of content.tags || []) {
    const m = byMid.get(mid);
    if (m) tags.push({ ...m, permalink: `/tag/${encodeURIComponent(m.slug)}/` });
  }
  return { cats, tags };
}

/* ==================== 页面渲染 ==================== */

/** 按「顶置文章IDs」把命中项前置并按其顺序排列，其余保持原顺序 */
function applyStickOrder(items, stickIds) {
  if (!stickIds.length) return items;
  const stickSet = new Set(stickIds);
  const stickPosts = items.filter((p) => stickSet.has(String(p.cid)));
  const regularPosts = items.filter((p) => !stickSet.has(String(p.cid)));
  stickPosts.sort((a, b) => stickIds.indexOf(String(a.cid)) - stickIds.indexOf(String(b.cid)));
  return [...stickPosts, ...regularPosts];
}

// 首页标题栏筛选用图标（跟随文字颜色 currentColor）
const FILTER_ICONS = {
  category: 'M896 288H512l-96-96H128c-35.3 0-64 28.7-64 64v512c0 35.3 28.7 64 64 64h768c35.3 0 64-28.7 64-64V352c0-35.3-28.7-64-64-64z',
  tag: 'M128 96h288l448 448-288 288L128 384V96zm96 128v256l320 320 192-192-320-320H224zm0 32a48 48 0 1 0 0 96 48 48 0 0 0 0-96z',
};

const filterIcon = (d) =>
  `<svg class="icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path d="${d}" /></svg>`;

/**
 * 首页标题栏右侧的「分类 / 标签」展开面板。
 * 默认收起，点开显示全部，点别处收起（交互由 joe.index.js 驱动）。
 */
async function buildIndexFilter(ctx) {
  const { cats: catIdx, tags: tagIdx } = await navMetas(ctx);
  const catMeta = catIdx.map((m) => ({ name: m.name, href: `/category/${encodeURIComponent(m.slug)}/` }));
  const tagMeta = tagIdx.map((m) => ({ name: m.name, href: `/tag/${encodeURIComponent(m.slug)}/` }));
  if (!catMeta.length && !tagMeta.length) return '';

  const filterBtn = (label, kind, count) =>
    count
      ? `<button type="button" class="joe_index__title-filter-btn" data-panel="${kind}" aria-expanded="false">${filterIcon(FILTER_ICONS[kind])}${label}</button>`
      : '';
  const filterPanel = (kind, metas) =>
    metas.length
      ? `<div class="joe_index__title-filter-panel joe_index__title-filter-panel--${kind}" hidden>
          <ul class="slides">${metas
            .map((m) => `<li><a class="link" href="${m.href}" title="${escapeHtml(m.name)}" target="_blank" rel="noopener noreferrer">${escapeHtml(m.name)}</a></li>`)
            .join('')}</ul>
        </div>`
      : '';
  return `<div class="joe_index__title-filter">
        ${filterBtn('分类', 'category', catMeta.length)}
        ${filterBtn('标签', 'tag', tagMeta.length)}
        ${filterPanel('category', catMeta)}
        ${filterPanel('tag', tagMeta)}
      </div>`;
}

const pad2 = (n) => String(n).padStart(2, '0');

/** 按年 → 月分组（列表本身已按时间倒序） */
function groupByYearMonth(items) {
  const years = new Map();
  for (const p of items) {
    const d = new Date(p.created * 1000);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    if (!years.has(y)) years.set(y, new Map());
    const months = years.get(y);
    if (!months.has(m)) months.set(m, []);
    months.get(m).push(p);
  }
  return years;
}

const CENSUS_COLORS = ['#1cc88a', '#36b9cc', '#2196f3', '#9c27b0', '#f6a821', '#fe2d46'];

const CENSUS_ICONS = {
  post: `<svg class="icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="30" height="30"><path d="M947.2 298.667c0-34.134-12.8-68.267-38.4-89.6L814.933 115.2c-51.2-51.2-132.266-51.2-179.2 0l-512 516.267c-25.6 21.333-38.4 55.466-38.4 89.6v132.266c0 46.934 38.4 85.334 81.067 85.334h682.667c25.6 0 42.666-17.067 42.666-42.667s-17.066-42.667-42.666-42.667h-409.6L908.8 388.267c25.6-25.6 38.4-55.467 38.4-89.6zM170.667 853.333V721.067c0-12.8 4.266-21.334 12.8-29.867l413.866-418.133 153.6 153.6-413.866 413.866c-8.534 8.534-21.334 12.8-34.134 12.8H170.667zm678.4-524.8l-38.4 38.4-153.6-153.6 38.4-38.4c8.533-8.533 21.333-12.8 29.866-12.8 12.8 0 21.334 4.267 29.867 12.8l93.867 93.867c8.533 8.533 12.8 17.067 12.8 29.867s-4.267 21.333-12.8 29.866z" /></svg>`,
  comment: `<svg class="icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path d="M511.914 928.016c-8.257 0-16.341-3.096-22.706-9.46l-95.984-95.985c-12.557-12.557-12.557-32.682 0-45.24s32.683-12.556 45.24 0l73.45 73.45 73.45-73.45c6.02-6.02 14.105-9.46 22.706-9.46h223.962c17.718 0 31.995-14.277 31.995-31.995V223.962c0-17.545-14.277-31.994-31.995-31.994H192.14c-17.546 0-31.995 14.449-31.995 31.994v511.914c0 17.718 14.45 31.995 31.995 31.995h95.984c17.717 0 31.994 14.277 31.994 31.995s-14.277 31.994-31.994 31.994H192.14c-52.98 0-95.984-43.003-95.984-95.984V223.962c0-52.98 43.003-95.984 95.984-95.984h639.892c52.98 0 95.984 43.004 95.984 95.984v511.914c0 52.98-43.003 95.984-95.984 95.984H621.143l-86.523 86.695c-6.193 6.193-14.45 9.461-22.706 9.461z" /><path d="M335.944 511.914c-26.49 0-47.992-21.502-47.992-47.992s21.501-47.992 47.992-47.992 47.991 21.502 47.991 47.992-21.501 47.992-47.991 47.992zm191.967 0c-26.49 0-47.992-21.502-47.992-47.992s21.502-47.992 47.992-47.992 47.992 21.502 47.992 47.992-21.502 47.992-47.992 47.992zm192.14 0c-26.49 0-47.992-21.502-47.992-47.992s21.502-47.992 47.992-47.992 47.992 21.502 47.992 47.992-21.674 47.992-47.992 47.992z" /></svg>`,
  category: `<svg class="icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="28" height="28"><path d="M166.79 123.639v778.578l311.724-133.273a86.303 86.303 0 0 1 64.857-1.208L857.21 888.279v-764.64H166.79zM145.215 58.91h733.57a43.151 43.151 0 0 1 43.152 43.152v817.608a43.151 43.151 0 0 1-58.62 40.282l-343.14-131.806a21.576 21.576 0 0 0-16.225.303L162.194 974.582a43.151 43.151 0 0 1-60.132-39.678V102.062a43.151 43.151 0 0 1 43.153-43.15z" /><path d="M329.816 411.307a32.363 32.363 0 1 1 0-64.727h364.368a32.363 32.363 0 1 1 0 64.727H329.816zm0 170.814a32.363 32.363 0 1 1 0-64.728h364.368a32.363 32.363 0 1 1 0 64.728H329.816z" /></svg>`,
  tag: `<svg class="icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="28" height="28"><path d="M128 128h320l448 448-320 448-448-448V128zm160 96a64 64 0 1 0 0 128 64 64 0 0 0 0-128z" /></svg>`,
};

const CENSUS_ARROW = `<svg class="icon joe_filing-arrow" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="12" height="12"><path d="M624.865 512.247L332.71 220.088c-12.28-12.27-12.28-32.186 0-44.457 12.27-12.28 32.186-12.28 44.457 0l314.388 314.388c12.28 12.27 12.28 32.186 0 44.457L377.167 848.863c-6.136 6.14-14.183 9.211-22.228 9.211s-16.092-3.071-22.228-9.211c-12.28-12.27-12.28-32.186 0-44.457l292.155-292.16z" /></svg>`;

/** 归档页筛选条：全部 / 分类 / 标签 */
function archiveFilters(filters) {
  const { cats, tags, activeMeta, allCount } = filters;
  const chip = (label, href, count, active) =>
    `<a class="joe_archive-filters__item${active ? ' active' : ''}" href="${href}">${escapeHtml(label)}<span>${count}</span></a>`;
  const tagGroup = tags.length
    ? `<span class="joe_archive-filters__label">标签</span>
      ${tags.map((m) => chip(m.name, `/archive/?tag=${encodeURIComponent(m.slug)}`, m.count || 0, activeMeta?.mid === m.mid)).join('')}`
    : '';
  return `<nav class="joe_archive-filters" aria-label="按分类或标签筛选">
      <span class="joe_archive-filters__label">分类</span>
      ${chip('全部', '/archive/', allCount, !activeMeta)}
      ${cats.map((m) => chip(m.name, `/archive/?cat=${encodeURIComponent(m.slug)}`, m.count || 0, activeMeta?.mid === m.mid)).join('')}
      ${tagGroup}
    </nav>`;
}

function censusCard(label, value, icon) {
  return `<div class="list">
      <div class="count"><h6>${label}</h6><p>${value}</p></div>
      ${icon}
    </div>`;
}

/** 分类分布环图（纯 CSS，不依赖 ECharts） */
function categoryPie(cats) {
  const total = cats.reduce((sum, m) => sum + (m.count || 0), 0);
  if (!total) return '<p class="joe_archive-pie__empty">暂无分类数据</p>';
  let acc = 0;
  const stops = [];
  const legend = [];
  cats.forEach((m, i) => {
    const count = m.count || 0;
    if (!count) return;
    const color = CENSUS_COLORS[i % CENSUS_COLORS.length];
    const start = (acc / total) * 100;
    acc += count;
    const end = (acc / total) * 100;
    stops.push(`${color} ${start.toFixed(2)}% ${end.toFixed(2)}%`);
    legend.push(`<li><i style="background:${color}"></i><span>${escapeHtml(m.name)}</span><em>${count}</em></li>`);
  });
  return `<div class="joe_archive-pie">
      <div class="joe_archive-pie__chart" style="background:conic-gradient(${stops.join(', ')})">
        <div class="joe_archive-pie__center"><strong>${total}</strong><span>篇文章</span></div>
      </div>
      <ul class="joe_archive-pie__legend">${legend.join('')}</ul>
    </div>`;
}

/** 归档页主体：统计卡片 + 筛选 + 可折叠时间线 */
function archivePageBody(list, metaByMid, filters) {
  const { cats, tags, activeMeta, allCount, commentCount } = filters;
  const statHtml = `<div class="joe_census__basic">
      <div class="joe_census__basic-item list">
        ${censusCard('文章数', allCount, CENSUS_ICONS.post)}
        ${censusCard('评论数', commentCount, CENSUS_ICONS.comment)}
        ${censusCard('分类数', cats.length, CENSUS_ICONS.category)}
        ${censusCard('标签数', tags.length, CENSUS_ICONS.tag)}
      </div>
      <div class="joe_census__basic-item category">${categoryPie(cats)}</div>
    </div>`;

  if (!list.items.length) {
    const emptyTitle = activeMeta ? `「${escapeHtml(activeMeta.name)}」下还没有文章` : '还没有文章';
    return `<div class="joe_archive-hero">
        <div class="joe_archive-hero__text">
          <h1 class="joe_archive-hero__title">归档</h1>
          <p class="joe_archive-hero__sub">共 0 篇文章</p>
        </div>
      </div>
      ${statHtml}
      ${archiveFilters(filters)}
      <div class="joe_panel joe_archive-empty">
        <p class="joe_archive-empty__title">${emptyTitle}</p>
        <p class="joe_archive-empty__hint">在后台发布文章后，这里会自动生成归档。</p>
      </div>`;
  }

  const years = groupByYearMonth(list.items);
  const yearKeys = [...years.keys()].sort((a, b) => b - a);
  const countOf = (y) => [...years.get(y).values()].reduce((sum, arr) => sum + arr.length, 0);
  const latest = list.items[0];
  const range = yearKeys.length > 1 ? `${yearKeys[yearKeys.length - 1]}–${yearKeys[0]}` : `${yearKeys[0]}`;
  const truncated = list.total > list.items.length ? ` · 仅显示最近 ${list.items.length} 篇` : '';
  const scope = activeMeta ? `${activeMeta.type === 'category' ? '分类' : '标签'}「${activeMeta.name}」` : '全部文章';
  const sub = `${scope} · 共 ${list.total} 篇 · ${range} 年 · 最近更新 ${formatDate(latest.created, 'Y-m-d')}${truncated}`;

  const filing = yearKeys
    .map((y, index) => {
      const months = [...years.get(y).entries()].sort((a, b) => b[0] - a[0]);
      const body = months
        .map(
          ([m, items]) => `<div class="joe_filing-month">${m} 月</div>
          <ul class="joe_filing-list">
            ${items
              .map((p) => {
                const d = new Date(p.created * 1000);
                const catNames = (p.categories || []).map((mid) => metaByMid.get(mid)?.name).filter(Boolean);
                const catHtml = catNames.length
                  ? `<span class="joe_filing-cat">${escapeHtml(catNames[0])}${catNames.length > 1 ? ` +${catNames.length - 1}` : ''}</span>`
                  : '';
                return `<li class="joe_filing-article">
                <time class="joe_filing-date" datetime="${formatDate(p.created, 'Y-m-d')}">${pad2(d.getDate())}</time>
                <a class="joe_filing-link" href="${permalink(p)}" title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</a>
                ${catHtml}
                <span class="joe_filing-meta"><span>${p.views || 0} 阅读</span><span>${p.commentsNum || 0} 评论</span></span>
              </li>`;
              })
              .join('')}
          </ul>`
        )
        .join('');
      return `<div class="item">
        <div class="tail"></div>
        <div class="head"></div>
        <div class="wrapper">
          <details class="joe_filing-year"${index === 0 ? ' open' : ''}>
            <summary class="panel"><span>${y} 年<em>${countOf(y)} 篇</em></span>${CENSUS_ARROW}</summary>
            <div class="joe_filing-body">${body}</div>
          </details>
        </div>
      </div>`;
    })
    .join('');

  return `<div class="joe_archive-hero">
      <div class="joe_archive-hero__text">
        <h1 class="joe_archive-hero__title">归档</h1>
        <p class="joe_archive-hero__sub">${sub}</p>
      </div>
    </div>
    ${statHtml}
    ${archiveFilters(filters)}
    <div class="joe_census__filing">
      <div class="title">文章归档<span>共 ${list.total} 篇</span></div>
      <div class="content">${filing}</div>
    </div>`;
}

/** 归档页（/archive/）：统计 + 分类分布 + 可折叠时间线，支持 ?cat=slug / ?tag=slug */
export async function renderArchivePage(ctx) {
  const { db, url } = ctx;
  const catSlug = url.searchParams.get('cat') || '';
  const tagSlug = url.searchParams.get('tag') || '';

  // 侧栏与主内容互不依赖，先并行启动，避免归档查询完成后再串行渲染侧栏
  const asidePromise = asideBlock(ctx);
  const [nav, stat] = await Promise.all([navMetas(ctx), siteCounts(ctx)]);
  const cats = nav.cats;
  const tags = nav.tags;
  const activeMeta =
    (catSlug && cats.find((m) => m.slug === catSlug)) ||
    (tagSlug && tags.find((m) => m.slug === tagSlug)) ||
    null;

  const query = { type: 'post', pageSize: TIMELINE_LIMIT, allStatus: !!ctx.user };
  if (activeMeta?.type === 'category') query.categoryMid = activeMeta.mid;
  if (activeMeta?.type === 'tag') query.tagMid = activeMeta.mid;

  const list = await db.listContentsIndex(query);
  const enriched = await db.enrichWithStats(list);
  const mids = [...new Set(enriched.items.flatMap((p) => p.categories || []))];
  const metas = mids.length ? await db.getMetasBatch(mids) : [];
  const metaByMid = new Map(metas.map((m) => [m.mid, m]));
  const a = (p) => assetsUrl(ctx.options, p);
  const asideHtml = await asidePromise;
  ctx.contentBody = `<div class="joe_container joe_page joe_body joe_archive-page"><div class="joe_main">${archivePageBody(enriched, metaByMid, {
    cats,
    tags,
    activeMeta,
    allCount: stat.posts,
    commentCount: stat.comments,
  })}</div>${asideHtml}</div>`;
  return await layout(ctx, {
    title: `${activeMeta ? `${activeMeta.name} - ` : ''}归档 - ${escapeHtml(ctx.options.title)}`,
    css: [a('assets/css/joe.census.min.css')],
  });
}

/** 便签留言墙（配合后台开关 JGuestbook_Wall 使用） */
export async function renderGuestbookWall(ctx, page) {
  const { db, options, url } = ctx;
  const comments = await db.listComments(page.cid);
  const latest = comments.slice(-120).reverse();
  const avatarSource = options.joe?.JAvatarSource || 'weavatar';
  const assetsBase = options.themeAssetsBase || DEFAULT_ASSETS_BASE;
  const tones = ['sun', 'rose', 'mint', 'sky', 'lilac'];
  const notes = latest
    .map((c, idx) => {
      const tilt = ((idx % 5) - 2) * 0.7;
      return `<article class="joe_wall__note" data-tone="${tones[idx % tones.length]}" data-coid="${c.coid}" style="--tilt:${tilt}deg">
        <span class="joe_wall__pin" aria-hidden="true"></span>
        <div class="joe_wall__meta">
          <img width="40" height="40" class="avatar lazyload" src="${LAZYLOAD}" data-src="${avatarUrl(c.mail, 40, avatarSource)}" alt="${escapeHtml(c.author)}" decoding="async">
          <div><strong>${escapeHtml(c.author)}</strong><time datetime="${formatDate(c.created, 'Y-m-d H:i')}">${formatDate(c.created, 'Y-m-d H:i')}</time></div>
        </div>
        <div class="joe_wall__text">${renderCommentText(c.text, assetsBase)}</div>
      </article>`;
    })
    .join('');
  const posted = url.searchParams.get('posted');
  const waiting = options.commentStatus === 'waiting';
  const canPost = true; // 墙模式本身就是留言入口，页面可关闭普通评论区
  const formHtml = canPost ? `    <form class="joe_wall__form" method="post" action="/comment/${page.cid}">
      <div class="joe_wall__form-head"><h2>写一张便签</h2><p>留下你的想法，贴到墙上。</p></div>
      <div class="joe_wall__row">
        <input type="text" name="author" maxlength="32" placeholder="昵称" required>
        <input type="email" name="mail" placeholder="邮箱（用于头像）" required>
      </div>
      <textarea name="text" rows="4" placeholder="写下你的留言…" required></textarea>
      <div class="joe_wall__form-foot">
        <span>${waiting ? '留言需要审核后展示' : '提交后会立即贴在墙上'}</span>
        <button type="submit">贴上留言</button>
      </div>
    </form>` : '<div class="joe_wall__closed">留言板暂时关闭了留言。</div>';
  ctx.contentBody = `<div class="joe_container joe_wall">
    <header class="joe_wall__head">
      <h1>${escapeHtml(page.title)}</h1>
      <div class="joe_wall__intro">${renderMarkdown(page.text || '')}</div>
      <p class="joe_wall__sub">共 ${comments.length} 张便签 · 桌面上可以拖动便签重新摆放</p>
    </header>
    ${posted ? `<div class="joe_wall__posted">${waiting ? '留言已提交，审核通过后会出现在墙上。' : '留言已贴上墙。'}</div>` : ''}
    ${formHtml}
    <section class="joe_wall__board" id="wall">
      ${notes || '<div class="joe_wall__empty">还没有人留言，来贴第一张便签吧。</div>'}
    </section>
  </div>`;
  const a = (p) => assetsUrl(options, p);
  return await layout(ctx, {
    title: `${escapeHtml(page.title)} - ${escapeHtml(options.title)}`,
    js: [a('assets/js/joe.guestbook.js')],
  });
}

/** 关于页兜底（没有 slug=about 的独立页面时使用） */
export async function renderAboutPage(ctx) {
  const stat = await siteCounts(ctx);
  const a = (p) => assetsUrl(ctx.options, p);
  const intro = ctx.options.description || `${ctx.options.title}，记录技术与生活的一隅。`;
  ctx.contentBody = `<div class="joe_container joe_page"><div class="joe_main">
    <section class="joe_panel">
      <div class="joe_panel__head">
        <h1 class="joe_panel__title">关于本站</h1>
      </div>
      <div class="joe_about__body">
        <p>${escapeHtml(intro)}</p>
      </div>
      <p class="joe_about__stat">共 ${stat.posts} 篇文章 · ${stat.comments} 条评论</p>
    </section>
  </div></div>`;
  return await layout(ctx, {
    title: `关于本站 - ${escapeHtml(ctx.options.title)}`,
    css: [a('assets/css/joe.archive.min.css')],
  });
}

/** 首页 */
// cache-bust comment for deployment
/** 解析轮播/广告配置：一行一条，字段用 || 分隔 */
function parseBannerRows(raw, withTitle, limit) {
  const safeUrl = (value) => {
    const url = String(value || '').trim();
    return /^(https?:\/\/|\/)/i.test(url) ? url : '';
  };
  const rows = [];
  for (const line of String(raw || '').split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith('#')) continue;
    const parts = text.split(/\s*\|\|\s*/).map((part) => part.trim());
    const image = safeUrl(parts[0]);
    if (!image) continue;
    rows.push({
      image,
      link: safeUrl(parts[1]),
      title: withTitle ? parts[2] || '' : '',
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

const BANNER_ICON = '<svg class="icon" viewBox="0 0 1026 1024" xmlns="http://www.w3.org/2000/svg" width="18" height="18"><path d="M784.3 1007.961a33.2 33.2 0 0 1-27.106-9.062L540.669 854.55 431.766 962.813c-9.062 9.062-36.168 18.044-45.23 9.062a49.72 49.72 0 0 1-27.106-45.23V727.763a33.2 33.2 0 0 1 9.463-27.106l343.071-370.578a44.748 44.748 0 0 1 63.274 63.274l-334.17 361.515v72.175l63.273-54.211a42.583 42.583 0 0 1 54.212-9.062l198.64 126.386L910.847 140.34 151.647 510.837 323.343 619.34c18.044 9.062 27.106 45.23 9.062 63.273-9.062 18.044-45.23 27.106-63.273 18.044L34.082 547.005c-8.981-8.982-18.043-17.723-18.043-36.168s9.062-27.105 27.105-36.167l903.79-451.815c18.043-9.062 36.167-9.062 45.229 0 18.284 9.223 18.284 27.106 18.284 45.15L829.69 971.794c0 18.043-9.062 27.105-27.105 36.167z" /></svg>';

/** 首页轮播（每行：图片地址 || 跳转链接 || 标题） */
function bannerBlock(ctx) {
  const joe = ctx.options.joe || {};
  if (joe.JIndex_Carousel_Status === 'off') return '';
  const rows = parseBannerRows(joe.JIndex_Carousel, true, 10);
  if (!rows.length) return '';
  const slides = rows
    .map(
      (row, index) => `<div class="swiper-slide">
          <a class="item" href="${escapeHtml(row.link || '#')}"${row.link ? ' target="_blank" rel="noopener noreferrer nofollow"' : ''}>
            ${index === 0
              ? `<img width="100%" height="100%" src="${escapeHtml(row.image)}" alt="${escapeHtml(row.title)}" fetchpriority="high" decoding="async" />`
              : `<img width="100%" height="100%" class="thumbnail lazyload" src="${LAZYLOAD}" data-src="${escapeHtml(row.image)}" alt="${escapeHtml(row.title)}"  decoding="async" / decoding="async">`}
            ${row.title ? `<div class="title">${escapeHtml(row.title)}</div>` : ''}
            ${BANNER_ICON}
          </a>
        </div>`
    )
    .join('');
  return `<div class="joe_index__banner">
        <div class="swiper-container">
          <div class="swiper-wrapper">${slides}</div>
          <div class="swiper-pagination"></div>
          <div class="swiper-button-next"></div>
          <div class="swiper-button-prev"></div>
        </div>
      </div>`;
}

/** 首页广告（一行：广告图片 || 广告链接，限制一条） */
function adBlock(ctx) {
  const joe = ctx.options.joe || {};
  if (joe.JIndex_Ad_Status === 'off') return '';
  const rows = parseBannerRows(joe.JIndex_Ad, false, 8);
  if (!rows.length) return '';
  // 桌面按数量最多 4 列，手机由 CSS 固定为 2 列
  const columns = Math.min(4, rows.length);
  const links = rows
    .map(
      (ad, index) => `<a class="joe_index__ad-link" href="${escapeHtml(ad.link || '#')}"${ad.link ? ' target="_blank" rel="noopener noreferrer nofollow"' : ''}>
          ${index === 0
            ? `<img width="100%" height="200" src="${escapeHtml(ad.image)}" alt="${escapeHtml(ad.link || '')}" fetchpriority="high" decoding="async" />`
            : `<img width="100%" height="200" class="image lazyload" src="${LAZYLOAD}" data-src="${escapeHtml(ad.image)}" alt="${escapeHtml(ad.link || '')}"  decoding="async" / decoding="async">`}
          <span class="icon">广告</span>
        </a>`
    )
    .join('');
  return `<div class="joe_index__ad joe_ad-grid" style="--ad-cols:${columns}">${links}</div>`;
}

export async function renderIndex(ctx) {
  const a = (p) => assetsUrl(ctx.options, p);
  const { list, page } = ctx;

  // 处理顶置文章：按「顶置文章IDs」前置，其余保持原顺序
  const items = applyStickOrder(list.items, parseStickIds(ctx.options));
  const itemsHtml = items.map((p, i) => indexItem(ctx, p, i === 0)).join('');
  // 主列表筛选项与侧栏并行渲染
  const [filterHtml, asideHtml] = await Promise.all([
    buildIndexFilter(ctx),
    asideBlock(ctx),
  ]);
  ctx.contentBody = `<div class="joe_container joe_body">
    <div class="joe_main">
      <div class="joe_index">
        ${bannerBlock(ctx)}
        ${adBlock(ctx)}
        <div class="joe_index__title">
          <ul class="joe_index__title-title">
            <li class="item" data-type="created">最新文章</li>
            <li class="item" data-type="views">热门文章</li>
            <li class="item" data-type="commentsNum">评论最多</li>
            <li class="item" data-type="agree">点赞最多</li>
            <li class="line"></li>
          </ul>
          ${filterHtml}
        </div>
        <div class="joe_index__list" data-wow="off">
          <ul class="joe_list">${itemsHtml}</ul>
          <ul class="joe_list__loading" style="display:none"></ul>
        </div>
        <div class="joe_load" style="display:none">查看更多</div>
        ${pageNav(page, list.pages, '/')}
      </div>
    </div>
    ${asideHtml}
  </div>`;
  const hasCarousel =
    ctx.options.joe.JIndex_Carousel_Status !== 'off' &&
    parseBannerRows(ctx.options.joe.JIndex_Carousel, true, 1).length > 0;
  const indexCss = [a('assets/css/joe.index.min.css')];
  const indexJs = [a('assets/lib/wowjs@1.1.3/wow.min.js'), a('assets/js/joe.index.min.js')];
  if (hasCarousel) {
    indexCss.unshift(a('assets/lib/swiper@5.4.5/swiper.min.css'));
    indexJs.unshift(a('assets/lib/swiper@5.4.5/swiper.min.js'));
  }
  return await layout(ctx, {
    title: `${escapeHtml(ctx.options.title)} - ${escapeHtml(ctx.options.description || '')}`,
    css: indexCss,
    js: indexJs,
  });
}

function indexItem(ctx, p, eager = false) {
  const a = (path) => assetsUrl(ctx.options, path);
  // 优先用索引里的 abstract（v1.4.1 起）；旧索引回退正文摘要，再回退后台填写的摘要
  const excerpt = p.abstract || (p.text ? plainExcerpt(p.text, 90) : (p.fields?.abstract || ''));
  // 顶置角标：与 joe.index.js 前端渲染保持同构（同一段 class 与 display）。
  // .badge 的 CSS 里没有 display，而 span 默认 inline 会吃掉 height/line-height，
  // 所以 inline-block 是必须的，不能省。
  const stickBadge = parseStickIds(ctx.options).includes(String(p.cid))
    ? '<span class="badge" style="display: inline-block">置顶</span>'
    : '';
  // 隐藏文章角标。只有登录管理员的列表里才会出现 status=hidden 的条目
  // （匿名请求走 allStatus=false），所以这个标记天然只对管理员可见。
  const hiddenBadge = p.status === 'hidden'
    ? '<span class="badge" style="display: inline-block">隐藏</span>'
    : '';
  return `<li class="joe_list__item default">
  <div class="line"></div>
  <a href="${permalink(p)}" class="thumbnail" title="${escapeHtml(p.title)}" target="_blank" rel="noopener noreferrer">
    ${eager
      ? `<img width="100%" height="100%" src="${escapeHtml(coverUrl(ctx, p))}" alt="${escapeHtml(p.title)}" fetchpriority="high" decoding="async" />`
      : `<img width="100%" height="100%" class="lazyload" src="${LAZYLOAD}" data-src="${escapeHtml(coverUrl(ctx, p))}" alt="${escapeHtml(p.title)}"  decoding="async" / decoding="async">`}
    <time datetime="${formatDate(p.created, 'Y-m-d')}">${formatDate(p.created, 'Y-m-d')}</time>
  </a>
  <div class="information">
    <a href="${permalink(p)}" class="title" title="${escapeHtml(p.title)}" target="_blank" rel="noopener noreferrer">${stickBadge}${hiddenBadge}${escapeHtml(p.title)}</a>
    <a class="abstract" href="${permalink(p)}" title="文章摘要" target="_blank" rel="noopener noreferrer">${escapeHtml(excerpt)}</a>
    <div class="meta">
      <ul class="items">
        <li>${formatDate(p.created, 'Y-m-d')}</li>
        <li>${p.views ?? 0} 阅读</li>
        <li>${p.commentsNum || 0} 评论</li>
        <li>${p.agree ?? 0} 点赞</li>
      </ul>
    </div>
  </div>
</li>`;
}

/** 文章/页面 */
export async function renderPost(ctx) {
  const a = (p) => assetsUrl(ctx.options, p);
  const { post, db, preloaded } = ctx;
  const avatarSource = ctx.options.joe?.JAvatarSource || 'weavatar';
  // 使用预加载数据，避免重复查询
  const { cats, tags, author, prev, next, views, agree, related, commentsHtml } = preloaded || {};

  const catHtml = cats.length
    ? `<div class="joe_detail__category">${cats.slice(0, 5).map((c, i) => `<a href="${c.permalink}" class="item item-${i}" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</a>`).join('')}</div>`
    : '';

  // 正文第一张图通常是 LCP，改为立即加载；其余图片继续懒加载
  let articleHtml = renderMarkdown(post.text);
  articleHtml = articleHtml.replace(/<img([^>]*?)loading="lazy"/, '<img$1loading="eager" fetchpriority="high"');

  ctx.contentBody = `<div class="joe_container joe_bread">
    <ul class="joe_bread__bread">
      <li class="item"><a href="/" class="link" title="首页">首页</a></li>
      ${cats.length ? `<li class="line">/</li><li class="item"><a class="link" href="${cats[0].permalink}" title="${escapeHtml(cats[0].name)}">${escapeHtml(cats[0].name)}</a></li><li class="line">/</li>` : '<li class="line">/</li>'}
      <li class="item">正文</li>
    </ul>
  </div>
  <div class="joe_container joe_body">
    <div class="joe_main joe_post">
      <div class="joe_detail${ctx.user ? ' joe_detail--admin' : ''}" data-cid="${post.cid}">
        ${ctx.postPreview ? '<div class="joe_detail__preview-banner">管理员预览：这篇文章当前是「隐藏」状态，访客访问时会得到 404。</div>' : ''}
        ${catHtml}
        <h1 class="joe_detail__title">${escapeHtml(post.title)}</h1>
        ${ctx.user ? `<a class="joe_detail__edit" href="/admin/${post.type === 'page' ? 'page' : 'post'}?cid=${post.cid}" title="编辑这篇内容"><i class="fa fa-pencil" aria-hidden="true"></i> 编辑</a>` : ''}
        <div class="joe_detail__count">
          <div class="joe_detail__count-information">
            <img width="35" height="35" class="avatar lazyload" src="${LAZYLOAD}" data-src="${avatarUrl(author.mail, 35, avatarSource)}" alt="${escapeHtml(author.screenName)}"  decoding="async" / decoding="async">
            <div class="meta">
              <div class="author"><a class="link" href="/author/${post.authorId}/" title="${escapeHtml(author.screenName)}">${escapeHtml(author.screenName)}</a></div>
              <div class="item">
                <span class="text">${formatDate(post.created, 'Y-m-d')}</span>
                <span class="line">/</span>
                <span class="text">${post.commentsNum || 0} 评论</span>
                <span class="line">/</span>
                <span class="text" id="Joe_Article_Views">${views} 阅读</span>
              </div>
            </div>
          </div>
          <time class="joe_detail__count-created" datetime="${formatDate(post.created, 'm/d')}">${formatDate(post.created, 'm/d')}</time>
        </div>
        <article class="joe_detail__article">
          ${articleHtml}
        </article>
        ${operateBlock(ctx, post, tags)}
        <div class="joe_detail__agree">
          <div class="agree">
            <div class="icon">
              <svg class="icon-1" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="28" height="28"><path d="M736 128c-65.952 0-128.576 25.024-176.384 70.464-4.576 4.32-28.672 28.736-47.328 47.68L464.96 199.04C417.12 153.216 354.272 128 288 128 146.848 128 32 242.848 32 384c0 82.432 41.184 144.288 76.48 182.496l316.896 320.128C450.464 911.68 478.304 928 512 928s61.568-16.32 86.752-41.504l316.736-320 2.208-2.464C955.904 516.384 992 471.392 992 384c0-141.152-114.848-256-256-256z" fill="#fff"/></svg>
              <svg class="icon-2" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="28" height="28"><path d="M512 928c-28.928 0-57.92-12.672-86.624-41.376L106.272 564C68.064 516.352 32 471.328 32 384c0-141.152 114.848-256 256-256 53.088 0 104 16.096 147.296 46.592 14.432 10.176 17.92 30.144 7.712 44.608-10.176 14.432-30.08 17.92-44.608 7.712C366.016 204.064 327.808 192 288 192c-105.888 0-192 86.112-192 192 0 61.408 20.288 90.112 59.168 138.688l315.584 318.816C486.72 857.472 499.616 863.808 512 864c12.704.192 24.928-6.176 41.376-22.624l316.672-319.904C896.064 493.28 928 445.696 928 384c0-105.888-86.112-192-192-192-48.064 0-94.08 17.856-129.536 50.272l-134.08 134.112c-12.512 12.512-32.736 12.512-45.248 0s-12.512-32.736 0-45.248L562.24 196c48.32-44.192 109.664-68 173.76-68 141.152 0 256 114.848 256 256 0 82.368-41.152 144.288-75.68 181.696l-317.568 320.8C569.952 915.328 540.96 928 512 928z" fill="#fff"/></svg>
            </div>
            <span class="text">${agree}</span>
          </div>
        </div>
        ${related.length ? `<div class="joe_detail__related">
          <div class="joe_detail__related-title">相关推荐</div>
          <div class="joe_detail__related-content">
            ${related.map((r) => `<a class="item" href="${permalink(r)}" title="${escapeHtml(r.title)}">
              <img width="100%" height="120" class="lazyload" src="${LAZYLOAD}" data-src="${escapeHtml(coverUrl(ctx, r))}" alt="${escapeHtml(r.title)}"  decoding="async" / decoding="async">
              <div class="title">${escapeHtml(r.title)}</div>
            </a>`).join('')}
          </div>
        </div>` : ''}
        <ul class="joe_post__pagination">
          ${prev ? `<li class="joe_post__pagination-item prev"><a href="${permalink(prev)}" title="${escapeHtml(prev.title)}">上一篇</a></li>` : ''}
          ${next ? `<li class="joe_post__pagination-item next"><a href="${permalink(next)}" title="${escapeHtml(next.title)}">下一篇</a></li>` : ''}
        </ul>
        ${commentsHtml}
      </div>
    </div>
    ${await asideBlock(ctx)}
  </div>`;

  const desc = post.fields?.description || plainExcerpt(post.text, 120);
  return await layout(ctx, {
    title: `${escapeHtml(post.title)} - ${escapeHtml(ctx.options.title)}`,
    meta: `<meta name="description" content="${escapeHtml(desc)}" />${(post.fields?.keywords || tags.length) ? `<meta name="keywords" content="${escapeHtml(post.fields?.keywords || tags.map((t) => t.name).join(','))}" />` : ''}`,
    css: [a('assets/lib/prism/prism.min.css'), a('assets/css/joe.post.min.css')],
    js: [a('assets/lib/clipboard@2.0.11/clipboard.min.js'), a('assets/lib/prism/prism.min.js'), a('assets/js/joe.post_page.min.js')],
  });
}

/** 评论区块（Joe 结构 + Owo 表情 + 楼中楼） */
/**
 * 评论列表（含楼中楼递归）。抽出来单独维护递归结构，
 * commentsBlock 只负责评论表单与整体容器。
 */
function renderCommentList(comments, post, avatarSource, assetsBase) {
  const byParent = new Map();
  for (const c of comments) {
    if (!byParent.has(c.parent)) byParent.set(c.parent, []);
    byParent.get(c.parent).push(c);
  }
  const renderComment = (c) => {
    const children = byParent.get(c.coid) || [];
    return `<li class="comment-list__item">
      <div class="comment-list__item-contain" id="comment-${c.coid}">
        <div class="term">
          <img width="48" height="48" class="avatar lazyload" src="${LAZYLOAD}" data-src="${avatarUrl(c.mail, 48, avatarSource)}" alt="头像"  decoding="async" / decoding="async">
          <div class="content">
            <div class="user">
              <span class="author">${escapeHtml(c.author)}</span>
              ${c.authorId && c.authorId === post.authorId ? '<i class="owner">作者</i>' : ''}
              <div class="agent">${parseAgentOS(c.agent)} · ${parseAgentBrowser(c.agent)}</div>
            </div>
            <div class="substance">${renderCommentText(c.text, assetsBase)}</div>
            <div class="handle">
              <time class="date" datetime="${formatDate(c.created, 'Y-m-d')}">${formatDate(c.created, 'Y-m-d')}</time>
              <span class="reply joe_comment__reply" data-id="comment-${c.coid}" data-coid="${c.coid}">
                <i class="icon fa fa-pencil" aria-hidden="true"></i>回复
              </span>
            </div>
          </div>
        </div>
      </div>
      ${children.length ? `<div class="comment-list__item-children"><ul class="comment-list">${children.map(renderComment).join('')}</ul></div>` : ''}
    </li>`;
  };
  const top = byParent.get(0) || [];
  return top.length ? `<ul class="comment-list">${top.map(renderComment).join('')}</ul>` : '';
}

export async function commentsBlock(ctx, post) {
  if (!post.allowComment || ctx.options.joe.JCommentStatus === 'off') {
    return `<div class="joe_comment"><h3 class="joe_comment__title">评论</h3><div class="joe_comment__close"><span>博主关闭了评论</span></div></div>`;
  }
  const { db, csrfToken, user } = ctx;
  const avatarSource = ctx.options.joe?.JAvatarSource || 'weavatar';
  const assetsBase = ctx.options.themeAssetsBase || DEFAULT_ASSETS_BASE;
  const all = await db.listComments(post.cid);
  const commentListHtml = renderCommentList(all, post, avatarSource, assetsBase);
  return `<div class="joe_comment">
  <h3 class="joe_comment__title">评论 (${post.commentsNum || 0})</h3>
  <div id="respond" class="joe_comment__respond">
    <div class="joe_comment__respond-type">
      <button class="item" data-type="draw">画图模式</button>
      <button class="item active" data-type="text">文本模式</button>
    </div>
    <form method="post" class="joe_comment__respond-form" action="/comment/${post.cid}" data-type="text">
      <input type="hidden" name="_" value="${csrfToken}" />
      <div class="head">
        <div class="list"><input type="text" value="${escapeHtml(user?.screenName || '')}" autocomplete="off" name="author" maxlength="16" placeholder="请输入昵称..." /></div>
        <div class="list"><input type="text" value="${escapeHtml(user?.mail || '')}" autocomplete="off" name="mail" placeholder="请输入邮箱..." /></div>
        <div class="list"><input type="text" autocomplete="off" name="url" placeholder="请输入网址（非必填）..." /></div>
      </div>
      <div class="body">
        <textarea class="text joe_owo__target" name="text" autocomplete="new-password" placeholder="说点什么吧，点击右上方切换成画图试试？"></textarea>
        <div class="draw" style="display: none;">
          <ul class="line"><li data-line="3">细</li><li data-line="5" class="active">中</li><li data-line="8">粗</li></ul>
          <ul class="color"><li data-color="#303133" class="active"></li><li data-color="#67c23a"></li><li data-color="#e6a23c"></li><li data-color="#f56c6c"></li></ul>
          <canvas id="joe_comment_draw" height="300"></canvas>
        </div>
      </div>
      <div class="foot">
        <div class="owo joe_owo__contain"></div>
        <div class="submit"><span class="cancle joe_comment__cancle">取消</span><button type="submit">发送评论</button></div>
      </div>
    </form>
  </div>
  ${commentListHtml}
</div>`;
}

/**
 * 渲染评论正文（转义 + 画图评论 + Owo 表情 + 换行）。
 * base 由调用方传入，避免依赖模块级可变上下文（多请求共享模块实例时不安全）。
 */
function renderCommentText(text, base = DEFAULT_ASSETS_BASE) {
  let t = escapeHtml(text || '');
  // 画图评论 {!{data:image...}!}
  t = t.replace(/\{!\{(.+?)\}!\}/g, (_, img) => `<img class="owo_image" src="${img}" alt="画图评论" />`);
  // Owo 表情 ::(呵呵)
  t = t.replace(/::\((.+?)\)/g, (m, name) => {
    for (const grp of Object.keys(OWO_MAP)) {
      const hit = OWO_MAP[grp].find((e) => e.data === m);
      if (hit) {
        // 颜文字组 icon 为纯文本，其余为图片路径
        if (!hit.icon.includes('.png')) return hit.icon;
        return `<img class="owo_image" src="${base}/${hit.icon}" alt="${name}" />`;
      }
    }
    return m;
  });
  return t.replace(/\n/g, '<br>');
}

let OWO_MAP = {};
export function setOwoMap(map) { OWO_MAP = map; }

function parseAgentOS(agent) {
  const ua = agent || '';
  if (/windows/i.test(ua)) return 'Windows';
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipad/i.test(ua)) return 'iOS';
  if (/mac os/i.test(ua)) return 'MacOS';
  if (/linux/i.test(ua)) return 'Linux';
  return '其他';
}
function parseAgentBrowser(agent) {
  const ua = agent || '';
  if (/edg\//i.test(ua)) return 'Edge';
  if (/chrome/i.test(ua)) return 'Chrome';
  if (/firefox/i.test(ua)) return 'Firefox';
  if (/safari/i.test(ua)) return 'Safari';
  return '其他';
}

/** 归档页（分类/标签/搜索/作者/日期） */
export async function renderArchive(ctx) {
  const a = (p) => assetsUrl(ctx.options, p);
  const { list, page, archiveTitle } = ctx;
  const archiveLabel = ctx.archiveLabel || archiveTitle;
  const itemsHtml = list.items.map((p, i) => indexItem(ctx, p, i === 0)).join('');
  ctx.contentBody = `<div class="joe_container joe_bread">
    <ul class="joe_bread__bread">
      <li class="item"><a href="/" class="link" title="首页">首页</a></li>
      <li class="line">/</li>
      <li class="item" title="${escapeHtml(archiveTitle)}">${escapeHtml(archiveLabel)}</li>
    </ul>
  </div>
  <div class="joe_container joe_body">
    <div class="joe_main joe_archive">
      <div class="joe_archive__title">${escapeHtml(archiveTitle)}</div>
      <div class="joe_archive__list">
        <ul class="joe_list">${itemsHtml || '<li class="empty">暂无内容</li>'}</ul>
      </div>
      ${pageNav(page, list.pages, ctx.archiveBaseUrl)}
    </div>
    ${await asideBlock(ctx)}
  </div>`;
  return await layout(ctx, {
    title: `${escapeHtml(archiveTitle)} - ${escapeHtml(ctx.options.title)}`,
    css: [a('assets/css/joe.archive.min.css')],
  });
}

/** 404 */
export async function render404(ctx) {
  const a = (p) => assetsUrl(ctx.options, p);
  ctx.contentBody = `<div class="joe_container">
    <div class="joe_main">
      <div class="joe_404">
        <h1>404</h1>
        <p>抱歉，您访问的页面不存在或已被删除</p>
        <a class="home" href="/">返回首页</a>
      </div>
    </div>
  </div>`;
  return await layout(ctx, {
    title: `页面不存在 - ${escapeHtml(ctx.options.title)}`,
    css: [a('assets/css/joe.global.min.css')],
  });
}
