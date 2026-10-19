const id = /^rc_[A-Za-z0-9_-]{1,150}$/;
const token = /^[A-Za-z0-9_-]{8,200}$/;
const reportId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const states = new Set(['forwarding', 'pending_review', 'published', 'rejected', 'delivery_failed']);

export function receiptHandoff(hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (!params.has('receipt')) return null;
  if ([...params.keys()].length !== 2 || !id.test(params.get('receipt') || '') || !token.test(params.get('token') || '')) throw new Error('回执交接参数无效，请导入本机保存的私密回执文件。');
  return { receipt_id: params.get('receipt'), receipt_token: params.get('token') };
}

export function receiptCredential(value, apiBase) {
  if (!value || typeof value !== 'object' || !id.test(value.receipt_id || '') || !token.test(value.receipt_token || '')) throw new Error('私密回执文件无效。');
  // Never send an imported credential to a URL selected by the imported file.
  if (value.api_base && String(value.api_base).replace(/\/$/, '') !== apiBase.replace(/\/$/, '')) throw new Error('回执属于其他上传服务，不能向当前服务发送凭证。');
  return { receipt_id: value.receipt_id, receipt_token: value.receipt_token };
}

export function verifiedReceipt(value, credential, repository) {
  if (value.api_version !== 1 || value.receipt_id !== credential.receipt_id || !['benchmark', 'error'].includes(value.kind) || !reportId.test(value.report_id || '') || !states.has(value.status)) throw new Error('服务返回的回执身份或状态无效。');
  if (value.public_url) {
    const base = `https://github.com/${repository}/`;
    if (typeof value.public_url !== 'string' || !value.public_url.startsWith(base) || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/(?:pull\/\d+|blob\/[a-f0-9]{40}\/[^?#]+)$/.test(value.public_url)) throw new Error('回执中的公开地址无效。');
  }
  const allowed = ['receipt_id', 'kind', 'report_id', 'file_sha256', 'payload_sha256', 'status', 'received_at', 'updated_at', 'public_url', 'resolution_version', 'failure_code', 'body_retained', 'review_mode', 'archive_mode'];
  return { ...Object.fromEntries(allowed.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]])), receipt_token: credential.receipt_token };
}
