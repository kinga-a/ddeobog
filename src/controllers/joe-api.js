/**
 * Joe 主题开放 API（/joe/api）—— 兼容 Joe 原版 routeType 协议
 */
import { thumbnail } from '../render/html.js';

export async function handleJoeApi({ db, request, url, options = {} }) {
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
      const page = parseInt(get('page') || '1', 10);
      const pageSize = Math.min(parseInt(get('pageSize') || '10', 10), 50);
      const type = get('type') || 'created'; // created|views|commentsNum|agree
      const orderMap = { created: 'created', views: 'views', commentsNum: 'commentsNum', agree: 'agree' };
      const { items } = await db.listContents({
        type: 'post',
        page,
        pageSize,
        order: orderMap[type] || 'created',
      });
      const data = await Promise.all(
        items.map(async (p) => {
          const cats = [];
          for (const mid of p.categories || []) {
            const m = await db.getMeta(mid);
            if (m) cats.push({ name: m.name, permalink: `/category/${encodeURIComponent(m.slug)}/` });
          }
          return {
            cid: p.cid,
            title: p.title,
            permalink: `/archives/${p.cid}/`,
            abstract: p.fields?.abstract || '',
            created: fmt(p.created),
            views: await db.getStat(p.cid, 'views'),
            commentsNum: p.commentsNum || 0,
            agree: await db.getStat(p.cid, 'agree'),
            category: cats,
            type: p.status === 'sticky' ? 'sticky' : p.type,
            // 必须始终给得出图，否则客户端渲染会写出字面量 "undefined"：
            // joe.index.js 的 initDom() 会清空服务端渲染的列表，改用 publish_list
            // 的数据重画，取的是 _.image[0]——空数组取出来就是 undefined，
            // data-src 变成 "undefined"，lazysizes 再把这串当地址写进 src，图彻底不显示。
            image: [thumbnail(p, `${options.themeAssetsBase || '/usr/themes/joe'}/assets`)],
            lazyload: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
            time: fmt(p.created, 'YYYY-MM-DD'),
            mode: 'default',
          };
        })
      );
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
      const kind = get('type') === 'disagree' ? -1 : 1;
      if (!cid) return json(null, 0);
      const map = (await db.kv.getJSON('stat:agree')) || {};
      map[cid] = Math.max(0, (map[cid] || 0) + kind);
      await db.kv.putJSON('stat:agree', map);
      return json({ agree: map[cid] });
    }
    case 'baidu_record':
    case 'baidu_push':
      return json({ record: false, push: false });
    // 顶栏搜索下拉的联想结果（assets/js/joe.search.js 消费）
    case 'search': {
      const kw = (get('s') || get('keywords') || '').trim();
      if (!kw) return json({ total: 0, data: [] });
      const pageSize = Math.min(parseInt(get('pageSize') || '8', 10), 20);
      const { items, total } = await db.listContents({
        type: 'post',
        page: 1,
        pageSize,
        keywords: kw,
      });
      const data = await Promise.all(
        items.map(async (p) => ({
          cid: p.cid,
          title: p.title,
          permalink: `/archives/${p.cid}/`,
          views: await db.getStat(p.cid, 'views'),
          time: fmt(p.created, 'YYYY-MM-DD'),
        }))
      );
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
