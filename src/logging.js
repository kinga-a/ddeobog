/**
 * 请求日志 —— 同时适配 EdgeOne 边缘函数与本地 Node
 *
 * EdgeOne 的函数日志只收集函数执行期间的 console 输出；项目此前只有
 * 异常时才有 console.error，正常请求不产生任何日志，控制台因此是空白的。
 *
 * 输出一行 JSON，便于在 EdgeOne 日志里按 requestId / status / path 检索：
 *   {"ts":"...","level":"info","requestId":"a1b2c3d4","method":"GET",
 *    "path":"/archives/1/","status":200,"ms":12,"ip":"1a2b3c4d","ua":"..."}
 *
 * 隐私：不记录 query、Cookie、Authorization、请求体；IP 只存短哈希，UA 截断。
 */

const LEVELS = { off: 0, error: 1, info: 2, debug: 3 };

function envValue(env, key, fallback) {
  const fromEnv = env && env[key] !== undefined && env[key] !== null && env[key] !== ''
    ? env[key]
    : undefined;
  if (fromEnv !== undefined) return String(fromEnv);
  const fromProcess = globalThis.process?.env?.[key];
  return fromProcess === undefined || fromProcess === '' ? fallback : String(fromProcess);
}

export function loggerLevel(env) {
  const value = envValue(env, 'LOG_LEVEL', 'info').toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEVELS, value) ? value : 'info';
}

/** 8 位十六进制请求 ID；crypto.randomUUID 不可用时回退到时间戳 + 随机数 */
export function createRequestId() {
  try {
    return crypto.randomUUID().slice(0, 8);
  } catch {
    return `${Date.now().toString(16).slice(-6)}${Math.random().toString(16).slice(2, 6)}`;
  }
}

/** 非加密哈希，仅用于日志脱敏，不参与安全判断 */
function shortHash(value) {
  let h = 5381;
  const s = String(value || '');
  for (let i = 0; i < s.length; i += 1) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0').slice(0, 8);
}

function clientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || request.headers.get('cf-connecting-ip') || '';
}

/** 搜索关键词不进日志，避免把访客查询内容落到平台日志里 */
export function safePath(pathname) {
  const p = String(pathname || '/');
  if (/^\/search\/[^/]+\/?$/.test(p)) return '/search/[kw]/';
  return p.slice(0, 200);
}

export function requestMeta(request) {
  return {
    ip: shortHash(clientIp(request)),
    ua: String(request.headers.get('user-agent') || '').replace(/\s+/g, ' ').slice(0, 80),
  };
}

export function createRequestLogger(env) {
  const level = loggerLevel(env);
  const enabled = (name) => level !== 'off' && LEVELS[level] >= LEVELS[name];
  const emit = (name, event) => {
    const line = JSON.stringify({ ts: new Date().toISOString(), level: name, ...event });
    if (name === 'error') console.error(line);
    else console.log(line);
  };
  return {
    info(event) {
      if (enabled('info')) emit('info', event);
    },
    error(event) {
      if (enabled('error')) emit('error', event);
    },
  };
}