document.addEventListener('DOMContentLoaded', () => {
	const encryption = str => window.btoa(unescape(encodeURIComponent(str)));
	const decrypt = str => decodeURIComponent(escape(window.atob(str)));

	/* 当前页的CID */
	const cid = $('.joe_detail').attr('data-cid');

	/* 获取本篇文章百度收录情况 */
	{
		$.ajax({
			url: Joe.BASE_API,
			type: 'POST',
			dataType: 'json',
			data: { routeType: 'baidu_record', site: window.location.href },
			success(res) {
				if (res.data && res.data === '已收录') {
					$('#Joe_Baidu_Record').css('color', '#67C23A');
					$('#Joe_Baidu_Record').html('已收录');
				} else {
					/* 如果填写了Token，则自动推送给百度 */
					if (Joe.BAIDU_PUSH) {
						$('#Joe_Baidu_Record').html('<span style="color: #E6A23C">未收录，推送中...</span>');
						const _timer = setTimeout(function () {
							$.ajax({
								url: Joe.BASE_API,
								type: 'POST',
								dataType: 'json',
								data: {
									routeType: 'baidu_push',
									domain: window.location.protocol + '//' + window.location.hostname,
									url: encodeURI(window.location.href)
								},
								success(res) {
									if (res.data.error) {
										$('#Joe_Baidu_Record').html('<span style="color: #F56C6C">推送失败，请检查！</span>');
									} else {
										$('#Joe_Baidu_Record').html('<span style="color: #67C23A">推送成功！</span>');
									}
								}
							});
							clearTimeout(_timer);
						}, 1000);
					} else {
						const url = `https://ziyuan.baidu.com/linksubmit/url?sitename=${encodeURI(window.location.href)}`;
						$('#Joe_Baidu_Record').html(`<a target="_blank" href="${url}" rel="noopener noreferrer nofollow" style="color: #F56C6C">未收录，提交收录</a>`);
					}
				}
			}
		});
	}

	/* 激活代码高亮 */
	{
		Prism.highlightAll();
		$("pre[class*='language-']").each(function (index, item) {
			let text = $(item).find("code[class*='language-']").text();
			let span = $(`<span class="copy"><i class="fa fa-clone"></i></span>`);
			new ClipboardJS(span[0], { text: () => text }).on('success', () => Qmsg.success('复制成功！'));
			$(item).append(span);
		});
	}

	/* 激活图片预览功能 */
	{
		$('.joe_detail__article img:not(img.owo_image)').each(function () {
			$(this).wrap($(`<span style="display: block;" data-fancybox="Joe" href="${$(this).attr('src')}"></span>`));
		});
	}

	/* 设置文章内的链接为新窗口打开 */
	{
		$('.joe_detail__article a:not(.joe_detail__article-anote)').each(function () {
			$(this).attr({ target: '_blank', rel: 'noopener noreferrer nofollow' });
		});
	}

	/* 激活浏览功能
	   去重维度是「浏览器 + 时间窗」：同一篇文章在 VIEWS_DEDUP_HOURS 小时内
	   只计一次，超过窗口再次访问重新计。
	   旧实现存的是 cid 数组且永不过期——一旦记过就永远不再计数。数据重置后
	   服务端计数归 0，浏览器却仍记着「已统计」，阅读量就永久卡在 0。 */
	const VIEWS_DEDUP_HOURS = 24;
	{
		const key = encryption('views');
		const now = Date.now();
		const dedupWindow = VIEWS_DEDUP_HOURS * 3600 * 1000;
		let viewMap = {};
		try {
			const parsed = localStorage.getItem(key) ? JSON.parse(decrypt(localStorage.getItem(key))) : null;
			if (Array.isArray(parsed)) {
				// 旧格式（cid 数组，没有时间戳）：一律当作已过期，让它重新计一次
				parsed.forEach(c => { viewMap[c] = 0; });
			} else if (parsed && typeof parsed === 'object') {
				viewMap = parsed;
			}
		} catch (e) {
			viewMap = {};
		}
		const last = Number(viewMap[cid]) || 0;
		if (!last || now - last >= dedupWindow) {
			$.ajax({
				url: Joe.BASE_API,
				type: 'POST',
				dataType: 'json',
				data: { routeType: 'handle_views', cid },
				success(res) {
					if (res.code !== 1) return;
					$('#Joe_Article_Views').html(`${res.data.views} 阅读`);
					viewMap[cid] = now;
					// 顺手清掉过期条目，避免 localStorage 无限堆积
					Object.keys(viewMap).forEach(c => {
						if (now - (Number(viewMap[c]) || 0) >= dedupWindow) delete viewMap[c];
					});
					localStorage.setItem(key, encryption(JSON.stringify(viewMap)));
				}
			});
		}
	}

	/* 激活文章点赞功能 */
	{
		let agreeArr = localStorage.getItem(encryption('agree')) ? JSON.parse(decrypt(localStorage.getItem(encryption('agree')))) : [];
		if (agreeArr.includes(cid)) $('.joe_detail__agree .icon-1').addClass('active');
		else $('.joe_detail__agree .icon-2').addClass('active');
		let _loading = false;
		$('.joe_detail__agree .icon').on('click', function () {
			if (_loading) return;
			_loading = true;
			agreeArr = localStorage.getItem(encryption('agree')) ? JSON.parse(decrypt(localStorage.getItem(encryption('agree')))) : [];
			let flag = agreeArr.includes(cid);
			$.ajax({
				url: Joe.BASE_API,
				type: 'POST',
				dataType: 'json',
				data: { routeType: 'handle_agree', cid, type: flag ? 'disagree' : 'agree' },
				success(res) {
					if (res.code !== 1) return;
					$('.joe_detail__agree .text').html(res.data.agree);
					if (flag) {
						const index = agreeArr.findIndex(_ => _ === cid);
						agreeArr.splice(index, 1);
						$('.joe_detail__agree .icon-1').removeClass('active');
						$('.joe_detail__agree .icon-2').addClass('active');
						$('.joe_detail__agree .icon').removeClass('active');
					} else {
						agreeArr.push(cid);
						$('.joe_detail__agree .icon-2').removeClass('active');
						$('.joe_detail__agree .icon-1').addClass('active');
						$('.joe_detail__agree .icon').addClass('active');
					}
					const name = encryption('agree');
					const val = encryption(JSON.stringify(agreeArr));
					localStorage.setItem(name, val);
				},
				complete() {
					_loading = false;
				}
			});
		});
	}

	/* 密码保护文章，输入密码访问 */
	{
		let isSubmit = false;
		$('.joe_detail__article-protected').on('submit', function (e) {
			e.preventDefault();
			const url = $(this).attr('action') + '&time=' + +new Date();
			const protectPassword = $(this).find('input[type="password"]').val();
			if (protectPassword.trim() === '') return Qmsg.info('请输入访问密码！');
			if (isSubmit) return;
			isSubmit = true;
			$.ajax({
				url,
				type: 'POST',
				data: {
					cid,
					protectCID: cid,
					protectPassword
				},
				dataType: 'text',
				success(res) {
					let arr = [],
						str = '';
					arr = $(res).contents();
					Array.from(arr).forEach(_ => {
						if (_.parentNode.className === 'container') str = _;
					});
					if (!/Joe/.test(res)) {
						Qmsg.warning(str.textContent.trim() || '');
						isSubmit = false;
						$('.joe_comment__respond-form .foot .submit button').html('发表评论');
					} else {
						location.reload();
					}
				}
			});
		});
	}

	/* 激活文章视频模块 */
	{
		if ($('.joe_detail__article-video').length > 0) {
			const player = $('.joe_detail__article-video .play iframe').attr('data-player');
			$('.joe_detail__article-video .episodes .item').on('click', function () {
				$(this).addClass('active').siblings().removeClass('active');
				const url = $(this).attr('data-src');
				$('.joe_detail__article-video .play iframe').attr({ src: player + url });
			});
			$('.joe_detail__article-video .episodes .item').first().click();
		}
	}

	/* 分享：切换逻辑只保留 joe.global.js 里的那一份。
	   这里原本还有一份同样绑在 svg 上的 click 处理器，两者同时生效会各
	   toggle 一次 —— active 刚加上就被对方翻回去，点多少次面板都不展开。 */
});

/* 写在load事件里，为了解决图片未加载完成，滚动距离获取会不准确的问题 */
window.addEventListener('load', function () {
	/* 判断地址栏是否有锚点链接，有则跳转到对应位置 */
	{
		const scroll = new URLSearchParams(location.search).get('scroll');
		if (scroll) {
			const height = $('.joe_header').height();
			let elementEL = null;
			if ($('#' + scroll).length > 0) {
				elementEL = $('#' + scroll);
			} else {
				elementEL = $('.' + scroll);
			}
			if (elementEL && elementEL.length > 0) {
				const top = elementEL.offset().top - height - 15;
				window.scrollTo({ top, behavior: 'smooth' });
			}
		}
	}
});

/* ==================== 文章目录（悬浮按钮 + 展开面板） ==================== */
/*
 * 依据正文 .joe_detail__article 内的 h1~h6 生成目录：
 * Typecho 的 HyperDown/Markdown 解析器不会给标题生成 id，
 * 所以这里自行补 id（跳过已存在或重复的 id），并做层级缩进。
 * 少于 2 个标题时不显示按钮，避免出现无意义控件。
 */
function joeTocInit() {
  'use strict';

  var btn = document.getElementById('JoeTocBtn');
  var panel = document.getElementById('JoeTocPanel');
  var body = panel ? panel.querySelector('.joe_toc__body') : null;
  var counter = panel ? panel.querySelector('.joe_toc__count') : null;
  var article = document.querySelector('.joe_detail__article');

  if (!btn || !panel || !body || !article) return;

  var heads = [].slice.call(article.querySelectorAll('h1, h2, h3, h4, h5, h6'))
    .filter(function (el) { return (el.textContent || '').trim() !== ''; });

  if (heads.length < 2) return;

  var used = {};
  var items = [];

  heads.forEach(function (el, i) {
    if (!el.id) {
      var id = 'joe-h' + (i + 1);
      var n = 0;
      while (used[id] || document.getElementById(id)) id = 'joe-h' + (i + 1) + '-' + (++n);
      el.id = id;
    }
    used[el.id] = 1;

    var level = parseInt(el.tagName.slice(1), 10) || 1;
    var text = (el.textContent || '').trim().replace(/\s+/g, ' ');

    var a = document.createElement('a');
    a.className = 'item lv-' + level;
    a.href = '#' + el.id;
    a.textContent = text;
    a.title = text;
    a.setAttribute('data-target', el.id);
    body.appendChild(a);
    items.push({ link: a, el: el });
  });

  if (counter) counter.textContent = items.length + ' 项';

  /* ---- 展开 / 收起 ---- */
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function setOpen(open) {
    panel.hidden = !open;
    btn.classList.toggle('active', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  btn.hidden = false;
  setOpen(false);

  btn.addEventListener('click', function () { setOpen(panel.hidden); });
  btn.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(panel.hidden); }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !panel.hidden) setOpen(false);
  });

  document.addEventListener('click', function (e) {
    if (panel.hidden) return;
    if (panel.contains(e.target) || btn.contains(e.target)) return;
    setOpen(false);
  }, true);

  /* ---- 点击条目：滚动到标题，移动端自动收起 ---- */
  body.addEventListener('click', function (e) {
    var link = e.target.closest ? e.target.closest('a.item') : null;
    if (!link) return;
    e.preventDefault();
    var target = document.getElementById(link.getAttribute('data-target'));
    if (!target) return;
    target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    history.replaceState && history.length && history.replaceState(null, '', '#' + target.id);
    if (window.Joe && window.Joe.IS_MOBILE) setOpen(false);
    mark(link.getAttribute('data-target'));
  });

  /* ---- 滚动高亮 ---- */
  var active = null;

  function mark(id) {
    if (active && active.link.id === id) return;
    items.forEach(function (it) {
      var on = it.el.id === id;
      it.link.classList.toggle('active', on);
      if (on) {
        active = it;
        // 让高亮项在面板里始终可见（面板自身可滚动）
        var lr = it.link.getBoundingClientRect(), br = body.getBoundingClientRect();
        if (lr.top < br.top || lr.bottom > br.bottom) {
          it.link.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
        }
      }
    });
  }

  function sync() {
    if (panel.hidden) return;
    var top = 90, best = null;
    for (var i = 0; i < items.length; i++) {
      if (items[i].el.getBoundingClientRect().top - top <= 1) best = items[i];
      else break;
    }
    if (!best) best = items[0];
    mark(best.el.id);
  }

  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () { ticking = false; sync(); });
  }, { passive: true });

  mark(items[0].el.id);
}

/* joe.post_page.min.js 是在 <head> 里同步加载的（无 defer），
   此刻正文和 footer 都还没解析，必须等 DOM 构建完成再初始化。 */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', joeTocInit);
} else {
  joeTocInit();
}
