/**
 * 构建脚本：将 src/main.js 打包为单文件 Edge Function
 * 输出两份，兼容 EdgeOne Pages 的两种函数目录约定：
 *   - edge-functions/[[default]].js  （Makers Edge Functions，catch-all）
 *   - functions/[[path]].js          （Pages Functions 风格，catch-all）
 */
import { build } from 'esbuild';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const result = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2022',
  write: false,
  legalComments: 'none',
  // 必须保留函数名：EdgeOne CLI 用 `code.indexOf('onRequest') > -1` 判断一个文件
  // 是否为 Pages Function（isPagesFunction）。minify 会把导出函数重命名，
  // 压缩后的产物里不含 "onRequest"，CLI 便不注册任何路由，平台随后报
  // "No server-handler detected" 并把项目当纯静态站点部署，表现为全站 404。
  keepNames: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  // @edgeone/pages-blob 打进产物：它是一个薄封装，运行时若平台未提供 Blob 能力，
  // src/storage/blob.js 内部的 try/catch 会降级为 KV 存储。
  //
  // 这里绝不能改写成模块顶层的 `await import(...)`：EdgeOne 的 iife 输出格式
  // 不支持 top-level await，esbuild 会直接报错，导致平台同样认为没有 server handler。
  // src/storage/blob.js 里的 await 全部位于 async 函数体内，是安全的。
  external: [],
});

mkdirSync('edge-functions', { recursive: true });
mkdirSync('functions', { recursive: true });

const code = result.outputFiles[0].text;

writeFileSync('edge-functions/[[default]].js', code);
writeFileSync('functions/[[path]].js', code);
console.log('Bundle size:', (code.length / 1024).toFixed(1), 'KB');
console.log('✓ edge-functions/[[default]].js');
console.log('✓ functions/[[path]].js');
