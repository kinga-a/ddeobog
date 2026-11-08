/**
 * 回收站测试
 *
 *   node --test test-trash.mjs
 *
 * 覆盖：文章（含评论级联）软删与恢复、评论计数、分类引用与计数、
 *       附件 Blob 延迟删除、永久删除与清空。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { KV } from './src/storage/kv.js';
import { Database } from './src/db.js';

class MockKV {
  constructor() { this.map = new Map(); }
  async get(key, opts) {
    const v = this.map.get(key);
    if (v === undefined) return null;
    const type = typeof opts === 'string' ? opts : (opts && opts.type) || 'text';
    if (type === 'json') { try { return JSON.parse(v); } catch { return null; } }
    return v;
  }
  async put(key, value) { this.map.set(key, String(value)); }
  async delete(key) { this.map.delete(key); }
  async list({ prefix = '', limit = 256 } = {}) {
    const keys = [...this.map.keys()].filter((k) => k.startsWith(prefix)).sort();
    return { keys: keys.slice(0, limit).map((key) => ({ key })), complete: true, cursor: null };
  }
}

function makeDb() {
  const binding = new MockKV();
  const calls = { blobDelete: [] };
  const blob = {
    async delete(key) { calls.blobDelete.push(key); },
    async set() {},
    async get() { return null; },
  };
  return { db: new Database(new KV(binding), blob), binding, calls };
}

test('文章软删：正式列表消失、评论一起进回收站，恢复后完整回来', async () => {
  const { db } = makeDb();
  const post = await db.createContent({ title: '测试文章', type: 'post', text: '正文' });
  await db.createComment({ cid: post.cid, author: 'A', text: '评论一', status: 'approved' });
  await db.createComment({ cid: post.cid, author: 'B', text: '待审', status: 'waiting' });

  assert.equal((await db.getContent(post.cid)).commentsNum, 1);
  assert.equal(await db.trashContent(post.cid, 'admin'), true);

  assert.equal(await db.getContent(post.cid), null, '软删后正式表应没有内容');
  assert.equal((await db.listContentsIndex({ pageSize: 10, allStatus: true })).total, 0);
  assert.equal((await db.listComments(post.cid)).length, 0, '评论应随文章一起移出');

  const trash = await db.listTrash();
  assert.equal(trash.length, 1);
  assert.equal(trash[0].kind, 'content');
  assert.equal(trash[0].type, 'post');
  assert.equal(trash[0].title, '测试文章');
  assert.equal(trash[0].actor, 'admin');
  assert.equal(trash[0].data.comments.length, 2, '两条评论都要保留副本');

  const restored = await db.restoreTrash(trash[0].key);
  assert.equal(restored.type, 'post');
  const row = await db.getContent(post.cid);
  assert.equal(row.title, '测试文章');
  assert.equal(row.commentsNum, 1, '恢复后只统计已通过评论');
  assert.equal((await db.listComments(post.cid)).length, 1);
  assert.equal((await db.listContentsIndex({ pageSize: 10, allStatus: true })).total, 1);
  assert.equal((await db.listTrash()).length, 0, '恢复后回收站条目应删除');
});

test('评论软删与恢复：计数同步', async () => {
  const { db } = makeDb();
  const post = await db.createContent({ title: '文章', type: 'post', text: '' });
  const c = await db.createComment({ cid: post.cid, author: 'A', text: '评论', status: 'approved' });
  assert.equal((await db.getContent(post.cid)).commentsNum, 1);

  await db.trashComment(c.coid, 'mcp');
  assert.equal((await db.getContent(post.cid)).commentsNum, 0, '软删已通过评论应减计数');
  const item = (await db.listTrash())[0];
  assert.equal(item.actor, 'mcp');
  assert.match(item.title, /A：评论/);

  await db.restoreTrash(item.key);
  assert.equal((await db.getContent(post.cid)).commentsNum, 1, '恢复后应加回计数');
  assert.equal((await db.listComments(post.cid)).length, 1);
});

test('分类软删与恢复：文章引用与计数一起还原', async () => {
  const { db } = makeDb();
  const cat = await db.createMeta({ name: '互联网', slug: 'internet', type: 'category' });
  const post = await db.createContent({ title: '文章', type: 'post', text: '', categories: [cat.mid] });

  assert.equal((await db.getMeta(cat.mid)).count, 1);
  await db.trashMeta(cat.mid, 'mcp');

  assert.equal(await db.getMeta(cat.mid), null);
  assert.deepEqual((await db.getContent(post.cid)).categories, [], '删除分类应从文章移除');
  const item = (await db.listTrash())[0];
  assert.equal(item.kind, 'meta');
  assert.deepEqual(item.data.affectedPosts, [post.cid]);

  await db.restoreTrash(item.key);
  assert.equal((await db.getMeta(cat.mid)).name, '互联网');
  assert.deepEqual((await db.getContent(post.cid)).categories, [cat.mid], '恢复后应加回文章引用');
  assert.equal((await db.getMeta(cat.mid)).count, 1, '文章数应按索引重算');
});

test('附件软删不删 Blob，彻底删除时才清理', async () => {
  const { db, calls } = makeDb();
  const file = await db.createContent({ title: 'a.png', slug: 'a.png', type: 'attachment' });

  await db.trashContent(file.cid, 'admin');
  assert.equal(calls.blobDelete.length, 0, '软删阶段不应删除 Blob');

  const item = (await db.listTrash())[0];
  await db.purgeTrash(item.key);
  assert.deepEqual(calls.blobDelete, ['a.png'], '彻底删除应清理 Blob');
  assert.equal((await db.listTrash()).length, 0);
});

test('恢复冲突：同 ID 已存在时拒绝覆盖', async () => {
  const { db } = makeDb();
  const post = await db.createContent({ title: '旧文章', type: 'post', text: '' });
  await db.trashContent(post.cid, 'admin');
  const item = (await db.listTrash())[0];

  // 模拟 ID 被重新占用
  await db.kv.putJSON(`post:${post.cid}`, { cid: post.cid, title: '新文章', type: 'post', created: 1, text: '' });
  await assert.rejects(() => db.restoreTrash(item.key), /已存在/);
});

test('清空回收站：全部删除且不可恢复', async () => {
  const { db } = makeDb();
  const a = await db.createContent({ title: 'A', type: 'post', text: '' });
  const b = await db.createContent({ title: 'B', type: 'post', text: '' });
  await db.trashContent(a.cid, 'admin');
  await db.trashContent(b.cid, 'admin');
  assert.equal((await db.listTrash()).length, 2);

  const removed = await db.emptyTrash();
  assert.equal(removed, 2);
  assert.equal((await db.listTrash()).length, 0);
  assert.equal(await db.getContent(a.cid), null);
  assert.equal(await db.getContent(b.cid), null);
});
