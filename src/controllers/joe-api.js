/**
 * Joe 主题开放 API（/joe/api）—— 兼容 Joe 原版 routeType 协议
 */
export async function handleJoeApi({ db, request, url }) {
  const form = await request.formData().catch(() => new URLSearchParams(url.search));
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
          const firstImg = (p.text || '').match(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/);
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
            image: [p.fields?.thumb || (firstImg ? firstImg[1] : '')].filter(Boolean),
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
