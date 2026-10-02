/**
 * Joe 主题渲染器 —— 复用 Joe 主题原版 CSS/JS/静态资源
 * 服务端输出与 Joe DOM 结构一致的 HTML
 */
import { renderMarkdown, escapeHtml, plainExcerpt, splitMore } from './markdown.js';
import { pageNav, avatarUrl, formatDate, thumbnail } from './html.js';

export const THEME_NAME = 'joe';
const LAZYLOAD = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

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
  JAside_3DTag: 'off',
  JAside_Flatterer: 'on',
  JCommentStatus: 'on',
  JIndex_Hot: 'off',
  JIndex_Carousel: '',
  JIndex_Recommend: '',
  JIndex_Ad: '',
  JIndex_Notice: '',
  JList_Animate: 'off',
  JOverdue: 'off',
  JNavMaxNum: '6',
  JFooter_Custom: '',
  JICP: '',
  JAssetsURL: '',
};

export function assetsUrl(opts, path) {
  const base = opts.themeAssetsBase || '/usr/themes/joe';
  return `${base}/${path}`;
}

/** window.Joe 全局配置 + 通用 head */
function headBlock(ctx, extra = {}) {
  const { options } = ctx;
  const a = (p) => assetsUrl(options, p);
  return `<script>
  localStorage.getItem("data-night") && document.querySelector("html").setAttribute("data-night", "night");
  window.Joe = {
    THEME_URL: \`${a('')}\`,
    BASE_API: \`/joe/api\`,
    DYNAMIC_BACKGROUND: \`\`,
    WALLPAPER_BACKGROUND_PC: \`\`,
    IS_MOBILE: /windows phone|iphone|android/gi.test(window.navigator.userAgent),
    BAIDU_PUSH: false,
    DOCUMENT_TITLE: \`${escapeHtml(options.joe.JDocumentTitle || '')}\`,
    LAZY_LOAD: \`${a('assets/img/lazyload.jpg')}\`,
    BIRTHDAY: \`${escapeHtml(options.joe.JBirthDay || '')}\`,
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
  const links = [
    a('assets/css/joe.mode.min.css'),
    a('assets/css/joe.normalize.min.css'),
    a('assets/css/joe.global.min.css'),
    a('assets/css/joe.responsive.min.css'),
    a('assets/lib/qmsg/qmsg.min.css'),
    a('assets/lib/fancybox@3.5.7/fancybox.min.css'),
    a('assets/lib/animate.css@4.1.1/animate.min.css'),
    a('assets/lib/font-awesome@4.7.0/font-awesome.min.css'),
    a('assets/lib/APlayer@1.10.1/APlayer.min.css'),
    ...extra,
  ];
  return links.map((h) => `<link href="${h}" rel="stylesheet" />`).join('\n');
}

function scripts(ctx, extra = []) {
  const a = (p) => assetsUrl(ctx.options, p);
  const list = [
    a('assets/lib/jquery@3.6.1/jquery.min.js'),
    a('assets/lib/scroll/scroll.min.js'),
    a('assets/lib/lazysizes@5.3.2/lazysizes.min.js'),
    a('assets/lib/APlayer@1.10.1/APlayer.min.js'),
    a('assets/lib/sketchpad/sketchpad.min.js'),
    a('assets/lib/fancybox@3.5.7/fancybox.min.js'),
    a('assets/lib/extend/extend.min.js'),
    a('assets/lib/qmsg/qmsg.min.js'),
    a('assets/js/joe.global.min.js'),
    a('assets/js/joe.short.min.js'),
    ...extra,
  ];
  return list.map((s) => `<script src="${s}"></script>`).join('\n');
}

/** 页头：导航 + 搜索 + 移动端抽屉 */
function headerBlock(ctx) {
  const { options, pages, path } = ctx;
  const navMax = parseInt(options.joe.JNavMaxNum || '6', 10);
  const navPages = pages.slice(0, navMax);
  const morePages = pages.slice(navMax);
  const isIndex = path === '/';
  return `<header class="joe_header${ctx.isPost ? ' current' : ''}">
  <div class="joe_header__above">
    <div class="joe_container">
      <svg class="joe_header__above-slideicon" viewBox="0 0 1152 1024" xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path d="M76.032 872a59.968 59.968 0 1 0 0 120h999.936a59.968 59.968 0 1 0 0-120H76.032zm16-420.032a59.968 59.968 0 1 0 0 120h599.936a59.968 59.968 0 0 0 0-119.936H92.032zM76.032 32a59.968 59.968 0 1 0 0 120h999.936a60.032 60.032 0 0 0 0-120H76.032z"/></svg>
      <a title="${escapeHtml(options.title)}" class="joe_header__above-logo" href="/">
        <img class="lazyload" src="${LAZYLOAD}" data-src="${escapeHtml(options.joe.JLogo)}" alt="${escapeHtml(options.title)}" />
      </a>
      <nav class="joe_header__above-nav">
        <a class="item${isIndex ? ' active' : ''}" href="/" title="首页">首页</a>
        ${navPages.map((p) => `<a class="item${path === p.permalink ? ' active' : ''}" href="${p.permalink}" title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</a>`).join('')}
        ${morePages.length ? `<div class="joe_dropdown" trigger="hover" placement="60px" style="margin-right: 15px;">
          <div class="joe_dropdown__link"><a href="#" rel="nofollow">更多</a></div>
          <nav class="joe_dropdown__menu">${morePages.map((p) => `<a href="${p.permalink}">${escapeHtml(p.title)}</a>`).join('')}</nav>
        </div>` : ''}
      </nav>
      <div class="joe_header__above-search">
        <svg class="icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path d="M1004.257 874.846 768.898 639.488a385.526 385.526 0 0 0 44.851-178.637C813.749 259.91 654.353 100.513 457.287 100.513S100.825 259.91 100.825 456.977c0 197.066 159.396 356.462 356.462 356.462 64.819 0 125.602-17.36 178.637-44.851l235.358 235.358a35.607 35.607 0 0 0 50.397 0l42.578-42.578a35.607 35.607 0 0 0 0-50.397zM457.287 723.833c-147.386 0-266.856-119.47-266.856-266.856s119.47-266.856 266.856-266.856 266.856 119.47 266.856 266.856-119.47 266.856-266.856 266.856z"/></svg>
        <input type="text" class="input search-input" placeholder="搜索内容..." autocomplete="off" />
        <div class="result"></div>
      </div>
      <svg class="joe_header__above-searchicon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path d="M1004.257 874.846 768.898 639.488a385.526 385.526 0 0 0 44.851-178.637C813.749 259.91 654.353 100.513 457.287 100.513S100.825 259.91 100.825 456.977c0 197.066 159.396 356.462 356.462 356.462 64.819 0 125.602-17.36 178.637-44.851l235.358 235.358a35.607 35.607 0 0 0 50.397 0l42.578-42.578a35.607 35.607 0 0 0 0-50.397zM457.287 723.833c-147.386 0-266.856-119.47-266.856-266.856s119.47-266.856 266.856-266.856 266.856 119.47 266.856 266.856-119.47 266.856-266.856 266.856z"/></svg>
    </div>
  </div>
  <div class="joe_header__slideout">
    <div class="joe_header__slideout-wrap">
      <nav class="joe_header__slideout-menu">
        <a class="item${isIndex ? ' current' : ''}" href="/">首页</a>
        ${pages.map((p) => `<a class="item${path === p.permalink ? ' current' : ''}" href="${p.permalink}">${escapeHtml(p.title)}</a>`).join('')}
      </nav>
    </div>
  </div>
  <div class="joe_header__searchout">
    <div class="joe_container">
      <div class="joe_header__searchout-inner">
        <input type="text" class="input search-input" placeholder="搜索内容..." autocomplete="off" />
        <button class="submit search-btn">搜索</button>
      </div>
    </div>
  </div>
  <div class="joe_header__mask"></div>
</header>`;
}

/** 侧栏 */
async function asideBlock(ctx) {
  const { options, db, user } = ctx;
  const a = (p) => assetsUrl(options, p);
  const owner = (await db.listUsers()).find((u) => u.group === 'administrator') || {};
  const postsIdx = await db.listContents({ type: 'post', pageSize: 1 });
  const stat = {
    posts: postsIdx.total,
    comments: (await db.listAllComments({ status: 'approved', pageSize: 1 })).total,
  };
  const hot = await db.listContents({ type: 'post', pageSize: parseInt(options.joe.JAside_Hot_Num || '5', 10) || 5, order: 'views' });
  const hotViews = await Promise.all(hot.items.map(async (p) => ({ ...p, views: await db.getStat(p.cid, 'views') })));
  const recentComments = await db.recentComments(5);
  const tags = await db.listMetas('tag');

  let html = `<aside class="joe_aside">
  <section class="joe_aside__item author">
    <img width="100%" height="120" class="image lazyload" src="${LAZYLOAD}" data-src="${escapeHtml(options.joe.JAside_Author_Image)}" alt="博主栏壁纸" />
    <div class="user">
      <img width="75" height="75" class="avatar lazyload" src="${LAZYLOAD}" data-src="${escapeHtml(options.joe.JAside_Author_Avatar || avatarUrl(owner.mail))}" alt="博主头像" />
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
            <img width="100%" height="130" class="image lazyload" src="${LAZYLOAD}" data-src="${escapeHtml(thumbnail(p, a('assets')))}" alt="${escapeHtml(p.title)}" />
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
            <img width="40" height="40" class="avatar lazyload" src="${LAZYLOAD}" data-src="${avatarUrl(c.mail)}" alt="${escapeHtml(c.author)}" />
            <div class="info"><div class="author">${escapeHtml(c.author)}</div><span class="date">${formatDate(c.created, 'Y-m-d')}</span></div>
          </div>
          <div class="reply"><a class="link" href="${commentLink(db, c)}">${escapeHtml(plainExcerpt(c.text, 40))}</a></div>
        </li>`).join('')}
      </ul>
    </section>`;
  }

  if (options.joe.JAside_3DTag === 'on' && tags.length) {
    html += `<section class="joe_aside__item tags">
      <div class="joe_aside__item-title"><span class="text">标签云</span><span class="line"></span></div>
      <div class="joe_aside__item-contain">
        <div class="tag"></div>
        <ul class="list" style="display: none;">
          ${tags.map((t) => `<li data-url="/tag/${encodeURIComponent(t.slug)}/" data-label="${escapeHtml(t.name)}"></li>`).join('')}
        </ul>
      </div>
    </section>`;
  }

  if (options.joe.JAside_Flatterer === 'on') {
    html += `<section class="joe_aside__item flatterer">
      <div class="joe_aside__item-title"><span class="text">舔狗日记</span><span class="line"></span></div>
      <div class="joe_aside__item-contain"><div class="content"></div><div class="change">换一篇</div></div>
    </section>`;
  }

  html += `</aside>`;
  return html;
}

function commentLink(db, c) {
  return `/archives/${c.cid}/#comment-${c.coid}`;
}

/** 页脚 + 侧边操作按钮 */
function footerBlock(ctx) {
  const { options } = ctx;
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
        <span class="joe_run__day">0</span><span class="text">天</span>
        <span class="joe_run__hour">0</span><span class="text">小时</span>
        <span class="joe_run__minute">0</span><span class="text">分</span>
        <span class="joe_run__second">0</span><span class="text">秒</span>
      </div>
      <div class="joe_footer__below-item">
        <span>© ${new Date().getFullYear()} ${escapeHtml(options.title)} · ${escapeHtml(options.description || '')}</span>
      </div>
    </div>
  </div>
</footer>
<div class="joe_action">
  <div class="joe_action_item mode">
    <svg class="icon-1" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path d="M948.8 576L768 768v64h-64L512 1024l-64-64-256 64 64-256-64-64 192-192v-64h64l192-192 64 64 256-64-64 256 64 64-64 64-128 128h64z"/></svg>
    <svg class="icon-2" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path d="M512 64a448 448 0 1 0 448 448A448 448 0 0 0 512 64zm0 832a384 384 0 0 1-32-765.76V896a381.44 381.44 0 0 1-32 0z"/></svg>
  </div>
  <div class="joe_action_item scroll">
    <svg class="icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path d="M512 64a448 448 0 1 0 448 448A448 448 0 0 0 512 64zm0 832a384 384 0 0 1-32-765.76V896a381.44 381.44 0 0 1-32 0z"/></svg>
  </div>
</div>`;
}

/** HTML 文档骨架 */
function layout(ctx, { title, meta = '', css = [], js = [], bodyClass = '' }) {
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
    ${headerBlock(ctx)}
    ${ctx.contentBody || ''}
    ${footerBlock(ctx)}
  </div>
</body>
</html>`;
}

export function permalink(content) {
  if (content.type === 'page') return `/${content.slug}/`;
  if (content.type === 'attachment') return `/attachment/${content.cid}/`;
  return `/archives/${content.cid}/`;
}

/** 分类/标签对象渲染辅助 */
export async function contentMetas(db, content) {
  const cats = [], tags = [];
  for (const mid of content.categories || []) {
    const m = await db.getMeta(mid);
    if (m) cats.push({ ...m, permalink: `/category/${encodeURIComponent(m.slug)}/` });
  }
  for (const mid of content.tags || []) {
    const m = await db.getMeta(mid);
    if (m) tags.push({ ...m, permalink: `/tag/${encodeURIComponent(m.slug)}/` });
  }
  return { cats, tags };
}

/* ==================== 页面渲染 ==================== */

/** 首页 */
export async function renderIndex(ctx) {
  const a = (p) => assetsUrl(ctx.options, p);
  const { list, page } = ctx;
  const itemsHtml = list.items.map((p) => indexItem(ctx, p)).join('');
  ctx.contentBody = `<div class="joe_container">
    <div class="joe_main">
      <div class="joe_index">
        <div class="joe_index__title">
          <ul class="joe_index__title-title">
            <li class="item" data-type="created">最新文章</li>
            <li class="item" data-type="views">热门文章</li>
            <li class="item" data-type="commentsNum">评论最多</li>
            <li class="item" data-type="agree">点赞最多</li>
            <li class="line"></li>
          </ul>
        </div>
        <div class="joe_index__list" data-wow="off">
          <ul class="joe_list">${itemsHtml}</ul>
          <ul class="joe_list__loading" style="display:none"></ul>
        </div>
        ${pageNav(page, list.pages, '/')}
        <div class="joe_load" style="display:none">查看更多</div>
      </div>
    </div>
    ${await asideBlock(ctx)}
  </div>`;
  return layout(ctx, {
    title: `${escapeHtml(ctx.options.title)} - ${escapeHtml(ctx.options.description || '')}`,
    css: [a('assets/lib/swiper@5.4.5/swiper.min.css'), a('assets/css/joe.index.min.css')],
    js: [a('assets/lib/swiper@5.4.5/swiper.min.js'), a('assets/lib/wowjs@1.1.3/wow.min.js'), a('assets/js/joe.index.min.js')],
  });
}

function indexItem(ctx, p) {
  const a = (path) => assetsUrl(ctx.options, path);
  return `<li class="joe_list__item default">
  <div class="line"></div>
  <a href="${permalink(p)}" class="thumbnail" title="${escapeHtml(p.title)}" target="_blank" rel="noopener noreferrer">
    <img width="100%" height="100%" class="lazyload" src="${LAZYLOAD}" data-src="${escapeHtml(thumbnail(p, a('assets')))}" alt="${escapeHtml(p.title)}" />
    <time datetime="${formatDate(p.created, 'Y-m-d')}">${formatDate(p.created, 'Y-m-d')}</time>
  </a>
  <div class="information">
    <a href="${permalink(p)}" class="title" title="${escapeHtml(p.title)}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.title)}</a>
    <a class="abstract" href="${permalink(p)}" title="文章摘要" target="_blank" rel="noopener noreferrer">${escapeHtml(p.fields?.abstract || plainExcerpt(p.text, 90))}</a>
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
  const { post, db } = ctx;
  const { cats, tags } = await contentMetas(db, post);
  const author = (await db.getUser(post.authorId)) || { screenName: '博主', mail: '' };
  const { prev, next } = await db.prevNext(post.cid, post.type);
  const views = await db.getStat(post.cid, 'views');
  const agree = await db.getStat(post.cid, 'agree');
  const related = (await db.listContents({ type: 'post', pageSize: 4, tagMid: post.tags?.[0] })).items.filter((r) => r.cid !== post.cid).slice(0, 3);

  const catHtml = cats.length
    ? `<div class="joe_detail__category">${cats.slice(0, 5).map((c, i) => `<a href="${c.permalink}" class="item item-${i}" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</a>`).join('')}</div>`
    : '';

  ctx.contentBody = `<div class="joe_container joe_bread">
    <ul class="joe_bread__bread">
      <li class="item"><a href="/" class="link" title="首页">首页</a></li>
      ${cats.length ? `<li class="line">/</li><li class="item"><a class="link" href="${cats[0].permalink}" title="${escapeHtml(cats[0].name)}">${escapeHtml(cats[0].name)}</a></li><li class="line">/</li>` : '<li class="line">/</li>'}
      <li class="item">正文</li>
    </ul>
  </div>
  <div class="joe_container">
    <div class="joe_main joe_post">
      <div class="joe_detail" data-cid="${post.cid}">
        ${catHtml}
        <h1 class="joe_detail__title">${escapeHtml(post.title)}</h1>
        <div class="joe_detail__count">
          <div class="joe_detail__count-information">
            <img width="35" height="35" class="avatar lazyload" src="${LAZYLOAD}" data-src="${avatarUrl(author.mail)}" alt="${escapeHtml(author.screenName)}" />
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
          ${renderMarkdown(post.text)}
        </article>
        ${tags.length ? `<div class="joe_detail__tags">${tags.map((t) => `<a href="${t.permalink}" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</a>`).join('')}</div>` : ''}
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
              <img width="100%" height="120" class="lazyload" src="${LAZYLOAD}" data-src="${escapeHtml(thumbnail(r, a('assets')))}" alt="${escapeHtml(r.title)}" />
              <div class="title">${escapeHtml(r.title)}</div>
            </a>`).join('')}
          </div>
        </div>` : ''}
        <ul class="joe_post__pagination">
          ${prev ? `<li class="joe_post__pagination-item prev"><a href="${permalink(prev)}" title="${escapeHtml(prev.title)}">${escapeHtml(prev.title)}</a></li>` : ''}
          ${next ? `<li class="joe_post__pagination-item next"><a href="${permalink(next)}" title="${escapeHtml(next.title)}">${escapeHtml(next.title)}</a></li>` : ''}
        </ul>
        ${await commentsBlock(ctx, post)}
      </div>
      ${await asideBlock(ctx)}
    </div>
  </div>`;

  const desc = post.fields?.description || plainExcerpt(post.text, 120);
  return layout(ctx, {
    title: `${escapeHtml(post.title)} - ${escapeHtml(ctx.options.title)}`,
    meta: `<meta name="description" content="${escapeHtml(desc)}" />${(post.fields?.keywords || tags.length) ? `<meta name="keywords" content="${escapeHtml(post.fields?.keywords || tags.map((t) => t.name).join(','))}" />` : ''}`,
    css: [a('assets/lib/prism/prism.min.css'), a('assets/css/joe.post.min.css')],
    js: [a('assets/lib/clipboard@2.0.11/clipboard.min.js'), a('assets/lib/prism/prism.min.js'), a('assets/js/joe.post_page.min.js')],
  });
}

/** 评论区块（Joe 结构 + Owo 表情 + 楼中楼） */
async function commentsBlock(ctx, post) {
  if (!post.allowComment || ctx.options.joe.JCommentStatus === 'off') {
    return `<div class="joe_comment"><h3 class="joe_comment__title">评论</h3><div class="joe_comment__close"><span>博主关闭了评论</span></div></div>`;
  }
  const { db, csrfToken, user } = ctx;
  const all = await db.listComments(post.cid);
  const byParent = new Map();
  for (const c of all) {
    if (!byParent.has(c.parent)) byParent.set(c.parent, []);
    byParent.get(c.parent).push(c);
  }
  const renderComment = (c, depth = 0) => {
    const children = byParent.get(c.coid) || [];
    return `<li class="comment-list__item">
      <div class="comment-list__item-contain" id="comment-${c.coid}">
        <div class="term">
          <img width="48" height="48" class="avatar lazyload" src="${LAZYLOAD}" data-src="${avatarUrl(c.mail)}" alt="头像" />
          <div class="content">
            <div class="user">
              <span class="author">${escapeHtml(c.author)}</span>
              ${c.authorId && c.authorId === post.authorId ? '<i class="owner">作者</i>' : ''}
              <div class="agent">${parseAgentOS(c.agent)} · ${parseAgentBrowser(c.agent)}</div>
            </div>
            <div class="substance">${renderCommentText(c.text)}</div>
            <div class="handle">
              <time class="date" datetime="${formatDate(c.created, 'Y-m-d')}">${formatDate(c.created, 'Y-m-d')}</time>
              <span class="reply joe_comment__reply" data-id="comment-${c.coid}" data-coid="${c.coid}">
                <i class="icon fa fa-pencil" aria-hidden="true"></i>回复
              </span>
            </div>
          </div>
        </div>
      </div>
      ${children.length ? `<div class="comment-list__item-children"><ul class="comment-list">${children.map((ch) => renderComment(ch, depth + 1)).join('')}</ul></div>` : ''}
    </li>`;
  };
  const top = byParent.get(0) || [];
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
  ${top.length ? `<ul class="comment-list">${top.map((c) => renderComment(c)).join('')}</ul>` : ''}
</div>`;
}

function renderCommentText(text) {
  const base = g_ctx.options.themeAssetsBase || '/usr/themes/joe';
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

let g_ctx = { options: { themeAssetsBase: '/usr/themes/joe' } };
export function setThemeContext(ctx) { g_ctx = ctx; }

// Owo 表情映射（与 assets/json/joe.owo.json 对应，启动时加载）
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
  const itemsHtml = list.items.map((p) => indexItem(ctx, p)).join('');
  ctx.contentBody = `<div class="joe_container joe_bread">
    <ul class="joe_bread__bread">
      <li class="item"><a href="/" class="link" title="首页">首页</a></li>
      <li class="line">/</li>
      <li class="item">${escapeHtml(archiveTitle)}</li>
    </ul>
  </div>
  <div class="joe_container">
    <div class="joe_main joe_archive">
      <div class="joe_archive__title">${escapeHtml(archiveTitle)}</div>
      <div class="joe_archive__list">
        <ul class="joe_list">${itemsHtml || '<li class="empty">暂无内容</li>'}</ul>
      </div>
      ${pageNav(page, list.pages, ctx.archiveBaseUrl)}
    </div>
    ${await asideBlock(ctx)}
  </div>`;
  return layout(ctx, {
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
  return layout(ctx, {
    title: `页面不存在 - ${escapeHtml(ctx.options.title)}`,
    css: [a('assets/css/joe.global.min.css')],
  });
}
