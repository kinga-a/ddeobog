/**
 * 备份加密 —— PBKDF2-SHA256 + AES-256-GCM
 *
 * 加密后的文件仍是一个 JSON 信封，可正常下载、上传、存 WebDAV：
 * {
 *   format: '5iblog-backup-encrypted',
 *   version: 1,
 *   createdAt: 1794149059,
 *   kdf:    { name: 'PBKDF2-SHA256', iterations: 100000, salt: '...' },
 *   cipher: { name: 'AES-GCM', iv: '...' },
 *   data:   '...'
 * }
 *
 * 只使用 Web 标准 WebCrypto，Node 与 Edge 运行时通用。
 */
export const ENCRYPTED_FORMAT = '5iblog-backup-encrypted';
/** 兼容旧版本加密备份（主题迁移前） */
const LEGACY_ENCRYPTED_FORMATS = new Set(['typecho-edge-backup-encrypted']);
export const MIN_PASSWORD_LENGTH = 6;

const DEFAULT_ITERATIONS = 100000;
const MIN_ITERATIONS = 10000;
const MAX_ITERATIONS = 1000000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

/** 大文件分块，避免 fromCharCode 参数过多导致栈溢出 */
function toBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(String(text || ''));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function subtle() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new Error('当前运行时不支持 WebCrypto，无法加密备份');
  return c.subtle;
}

async function deriveKey(password, salt, iterations) {
  const base = await subtle().importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return subtle().deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export function isEncryptedBackup(obj) {
  return !!obj && typeof obj === 'object'
    && (obj.format === ENCRYPTED_FORMAT || LEGACY_ENCRYPTED_FORMATS.has(obj.format));
}

/** 加密备份对象 */
export async function encryptBackup(obj, password) {
  const pass = String(password || '');
  if (pass.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`备份密码至少 ${MIN_PASSWORD_LENGTH} 位`);
  }
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(pass, salt, DEFAULT_ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(obj));
  const encrypted = await subtle().encrypt({ name: 'AES-GCM', iv }, key, plaintext);

  return {
    format: ENCRYPTED_FORMAT,
    version: 1,
    createdAt: obj && obj.createdAt ? obj.createdAt : Math.floor(Date.now() / 1000),
    kdf: { name: 'PBKDF2-SHA256', iterations: DEFAULT_ITERATIONS, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    data: toBase64(new Uint8Array(encrypted)),
  };
}

/** 解密备份信封，返回原始备份对象 */
export async function decryptBackup(envelope, password) {
  if (!isEncryptedBackup(envelope)) throw new Error('不是加密备份文件');
  const pass = String(password || '');
  if (!pass) throw new Error('该备份已加密，请输入备份密码');

  const iterations = Number(envelope.kdf && envelope.kdf.iterations);
  if (!Number.isFinite(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new Error('备份文件的加密参数异常');
  }
  if (!envelope.kdf.salt || !envelope.cipher || !envelope.cipher.iv || !envelope.data) {
    throw new Error('加密备份文件缺少必要字段');
  }

  const salt = fromBase64(envelope.kdf.salt);
  const iv = fromBase64(envelope.cipher.iv);
  const data = fromBase64(envelope.data);
  const key = await deriveKey(pass, salt, iterations);

  let plain;
  try {
    plain = await subtle().decrypt({ name: 'AES-GCM', iv }, key, data);
  } catch {
    throw new Error('密码错误或备份文件已损坏');
  }
  try {
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new Error('解密后的内容不是合法 JSON');
  }
}