import { createHash, timingSafeEqual, X509Certificate } from 'node:crypto';
import https from 'node:https';
import { checkServerIdentity } from 'node:tls';

export interface PhoneProfile { schemaVersion: 1; type: 'calendarbridge-desktop'; baseUrl: string; adminToken: string; certificatePem: string; certificateSha256: string }
export class PhoneRequestError extends Error { constructor(message: string, readonly code?: number) { super(message); } }

export function parsePhoneProfile(text: string): PhoneProfile {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('连接配置不是有效的 JSON 文件。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('连接配置格式无效。');
  const profile = value as Record<string, unknown>;
  if (profile.schemaVersion !== 1 || profile.type !== 'calendarbridge-desktop') throw new Error('请选择电脑端的 wallnote-connection.json。');
  if (typeof profile.baseUrl !== 'string' || typeof profile.adminToken !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(profile.adminToken) || typeof profile.certificatePem !== 'string' || profile.certificatePem.length > 16000 || typeof profile.certificateSha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(profile.certificateSha256)) throw new Error('连接配置缺少有效的密钥或证书。');
  const url = new URL(profile.baseUrl);
  if (url.protocol !== 'https:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('电脑接口必须使用本机 127.0.0.1 的 HTTPS 地址。');
  let certificate: X509Certificate;
  try { certificate = new X509Certificate(profile.certificatePem); } catch { throw new Error('连接配置中的证书无效。'); }
  const fingerprint = certificate.fingerprint256.replaceAll(':', '').toLowerCase();
  if (fingerprint !== profile.certificateSha256.toLowerCase() || !certificate.checkIP('127.0.0.1')) throw new Error('证书指纹或本机地址不匹配。');
  return { schemaVersion: 1, type: 'calendarbridge-desktop', baseUrl: url.origin, adminToken: profile.adminToken, certificatePem: profile.certificatePem, certificateSha256: fingerprint };
}

export function phoneRequest(profile: PhoneProfile, route: string, body?: unknown): Promise<Record<string, unknown>> {
  if (!route.startsWith('/desktop/')) return Promise.reject(new Error('不支持的电脑接口。'));
  const encoded = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const request = https.request(new URL(route, profile.baseUrl), {
      method: encoded ? 'POST' : 'GET', ca: profile.certificatePem, rejectUnauthorized: true,
      checkServerIdentity: (hostname, certificate) => {
        const actual = createHash('sha256').update(certificate.raw).digest();
        const expected = Buffer.from(profile.certificateSha256, 'hex');
        if (expected.length !== actual.length || !timingSafeEqual(actual, expected)) return new Error('电脑接收服务的证书指纹已改变。');
        return checkServerIdentity(hostname, certificate);
      },
      headers: { Authorization: `Bearer ${profile.adminToken}`, ...(encoded ? { 'Content-Type': 'application/json', 'Content-Length': String(encoded.length) } : {}) },
    }, response => {
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 32 * 1024 * 1024) request.destroy(new PhoneRequestError('手机同步数据过大。')); else chunks.push(chunk); });
      response.on('error', fail);
      response.on('end', () => {
        clearTimeout(timeout);
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (response.statusCode !== 200 || data?.ok !== true) return reject(new PhoneRequestError(typeof data?.error === 'string' ? data.error.slice(0, 300) : '接收服务请求失败。', response.statusCode));
          resolve(data);
        } catch { reject(new PhoneRequestError('接收服务返回了无效数据。')); }
      });
    });
    const timeout = setTimeout(() => request.destroy(new PhoneRequestError('手机日历接收服务连接超时。')), 10000);
    function fail(error: Error) {
      clearTimeout(timeout);
      const code = (error as NodeJS.ErrnoException).code;
      const messages: Record<string, string> = { ECONNREFUSED: '无法连接 CalendarBridge，请先启动电脑接收服务。', ECONNRESET: '接收服务连接中断，请稍后重试。', ETIMEDOUT: '连接接收服务超时。', CERT_HAS_EXPIRED: '接收服务证书已过期，请更新配对配置。', DEPTH_ZERO_SELF_SIGNED_CERT: '接收服务证书验证失败，请核对连接配置。', SELF_SIGNED_CERT_IN_CHAIN: '接收服务证书验证失败，请核对连接配置。' };
      reject(code && messages[code] ? new PhoneRequestError(messages[code]) : error);
    }
    request.on('error', fail);
    request.end(encoded);
  });
}
