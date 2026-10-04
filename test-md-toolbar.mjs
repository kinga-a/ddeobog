/**
 * 后台 Markdown 工具条的行为测试。
 *
 * 没有可用的浏览器驱动，所以这里用一个最小 DOM 替身（只实现脚本真正用到的那几个
 * API）把 joe.admin-md.js 原样跑起来，而不是去断言源码字符串。这样撤销步数、
 * 行前缀 toggle 这类最容易写错的地方才是真的被验过。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('./usr/themes/joe/assets/js/joe.admin-md.js', import.meta.url), 'utf8');

/* ---------- 最小 DOM ---------- */
function makeEl(tag, attrs = {}) {
  const listeners = {};
  const el = {
    tagName: tag,
    attrs,
    focused: false,
    value: '',
    selectionStart: 0,
    selectionEnd: 0,
    setSelectionRange(s, e) { this.selectionStart = s; this.selectionEnd = e; },
    focus() { this.focused = true; },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    dispatch(type, ev) { for (const fn of listeners[type] || []) fn(ev); },
    closest(sel) {
      const [t, attr] = sel.split(/[\[\]]/).filter(Boolean);
      if (t !== tag) return null;
      if (attr) {
        const key = attr.replace(/^data-/, '');
        const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        if (!(camel in el.attrs)) return null;
      }
      return el;
    },
    getAttribute(name) {
      const camel = name.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      return camel in el.attrs ? el.attrs[camel] : null;
    },
  };
  return el;
}

/** 起一套环境：返回 textarea、点按钮、敲键盘的句柄 */
function boot(initialValue = '') {
  const bar = makeEl('div');
  const ta = makeEl('textarea');
  ta.value = initialValue;
  ta.selectionStart = initialValue.length;
  ta.selectionEnd = initialValue.length;

  const document = {
    readyState: 'complete',
    getElementById: (id) => (id === 'joe-md-bar' ? bar : id === 'joe-md-text' ? ta : null),
    addEventListener() {},
  };
  const sandbox = { document, setTimeout, clearTimeout, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);

  return {
    ta,
    /** 点工具条按钮（先 mousedown 再 click，和真实点击顺序一致） */
    click(action) {
      const btn = makeEl('button', { md: action });
      const ev = { target: btn, preventDefault() { ev.defaultPrevented = true; }, defaultPrevented: false };
      bar.dispatch('mousedown', ev);
      bar.dispatch('click', ev);
      return ev;
    },
    /** 选中一段文字再点按钮 */
    sel(s, e) { ta.selectionStart = s; ta.selectionEnd = e; },
    /** 文本 + 选区快照 */
    state: () => ({ v: ta.value, s: ta.selectionStart, e: ta.selectionEnd }),
    key(k, mods = {}) {
      ta.dispatch('keydown', {
        key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
        preventDefault() {}, ...mods,
      });
    },
  };
}

/* ---------- 行前缀 ---------- */

test('标题：插入前缀且光标跟随后移', () => {
  const h = boot('标题');
  h.ta.selectionStart = 0;
  h.click('h1');
  assert.equal(h.ta.value, '# 标题');
  assert.equal(h.ta.selectionStart, 2, '光标应留在「# 」之后');
});

test('标题：已是同一级时再点是去掉前缀（toggle）', () => {
  const h = boot('## 小标题');
  h.ta.selectionStart = 0;
  h.click('h2');
  assert.equal(h.ta.value, '小标题');
});

test('标题：换级别时先剥旧前缀，不叠成 "## # 标题"', () => {
  const h = boot('# 标题');
  h.ta.selectionStart = 0;
  h.click('h2');
  assert.equal(h.ta.value, '## 标题');
  h.click('h3');
  assert.equal(h.ta.value, '### 标题');
});

test('H1 的 toggle 不会误伤 H2 行', () => {
  const h = boot('## 小标题');
  h.ta.selectionStart = 0;
  h.click('h1');
  assert.equal(h.ta.value, '# 小标题', 'H2 行上点 H1 应替换而不是删掉');
});

test('多行选中：每行都加前缀', () => {
  const h = boot('甲\n乙\n丙');
  h.sel(0, 3);
  h.click('ul');
  assert.equal(h.ta.value, '- 甲\n- 乙\n丙', '选区到「乙」末尾就该停，丙不动');
});

test('多行选中：选区延到最后一行时末行也加前缀', () => {
  const h = boot('甲\n乙\n丙');
  h.sel(0, 5);
  h.click('ul');
  assert.equal(h.ta.value, '- 甲\n- 乙\n- 丙');
});

test('多行选中：整块处于引用时全部取消', () => {
  const h = boot('> 甲\n> 乙');
  h.sel(0, 5);
  h.click('quote');
  assert.equal(h.ta.value, '甲\n乙');
});

/* ---------- 行内包裹 ---------- */

test('粗体：包住选中文字并保持选中', () => {
  const h = boot('这句话很重要');
  h.sel(3, 4);
  h.click('bold');
  assert.equal(h.ta.value, '这句话**很**重要');
  assert.equal(h.state().s, 5);
  assert.equal(h.state().e, 6, '插入后应仍选中「很」，方便继续加别的格式');
});

test('粗体：没有选中时插入占位文字并选中它', () => {
  const h = boot('');
  h.click('bold');
  assert.equal(h.ta.value, '**加粗**');
  assert.equal(h.state().s, 2);
  assert.equal(h.state().e, 4);
});

test('行内代码与删除线', () => {
  const h = boot('a b');
  h.sel(0, 1);
  h.click('code');
  assert.equal(h.ta.value, '`a` b');
  h.sel(0, 3);
  h.click('strike');
  assert.equal(h.ta.value, '~~`a`~~ b');
});

test('链接：无选中时占位，选中整段文字做锚文本', () => {
  const h = boot('');
  h.click('link');
  assert.equal(h.ta.value, '[链接文字](https://)');
  const g = boot('看这里');
  g.sel(0, 3);
  g.click('link');
  assert.equal(g.ta.value, '[看这里](https://)');
});

/* ---------- 块插入 ---------- */

test('代码块：光标停在两个围栏之间', () => {
  const h = boot('');
  h.click('codeblock');
  assert.equal(h.ta.value, '```js\n\n```');
  assert.equal(h.ta.selectionStart, 7, '应停在 ```js\\n 之后');
});

test('块插入：前后都有内容时补足空行', () => {
  const h = boot('前言');
  h.ta.selectionStart = 2;
  h.click('codeblock');
  assert.equal(h.ta.value, '前言\n\n```js\n\n```', '光标在文末时尾部无需再补换行');

  const g = boot('前言结尾');
  g.sel(2, 2);
  g.click('hr');
  assert.equal(g.ta.value, '前言\n\n---\n结尾', '后面有内容时必须补尾换行，否则 --- 和「结尾」粘成一行');
});

test('表格与摘要分隔', () => {
  const h = boot('');
  h.click('table');
  assert.match(h.ta.value, /^\| 列1 \| 列2 \|\n\| --- \| --- \|/);
  assert.equal(h.ta.selectionStart, 2, '光标落在第一个表头格里');

  const g = boot('');
  g.click('more');
  assert.equal(g.ta.value, '<!--more-->');
});

test('分隔线', () => {
  const h = boot('');
  h.click('hr');
  assert.equal(h.ta.value, '---');
});

/* ---------- 撤销 / 重做 ---------- */

test('一次按钮操作 = 一步撤销', () => {
  const h = boot('原文');
  h.ta.selectionStart = 0;
  h.click('h1');
  assert.equal(h.ta.value, '# 原文');
  h.click('undo');
  assert.equal(h.ta.value, '原文', '一次撤销就该回到原文，而不是跨过它');
});

test('连续两次操作，每次撤销只退一步', () => {
  const h = boot('x');
  h.sel(0, 1);
  h.click('bold');
  const afterBold = h.ta.value;
  h.click('italic');
  assert.equal(h.ta.value, '***x***');
  h.click('undo');
  assert.equal(h.ta.value, afterBold, '应回到「只加粗」的状态');
  h.click('undo');
  assert.equal(h.ta.value, 'x');
  h.click('redo');
  assert.equal(h.ta.value, afterBold);
});

test('没有历史时不报错', () => {
  const h = boot('a');
  h.click('undo');
  h.click('redo');
  assert.equal(h.ta.value, 'a');
});

/* ---------- 快捷键 ---------- */

test('Ctrl+B / Ctrl+I / Ctrl+K', () => {
  const h = boot('hi');
  h.sel(0, 2);
  h.key('b', { ctrlKey: true });
  assert.equal(h.ta.value, '**hi**');

  const g = boot('hi');
  g.sel(0, 2);
  g.key('i', { metaKey: true });
  assert.equal(g.ta.value, '*hi*');

  const k = boot('');
  k.key('k', { ctrlKey: true });
  assert.equal(k.ta.value, '[链接文字](https://)');
});

test('Ctrl+Shift+Z 与 Ctrl+Y 都能重做', () => {
  for (const k of [{ key: 'z', ctrlKey: true, shiftKey: true }, { key: 'y', ctrlKey: true }]) {
    const h = boot('a');
    h.sel(0, 1);
    h.click('bold');
    h.click('undo');
    assert.equal(h.ta.value, 'a');
    h.key(k.key, { ctrlKey: k.ctrlKey, shiftKey: k.shiftKey });
    assert.equal(h.ta.value, '**a**', `快捷键 ${k.key} 应能重做`);
  }
});

test('按钮点完焦点回到输入框', () => {
  const h = boot('');
  h.click('h1');
  assert.equal(h.ta.focused, true);
});

test('未知动作被忽略，不破坏内容', () => {
  const h = boot('保持');
  h.click('nosuch');
  assert.equal(h.ta.value, '保持');
});
