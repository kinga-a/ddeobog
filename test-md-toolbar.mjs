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
