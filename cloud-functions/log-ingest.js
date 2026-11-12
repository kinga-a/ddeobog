/**
 * EdgeOne Cloud Functions —— 接收 Edge Functions 的请求日志
 *
 * 为什么需要它：Makers「日志分析」目前不收集 Edge Functions 的 console，
 * 只收集 Cloud Functions / SSR / Agents。Edge Function 通过 LOG_SINK_URL
 * 把每行 JSON 异步转发到这里，再 console.log 一次，即可在控制台
 * 「日志分析 → 来源：Cloud Functions」中按 requestId / status / path 检索。
 *
 * 路由：cloud-functions/log-ingest.js → /log-ingest
 * 环境变量（Cloud Functions 与 Edge Functions 两侧都要配置）：
 *   LOG_SINK_TOKEN  共享密钥，未配置时本函数返回 503，避免公开裸奔
 *
 * 安全：只接受 POST + Bearer Token；字段白名单 + 长度截断；单条上限 16KB。
 */
import { timingSafeEqual } from 'node:crypto';

const MAX_BODY_BYTES = 16 * 1024;
const FIELD_LIMITS = {
  ts: 40,
  level: 8,
  requestId: 16,
  method: 8,
  path: 200,
  status: 4,
  ms: 12,
  ip: 16,
  ua: 80,
  message: 300,
  stack: 800,
};

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function tokenMatches(provided, expected) {
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 只保留已知字段并截断，避免任意大对象进入平台日志 */
function pickFields(record) {
  const out = {};
  for (const [key, limit] of Object.entries(FIELD_LIMITS)) {
    const value = record[key];
    if (value === undefined || value === null) continue;
    out[key] = String(value).slice(0, limit);
  }
  return out;
}

export default async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);

  const expected = env?.LOG_SINK_TOKEN || globalThis.process?.env?.LOG_SINK_TOKEN || '';
  if (!expected) return json({ ok: false, error: 'LOG_SINK_TOKEN is not configured' }, 503);

  const auth = request.headers.get('authorization') || '';
  if (!tokenMatches(auth.replace(/^Bearer\s+/i, ''), expected)) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ ok: false, error: 'payload too large' }, 413);

  let record;
  try {
    record = JSON.parse(text);
  } catch {
    return json({ ok: false, error: 'invalid json' }, 400);
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return json({ ok: false, error: 'invalid record' }, 400);
  }

  // 平台「日志分析」收集的就是这一行
  console.log(JSON.stringify({
    sink: 'edge',
    receivedAt: new Date().toISOString(),
    ...pickFields(record),
  }));
  return new Response(null, { status: 204 });
}