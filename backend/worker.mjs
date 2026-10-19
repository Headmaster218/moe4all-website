import { createService } from './service.mjs';
import { GitHubArchive } from './archive.mjs';

let keyCache;
function bytes(raw) { return Uint8Array.from(atob(raw.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); }
export async function verifyAccess(request, env) {
  const raw = request.headers.get('cf-access-jwt-assertion');
  if (!raw || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_ISSUER || '') || !env.ACCESS_AUD || !env.ADMIN_EMAIL) return null;
  try {
    const parts = raw.split('.'); if (parts.length !== 3) return null;
    const header = JSON.parse(new TextDecoder().decode(bytes(parts[0]))), claims = JSON.parse(new TextDecoder().decode(bytes(parts[1])));
    if (header.alg !== 'RS256' || claims.iss !== env.ACCESS_ISSUER || !(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(env.ACCESS_AUD) || claims.email !== env.ADMIN_EMAIL || !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now() || (claims.nbf && claims.nbf * 1000 > Date.now())) return null;
    if (!keyCache || keyCache.issuer !== env.ACCESS_ISSUER || keyCache.expires < Date.now()) {
      const response = await fetch(`${env.ACCESS_ISSUER}/cdn-cgi/access/certs`, { redirect: 'error' });
      if (!response.ok) return null;
      keyCache = { issuer: env.ACCESS_ISSUER, keys: (await response.json()).keys, expires: Date.now() + 300000 };
    }
    const jwk = keyCache.keys.find(key => key.kid === header.kid); if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, bytes(parts[2]), new TextEncoder().encode(parts.slice(0, 2).join('.'))) ? claims.email : null;
  } catch { return null; }
}
function service(env, ctx) {
  if (!env.DB || !env.RATE_LIMIT_SALT || !env.SITE_ORIGIN || !env.TURNSTILE_SECRET || !env.TURNSTILE_SITE_KEY) throw new Error('Submission service configuration incomplete');
  return createService({
    ...env, MODE: 'production', defer: task => ctx.waitUntil(task),
    REVIEW_MODE: 'github_pr',
    ARCHIVE: env.GITHUB_TOKEN ? new GitHubArchive({ token: env.GITHUB_TOKEN, repository: env.GITHUB_REPOSITORY }) : null,
    authorizeAdmin: request => verifyAccess(request, env),
    verifyHuman: async token => {
      if (typeof token !== 'string' || !token || token.length > 2048) return false;
      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token }), redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok) return false;
      const value = await response.json();
      return value.success === true && value.hostname === new URL(env.SITE_ORIGIN).hostname && value.action === 'submission';
    }
  });
}
export default {
  async fetch(request, env, ctx) {
    try { return await service(env, ctx).fetch(request); }
    catch { return Response.json({ api_version: 1, error: { code: 'service_unconfigured', message: '上传服务尚未配置完成', retryable: true } }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(service(env, ctx).syncPending());
  }
};
