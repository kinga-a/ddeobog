/**
 * 撰写/编辑页的 Markdown 编辑器（EasyMDE 2.18.0，vendored 于主题 lib）。
 *
 * 接法要点：
 * - 分屏预览不用 EasyMDE 自带的 marked 渲染，而是把正文 POST 到 /admin/preview，
 *   用站点自己的 renderMarkdown 出 HTML——预览与发布效果一致，Joe 短代码也认。
 * - 图片按钮/粘贴/拖放走 imageUploadFunction：先经后台统一的图片压缩
 *   （window.compressImageFile，与附件页同款），再 POST /admin/upload-image 拿地址。
 * - 库文件按需动态加载：整页打开与后台 SPA 局部换页两种进入方式都可靠；
 *   CSS 由编辑页模板直出 <link>。
 */
(function () {
  var ta = document.getElementById('joe-md-text');
  if (!ta || ta.dataset.easymdeReady) return;
  ta.dataset.easymdeReady = '1';

  function boot() {
    if (typeof EasyMDE === 'undefined') return;
    var seq = 0;
    var timer = 0;
    var editor = new EasyMDE({
      element: ta,
      autoDownloadFontAwesome: false, // 后台已自带 Font Awesome 4.7，不必再去 CDN 拉
      spellChecker: false, // 拼写检查要从 CDN 拉词典，关掉
      forceSync: true,
      minHeight: '320px',
      placeholder: '在这里写正文，点上面的「分屏预览」可以左边写、右边看效果…',
      status: ['lines', 'words'],
      toolbar: [
        'bold', 'italic', 'strikethrough', 'heading-1', 'heading-2', 'heading-3', '|',
        'code', 'quote', 'unordered-list', 'ordered-list', '|',
        'link', 'image', 'table', 'horizontal-rule',
        {
          name: 'more',
          action: function (ed) {
            var cm = ed.codemirror;
            cm.replaceSelection('\n<!--more-->\n');
            cm.focus();
          },
          className: 'fa fa-scissors',
          title: '插入摘要分隔 <!--more-->',
        },
        '|', 'preview', 'side-by-side', 'fullscreen', '|', 'undo', 'redo', 'guide',
      ],
      previewRender: function (plainText, preview) {
        var mine = ++seq;
        clearTimeout(timer);
        timer = setTimeout(function () {
          var fd = new FormData();
          fd.append('text', plainText);
          fetch('/admin/preview', { method: 'POST', body: fd, credentials: 'same-origin' })
            .then(function (r) { return r.text(); })
            .then(function (htmlText) { if (mine === seq) preview.innerHTML = htmlText; })
            .catch(function () { /* 预览失败保持上一版内容 */ });
        }, 250);
        return preview.innerHTML || '<p style="color:#999">预览加载中…</p>';
      },
      imageUploadFunction: function (file, onSuccess, onError) {
        var run = window.compressImageFile ? window.compressImageFile(file) : Promise.resolve(file);
        run.then(function (f) {
          var fd = new FormData();
          fd.append('file', f);
          return fetch('/admin/upload-image', { method: 'POST', body: fd, credentials: 'same-origin' });
        })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (j && j.url) onSuccess(j.url);
            else onError('上传失败，请重试');
          })
          .catch(function () { onError('上传失败，请重试'); });
      },
    });
    // 提交前把编辑器内容同步回 textarea（forceSync 已在同步，这里再保险一次）
    var form = ta.closest('form');
    if (form) {
      form.addEventListener('submit', function () { ta.value = editor.value(); });
    }
  }

  if (typeof EasyMDE !== 'undefined') boot();
  else {
    var s = document.createElement('script');
    s.src = '/usr/themes/joe/assets/lib/easymde@2.18.0/easymde.min.js';
    s.onload = boot;
    document.head.appendChild(s);
  }
})();
