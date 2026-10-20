const MAX_AGE = 15 * 60 * 1000;
const KEY = 'moe4all-upload-v1:';

// Tab-scoped credentials only: never persist the report or a Turnstile token.
export function uploadStore(storage, apiBase, now = Date.now) {
  function clear(kind) { try { storage()?.removeItem(KEY + kind); } catch {} }
  function read(kind) {
    try {
      const text = storage()?.getItem(KEY + kind);
      if (!text || text.length > 8192) return null;
      const saved = JSON.parse(text);
      if (saved.api !== apiBase || !Number.isFinite(saved.until) || saved.until <= now() || saved.until > now() + MAX_AGE || !saved.value || typeof saved.value !== 'object') { clear(kind); return null; }
      const v = saved.value;
      if (kind === 'confirmation' ? !/^[A-Za-z0-9_-]+$/.test(v.id || '') || typeof v.token !== 'string' || !v.token || v.token.length > 2048 :
        !/^[A-Za-z0-9_-]+$/.test(v.session_id || '') || typeof v.session_token !== 'string' || !v.session_token || !/^[a-f0-9]{64}$/.test(v.file_sha256 || '')) { clear(kind); return null; }
      return v;
    } catch { clear(kind); return null; }
  }
  function write(kind, value) {
    try {
      const fields = kind === 'confirmation' ? ['id', 'token', 'expires_at'] : ['session_id', 'session_token', 'browser', 'expires_at', 'state', 'kind', 'report_id', 'file_sha256', 'size_bytes'];
      value = Object.fromEntries(fields.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
      const expires = Date.parse(value.expires_at);
      const text = JSON.stringify({ api: apiBase, until: Math.min(now() + MAX_AGE, Number.isFinite(expires) ? expires : Infinity), value });
      if (text.length > 8192 || !storage()) return false;
      storage().setItem(KEY + kind, text); return true;
    } catch { return false; }
  }
  return { read, write, clear };
}

export function sameReport(session, decoded) {
  return session?.report_id === decoded.id && session.kind === decoded.kind && session.file_sha256 === decoded.fileSha256 && session.size_bytes === decoded.sizeBytes;
}

export async function submissionRequest(base, path, options = {}, fetcher = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const { stage = '上传 API', ...init } = options;
  const attempts = !init.method || init.method === 'GET' ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetcher(base + path, { credentials: 'include', redirect: 'error', ...init, headers: { Accept: 'application/json', ...init.headers }, signal: AbortSignal.timeout(30000) });
      let value;
      try { value = await response.json(); } catch { throw Object.assign(new Error('服务器响应无法识别，尚未确认成功。'), { code: 'invalid_response' }); }
      if (!response.ok) throw Object.assign(new Error(value.error?.message || `请求失败（HTTP ${response.status}）`), { status: response.status, code: value.error?.code, requestId: value.request_id });
      return value;
    } catch (error) {
      const retryable = !error.status && error.code !== 'invalid_response' || error.status >= 500;
      if (retryable && attempt + 1 < attempts) { await pause(400); continue; }
      if (!error.status && !error.code) error = Object.assign(new Error('连接失败或超时，请检查网络、代理及浏览器拦截。'), { code: 'network_error' });
      error.stage = stage; throw error;
    }
  }
}

export function humanVerifier(win, doc, { token, failure, timeoutMs = 15000 } = {}) {
  let loading, widget, element, epoch = 0;
  function dispose() {
    epoch++; token('');
    if (widget !== undefined) { try { win.turnstile?.remove(widget); } catch {} }
    widget = undefined; element = undefined;
  }
  function load() {
    if (win.turnstile?.render) return Promise.resolve();
    if (loading) return loading;
    const current = new Promise((resolve, reject) => {
      const script = doc.createElement('script');
      const timer = setTimeout(() => finish(new Error('验证码脚本加载超时。')), timeoutMs);
      function finish(error) {
        clearTimeout(timer); script.onload = null; script.onerror = null;
        if (error) { script.remove(); reject(error); } else resolve();
      }
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onload = () => finish(win.turnstile?.render ? null : new Error('验证码服务未就绪。'));
      script.onerror = () => finish(new Error('无法加载验证码服务 challenges.cloudflare.com。'));
      doc.head.append(script);
    });
    loading = current.catch(error => { loading = undefined; throw error; });
    return loading;
  }
  async function prepare(session, force = false) {
    const target = doc.querySelector('#human-verification');
    if (!target) return;
    if (!force && widget !== undefined && element === target) return;
    dispose(); const generation = epoch;
    if (!session.turnstile_site_key) throw new Error('验证码服务尚未配置。');
    await load();
    if (generation !== epoch || doc.querySelector('#human-verification') !== target) return;
    element = target;
    const failed = message => { if (generation === epoch) { token(''); failure(message); } };
    widget = win.turnstile.render(target, {
      sitekey: session.turnstile_site_key, action: 'submission',
      callback: value => { if (generation === epoch) token(value); },
      'expired-callback': () => failed('验证码已过期，请重新验证。'),
      'timeout-callback': () => failed('验证码验证超时，请重新验证。'),
      'error-callback': code => { failed(`验证码验证失败（${String(code).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)}），可重试，不需要刷新页面。`); return true; }
    });
  }
  return { prepare, dispose };
}
