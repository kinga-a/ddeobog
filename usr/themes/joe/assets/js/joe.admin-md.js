/**
 * 后台撰写/编辑面板的 Markdown 快捷工具条。
 *
 * 按钮由 admin.js 服务端渲染（每个带 data-md 动作名），这里只负责绑定行为——
 * 这样测试可以对着 HTML 断言具体动作，行为逻辑又不用塞进模板字符串。
 *
 * 动作分三类，对应三种插入语义：
 *   wrap    包住选区；没有选区时插入占位文字并选中它（粗体/斜体/链接…）
 *   prefix  作用于所在行，行首加前缀；已经是这个前缀就再去掉（标题/引用/列表…）
 *   block   整块插入，并保证上下留出空行（代码块/表格/分隔线/摘要分隔）
 *
 * 能提供哪些动作，取决于 src/render/markdown.js 实际支持什么。
 * 那里不支持的语法不放按钮，否则用户会得到一段原样显示的字符，
 * 比如任务列表 - [ ] 会被渲染成 <li>[ ] xxx</li>。
 */
(function () {
  'use strict';

  var BAR_ID = 'joe-md-bar';
  var TA_ID = 'joe-md-text';
  var MAX_HIST = 150;
  var TYPING_DEBOUNCE = 600;

  // test: 判断当前行是否已是该前缀（决定这次是「去掉」还是「加上」）
  // strip: 加上新前缀前先剥掉旧的，避免 H2 叠成 "## # 标题"
  var ACTS = {
    h1:       { t: 'prefix', test: /^# (?!#)/, strip: /^#{1,6} /, add: '# ' },
    h2:       { t: 'prefix', test: /^## (?!#)/, strip: /^#{1,6} /, add: '## ' },
    h3:       { t: 'prefix', test: /^### (?!#)/, strip: /^#{1,6} /, add: '### ' },
    quote:    { t: 'prefix', test: /^> /, strip: /^> /, add: '> ' },
    ul:       { t: 'prefix', test: /^[-*+] /, strip: /^[-*+] /, add: '- ' },
    ol:       { t: 'prefix', test: /^\d+[.)] /, strip: /^\d+[.)] /, add: '1. ' },
    bold:     { t: 'wrap', b: '**', a: '**', ph: '加粗' },
    italic:   { t: 'wrap', b: '*', a: '*', ph: '斜体' },
    strike:   { t: 'wrap', b: '~~', a: '~~', ph: '删除' },
    code:     { t: 'wrap', b: '`', a: '`', ph: 'code' },
    link:     { t: 'wrap', b: '[', a: '](https://)', ph: '链接文字' },
    image:    { t: 'wrap', b: '![', a: '](https://)', ph: '图片描述' },
    // caret: 块插入后光标停在块内的哪个偏移，省得用户自己挪
    codeblock: { t: 'block', text: '```js\n\n```', caret: 7 },
    table:    { t: 'block', text: '| 列1 | 列2 |\n| --- | --- |\n| 内容 | 内容 |', caret: 2 },
    hr:       { t: 'block', text: '---' },
    more:     { t: 'block', text: '<!--more-->' }
  };

  var HOTKEYS = { b: 'bold', i: 'italic', k: 'link' };

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  function target(el) {
    return el && el.closest ? el : null;
  }

  ready(function () {
    var bar = document.getElementById(BAR_ID);
    var ta = document.getElementById(TA_ID);
    if (!bar || !ta) return;

    // 历史栈存 {文本, 光标}。工具条动作会在「改动前」和「改动后」各压一次，
    // 否则一次按钮操作会被拆成两步撤销——用户按一下撤销直接跨过了自己刚插的内容。
    var hist = [{ v: ta.value, p: ta.selectionStart || 0 }];
    var hi = 0;
    var timer = null;

    function push() {
      var entry = { v: ta.value, p: ta.selectionStart };
      if (hist[hi] && hist[hi].v === entry.v) return;
      hist = hist.slice(0, hi + 1);
      hist.push(entry);
      if (hist.length > MAX_HIST) hist.shift();
      hi = hist.length - 1;
    }

    // 把还挂着的防抖先落盘，否则撤销会把刚敲的字吞掉
    function flush() {
      if (timer) { clearTimeout(timer); timer = null; push(); }
    }

    function apply(v, s, e) {
      ta.value = v;
      var n = v.length;
      ta.setSelectionRange(Math.min(s, n), Math.min(e, n));
      ta.focus();
    }

    function undo() {
      flush();
      if (hi <= 0) return;
      hi--;
      apply(hist[hi].v, hist[hi].p, hist[hi].p);
    }

    function redo() {
      flush();
      if (hi >= hist.length - 1) return;
      hi++;
      apply(hist[hi].v, hist[hi].p, hist[hi].p);
    }

    function doWrap(act) {
      var v = ta.value;
      var s = ta.selectionStart, e = ta.selectionEnd;
      var inner = v.slice(s, e) || act.ph || '';
      var text = act.b + inner + act.a;
      var from = s + act.b.length;
      push();
      apply(v.slice(0, s) + text + v.slice(e), from, from + inner.length);
      push();
    }

    function doPrefix(act) {
      var v = ta.value;
      var s = ta.selectionStart, e = ta.selectionEnd;
      var ls = v.lastIndexOf('\n', s - 1) + 1;
      var le = v.indexOf('\n', e);
      if (le === -1) le = v.length;
      var block = v.slice(ls, le);
      var lines = block.split('\n');
      var removing = lines.every(function (l) { return act.test.test(l); });
      var out = lines.map(function (l) {
        return removing ? l.replace(act.strip, '') : act.add + l.replace(act.strip, '');
      }).join('\n');
      var tail = v.slice(le);
      push();
      if (lines.length === 1) {
        // 单行：光标跟着前缀增减走
        var p = s + (removing ? -act.add.length : act.add.length);
        apply(v.slice(0, ls) + out + tail, p, p);
      } else {
        // 多行：整块选中，方便接着调格式
        apply(v.slice(0, ls) + out + tail, ls, ls + out.length);
      }
      push();
    }

    function doBlock(act) {
      var v = ta.value;
      var s = ta.selectionStart, e = ta.selectionEnd;
      var head = v.slice(0, s), tail = v.slice(e);
      // 上下各留够空行，否则渲染器会把代码块/表格粘在上一段文字上
      var lead = '';
      if (head && !/\n$/.test(head)) lead = '\n\n';
      else if (head && /\n$/.test(head) && !/\n\n$/.test(head)) lead = '\n';
      var trail = tail && !/^\n/.test(tail) ? '\n' : '';
      var text = lead + act.text + trail;
      var caret = s + lead.length + (act.caret == null ? act.text.length : act.caret);
      push();
      apply(head + text + tail, caret, caret);
      push();
    }

    function run(name) {
      if (name === 'undo') return undo();
      if (name === 'redo') return redo();
      var act = ACTS[name];
      if (!act) return;
      if (act.t === 'wrap') doWrap(act);
      else if (act.t === 'prefix') doPrefix(act);
      else if (act.t === 'block') doBlock(act);
    }

    bar.addEventListener('mousedown', function (ev) {
      // 按下按钮时不让 textarea 失焦，保住选区
      var btn = target(ev.target);
      if (btn && btn.closest('button')) ev.preventDefault();
    });

    bar.addEventListener('click', function (ev) {
      var el = target(ev.target);
      var btn = el && el.closest('button[data-md]');
      if (!btn) return;
      ev.preventDefault();
      run(btn.getAttribute('data-md'));
    });

    ta.addEventListener('input', function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { timer = null; push(); }, TYPING_DEBOUNCE);
    });
    ta.addEventListener('blur', flush);

    ta.addEventListener('keydown', function (ev) {
      if (!(ev.ctrlKey || ev.metaKey)) return;
      var k = (ev.key || '').toLowerCase();
      if (k === 'z') {
        ev.preventDefault();
        if (ev.shiftKey) redo(); else undo();
        return;
      }
      if (k === 'y') { ev.preventDefault(); redo(); return; }
      if (ev.shiftKey || ev.altKey) return;
      if (HOTKEYS[k]) { ev.preventDefault(); run(HOTKEYS[k]); }
    });
  });
})();