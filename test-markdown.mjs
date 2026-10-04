/**
 * 文章正文渲染（markdown.js）的行为测试。
 *
 * 直接调 renderMarkdown 断言产出的 HTML，而不是断言源码字符串——这样
 * 「视频分支放在图片分支前面」这种顺序问题才会真的被测出来。
 *
 * 覆盖两种写法（裸 URL 与 ![]()）外加两条防回归：
 * 图片分支、以及段落中间的 [文字](url) 链接，都不能被视频分支吃掉。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderMarkdown } from './src/render/markdown.js';

/* ---------- 情况一：URL 本身是视频文件 ---------- */

test('独占一行的裸视频 URL 渲染成 <video>', () => {
  const html = renderMarkdown('https://cdn.x.cn/a.mp4');
  assert.match(html, /<video src="https:\/\/cdn\.x\.cn\/a\.mp4"/);
  assert.match(html, /controls/);
  // 只放行可播放的，不给 autoplay
  assert.doesNotMatch(html, /autoplay/);
});

test('![]() 写法的 alt 落进 <figcaption>', () => {
  const html = renderMarkdown('![演示很清晰](https://cdn.x.cn/a.webm)');
  assert.match(html, /<video src="https:\/\/cdn\.x\.cn\/a\.webm"/);
  assert.match(html, /<figcaption>演示很清晰<\/figcaption>/);
});

test('![]() 带 title 时忽略 title、以 alt 作为说明', () => {
  const html = renderMarkdown('![说明](https://cdn.x.cn/a.mp4 "某个标题")');
  assert.match(html, /<figcaption>说明<\/figcaption>/);
  assert.doesNotMatch(html, /某个标题/);
});

test('无 alt 时不输出空的 figcaption', () => {
  assert.doesNotMatch(renderMarkdown('![](https://cdn.x.cn/a.mp4)'), /figcaption/);
});

test('签名链接：剥掉 ?query 后仍判为视频，且 & 被正确转义', () => {
  const html = renderMarkdown('https://cdn.x.cn/a.mp4?sign=abc&t=99');
  assert.match(html, /<video src="https:\/\/cdn\.x\.cn\/a\.mp4\?sign=abc&amp;t=99"/);
  // &amp; 是 HTML 属性里必须的写法，浏览器会解码回 &，签名才不会坏
  assert.doesNotMatch(html, /&t=99"/);
});

test('六种扩展名都认', () => {
  for (const ext of ['mp4', 'webm', 'ogv', 'ogg', 'mov', 'm4v']) {
    assert.match(
      renderMarkdown(`https://cdn.x.cn/a.${ext}`),
      new RegExp(`<video src="https://cdn\\.x\\.cn/a\\.${ext}"`),
      `${ext} 没被当成视频`
    );
  }
});

/* ---------- 防回归：不能抢走图片和普通链接 ---------- */

test('图片独占一行仍是 <img>，不受视频分支影响', () => {
  const html = renderMarkdown('![图](https://cdn.x.cn/a.png)');
  assert.match(html, /<img src="https:\/\/cdn\.x\.cn\/a\.png"/);
  assert.doesNotMatch(html, /<video/);
});

test('[文字](视频URL) 仍是链接，不是播放器', () => {
  const html = renderMarkdown('[点我播放](https://cdn.x.cn/a.mp4)');
  assert.match(html, /<a href="https:\/\/cdn\.x\.cn\/a\.mp4"/);
  assert.doesNotMatch(html, /<video/);
});

test('段落中间的裸 .mp4 保持为链接', () => {
  const html = renderMarkdown('这是 https://cdn.x.cn/a.mp4 这个视频');
  assert.match(html, /<a href="https:\/\/cdn\.x\.cn\/a\.mp4"/);
  assert.doesNotMatch(html, /<video/);
});

test('.mp4 后缀跟了别的话，不会被当成视频', () => {
  const html = renderMarkdown('https://cdn.x.cn/a.mp4 是我上次录的');
  assert.doesNotMatch(html, /<video/);
});

test('裸图片 URL 仍是链接', () => {
  const html = renderMarkdown('https://cdn.x.cn/a.png');
  assert.match(html, /<a href="https:\/\/cdn\.x\.cn\/a\.png"/);
  assert.doesNotMatch(html, /<video/);
});

test('列表行里的视频不转 player（与图片的现有行为一致）', () => {
  const html = renderMarkdown('- https://cdn.x.cn/a.mp4');
  assert.doesNotMatch(html, /<video/);
  assert.match(html, /<a href="https:\/\/cdn\.x\.cn\/a\.mp4"/);
});

test('危险协议不会被渲染成 video', () => {
  for (const u of ['javascript:alert(1).mp4', 'data:text/html,<script>x</script>.mp4']) {
    assert.doesNotMatch(renderMarkdown(`![x](${u})`), /<video/, `${u} 竟渲染成了 video`);
  }
});

test('非 http(s) 的 .mp4 绝对地址不转 video', () => {
  assert.doesNotMatch(renderMarkdown('ftp://x.cn/a.mp4'), /<video/);
});

test('figcaption 里的尖括号被转义，不逃出标签', () => {
  const html = renderMarkdown('![<img src=x onerror=alert(1)>](https://cdn.x.cn/a.mp4)');
  // 尖括号变成实体，只剩惰性文本，不会变成活的 <img> 标签
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img/);
});

/* ---------- Typecho DPlayer 短代码（文章 10 实际在用的写法） ---------- */

test('{dplayer src="…"} 渲染成 video', () => {
  const html = renderMarkdown('{dplayer src="https://cdn.x.cn/a.mp4"/}');
  assert.match(html, /<video src="https:\/\/cdn\.x\.cn\/a\.mp4"/);
  assert.doesNotMatch(html, /\{dplayer/);
});

test('{dplayer} 结尾不带斜杠也能识别', () => {
  assert.match(renderMarkdown('{dplayer src="https://cdn.x.cn/a.mp4"}'), /<video src=/);
});

test('{dplayer} 单引号属性也能识别', () => {
  assert.match(renderMarkdown("{dplayer src='https://cdn.x.cn/a.mp4'/}"), /<video src=/);
});

test('{dplayer} 的 title 属性落进 figcaption', () => {
  const html = renderMarkdown('{dplayer src="https://cdn.x.cn/a.mp4" title="演示"/}');
  assert.match(html, /<figcaption>演示<\/figcaption>/);
});

test('{dplayer} 在段落中间可用（不要求独占一行）', () => {
  const html = renderMarkdown('看这里：{dplayer src="https://cdn.x.cn/a.mp4"/}就这个');
  assert.match(html, /看这里：<figure/);
  assert.match(html, /<\/figure>就这个/);
});

test('src 不会被自动链接规则咬成播放器里套超链接', () => {
  const html = renderMarkdown('{dplayer src="https://cdn.x.cn/a.mp4"/}');
  assert.doesNotMatch(html, /<a href=/);
});

test('{dplayer} 的签名参数保持实体形式', () => {
  const html = renderMarkdown('{dplayer src="https://cdn.x.cn/a.mp4?a=1&b=2"/}');
  assert.match(html, /a=1&amp;b=2/);
});

test('文章 10 的真实内容：两个视频都出来，且无短代码残留', () => {
  // 线上 archives/10 的正文原样，用于回归「视频不出」这个 bug
  const md = [
    '{dplayer src="https://cloud.video.taobao.com/play/u/null/p/1/e/6/t/1/407201055210.mp4?SBizCode=xiaoer"/}',
    '首次APP备案视频教程：',
    '{dplayer src="https://cloud.video.taobao.com/play/u/null/p/1/e/6/t/1/429328919018.mp4"/}',
    '来自：https://help.aliyun.com/zh/icp-filing/user-guide/for-the-first-time-the-record-process',
  ].join('\n');
  const html = renderMarkdown(md);
  assert.equal((html.match(/<video /g) || []).length, 2, '应当正好两个播放器');
  assert.doesNotMatch(html, /\{dplayer/);
  assert.doesNotMatch(html, /&quot;/, '不该再有转义残留的引号');
});

test('写在反引号里的 {dplayer} 不变成播放器', () => {
  const html = renderMarkdown('`{dplayer src="https://cdn.x.cn/a.mp4"/}`');
  assert.doesNotMatch(html, /<video/);
  assert.match(html, /<code>/);
});

test('写在代码块里的 {dplayer} 不变成播放器', () => {
  const html = renderMarkdown('```\n{dplayer src="https://cdn.x.cn/a.mp4"/}\n```');
  assert.doesNotMatch(html, /<video/);
});

test('{dplayer} 的 javascript: 不会产出标签', () => {
  const html = renderMarkdown('{dplayer src="javascript:alert(1).mp4"/}');
  assert.doesNotMatch(html, /<video/);
  assert.doesNotMatch(html, /src="javascript/);
});

test('缺 src 或 src 为空的 {dplayer} 原样保留', () => {
  for (const s of ['{dplayer}/}', '{dplayer src=""/}']) {
    const html = renderMarkdown(s);
    assert.doesNotMatch(html, /<video/, `${s} 不该产出播放器`);
    assert.match(html, /dplayer/);
  }
});