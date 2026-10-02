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
  define: { 'process.env.NODE_ENV': '"production"' },
  // @edgeone/pages-blob 由平台提供；打包时保留 import 由运行时解析，
  // 若运行时不可用，代码内有 KV 降级逻辑。
  external: ['@edgeone/pages-blob'],
});

mkdirSync('edge-functions', { recursive: true });
mkdirSync('functions', { recursive: true });

let code = result.outputFiles[0].text;

// Blob SDK 外部化：改为运行时动态 import，便于降级
code = code.replace(
  /import\s*\{([^}]*)\}\s*from\s*["@']@edgeone\/pages-blob["@'];?/g,
  (m, names) => `const __blobMod = await import(/* @edgeone/pages-blob */ "@edgeone/pages-blob").catch(() => null);`
);

writeFileSync('edge-functions/[[default]].js', code);
writeFileSync('functions/[[path]].js', code);
console.log('Bundle size:', (code.length / 1024).toFixed(1), 'KB');
console.log('✓ edge-functions/[[default]].js');
console.log('✓ functions/[[path]].js');
