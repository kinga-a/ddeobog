/*!
 * Joe 主题搜索
 *
 * 原版 joe.global.js 只负责「点开/关闭下拉面板」（.result 的 .active 切换），
 * 联想结果与跳转逻辑缺失，输入框和搜索按钮点了没反应。这里补齐：
 *   - 顶栏输入框输入即联想（防抖 250ms，结果渲染进 .joe_header__above-search .result）
 *   - 回车 / 点击「搜索」按钮 → 跳转 /search/<kw>/
 *   - 上下键切换、回车选中联想项、Esc 关闭
 *
 * 结构完全按主题自带 CSS 的期望：
 *   .result .item > .sort(排名徽标) + .text(标题) + .views(阅读量)
 *   .joe_header__searchout-inner .search > input + button
 *
 * 注意：本脚本由 theme-joe.js 在 <head> 里同步引入，页头元素此时还没解析，
 * 必须像 joe.global.js 一样等 DOMContentLoaded，否则 querySelector 拿到 null 直接失效。
 */
function initJoeSearch() {
  'use strict';

  var above = document.querySelector('.joe_header__above-search');
  if (!above) return;

  var API = (window.Joe && window.Joe.BASE_API) || '/joe/api';
  var result = above.querySelector('.result');
  var aboveInput = above.querySelector('.input');

  // 顶栏输入框 + 弹出的搜索面板输入框，两处共享同一个关键字
  var inputs = [aboveInput].concat(
    Array.prototype.slice.call(document.querySelectorAll('.joe_header__searchout-inner .search input'))
  ).filter(Boolean);

  var searchout = document.querySelector('.joe_header__searchout');
  var button = document.querySelector('.joe_header__searchout-inner .search .search-btn');

  var timer = null;
  var inflight = null;
  var current = []; // 当前联想结果
  var active = -1; // 高亮项下标
  var lastKeyword = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function searchUrl(kw) {
    return '/search/' + encodeURIComponent(kw) + '/';
  }

  function go(kw) {
    kw = String(kw || '').trim();
    if (!kw) return;
    if (searchout) searchout.classList.remove('active');
    window.location.href = searchUrl(kw);
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
      result.innerHTML = '';
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
      if (inputs[i] !== document.activeElement && inputs[i].value !== kw) {
        inputs[i].value = value;
      }
    }
    if (timer) clearTimeout(timer);
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
      var kw = String(this.value || '').trim();
      if (ev.key === 'Enter') {
        ev.preventDefault();
        // 有高亮项时优先跳联想，否则按关键字搜索
        if (active >= 0 && current[active]) {
          var it = current[active];
          if (searchout) searchout.classList.remove('active');
          window.location.href = it.permalink;
        } else {
          go(kw);
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

  if (button) {
    button.addEventListener('click', function () {
      var kw = '';
      for (var i = 0; i < inputs.length; i++) {
        if (inputs[i].value && inputs[i].value.trim()) {
          kw = inputs[i].value;
          break;
        }
      }
      go(kw);
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
