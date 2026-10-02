/**
 * 密码与随机工具 —— PBKDF2-SHA256（Web Crypto）
 * 存储格式: pbkdf2$<iterations>$<salt_b64>$<hash_b64>
 */
const ITERATIONS = 100000;

export function randomHex(bytes = 16) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function b64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

async function pbkdf2(password, salt, iterations) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations },
    key,
    256
  );
}

export async function hashPassword(password) {
  const salt = randomHex(16);
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${salt}$${b64(hash)}`;
}

export async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts[0] !== 'pbkdf2' || parts.length !== 4) return false;
  const iterations = parseInt(parts[1], 10);
  const salt = parts[2];
  const expected = parts[3];
  const actual = b64(await pbkdf2(password, salt, iterations));
  // 常量时间比较
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
