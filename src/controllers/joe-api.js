/**
 * Joe 主题开放 API（/joe/api）—— 兼容 Joe 原版 routeType 协议
 */
import { thumbnail, parseStickIds } from '../render/html.js';
import { escapeHtml } from '../render/markdown.js';

const MAX_PAGE_SIZE = 50;
const SEARCH_MAX_PAGE_SIZE = 20;
const DEFAULT_SEARCH_SIZE = 8;
const LAZYLOAD_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const ASSETS_BASE = '/usr/themes/joe';

export async function handleJoeApi({ db, request, url, user = null, options = {} }) {
  // 注意：不能用 `request.formData().catch(...)`。
  // EdgeOne 边缘运行时的 Request 在没有 Content-Type 时是**同步抛错**
  // （"Content-Type header is empty"），此时 .catch 还没挂上，异常会直接
  // 冒泡到上层变成 500。必须用 try/catch 包住整个调用。
  let form;
  try {
    form = await request.formData();
  } catch {
    form = new URLSearchParams(url.search);
  }
  const get = (k) => form.get(k) || url.searchParams.get(k) || '';
  const routeType = get('routeType');

  const json = (data, code = 1) =>
    new Response(JSON.stringify({ code, data }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });

  switch (routeType) {
    case 'publish_list': {
      const page = Math.max(parseInt(get('page') || '1', 10) || 1, 1);
      const pageSize = Math.min(Math.max(parseInt(get('pageSize') || '10', 10) || 10, 1), MAX_PAGE_SIZE);
      const type = get('type') || 'created'; // created|views|commentsNum|agree
      const orderMap = { created: 'created', views: 'views', commentsNum: 'commentsNum', agree: 'agree' };
      // 登录管理员在首页 tab 里也要看到隐藏文章。
      // 这个接口必须跟着一起改：joe.index.js 的 initDom() 会清空服务端渲染的
      // 列表、拿这里的数据重画，只改 renderIndex 的话隐藏文章会在 JS 跑起来后消失。
      // user 由 main.js 统一解析好传进来，不用在这里重读一遍会话。
      // 索引条目已带写入时算好的封面与自定义摘要（cover/absCustom），
      // 不必再逐篇读全文；旧条目缺字段时 listContentsIndex 会按页回填。
      const { items } = await db.listContentsIndex({
        type: 'post',
        page,
        pageSize,
        order: orderMap[type] || 'created',
        allStatus: !!user,
      });

      // 顶置文章（后台「顶置文章IDs」，逗号分隔的 cid）。
      // 首页列表不是服务端直出：joe.index.js 的 initDom() 会先清空 .joe_list，
      // 再拿 publish_list 的数据重画，所以 renderIndex 里的排序会被整个覆盖，
      // 置顶必须在这里实现才生效。
      // 第 1 页把置顶文章按填写顺序前置；后续页把它们从结果里剔除，
      // 保证同一篇文章在无限滚动列表里只出现一次。
      const stickIds = parseStickIds(options);
      const stickSet = new Set(stickIds);
      let list = items;
      if (stickSet.size) {
        list = list.filter((p) => !stickSet.has(String(p.cid)));
        if (page === 1) {
          const sticks = [];
          for (const cid of stickIds) {
            const p = await db.getContent(parseInt(cid, 10));
            if (p && p.type === 'post' && p.status === 'publish') sticks.push(p);
          }
          list = [...sticks, ...list];
        }
      }

      // 批量取统计数据与分类，避免逐条 getStat/getMeta 的 N+1 查询
      const cids = list.map((p) => p.cid);
      const mids = [...new Set(list.flatMap((p) => p.categories || []))];
      const [statsMap, metas] = await Promise.all([
        db.getStatsBatch(cids),
        db.getMetasBatch(mids),
      ]);
      const metaByMid = new Map(metas.map((m) => [m.mid, m]));

      const data = list.map((p) => {
        const stats = statsMap.get(p.cid) || {};
        return {
          cid: p.cid,
          title: escapeHtml(p.title),
          permalink: `/archives/${p.cid}/`,
          abstract: escapeHtml(p.absCustom ?? p.fields?.abstract ?? ''),
          created: fmt(p.created),
          views: stats.views || 0,
          commentsNum: p.commentsNum || 0,
          agree: stats.agree || 0,
          category: (p.categories || [])
            .map((mid) => metaByMid.get(mid))
            .filter(Boolean)
            .map((m) => ({ name: escapeHtml(m.name), permalink: `/category/${encodeURIComponent(m.slug)}/` })),
          // 角标靠 type==='sticky' 判断（joe.index.js 里就是这么渲染的）。
          // 后台的「顶置文章IDs」不改文章的 status，所以这里要把置顶的
          // 显式标成 sticky，否则角标永远不显示。
          type: p.status === 'sticky' || stickSet.has(String(p.cid)) ? 'sticky' : p.type,
          // 必须始终给得出图，否则客户端渲染会写出字面量 "undefined"：
          // joe.index.js 的 initDom() 会清空服务端渲染的列表，改用 publish_list
          // 的数据重画，取的是 _.image[0]——空数组取出来就是 undefined，
          // data-src 变成 "undefined"，lazysizes 再把这串当地址写进 src，图彻底不显示。
          image: [escapeHtml(p.cover || thumbnail(p, `${options.themeAssetsBase || ASSETS_BASE}/assets`))],
          lazyload: LAZYLOAD_PLACEHOLDER,
          time: fmt(p.created, 'YYYY-MM-DD'),
          mode: 'default',
          // 客户端据此渲染「隐藏」角标。匿名请求拿不到 hidden 条目，
          // 所以这个字段对匿名用户始终是 publish，角标不会误显示。
          status: p.status,
        };
      });
      return json(data);
    }
    case 'handle_views': {
      const cid = parseInt(get('cid'), 10);
      if (!cid) return json(null, 0);
      const views = await db.incrStat(cid, 'views');
      return json({ views });
    }
    case 'handle_agree': {
      const cid = parseInt(get('cid'), 10);
      const delta = get('type') === 'disagree' ? -1 : 1;
      if (!cid) return json(null, 0);
      const agree = await db.adjustStat(cid, 'agree', delta);
      return json({ agree });
    }
    case 'baidu_record':
    case 'baidu_push':
      return json({ record: false, push: false });
    // 顶栏搜索下拉的联想结果（assets/js/joe.search.js 消费）
    case 'search': {
      const kw = (get('s') || get('keywords') || '').trim();
      if (!kw) return json({ total: 0, data: [] });
      const pageSize = Math.min(Math.max(parseInt(get('pageSize') || String(DEFAULT_SEARCH_SIZE), 10) || DEFAULT_SEARCH_SIZE, 1), SEARCH_MAX_PAGE_SIZE);
      const { items, total } = await db.listContentsIndex({
        type: 'post',
        page: 1,
        pageSize,
        keywords: kw,
      });
      const cids = items.map((p) => p.cid);
      const statsMap = await db.getStatsBatch(cids);
      const data = items.map((p) => ({
        cid: p.cid,
        title: escapeHtml(p.title),
        permalink: `/archives/${p.cid}/`,
        views: statsMap.get(p.cid)?.views || 0,
        time: fmt(p.created, 'YYYY-MM-DD'),
      }));
      return json({ total, data });
    }
    default:
      return json(null, 0);
  }
}

function fmt(ts, f = 'YYYY-MM-DD HH:mm:ss') {
  const d = new Date(ts * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return f
    .replace('YYYY', d.getFullYear())
    .replace('MM', pad(d.getMonth() + 1))
    .replace('DD', pad(d.getDate()))
    .replace('HH', pad(d.getHours()))
    .replace('mm', pad(d.getMinutes()))
    .replace('ss', pad(d.getSeconds()));
}
