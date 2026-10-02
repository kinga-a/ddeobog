/**
 * 构建脚本：将 src/main.js 打包为单文件 Edge Function
 *
 * 输出到 edge-functions/ 的两个入口：
 *   - [[default]].js  多级动态路由，匹配 /install、/admin、/feed/…（除根路径外的一切）
 *   - index.js        官方路由表：edge-functions/index.js → example.com/
 *                     缺了它，`/` 不匹配任何函数路由，会落到静态资源层，
 *                     而产物里没有 index.html，于是平台直接返回 404 NOT_FOUND。
 *
 * ⚠️ 关键约束：绝不能压缩标识符。
 * EdgeOne CLI 生成的是「把用户代码原样内联进一个 IIFE」的产物，shim 随后用
 * **裸标识符** 读取处理器：
 *
 *     c(dn, "onRequest");        // 这只是 esbuild keepNames 的 __name 辅助函数，
 *     pagesFunctionResponse = onRequest;   // 只改 .name 属性，不是全局注册
 *
 * esbuild 的 minify 会把 `export default async function onRequest` 重命名为
 * `dn`，标识符绑定随之消失，shim 里的裸引用 `onRequest` 直接抛
 * `ReferenceError: onRequest is not defined`，平台返回 545 "Error return from script"。
 * keepNames: true 救不了这一点 —— 它只保留函数对象的 name 属性。
 * 因此这里用 minifySyntax / minifyWhitespace 单独开启压缩，保留全部标识符名。
 */
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';

const result = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  // 只压缩语法和空白，标识符名原样保留（见文件头说明）
  minifySyntax: true,
  minifyWhitespace: true,
  minifyIdentifiers: false,
  keepNames: true,
  format: 'esm',
  target: 'es2022',
  write: false,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
  // @edgeone/pages-blob 打进产物：它是一个薄封装，运行时若平台未提供 Blob 能力，
  // src/storage/blob.js 内部的 try/catch 会降级为 KV 存储。
  //
  // 这里绝不能改写成模块顶层的 `await import(...)`：EdgeOne 的 iife 输出格式
  // 不支持 top-level await，esbuild 会直接报错，导致平台判定没有 server handler。
  // src/storage/blob.js 里的 await 全部位于 async 函数体内，是安全的。
  external: [],
});

mkdirSync('edge-functions', { recursive: true });

const code = result.outputFiles[0].text;

// 自检：产物里必须存在顶层 `function onRequest` 绑定，否则线上必然 545。
if (!/\bfunction\s+onRequest\b/.test(code)) {
  console.error('✗ 产物中找不到顶层 onRequest 绑定，EdgeOne shim 会抛 ReferenceError。');
  process.exit(1);
}

writeFileSync('edge-functions/[[default]].js', code);
writeFileSync('edge-functions/index.js', code);

console.log('Bundle size:', (code.length / 1024).toFixed(1), 'KB');
console.log('✓ edge-functions/[[default]].js  (catch-all)');
console.log('✓ edge-functions/index.js        (根路径 /)');
