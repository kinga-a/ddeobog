/**
 * 便签留言墙交互
 * - 桌面端：拖拽便签，位置保存在 localStorage
 * - 移动端：不启用拖拽（避免与页面滚动冲突）
 * - 留言表单：AJAX 提交，成功后刷新页面
 */
(function () {
  var notes = Array.prototype.slice.call(document.querySelectorAll('.blog_wall__note'));
  var board = document.querySelector('.blog_wall__board');
  var isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;

  if (!isMobile && board) {
    var z = 10;
    notes.forEach(function (note) {
      var coid = note.getAttribute('data-coid');
      var x = 0;
      var y = 0;
      try {
        var saved = JSON.parse(localStorage.getItem('blog_wall:' + coid) || 'null');
        if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
          x = saved.x;
          y = saved.y;
        }
      } catch (err) {
        /* localStorage 不可用时忽略 */
      }
      note.style.setProperty('--x', x + 'px');
      note.style.setProperty('--y', y + 'px');

      var startX = 0;
      var startY = 0;
      var dragging = false;

      note.addEventListener('pointerdown', function (e) {
        if (e.button !== 0 || e.target.closest('a,button,input,textarea,img')) return;
        dragging = true;
        startX = e.clientX - x;
        startY = e.clientY - y;
        note.classList.add('is-dragging');
        note.style.zIndex = ++z;
        if (note.setPointerCapture) note.setPointerCapture(e.pointerId);
      });

      note.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        x = e.clientX - startX;
        y = e.clientY - startY;
        note.style.setProperty('--x', x + 'px');
        note.style.setProperty('--y', y + 'px');
      });

      function endDrag() {
        if (!dragging) return;
        dragging = false;
        note.classList.remove('is-dragging');
        try {
          localStorage.setItem('blog_wall:' + coid, JSON.stringify({ x: x, y: y }));
        } catch (err) {
          /* 忽略存储失败 */
        }
      }
      note.addEventListener('pointerup', endDrag);
      note.addEventListener('pointercancel', endDrag);
    });
  }

  var form = document.querySelector('.blog_wall__form');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('button[type="submit"]');
      if (btn) {
        btn.disabled = true;
        btn.textContent = '提交中…';
      }
      fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { 'X-Requested-With': 'fetch' },
        credentials: 'same-origin',
      })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          window.location.href = window.location.pathname + '?posted=1#wall';
        })
        .catch(function () {
          if (btn) {
            btn.disabled = false;
            btn.textContent = '贴上留言';
          }
          alert('提交失败，请稍后再试');
        });
    });
  }
})();