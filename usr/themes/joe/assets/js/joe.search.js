/*!
 * Joe 主题搜索
 *
 * 原版 joe.global.js 只负责「点开/关闭下拉面板」（.result 的 .active 切换），
 * 这里补齐两件事：
 *   1. 联想：顶栏输入框输入即联想（防抖 250ms），结果渲染进 .joe_header__above-search .result
 *      —— 渲染成的主题 CSS 期望的 .item > .sort + .text + .views，与服务端渲染的热门文章同构
 *   2. 关键词回填：顶栏与移动端搜索面板两个输入框共用同一个关键字
 *
 * 搜索本身不再由 JS 跳转：两处都是 <form method="get" action="/search">，
 * 回车/点「Search」按钮走浏览器原生提交，GET /search?s=kw 由后端 302 到 /search/kw/。
 *
 * 注意：本脚本由 theme-joe.js 在 <head> 里同步引入，页头元素此时还没解析，
 * 必须像 joe.global.js 一样等 DOMContentLoaded，否则 querySelector 拿到 null 直接失效。
 */
function initJoeSearch() {
  'use strict';

  var above = document.querySelector('.joe_header__above-search');
  if (!above) return;

  var API = (window.Joe && window.Joe.BASE_API) || '/joe/api';
  var aboveForm = above.querySelector('form') || above;
  var aboveInput = above.querySelector('.input');
  var result = above.querySelector('.result');
  // 服务端渲染的热门文章（首屏），清空输入框时还原
  var initialHtml = result ? result.innerHTML : '';

  // 顶栏输入框 + 弹出的搜索面板输入框，两处共享同一个关键字
  var inputs = [aboveInput].concat(
    Array.prototype.slice.call(document.querySelectorAll('.joe_header__searchout-inner .search input'))
  ).filter(Boolean);

  var searchout = document.querySelector('.joe_header__searchout');

  var timer = null;
  var inflight = null;
  var current = []; // 当前联想结果
  var active = -1; // 高亮项下标
  var lastKeyword = null;
  var hasQuery = false; // 输入框里是否有关键字

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function closeResult() {
    if (result) result.classList.remove('active');
    active = -1;
  }

  function render(items) {
    if (!result) return;
    current = items || [];
    active = -1;
    if (!current.length) {
      // 没结果就还原首屏的热门文章，行为与 5i.ink 一致（面板里始终有内容）
      result.innerHTML = initialHtml;
      result.classList.remove('active');
      return;
    }
    var html = '';
    for (var i = 0; i < current.length; i++) {
      var it = current[i];
      html +=
        '<a class="item" href="' +
        esc(it.permalink || '#') +
        '">' +
        '<span class="sort">' +
        (i + 1) +
        '</span>' +
        '<span class="text">' +
        esc(it.title) +
        '</span>' +
        '<span class="views">' +
        esc(it.views == null ? 0 : it.views) +
        ' 阅读</span>' +
        '</a>';
    }
    result.innerHTML = html;
    result.classList.add('active');
  }

  function highlight() {
    if (!result || !current.length) return;
    var nodes = result.querySelectorAll('.item');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.toggle('active', i === active);
    }
  }

  function fetchSuggest(kw) {
    if (inflight && inflight.abort) inflight.abort();
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    inflight = ctrl;
    fetch(API + '?routeType=search&s=' + encodeURIComponent(kw) + '&pageSize=8', {
      headers: { Accept: 'application/json' },
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (json) {
        if (!json || json.code !== 1) return render([]);
        var payload = json.data || {};
        render(payload.data || []);
      })
      .catch(function () {
        // 主动 abort 或网络失败：保持当前列表，不要闪成空
      });
  }

  function onInput(value) {
    var kw = String(value || '').trim();
    // 同步另一个输入框
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i] !== document.activeElement && inputs[i].value !== value) {
        inputs[i].value = value;
      }
    }
    if (timer) clearTimeout(timer);
    hasQuery = !!kw;
    if (!kw) {
      lastKeyword = null;
      inflight = null;
      render([]);
      return;
    }
    // 关键字没变就不重复请求
    if (kw === lastKeyword) return;
    timer = setTimeout(function () {
      lastKeyword = kw;
      fetchSuggest(kw);
    }, 250);
  }

  inputs.forEach(function (input) {
    input.addEventListener('input', function () {
      onInput(this.value);
    });

    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        // 有关键字且有联想列表时，上下键选中优先走联想项；
        // 其余情况不拦截，交给 <form> 原生提交（GET /search?s=kw）
        if (hasQuery && current.length && active >= 0 && current[active]) {
          ev.preventDefault();
          var it = current[active];
          if (searchout) searchout.classList.remove('active');
          window.location.href = it.permalink;
        }
      } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        if (!current.length) return;
        ev.preventDefault();
        active =
          ev.key === 'ArrowDown'
            ? (active + 1) % current.length
            : (active - 1 + current.length) % current.length;
        highlight();
      } else if (ev.key === 'Escape') {
        closeResult();
      }
    });
  });

  // 桌面端输入框右侧的放大镜（<span class="icon">）——聚焦时主题 CSS 会把它翻转让成叉号。
  // 5i.ink 没绑点击，这里绑一下等价于点「Search」按钮。
  var inlineIcon = above.querySelector('.icon');
  if (inlineIcon) {
    inlineIcon.style.cursor = 'pointer';
    inlineIcon.addEventListener('click', function () {
      var kw = aboveInput ? String(aboveInput.value || '').trim() : '';
      if (!kw) return;
      if (searchout) searchout.classList.remove('active');
      if (aboveForm.tagName === 'FORM') {
        aboveInput.focus();
        aboveForm.submit();
      }
    });
  }

  // 联想项点击：阻止 joe.global.js 的 document click 关闭逻辑抢跑
  if (result) {
    result.addEventListener('click', function (ev) {
      if (ev.target.closest('.item')) ev.stopPropagation();
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initJoeSearch);
} else {
  initJoeSearch();
}
