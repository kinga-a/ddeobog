/**
 * 主题「座右铭」的取值与回退行为测试。
 *
 * 5iblog.global.js 是整包上线的第三方脚本，直接跑会拉进来一大堆 DOM 依赖。
 * 这里只把座右铭那一段代码块原样抠出来，注入桩 $ 和 Blog 后执行——
 * 验的是真实分支行为，不是源码里有没有某个字符串。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SRC = fs.readFileSync(
  new URL('./usr/themes/5iblog/assets/js/5iblog.global.js', import.meta.url), 'utf8');

const DEFAULT_MOTTO = '有钱终成眷属，没钱亲眼目睹';

/** 抠出「座右铭」那个代码块（按花括号配平） */
function mottoBlock() {
  const start = SRC.indexOf('/* 座右铭 */');
  assert.ok(start > 0, '5iblog.global.js 里应仍存在座右铭代码块');
  const open = SRC.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') {
      depth--;
      if (depth === 0) return SRC.slice(start, i + 1);
    }
  }
  throw new Error('座右铭代码块的花括号没配平');
}

/**
 * 跑一次座右铭逻辑。
 * @param motto  设置页里填的值
 * @param ajax   $.ajax 的替身，返回 {fail:调用它模拟接口失败}
 */
function run(motto, ajax) {
  const painted = [];
  const $ = () => ({ html: (t) => painted.push(t) });
  $.ajax = ajax;
  new Function('$', 'Blog', mottoBlock())($, { MOTTO: motto });
  return painted;
}

const okAjax = (res) => (_opts) => _opts.success(res);

test('纯文字格言直接显示，不发请求', () => {
  let called = false;
  const painted = run('随便一句', () => { called = true; });
  assert.deepEqual(painted, ['随便一句']);
  assert.equal(called, false, '不含 http 的格言不该走 ajax');
});

test('未设置格言时用默认文案', () => {
  assert.deepEqual(run('', () => { throw new Error('不该发请求'); }), [DEFAULT_MOTTO]);
  assert.deepEqual(run(undefined, () => { throw new Error('不该发请求'); }), [DEFAULT_MOTTO]);
});

test('接口正常返回时显示接口内容', () => {
  const painted = run('https://v1.jinrishici.com/rensheng.txt', okAjax('统豺虎，御边幅。'));
  assert.deepEqual(painted, ['统豺虎，御边幅。']);
});

test('接口失败时退回默认文案，而不是留空', () => {
  // 这是本次修的点：原来只写了 success，接口一失败侧栏那块就一直空着。
  // jQuery 内部吞掉传输错误并走 error 回调，所以这里直接触发 error 分支。
  let opts = null;
  const painted = [];
  const $ = () => ({ html: (t) => painted.push(t) });
  $.ajax = (o) => { opts = o; o.error(); };
  new Function('$', 'Blog', mottoBlock())($, { MOTTO: 'https://v1.jinrishici.com/rensheng.txt' });

  assert.ok(opts && opts.error, '必须注册 error 回调，否则失败时无从兜底');
  assert.deepEqual(painted, [DEFAULT_MOTTO], '接口失败应退回默认文案');
});

test('接口返回空内容时也退回默认文案', () => {
  for (const res of ['', '   ', null, undefined]) {
    assert.deepEqual(
      run('https://v1.jinrishici.com/rensheng.txt', okAjax(res)),
      [DEFAULT_MOTTO],
      `返回 ${JSON.stringify(res)} 时应退回默认文案`
    );
  }
});

test('ajax 请求带 dataType:text——接口返回 JSON 会把原始 JSON 糊到页面上', () => {
  let opts = null;
  run('https://example.com/motto', (o) => { opts = o; });
  assert.equal(opts.dataType, 'text');
  assert.equal(opts.url, 'https://example.com/motto');
});
