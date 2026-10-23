/**
 * Markdown 渲染器 —— 兼容 Typecho HyperDown 常用语法子集：
 * 标题/粗斜/删除线/行内代码/代码块/链接/图片/引用/有序无序列表/表格/分隔线/自动链接/<!--more-->
 */

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 摘要：去掉 markdown 标记，截断 */
export function plainExcerpt(text, len = 100) {
  const idx = text.indexOf('<!--more-->');
  let t = idx >= 0 ? text.slice(0, idx) : text;
  t = t
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~`\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > len ? t.slice(0, len) + '...' : t;
}

/** 按 <!--more--> 分割正文 */
export function splitMore(text) {
  const idx = text.indexOf('<!--more-->');
  if (idx >= 0) return { excerptText: text.slice(0, idx), full: text };
  return { excerptText: null, full: text };
}

export function renderMarkdown(src) {
  if (!src) return '';
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  let inQuote = false;

  const flushQuote = () => {
    if (inQuote) { out.push('</blockquote>'); inQuote = false; }
  };

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      flushQuote();
      const lang = fence[1];
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // skip closing ```
      out.push(
        `<pre><code class="language-${escapeHtml(lang)}">${escapeHtml(buf.join('\n'))}</code></pre>`
      );
      continue;
    }

    // 空行
    if (!line.trim()) { flushQuote(); i++; continue; }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushQuote();
      const level = h[1].length;
      out.push(`<h${level} id="${slugId(h[2])}">${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // 分隔线
    if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line)) {
      flushQuote();
      out.push('<hr>');
      i++;
      continue;
    }

    // 引用
    if (/^>\s?/.test(line)) {
      if (!inQuote) { out.push('<blockquote>'); inQuote = true; }
      out.push(`<p>${inline(line.replace(/^>\s?/, ''))}</p>`);
      i++;
      continue;
    }
    flushQuote();

    // 无序列表
    if (/^[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^[-*+]\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // 有序列表
    if (/^\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\d+[.)]\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    // 表格
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      flushQuote();
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      let html = '<table><thead><tr>';
      for (const c of header) html += `<th>${inline(c)}</th>`;
      html += '</tr></thead><tbody>';
      for (const r of rows) {
        html += '<tr>';
        for (const c of r) html += `<td>${inline(c)}</td>`;
        html += '</tr>';
      }
      html += '</tbody></table>';
      out.push(html);
      continue;
    }

    // 视频独占一行：![]() 形式（可带 title）或裸 URL（后面不允许再有别的字）。
    // 两种形式分开匹配：合成一条正则会让「https://x/a.mp4 是我上次录的」这种
    // 行也被当成视频，段落里的普通链接反而消失。放在图片分支之前，图片分支原样不动。
    const trimmed = line.trim();
    const vidAlt = trimmed.match(/^!\[([^\]]*)\]\(\s*<?(https?:\/\/[^\s)>]+)>?(?:\s[^)]*)?\)$/);
    const vidBare = trimmed.match(/^<?(https?:\/\/[^\s)>]+)>?$/);
    const vid = vidAlt ? { url: vidAlt[2], alt: vidAlt[1] } : vidBare ? { url: vidBare[1], alt: '' } : null;
    if (vid && isVideoUrl(vid.url)) {
      out.push(renderVideo(vid.url, vid.alt));
      i++;
      continue;
    }

    // 同一排多张图（一行里只有图片、至少两张）。必须排在单图分支之前。
    const gallery = renderGallery(trimmed);
    if (gallery) {
      out.push(gallery);
      i++;
      continue;
    }

    // 图片独占一行（Joe 风格大图）
    const imgOnly = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgOnly) {
      const src = imgOnly[2].split(/\s+/)[0];
      out.push(
        `<img src="${escapeHtml(src)}" alt="${escapeHtml(imgOnly[1])}" class="joe_detail__article-image" loading="lazy" decoding="async" />`
      );
      i++;
      continue;
    }

    // 普通段落（合并连续行）
    const para = [line];
    i++;
    while (
      i < lines.length && lines[i].trim() &&
      !/^(#{1,6}\s|>|```|[-*+]\s|\d+[.)]\s)/.test(lines[i]) &&
      !/^(\*{3,}|-{3,}|_{3,})\s*$/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`);
  }
  flushQuote();
  return out.join('\n');
}

function splitRow(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((s) => s.trim());
}

function slugId(text) {
  return escapeHtml(
    String(text).trim().toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '') || 'h'
  );
}

/**
 * Typecho DPlayer 插件的短代码。
 *
 * 文章 10 用的是 `{dplayer src="…"}`，这是从原 Typecho 站搬过来的内容，
 * 而本项目的渲染器从来没有解析过短代码，所以它以字面量形式被转义后直接输出到
 * 页面上（`{dplayer src=&quot;…&quot;/}`）——视频当然出不来。
 *
 * 只认 dplayer 这一个：全站只有文章 10 用到，且主题自带的 joe-dplayer 组件是拿
 * `player` 基础地址拼 iframe 的，没有该属性会拼出 `undefinedhttps://…`，用不了。
 * 所以直接渲染原生 <video>，不引入任何播放器依赖。
 */
const DPLAYER_RE = /\{dplayer\b([^}]*)\}/g;

/** 解析 `k="v"` / `k='v'` 形式的属性串。 */
function shortcodeAttrs(attrs) {
  const map = {};
  const re = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(attrs))) map[m[1].toLowerCase()] = m[2] ?? m[3];
  return map;
}

// 判断是否为可直接播放的视频地址。只认扩展名，不发任何探测请求。
function isVideoUrl(url) {
  // 先剥掉 ?query 与 #hash 再看扩展名，否则签名链接（a.mp4?sign=xx&t=yy）
  // 会被判成非视频，而这类链接恰恰最常见。
  return /\.(mp4|webm|ogv|ogg|mov|m4v)$/i.test(String(url).split(/[?#]/)[0]);
}

/**
 * 一行里只有图片、且至少两张时，并排展示。
 *
 * 为什么必须单独处理：正文里不带 class 的 <img> 会命中主题的
 * `.joe_detail__article img:not([class]){display:block}`，两张图只能上下堆叠。
 * 所以这里给每张图带上 class 跳开那条规则，外层再套一层 flex。
 *
 * 只在「整行都是图片」时才并排；图旁边有文字就仍走普通段落，免得
 * 「说明文字 ![图]」这种写法被误判成图集。
 */
function renderGallery(line) {
  if (!/^(?:!\[[^\]]*\]\([^)]+\)\s*){2,}$/.test(line)) return null;
  const imgs = line.match(/!\[([^\]]*)\]\(([^)]+)\)/g).map((tag) => {
    const p = tag.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    // 第二个分组可能带 "title"，与单图分支一致取空白前的地址
    return (
      `<img src="${escapeHtml(p[2].split(/\s+/)[0])}" alt="${escapeHtml(p[1])}" ` +
      `class="joe_detail__article-gallery__item" loading="lazy" decoding="async" />`
    );
  });
  return `<div class="joe_detail__article-gallery">${imgs.join('')}</div>`;
}

/**
 * 渲染独占一行的视频。
 *
 * 刻意不让用户写原始 HTML——是渲染器自己生成 <video>，不是放行任意标签。
 * 现有代码本来就没有 javascript:/data: 过滤，<a href> 和 <img src> 早已接受
 * 任意 URL，所以这里没扩大攻击面；只接受 https?://，其余一律不匹配。
 *
 * src 是 HTML 属性，escapeHtml 转义出的 &amp; 会被浏览器解码回 &，
 * 所以带签名的链接能正常工作（与座右铭「JS 字符串字面量里不解码」是两回事）。
 */
function renderVideo(url, alt) {
  const caption = String(alt || '').trim();
  return (
    `<figure class="joe_detail__article-media">` +
    `<video src="${escapeHtml(url)}" controls preload="metadata" playsinline></video>` +
    (caption ? `<figcaption>${inline(caption)}</figcaption>` : '') +
    `</figure>`
  );
}

/** 行内格式 */
export function inline(s) {
  // 顺序要紧：先摘行内代码，再摘 dplayer 短代码，最后才 escapeHtml。
  // 而且行内代码必须存成「只剩数字下标」的占位符，不能把原文包在 \u0001…\u0002 里——
  // 那样 DPLAYER_RE 照样能匹配到里面的 {dplayer}，最后就会把播放器塞进 <code>。
  // 转义后属性里的引号会变成 &quot;，所以短代码必须在转义前摘出来；
  // 而生成的 <video> 又绝不能再被转义一次。
  const codes = [];
  const media = [];
  let pre = String(s)
    // 行内代码（优先处理）
    .replace(/`([^`]+)`/g, (_, code) => `\u0001${codes.push(code) - 1}\u0001`)
    .replace(DPLAYER_RE, (whole, attrs) => {
      const a = shortcodeAttrs(attrs);
      const src = (a.src || '').trim();
      // 只放行 http(s)。像 javascript: 这类原样保留，不产出任何标签。
      if (!/^https?:\/\//i.test(src)) return whole;
      media.push(renderVideo(src, a.title || ''));
      return `\u0003${media.length - 1}\u0003`;
    });
  let t = escapeHtml(pre);
  // 图片
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, alt, src) =>
    `<img src="${src}" alt="${alt}" loading="lazy" decoding="async" />`
  );
  // 链接
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, txt, href) =>
    `<a href="${href}" target="_blank" rel="noopener noreferrer">${txt}</a>`
  );
  // 自动链接
  t = t.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, p, url) =>
    `${p}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
  );
  // 粗体/斜体/删除线
  t = t.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  t = t.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  // 行内代码还原
  t = t.replace(/\u0001(\d+)\u0001/g, (_, idx) => `<code>${escapeHtml(codes[Number(idx)] ?? '')}</code>`);
  // 短代码还原。必须排在最后：提前塞回去的话，src 会被上面的自动链接规则
  // 咬走，变成播放器里套一个超链接。
  t = t.replace(/\u0003(\d+)\u0003/g, (_, idx) => media[Number(idx)] ?? '');
  return t;
}
