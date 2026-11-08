/**
 * 备份 / 恢复 与 WebDAV 客户端测试
 *
 *   node --test test-backup.mjs
 *
 * 覆盖：
 *   - 导出内容范围（含内容键，排除会话与 WebDAV 密码）
 *   - merge / replace 两种恢复方式
 *   - 非法备份文件校验
 *   - WebDAV MKCOL / PUT / PROPFIND / GET / DELETE 全链路（本地 mock 服务）
 *   - 路径穿越与协议校验
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  exportBackup,
  importBackup,
  validateBackup,
  isBackupKey,
  countBackupEntries,
  backupFileName,
  BACKUP_FORMAT,
  BACKUP_VERSION,
} from './src/backup.js';
import {
  encryptBackup,
  decryptBackup,
  isEncryptedBackup,
  ENCRYPTED_FORMAT,
} from './src/backup-crypto.js';
import {
  normalizeConfig,
  safeFileName,
  davUrl,
  parsePropfind,
  ensureDir,
  listBackups,
  putBackup,
  getBackup,
  deleteBackup,
  testConnection,
} from './src/webdav.js';

/** 内存 KV + 最小 db 接口 */
function makeDb(initial = {}) {
  const map = new Map(Object.entries(initial));
  const kv = {
    async get(key, type = 'text') {
      if (!map.has(key)) return null;
      const raw = map.get(key);
      if (type === 'json' || type?.type === 'json') {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }
      return raw;
    },
    async put(key, value) {
      map.set(key, String(value));
    },
    async putJSON(key, obj) {
      map.set(key, JSON.stringify(obj));
    },
    async delete(key) {
      map.delete(key);
    },
    async deleteBatch(keys) {
      for (const k of keys) map.delete(k);
    },
    async listKeys(prefix = '') {
      return [...map.keys()].filter((k) => k.startsWith(prefix)).sort();
    },
  };
  return {
    kv,
    map,
    async getOption(name, fallback = null) {
      const raw = map.get(`opt:${name}`);
      if (raw === undefined) return fallback;
      try {
        return JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    async setOption(name, value) {
      map.set(`opt:${name}`, JSON.stringify(value));
    },
    async listContentsIndex({ type = 'post' } = {}) {
      const idx = JSON.parse(map.get('idx:posts') || '[]');
      return { items: idx.filter((e) => e.type === type), total: idx.filter((e) => e.type === type).length };
    },
  };
}

const seed = {
  'opt:title': JSON.stringify('测试站点'),
  'opt:backup:webdav': JSON.stringify({ url: 'https://dav.example.com', password: 'secret' }),
  'post:1': JSON.stringify({ cid: 1, title: '文章一', type: 'post', created: 1, text: '正文' }),
  'post:2': JSON.stringify({ cid: 2, title: '关于', type: 'page', created: 2, text: '页面' }),
  'meta:10': JSON.stringify({ mid: 10, name: '互联网', type: 'category' }),
  'cmt:100': JSON.stringify({ coid: 100, cid: 1, text: '评论' }),
  'idx:posts': JSON.stringify([{ cid: 1, type: 'post' }, { cid: 2, type: 'page' }]),
  'idx:cmts': JSON.stringify([{ coid: 100 }]),
  'idx:metas': JSON.stringify([{ mid: 10 }]),
  'stat:views': JSON.stringify({ 1: 10 }),
  'file:meta:1': JSON.stringify({ name: 'a.png', size: 100 }),
  'user:1': JSON.stringify({ uid: 1, name: 'admin' }),
  'usern:admin': JSON.stringify(1),
  'sess:abc': JSON.stringify({ uid: 1 }),
  'pacc:abc': JSON.stringify({ uid: 1 }),
  'pending:xyz': JSON.stringify({ uid: 1 }),
  'login:1.2.3.4|admin': JSON.stringify({ count: 1 }),
};

test('备份键范围：含内容，排除会话、限流与 WebDAV 密码', () => {
  assert.ok(isBackupKey('post:1'));
  assert.ok(isBackupKey('opt:title'));
  assert.ok(isBackupKey('file:meta:1'));
  assert.ok(!isBackupKey('sess:abc'));
  assert.ok(!isBackupKey('pacc:abc'));
  assert.ok(!isBackupKey('pending:xyz'));
  assert.ok(!isBackupKey('login:1.2.3.4|admin'));
  assert.ok(!isBackupKey('opt:backup:webdav'));
});

test('导出：格式、统计与内容范围', async () => {
  const db = makeDb(seed);
  const backup = await exportBackup(db, { title: '测试站点', primaryUrl: 'https://example.com' });

  assert.equal(backup.format, BACKUP_FORMAT);
  assert.equal(backup.version, BACKUP_VERSION);
  assert.ok(backup.createdAt > 0);
  assert.equal(backup.site.title, '测试站点');
  assert.equal(backup.counts.posts, 2);
  assert.equal(backup.counts.pages, 1);
  assert.equal(backup.counts.comments, 1);

  assert.equal(backup.data['opt:title'], '测试站点');
  assert.equal(backup.data['post:1'].title, '文章一');
  assert.equal(backup.data['idx:posts'].length, 2);

  assert.equal(backup.data['sess:abc'], undefined, '不应导出会话');
  assert.equal(backup.data['pending:xyz'], undefined, '不应导出待验证会话');
  assert.equal(backup.data['opt:backup:webdav'], undefined, '不应导出 WebDAV 密码');

  assert.equal(countBackupEntries(backup), Object.keys(backup.data).length);
});

test('恢复 merge：覆盖同名键并保留其它数据', async () => {
  const db = makeDb(seed);
  const backup = await exportBackup(db);
  backup.data['post:1'] = { cid: 1, title: '改过的标题', type: 'post', created: 1, text: '新正文' };

  const target = makeDb({ 'post:9': JSON.stringify({ cid: 9, title: '保留我' }) });
  const res = await importBackup(target, backup, { mode: 'merge' });

  assert.equal(res.mode, 'merge');
  assert.equal(res.written, countBackupEntries(backup));
  assert.equal(JSON.parse(target.map.get('post:1')).title, '改过的标题');
  assert.ok(target.map.has('post:9'), 'merge 不应删除备份之外的数据');
  assert.ok(!target.map.has('sess:abc'), '不应写入会话键');
});

test('恢复 replace：先清空内容键再写入', async () => {
  const db = makeDb(seed);
  const backup = await exportBackup(db);
  delete backup.data['post:2'];

  const target = makeDb({
    'post:9': JSON.stringify({ cid: 9, title: '应被清空' }),
    'opt:old': JSON.stringify('旧配置'),
    'sess:keep': JSON.stringify({ uid: 1 }),
  });
  const res = await importBackup(target, backup, { mode: 'replace' });

  assert.equal(res.mode, 'replace');
  assert.ok(!target.map.has('post:9'), 'replace 应清空旧文章');
  assert.ok(!target.map.has('opt:old'), 'replace 应清空旧配置');
  assert.ok(target.map.has('sess:keep'), 'replace 不应删除会话（不属于备份范围）');
  assert.ok(target.map.has('post:1'));
  assert.ok(!target.map.has('post:2'), '备份里没有的键不应被写回');
});

test('校验：非法格式、超高版本、缺失 data 都会被拒绝', () => {
  assert.throws(() => validateBackup(null), /JSON/);
  assert.throws(() => validateBackup([]), /JSON/);
  assert.throws(() => validateBackup({ format: 'other', version: 1, data: {} }), /format/);
  assert.throws(() => validateBackup({ format: BACKUP_FORMAT, version: 999, data: {} }), /高于/);
  assert.throws(() => validateBackup({ format: BACKUP_FORMAT, version: 1 }), /data/);
});

test('备份文件名为 UTC 时间戳且可安全用于路径', () => {
  const name = backupFileName(new Date(Date.UTC(2026, 10, 8, 22, 45, 0)));
  assert.equal(name, 'typecho-edge-20261108-224500.json');
  assert.equal(safeFileName(name), name);
  assert.equal(safeFileName('/tmp/../x.json'), 'x.json');
  assert.throws(() => safeFileName('..'), /不合法/);
  assert.throws(() => safeFileName('a b.json'), /只能包含/);
});

test('WebDAV 配置校验与 URL 拼接', () => {
  const cfg = normalizeConfig({ url: 'https://dav.example.com/dav/', username: 'u', password: 'p', dir: '/backups/typecho/', keep: 5 });
  assert.equal(cfg.url, 'https://dav.example.com/dav');
  assert.equal(cfg.dir, 'backups/typecho');
  assert.equal(cfg.keep, 5);
  assert.equal(davUrl(cfg), 'https://dav.example.com/dav/backups/typecho/');
  assert.equal(davUrl(cfg, 'a.json'), 'https://dav.example.com/dav/backups/typecho/a.json');
  assert.throws(() => normalizeConfig({ url: 'ftp://x' }), /http/);
});

test('PROPFIND 解析：只取 .json 文件，跳过目录，按名称倒序', () => {
  const xml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/dav/backups/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
  <d:response><d:href>/dav/backups/a.json</d:href><d:propstat><d:prop><d:getcontentlength>123</d:getcontentlength><d:getlastmodified>Mon, 08 Nov 2026 10:00:00 GMT</d:getlastmodified><d:resourcetype/></d:prop></d:propstat></d:response>
  <d:response><d:href>/dav/backups/b.json</d:href><d:propstat><d:prop><d:getcontentlength>456</d:getcontentlength><d:resourcetype/></d:prop></d:propstat></d:response>
  <d:response><d:href>/dav/backups/note.txt</d:href><d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response>
</d:multistatus>`;
  const files = parsePropfind(xml, normalizeConfig({ url: 'https://x.test', dir: 'dav/backups' }));
  assert.deepEqual(files.map((f) => f.name), ['b.json', 'a.json']);
  assert.equal(files[1].size, 123);
  assert.match(files[1].modified, /2026/);
});

test('WebDAV 全链路：MKCOL / PUT / PROPFIND / GET / DELETE', async () => {
  const store = new Map();
  let authSeen = false;

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (!req.headers.authorization) {
        res.writeHead(401).end('auth required');
        return;
      }
      authSeen = true;
      const url = new URL(req.url, 'http://127.0.0.1');
      const name = url.pathname.split('/').pop();

      if (req.method === 'MKCOL') return res.writeHead(201).end();
      if (req.method === 'PROPFIND') {
        const list = [...store.entries()]
          .map(
            ([n, v]) =>
              `<d:response><d:href>/dav/backups/${n}</d:href><d:propstat><d:prop><d:getcontentlength>${v.length}</d:getcontentlength><d:resourcetype/></d:prop></d:propstat></d:response>`
          )
          .join('');
        res.writeHead(207, { 'Content-Type': 'application/xml' });
        return res.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${list}</d:multistatus>`);
      }
      if (req.method === 'PUT') {
        store.set(name, Buffer.concat(chunks).toString());
        return res.writeHead(201).end();
      }
      if (req.method === 'GET') {
        if (!store.has(name)) return res.writeHead(404).end();
        return res.writeHead(200, { 'Content-Type': 'application/json' }).end(store.get(name));
      }
      if (req.method === 'DELETE') {
        store.delete(name);
        return res.writeHead(204).end();
      }
      res.writeHead(405).end();
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const cfg = normalizeConfig({
    url: `http://127.0.0.1:${port}`,
    username: 'user',
    password: 'pass',
    dir: 'dav/backups',
    keep: 2,
  });

  try {
    const conn = await testConnection(cfg);
    assert.equal(conn.created, false, '目录已存在时不应重复创建');
    assert.ok(authSeen, '应发送 Basic 认证头');

    await ensureDir(cfg);
    const name = await putBackup(cfg, 'typecho-edge-20261108-224500.json', JSON.stringify({ a: 1 }));
    assert.equal(name, 'typecho-edge-20261108-224500.json');

    const files = await listBackups(cfg);
    assert.equal(files.length, 1);
    assert.equal(files[0].name, name);

    assert.deepEqual(await getBackup(cfg, name), { a: 1 });

    await deleteBackup(cfg, name);
    assert.equal((await listBackups(cfg)).length, 0);

    // 不存在的文件应给出明确错误
    await assert.rejects(() => getBackup(cfg, 'missing.json'), /找不到/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test('备份加密：加密后可解密还原，密文不含明文', async () => {
  const db = makeDb(seed);
  const backup = await exportBackup(db);
  const envelope = await encryptBackup(backup, 'my-backup-pass');

  assert.equal(envelope.format, ENCRYPTED_FORMAT);
  assert.equal(envelope.version, 1);
  assert.equal(envelope.kdf.name, 'PBKDF2-SHA256');
  assert.equal(envelope.cipher.name, 'AES-GCM');
  assert.ok(envelope.kdf.iterations >= 10000);
  assert.ok(!JSON.stringify(envelope).includes('文章一'), '密文不应包含明文');

  const plain = await decryptBackup(envelope, 'my-backup-pass');
  assert.equal(plain.format, BACKUP_FORMAT);
  assert.equal(plain.data['post:1'].title, '文章一');
});

test('备份加密：错误密码与缺失密码会被拒绝', async () => {
  const envelope = await encryptBackup({ format: BACKUP_FORMAT, version: 1, data: {} }, 'right-pass');
  await assert.rejects(() => decryptBackup(envelope, 'wrong-pass'), /密码错误/);
  await assert.rejects(() => decryptBackup(envelope, ''), /请输入备份密码/);
  await assert.rejects(() => decryptBackup({ format: 'other' }, 'x'), /不是加密备份/);
});

test('备份加密：弱密码与异常 KDF 参数被拒绝', async () => {
  await assert.rejects(() => encryptBackup({}, '123'), /至少 6 位/);
  const envelope = await encryptBackup({ format: BACKUP_FORMAT, version: 1, data: {} }, 'good-pass');
  envelope.kdf.iterations = 1;
  await assert.rejects(() => decryptBackup(envelope, 'good-pass'), /参数异常/);
});

test('连接测试：目录不存在时自动创建', async () => {
  const calls = [];
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      calls.push(req.method);
      if (req.method === 'PROPFIND') return res.writeHead(404).end();
      if (req.method === 'MKCOL') return res.writeHead(201).end();
      res.writeHead(405).end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const cfg = normalizeConfig({ url: `http://127.0.0.1:${port}`, dir: 'eo-ddblog' });
  try {
    const result = await testConnection(cfg);
    assert.equal(result.created, true);
    assert.deepEqual(calls, ['PROPFIND', 'MKCOL'], '应先探测目录，再创建');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
