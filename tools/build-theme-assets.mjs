/**
 * 主题静态资源里的 *.min.js 必须由同名 *.js 生成。
 *
 * 为什么需要它：页面加载的是 .min.js，而 .js 与 .min.js 是两份独立文件，
 * 主构建（build.mjs）只打包边缘函数，不会重新生成 min。
 * 只改 .js 会让改动静默失效——share 面板和索引页筛选按钮都踩过。
 *
 * 用法：node tools/build-theme-assets.mjs
 */
import { readdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import * as esbuild from 'esbuild';

const DIR = 'usr/themes/joe/assets/js';

const files = (await readdir(DIR)).filter((f) => f.endsWith('.js') && !f.endsWith('.min.js'));
if (files.length === 0) throw new Error(`${DIR} 下没有找到 .js 源文件`);

let changed = 0;
for (const name of files) {
  const src = join(DIR, name);
  const min = src.replace(/\.js$/, '.min.js');
  const before = await stat(min).catch(() => null);
  const beforeMs = before?.size ?? -1;

  const result = await esbuild.build({
    entryPoints: [src],
    bundle: false,
    minify: true,
    target: 'es2018',
    write: false,
    legalComments: 'none',
  });
  const code = result.outputFiles[0].text;
  await writeFile(min, code);

  const afterMs = Buffer.byteLength(code);
  const mark = beforeMs === afterMs ? '（大小未变）' : `（${beforeMs} → ${afterMs} 字节）`;
  console.log(`${name} → ${name.replace(/\.js$/, '.min.js')} ${mark}`);
  changed++;
}

console.log(`\n已从 ${changed} 个 .js 生成 .min.js：${DIR}`);