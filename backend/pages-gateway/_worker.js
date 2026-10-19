const unavailable = () => Response.json({
  api_version: 1,
  error: { code: 'gateway_unavailable', message: '上传入口尚未就绪，请保留文件稍后重试', retryable: true }
}, { status: 503, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/' && ['GET', 'HEAD'].includes(request.method)) {
      return Response.json({ service: 'MoE4All submission gateway', service_binding: typeof env.SUBMISSIONS?.fetch === 'function' ? 'configured' : 'missing' }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (!path.startsWith('/v1/')) return new Response(null, { status: 404 });
    if (typeof env.SUBMISSIONS?.fetch !== 'function') return unavailable();
    try {
      // A Service Binding preserves the request without public workers.dev DNS or redirects.
      return await env.SUBMISSIONS.fetch(request);
    } catch {
      return unavailable();
    }
  }
};
