/**
 * TOTP 两步验证（RFC 6238，SHA-1，30 秒窗口，6 位）
 * 依赖 Web Crypto HMAC-SHA1（EdgeOne Edge Functions 支持）
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** 生成随机 base32 密钥（160 位 = 32 字符） */
export function generateTotpSecret() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

export function base32Decode(str) {
  let bits = '';
  for (const ch of str.toUpperCase().replace(/=+$/, '')) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return new Uint8Array(bytes);
}

async function hmacSha1(keyBytes, msgBytes) {
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, msgBytes));
}

/** 计算某个时间步的 TOTP 值 */
export async function totpAt(secret, counter) {
  const keyBytes = base32Decode(secret);
  const msg = new Uint8Array(8);
  // counter 转 big-endian 64bit
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const mac = await hmacSha1(keyBytes, msg);
  const offset = mac[mac.length - 1] & 0x0f;
  const code =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);
  return String(code % 1000000).padStart(6, '0');
}

/**
 * 校验 TOTP 验证码（允许 ±1 个时间窗口）
 */
export async function verifyTotp(secret, code) {
  if (!secret || !code || !/^\d{6}$/.test(String(code))) return false;
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (const drift of [-1, 0, 1]) {
    if ((await totpAt(secret, counter + drift)) === String(code)) return true;
  }
  return false;
}

/** 生成 otpauth:// URI（供验证器 App 扫码） */
export function otpauthUri(secret, account, issuer) {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/**
 * 生成 TOTP 二维码（SVG 矢量）
 * 使用 qrcode-generator（MIT）生成模块矩阵，再输出为 SVG
 */
import qrcode from 'qrcode-generator';

export function totpQrSvg(uri) {
  const qr = qrcode(0, 'M'); // 自动选择版本，纠错级别 M
  qr.addData(uri);
  qr.make();
  const n = qr.getModuleCount();
  const scale = 4;
  const dim = (n + 8) * scale;
  let rects = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) {
        rects += `<rect x="${(c + 4) * scale}" y="${(r + 4) * scale}" width="${scale}" height="${scale}"/>`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}
