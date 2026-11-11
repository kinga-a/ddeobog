/**
 * 后台 Markdown 编辑器（EasyMDE）的接入测试。
 *
 * 旧的自研工具条（joe.admin-md.js）已下线，编辑器换成 vendored 的 EasyMDE：
 * 这里验的是接入契约——库文件完整可用、初始化脚本把预览/上传/摘要分隔都
 * 接到本站端点上、样式层有对应适配。编辑器内部行为（CodeMirror 编辑、
 * 工具栏动作）由 EasyMDE 上游保证，不在这里重复测；端点行为在 test.mjs 里
 * 有真请求级的用例（预览渲染、图片上传）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

test('vendored EasyMDE：版本、体积与语法完整', () => {
  const js = read('./usr/themes/joe/assets/lib/easymde@2.18.0/easymde.min.js');
  assert.ok(js.includes('easymde v2.18.0'), '应为 EasyMDE 2.18.0');
  assert.ok(js.length > 300_000, `库文件疑似不完整：${js.length} 字节`);
  assert.doesNotThrow(() => new Function(js), '库文件应可解析');
  const css = read('./usr/themes/joe/assets/lib/easymde@2.18.0/easymde.min.css');
  assert.ok(css.includes('.EasyMDEContainer'), '样式应包含编辑器容器类');
  assert.ok(css.includes('.editor-preview-side'), '样式应包含分屏预览类');
});

test('初始化脚本：预览走站点渲染端点，不用内置 marked', () => {
  const src = read('./usr/themes/joe/assets/js/joe.admin-editor.js');
  assert.ok(src.includes("fetch('/admin/preview'"), '预览应 POST 到 /admin/preview');
  assert.ok(src.includes('previewRender'), '应提供自定义 previewRender');
});

test('初始化脚本：图片上传先压缩再走后台端点', () => {
  const src = read('./usr/themes/joe/assets/js/joe.admin-editor.js');
  assert.ok(src.includes('imageUploadFunction'), '应提供图片上传函数');
  assert.ok(src.includes('compressImageFile'), '上传前应复用后台图片压缩');
  assert.ok(src.includes("'/admin/upload-image'"), '应 POST 到 /admin/upload-image');
});

test('初始化脚本：工具栏含分屏与摘要分隔，且关掉会拉 CDN 的功能', () => {
  const src = read('./usr/themes/joe/assets/js/joe.admin-editor.js');
  assert.ok(src.includes("'side-by-side'"), '工具栏应有分屏预览');
  assert.ok(src.includes("'preview'"), '工具栏应有单屏预览');
  assert.ok(src.includes('<!--more-->'), '应保留插入摘要分隔的动作');
  assert.ok(src.includes('spellChecker: false'), '拼写检查要拉 CDN 词典，必须关');
  assert.ok(src.includes('autoDownloadFontAwesome: false'), '图标库后台自带，必须关自动下载');
  assert.ok(src.includes('sideBySideFullscreen: false'), '分屏不得联动全屏：全屏的滚动锁会在 SPA 离开编辑页后残留，冻住整个后台');
  assert.ok(src.includes('easymde@2.18.0/easymde.min.js'), '应从 vendored 路径加载库');
});

test('初始化脚本：min 版已生成且内容一致', () => {
  const min = read('./usr/themes/joe/assets/js/joe.admin-editor.min.js');
  assert.ok(min.includes('/admin/preview'), 'min 版应包含预览端点');
  assert.ok(min.length < read('./usr/themes/joe/assets/js/joe.admin-editor.js').length, 'min 版应更小');
});

test('后台样式：EasyMDE 适配存在，旧工具条样式已清', () => {
  const css = read('./usr/themes/joe/assets/css/admin.css');
  assert.ok(css.includes('.EasyMDEContainer .CodeMirror'), '应有编辑区适配');
  assert.ok(css.includes('.editor-preview-side'), '应有预览区适配');
  assert.ok(!css.includes('.md-bar'), '旧工具条样式不应残留');
});

test('后台样式：开关的装饰层不得拦截点击', () => {
  const css = read('./usr/themes/joe/assets/css/admin.css');
  // 药丸/滑块是纯装饰层且盖在透明复选框之上，不放行点击的话开关点了没反应
  assert.ok(/\.switch__ui \{[^}]*pointer-events: none/.test(css), '.switch__ui 必须有 pointer-events: none');
  assert.ok(css.includes('.ui-modal'), '应有自定义确认弹窗样式');
  assert.ok(css.includes('::file-selector-button'), '文件选择按钮应有美化');
});

test('移动端防溢出：后台网格可收缩、整页兜底；前台正文长内容可断行', () => {
  const admin = read('./usr/themes/joe/assets/css/admin.css');
  // 1fr 等于 minmax(auto, 1fr)，列宽会被不可断的长内容撑爆，手机单列必须写 minmax(0, 1fr)
  assert.ok(admin.includes('.home-module-grid { grid-template-columns: minmax(0, 1fr); gap: 14px; }'), '手机首页模块网格应可收缩');
  assert.ok(admin.includes('overflow-x: clip'), '后台整页应有横向溢出兜底');
  assert.ok(/\.hint \{[^}]*overflow-wrap: anywhere/.test(admin), '提示文本里的长链接应可断行');
  const layout = read('./usr/themes/joe/assets/css/joe.layout.css');
  assert.ok(layout.includes('overflow-x: clip'), '前台整页应有横向溢出兜底');
  assert.ok(layout.includes('.joe_detail__article a:not([class]) { overflow-wrap: anywhere; }'), '正文长链接应可断行');
  assert.ok(layout.includes('.joe_detail__article pre { overflow-x: auto; }'), '无语言代码块应可横向滚动');
  assert.ok(layout.includes('.comment-list__item-contain { overflow-wrap: anywhere; }'), '评论长内容应可断行');
});

test('前台体验五项：加载动画、文章留白、抽屉胶囊、搜索无光晕', () => {
  const layout = read('./usr/themes/joe/assets/css/joe.layout.css');
  assert.ok(layout.includes('@keyframes joe-load-spin'), '查看更多应有加载转圈动画');
  assert.ok(layout.includes('.joe-item-enter'), '新追加条目应有淡入动画类');
  assert.ok(layout.includes('.joe_detail__related { margin-bottom: 22px; }'), '相关推荐下方应有留白');
  assert.ok(layout.includes('.joe_post__pagination { margin: 2px 0 22px; }'), '上/下一篇与评论区之间应有留白');
  assert.ok(layout.includes('.joe_header__slideout-menu .slides .link'), '抽屉分类/标签应有胶囊样式');
  const index = read('./usr/themes/joe/assets/js/joe.index.js');
  assert.ok(index.includes('joe-item-enter'), '列表脚本应给新条目打动画类');
  assert.ok(index.includes('加载中…'), '加载时按钮应显示加载文案');
  const refine = read('./usr/themes/joe/assets/css/joe.refine.css');
  assert.ok(!refine.includes('.joe_header__above-search:focus-within {\n  border-radius: 17px;\n  outline: 2px solid var(--theme);'), '搜索容器不应再画主题色光圈');
  assert.ok(refine.includes('.joe_header__searchout .search input:focus-visible { outline: none; box-shadow: none; }'), '展开搜索条聚焦也不应有轮廓光晕');
  assert.ok(refine.includes('.joe_header__above-search .input { border-color: var(--classA); }'), '搜索框应有看得清的中性灰边框');
  assert.ok(layout.includes('white-space: nowrap'), '加载中文案应单行不溢出胶囊');
});

test('阅读进度条：JS 驱动（rAF+transform），不再用 scroll-driven CSS 动画', () => {
  const refine = read('./usr/themes/joe/assets/css/joe.refine.css');
  assert.ok(!refine.includes('animation-timeline: scroll'), 'scroll-driven 动画在移动端跟随不跟手，应已下线');
  assert.ok(refine.includes('.joe_reading-progress'), '进度条元素应有样式');
  assert.ok(refine.includes('will-change: transform'), '进度条应预告合成层');
  const post = read('./usr/themes/joe/assets/js/joe.post_page.js');
  assert.ok(post.includes("bar.className = 'joe_reading-progress'"), '文章页脚本应创建进度条元素');
  assert.ok(post.includes("{ passive: true }"), '滚动监听应为 passive');
  assert.ok(post.includes("bar.style.transform = 'scaleX(' + p + ')'"), '每帧只写 transform');
});

test('首页分类/标签下拉：滚动条隐藏但可滚', () => {
  const layout = read('./usr/themes/joe/assets/css/joe.layout.css');
  assert.ok(layout.includes('.joe_index__title-filter-panel::-webkit-scrollbar'), 'webkit 系应隐藏下拉滚动条');
  assert.ok(/\.joe_index__title-filter-panel \{[^}]*scrollbar-width: none/.test(layout), 'Firefox 应隐藏下拉滚动条');
});
