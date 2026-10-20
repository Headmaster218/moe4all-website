import { sha256 } from '../community/submission-codec.mjs';

const encoder = new TextEncoder();
export class GitHubArchive {
  constructor({ token, repository, fetcher = fetch }) {
    this.mode = 'github'; this.token = token; this.repository = repository;
    this.fetcher = fetcher;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('GitHub archive requires a repository');
  }
  async api(path, method = 'GET', body) {
    const response = await this.fetcher(`https://api.github.com/repos/${this.repository}/${path}`, {
      method, redirect: 'manual', signal: this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'MoE4All-Submissions' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (!response.ok) { const error = new Error('GitHub archive request failed'); error.statusCode = response.status; throw error; }
    return response.status === 204 ? null : response.json();
  }
  async verify(row) {
    const archive = JSON.parse(row.archive_json || '{}');
    if (!archive.commit || !archive.path) return false;
    const relation = await this.api(`compare/${encodeURIComponent(archive.commit)}...main`);
    if (!['ahead', 'identical'].includes(relation.status)) return false;
    const content = await this.api(`contents/${archive.path}?ref=${encodeURIComponent(archive.commit)}`);
    return await sha256(Uint8Array.from(atob(content.content.replace(/\s/g, '')), c => c.charCodeAt(0))) === row.file_sha256;
  }
  async readMerged(commit, path) {
    if (!/^[a-f0-9]{40}$/.test(commit) || !/^benchmark-database\/v1\/\d{4}-\d{2}\/[A-Za-z0-9._-]+\.m4b$/.test(path)) throw new Error('Invalid Git import reference');
    const relation = await this.api(`compare/${commit}...main`);
    if (!['ahead', 'identical'].includes(relation.status)) throw new Error('Import commit is not in main history');
    const content = await this.api(`contents/${path}?ref=${commit}`);
    return Uint8Array.from(atob(content.content.replace(/\s/g, '')), c => c.charCodeAt(0));
  }
  async process(row) {
    const request = Object.create(this);
    request.signal = AbortSignal.timeout(25000);
    return request.processReport(row);
  }
  async processReport(row) {
    const kind = row.kind || 'benchmark';
    if (!['benchmark', 'error'].includes(kind) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(row.report_id)) throw new Error('Invalid report identity');
    const created = row.report_created_at?.slice(0, 7) || /^created-at:\s*(\d{4}-\d{2})/m.exec((row.armor || '').replace(/\r\n?/g, '\n'))?.[1];
    if (!created) throw new Error('Cannot determine archive month');
    const path = `${kind === 'benchmark' ? 'benchmark-database' : 'error-database'}/v1/${created}/${row.report_id}.${kind === 'benchmark' ? 'm4b' : 'm4e'}`;
    if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(created) || (row.source_path && row.source_path !== path)) throw new Error('Invalid persisted archive path');
    try {
      const main = await this.api('git/ref/heads/main');
      const content = await this.api(`contents/${path}?ref=${main.object.sha}`);
      if (await sha256(Uint8Array.from(atob(content.content.replace(/\s/g, '')), c => c.charCodeAt(0))) !== row.file_sha256) throw new Error('Existing main archive differs from the approved original');
      return { state: 'published', verified: true, mode: this.mode, commit: main.object.sha, path, public_url: `https://github.com/${this.repository}/blob/${main.object.sha}/${path}`, file_sha256: row.file_sha256 };
    } catch (error) { if (error.statusCode !== 404) throw error; }
    const branch = `community/${kind}/${row.file_sha256}`, previous = JSON.parse(row.archive_json || '{}');
    let pr;
    if (previous.pr_number) pr = await this.api(`pulls/${previous.pr_number}`);
    else {
      const existing = await this.api(`pulls?state=all&head=${encodeURIComponent(this.repository.split('/')[0] + ':' + branch)}&base=main`);
      pr = existing[0];
      if (!pr) {
        if (!row.armor) throw new Error('Cannot recreate a missing PR after source cleanup');
        const main = await this.api('git/ref/heads/main');
        try { await this.api('git/refs', 'POST', { ref: `refs/heads/${branch}`, sha: main.object.sha }); }
        catch (error) { if (error.statusCode !== 422) throw error; }
        let source;
        try { source = await this.api(`contents/${path}?ref=${encodeURIComponent(branch)}`); } catch (error) { if (error.statusCode !== 404) throw error; }
        if (source) {
          if (await sha256(Uint8Array.from(atob(source.content.replace(/\s/g, '')), c => c.charCodeAt(0))) !== row.file_sha256) throw new Error('Archive branch content conflict');
        } else {
          try {
            await this.api(`contents/${path}`, 'PUT', { branch, message: `${kind}: add ${row.report_id}`, content: btoa(Array.from(encoder.encode(row.armor), byte => String.fromCharCode(byte)).join('')) });
          } catch (error) {
            if (![409, 422].includes(error.statusCode)) throw error;
            const concurrent = await this.api(`contents/${path}?ref=${encodeURIComponent(branch)}`);
            if (await sha256(Uint8Array.from(atob(concurrent.content.replace(/\s/g, '')), c => c.charCodeAt(0))) !== row.file_sha256) throw new Error('Concurrent branch content conflict');
          }
        }
        try {
          pr = await this.api('pulls', 'POST', { title: `${kind}: ${row.report_id}`, head: branch, base: 'main', body: `User-consented public ${kind} submission; awaiting maintainer review.\n\nFile SHA-256: ${row.file_sha256}\nPayload SHA-256: ${row.payload_sha256}\n\nValidated format only; not independently reproduced. No automatic merge.` });
        } catch (error) {
          if (error.statusCode !== 422) throw error;
          const concurrent = await this.api(`pulls?state=all&head=${encodeURIComponent(this.repository.split('/')[0] + ':' + branch)}&base=main`);
          pr = concurrent[0]; if (!pr) throw error;
        }
      }
    }
    const result = { state: 'pending', mode: this.mode, pr_number: pr.number, head_sha: pr.head.sha, path, public_url: pr.html_url, file_sha256: row.file_sha256 };
    if (pr.merged) {
      result.commit = pr.merge_commit_sha;
      if (!await this.verify({ ...row, archive_json: JSON.stringify(result) })) throw new Error('Merged archive verification failed');
      return { ...result, verified: true, state: 'published' };
    }
    const changes = await this.api(`pulls/${pr.number}/files?per_page=2`);
    if (changes.length !== 1 || changes[0].filename !== path || changes[0].status !== 'added') throw new Error('Archive PR changed beyond the submitted report');
    const source = await this.api(`contents/${path}?ref=${pr.head.sha}`);
    if (await sha256(Uint8Array.from(atob(source.content.replace(/\s/g, '')), c => c.charCodeAt(0))) !== row.file_sha256) throw new Error('PR head does not match approved bytes');
    return { ...result, verified: true, state: pr.state === 'open' ? 'pending' : 'rejected' };
  }
}
