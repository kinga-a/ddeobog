/**
 * 侧栏天气：读取 #blog-weather，异步请求 /5iblog/api?routeType=weather 并填充。
 * 服务端已做中文标准化与 10 分钟 KV 缓存；接口失败时移除整个侧栏块。
 */
(function () {
  var el = document.getElementById('blog-weather');
  if (!el) return;

  var ICONS = {
    sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6"/></svg>',
    cloud: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18h9.2a3.8 3.8 0 0 0 .7-7.5A5.6 5.6 0 0 0 6.3 12 3 3 0 0 0 7 18z"/></svg>',
    rain: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 15h9.2a3.6 3.6 0 0 0 .7-7.1A5.3 5.3 0 0 0 6.4 9.3 2.9 2.9 0 0 0 7 15z"/><path d="M8.5 18.2l-1 2M12.5 18.2l-1 2M16.5 18.2l-1 2"/></svg>',
    snow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/><path d="M9.6 4.8 12 7l2.4-2.2M9.6 19.2 12 17l2.4 2.2"/></svg>',
    thunder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14h9.2a3.6 3.6 0 0 0 .7-7.1A5.3 5.3 0 0 0 6.4 8.3 2.9 2.9 0 0 0 7 14z"/><path d="M13 13.5 9.5 19h3l-1 3.5"/></svg>',
    fog: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16M5.5 12h13M3.5 16h17M6 20h12"/></svg>',
  };

  function kind(weather) {
    var s = String(weather || '');
    if (/雷|thunder/i.test(s)) return 'thunder';
    if (/雪|冰雹|snow|sleet/i.test(s)) return 'snow';
    if (/雨|rain|shower/i.test(s)) return 'rain';
    if (/雾|霾|沙|尘|fog|haze|mist|sand/i.test(s)) return 'fog';
    if (/云|阴|cloud|overcast/i.test(s)) return 'cloud';
    if (/晴|clear|sun/i.test(s)) return 'sun';
    return 'cloud';
  }

  function icon(weather) {
    return '<span class="blog_weather__icon">' + (ICONS[kind(weather)] || ICONS.cloud) + '</span>';
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function num(value, suffix) {
    return Number.isFinite(Number(value)) ? Math.round(Number(value)) + (suffix || '') : '--';
  }

  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function render(data) {
    var now = new Date();
    var week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];
    var maxDays = parseInt(el.dataset.days || '4', 10) || 4;
    var days = (data.days || []).slice(0, maxDays);
    var range = data.tempMax != null || data.tempMin != null
      ? '<div class="blog_weather__range">' + num(data.tempMax, '°') + ' / ' + num(data.tempMin, '°') + '</div>'
      : '';
    var daysHtml = days.length
      ? '<div class="blog_weather__days">' + days.map(function (day) {
          return '<div class="blog_weather__day" title="' + esc(day.weather || '') + '">' +
            '<span class="blog_weather__day-week">' + esc(day.week || '') + '</span>' +
            icon(day.weather) +
            '<span class="blog_weather__day-temp">' + num(day.tempMax, '°') + '<em>' + num(day.tempMin, '°') + '</em></span>' +
          '</div>';
        }).join('') + '</div>'
      : '';

    el.innerHTML =
      '<div class="blog_weather__hero">' +
        '<div class="blog_weather__orb blog_weather__orb--1"></div>' +
        '<div class="blog_weather__orb blog_weather__orb--2"></div>' +
        '<div class="blog_weather__orb blog_weather__orb--3"></div>' +
        '<div class="blog_weather__left">' +
          '<div class="blog_weather__condition">' + icon(data.weather) + '<span>' + esc(data.weather || '天气') + '</span></div>' +
          '<div class="blog_weather__temp">' + num(data.temperature, '°') + '</div>' +
          range +
        '</div>' +
        '<div class="blog_weather__right">' +
          '<div class="blog_weather__time">' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + '</div>' +
          '<div class="blog_weather__date">' + week + ' ' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + '</div>' +
          '<div class="blog_weather__city" title="' + esc(data.city || '') + '">' + esc(data.city || '') + '</div>' +
        '</div>' +
      '</div>' + daysHtml;
    el.classList.add('is-ready');
  }

  fetch('/5iblog/api?routeType=weather', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then(function (res) { return res.json(); })
    .then(function (payload) {
      if (!payload || payload.code !== 1 || !payload.data) throw new Error('weather unavailable');
      render(payload.data);
    })
    .catch(function () {
      var section = el.closest ? el.closest('.blog_aside__item') : null;
      if (section) section.remove();
    });
})();