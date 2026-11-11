/**
 * SQLite 存储后端测试
 *
 *   npm run test:sqlite
 *
 * 覆盖 KV 语义、跨页前缀列举、Database 完整读写流程、Blob 二进制往返、
 * 进程重启后的持久化与自增序列延续。
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSqliteStore, SqliteBlobStorage } from './src/storage/sqlite.js';
import { KV } from './src/storage/kv.js';
import { Database } from './src/db.js';

const dir = mkdtempSync(join(tmpdir(), 'typecho-sqlite-'));
const dbPath = join(dir, 'blog.sqlite');
let store = openSqliteStore({ path: dbPath });

function freshDb(s = store) {
  const kv = new KV(s.binding);
  return { db: new Database(kv, new SqliteBlobStorage(s, kv)), kv };
}

let { db, kv } = freshDb();

after(() => {
  try {
    store.close();
  } catch {
    /* 已关闭 */
  }
  rmSync(dir, { recursive: true, force: true });
});

test('KV 读写 / JSON / 批量 / 删除', async () => {
  await kv.put('unit:text', 'hello');
  assert.equal(await kv.get('unit:text'), 'hello');

  await kv.putJSON('unit:json', { a: 1, b: ['x'] });
  assert.deepEqual(await kv.getJSON('unit:json'), { a: 1, b: ['x'] });
  assert.equal(await kv.getJSON('unit:missing'), null);

  await kv.putBatch([
    ['unit:a', { n: 1 }],
    ['unit:b', { n: 2 }],
  ]);
  const batch = await kv.getBatch(['unit:a', 'unit:b', 'unit:none']);
  assert.deepEqual(batch.get('unit:a'), { n: 1 });
  assert.deepEqual(batch.get('unit:b'), { n: 2 });
  assert.equal(batch.get('unit:none'), null);

  await kv.deleteBatch(['unit:a', 'unit:b']);
  assert.equal(await kv.get('unit:a'), null);
  assert.equal(await kv.get('unit:b'), null);
});

test('前缀列举跨页（超过单页 256）', async () => {
  const keys = [];
  for (let i = 0; i < 300; i += 1) keys.push(`page:${String(i).padStart(3, '0')}`);
  await kv.putBatch(keys.map((k) => [k, { k }]));

  const listed = await kv.listKeys('page:');
  assert.equal(listed.length, 300);
  assert.equal(listed[0], 'page:000');
  assert.equal(listed.at(-1), 'page:299');

  const some = await kv.listKeys('page:2');
  assert.equal(some.length, 100);

  await kv.deleteBatch(keys);
  assert.equal((await kv.listKeys('page:')).length, 0);
});

test('安装配置与用户', async () => {
  assert.equal(await db.isInstalled(), false);
  await db.setOption('installed', 1);
  await db.setOption('title', '墨记');
  assert.equal(await db.isInstalled(), true);

  const options = await db.getOptions();
  assert.equal(options.title, '墨记');

  const user = await db.createUser({
    name: 'admin',
    mail: 'admin@example.com',
    password: 'admin123456',
    screenName: '管理员',
  });
  assert.equal(user.uid, 1);
  assert.ok(user.passwordHash && user.passwordHash !== 'admin123456');

  assert.equal((await db.getUserByName('admin')).uid, 1);
  assert.equal((await db.getUserByMail('admin@example.com')).uid, 1);
  assert.equal((await db.listUsers()).length, 1);
});

test('内容 / 分类 / 标签 / 索引 / 统计', async () => {
  const category = await db.createMeta({ type: 'category', name: '技术', slug: 'tech' });
  const tag = await db.createMeta({ type: 'tag', name: 'EdgeOne', slug: 'edgeone' });
  const author = await db.getUserByName('admin');

  const post = await db.createContent({
    title: '在 SQLite 上跑 Typecho',
    text: '正文开始\n\n![封面](/upload/cover.png)\n\n<!--more-->摘要部分',
    authorId: author.uid,
    type: 'post',
    slug: 'post-1',
    categories: [category.mid],
    tags: [tag.mid],
  });
  assert.equal(post.cid, 1);
  assert.equal((await db.getMeta(category.mid)).count, 1);
  assert.equal((await db.getMeta(tag.mid)).count, 1);

  const page = await db.listContentsIndex({ type: 'post', page: 1, pageSize: 10 });
  assert.equal(page.total, 1);
  assert.equal(page.items[0].cid, post.cid);
  assert.equal(page.items[0].cover, '/upload/cover.png');
  assert.equal(page.items[0].hasPassword, false);

  assert.equal((await db.listContentsIndex({ type: 'post', keywords: 'sqlite' })).total, 1);
  assert.equal((await db.listContentsIndex({ type: 'post', keywords: '不存在的词' })).total, 0);
  assert.equal((await db.listContentsIndex({ type: 'post', categoryMid: category.mid })).total, 1);
  assert.equal((await db.listContentsIndex({ type: 'post', tagMid: tag.mid })).total, 1);

  await db.incrStat(post.cid, 'views');
  await db.incrStat(post.cid, 'views');
  await db.adjustStat(post.cid, 'agree', 3);
  assert.equal(await db.getStat(post.cid, 'views'), 2);
  assert.equal(await db.sumStat('views'), 2);

  const enriched = await db.enrichWithStats(page);
  assert.equal(enriched.items[0].views, 2);
  assert.equal(enriched.items[0].agree, 3);

  const second = await db.createContent({
    title: '第二篇',
    text: '更多内容',
    authorId: author.uid,
    type: 'post',
    slug: 'post-2',
    created: post.created - 60,
    categories: [category.mid],
  });
  assert.equal((await db.getMeta(category.mid)).count, 2);

  const order = await db.listContentsIndex({ type: 'post', order: 'views' });
  assert.equal(order.items[0].cid, post.cid);

  const adjacent = await db.prevNext(second.cid);
  assert.equal(adjacent.prev?.cid, post.cid);

  assert.equal((await db.getContentBySlug('post-1', 'post'))?.cid, post.cid);

  await db.updateContent(second.cid, { categories: [], tags: [] });
  assert.equal((await db.getMeta(category.mid)).count, 1);
  assert.equal((await db.getMeta(tag.mid)).count, 1);
});

test('评论与评论数', async () => {
  const post = await db.getContentBySlug('post-1', 'post');
  const comment = await db.createComment({
    cid: post.cid,
    author: '访客',
    mail: 'guest@example.com',
    text: '写得清楚',
    status: 'approved',
  });

  assert.equal((await db.getContent(post.cid)).commentsNum, 1);
  assert.equal((await db.listComments(post.cid)).length, 1);
  assert.equal((await db.recentComments(5)).length, 1);

  await db.updateComment(comment.coid, { status: 'waiting' });
  assert.equal((await db.getContent(post.cid)).commentsNum, 0);
  await db.updateComment(comment.coid, { status: 'approved' });
  assert.equal((await db.getContent(post.cid)).commentsNum, 1);

  const all = await db.listAllComments({ status: 'approved' });
  assert.equal(all.total, 1);
  assert.equal(all.items[0].coid, comment.coid);
});

test('会话', async () => {
  const user = await db.getUserByName('admin');
  const token = await db.createSession(user.uid, 3600);
  assert.ok(token);
  assert.equal((await db.getSession(token)).uid, user.uid);
  await db.deleteSession(token);
  assert.equal(await db.getSession(token), null);
});

test('回收站软删除与恢复', async () => {
  const post = await db.getContentBySlug('post-1', 'post');
  await db.trashContent(post.cid);
  assert.equal(await db.getContent(post.cid), null);

  const trash = await db.listTrash();
  const entry = trash.find((t) => t.kind === 'content' && t.id === post.cid);
  assert.ok(entry);

  await db.restoreTrash(entry.key);
  const restored = await db.getContent(post.cid);
  assert.equal(restored.title, post.title);
  assert.equal(restored.commentsNum, 1);
  assert.equal((await db.listComments(post.cid)).length, 1);
  assert.equal((await db.listTrash()).length, 0);
});

test('Blob 二进制往返与元数据', async () => {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x0a]);
  await db.blob.set('cover.png', bytes, 'image/png');

  const blob = await db.blob.get('cover.png');
  assert.equal(blob.contentType, 'image/png');
  assert.deepEqual([...new Uint8Array(blob.body)], [...bytes]);
  assert.deepEqual(await kv.getJSON('file:meta:cover.png'), {
    contentType: 'image/png',
    size: bytes.length,
  });

  await db.blob.set('hello.txt', '你好，SQLite', 'text/plain; charset=utf-8');
  const text = await db.blob.get('hello.txt');
  assert.equal(new TextDecoder().decode(new Uint8Array(text.body)), '你好，SQLite');

  await db.blob.delete('cover.png');
  assert.equal(await db.blob.get('cover.png'), null);
  assert.equal(await kv.getJSON('file:meta:cover.png'), null);
});

test('重启后数据、自增序列与附件保持', async () => {
  store.close();
  store = openSqliteStore({ path: dbPath });
  ({ db, kv } = freshDb(store));

  assert.equal(await db.isInstalled(), true);
  assert.equal((await db.listUsers()).length, 1);
  assert.equal((await db.getContent(1))?.title, '在 SQLite 上跑 Typecho');
  assert.equal((await db.listComments(1)).length, 1);

  const meta = await db.createMeta({ type: 'tag', name: '重启', slug: 'restart' });
  assert.equal(meta.mid, 3, '自增序列应从落库的 seq 继续');

  const text = await db.blob.get('hello.txt');
  assert.equal(new TextDecoder().decode(new Uint8Array(text.body)), '你好，SQLite');

  assert.equal(await kv.get('opt:installed', 'json'), 1);
});