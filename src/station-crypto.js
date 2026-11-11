const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const randomHex = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join('');
export async function hashInvite(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), x => x.toString(16).padStart(2, '0')).join('');
}
function bytes(hex) {
  if (!/^[a-f0-9]{64}$/.test(hex)) throw new Error('密钥格式无效');
  return Uint8Array.from(hex.match(/../g), x => parseInt(x, 16));
}
async function keyFrom(hex) { return crypto.subtle.importKey('raw', bytes(hex), 'AES-GCM', false, ['encrypt', 'decrypt']); }
export async function encryptBytes(value, hex, context) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(context) }, await keyFrom(hex), value);
  return { iv: Array.from(iv), ciphertext };
}
export async function decryptBytes(value, iv, hex, context) {
  if (!Array.isArray(iv) || iv.length !== 12 || iv.some(x => !Number.isInteger(x) || x < 0 || x > 255)) throw Error('密文格式无效');
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: Uint8Array.from(iv), additionalData: encoder.encode(context) }, await keyFrom(hex), value);
}
export async function seal(value, hex, context) {
  const result = await encryptBytes(encoder.encode(JSON.stringify(value)), hex, context);
  return { version: 1, iv: result.iv, ciphertext: btoa(String.fromCharCode(...new Uint8Array(result.ciphertext))) };
}
export async function open(payload, hex, context) {
  if (payload.version !== 1 || typeof payload.ciphertext !== 'string') throw Error('密文版本无效');
  return JSON.parse(decoder.decode(await decryptBytes(Uint8Array.from(atob(payload.ciphertext), x => x.charCodeAt(0)), payload.iv, hex, context)));
}
export function parseInvite(value) {
  const parts = value.trim().split('.');
  if (parts.length !== 3 || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(parts[0]) || !parts.slice(1).every(x => /^[a-f0-9]{64}$/.test(x))) throw Error('请粘贴完整的配对邀请');
  return { space: parts[0], secret: parts[1], key: parts[2] };
}
