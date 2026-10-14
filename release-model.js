(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoeReleaseModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function compareVersions(left, right) {
    const parse = value => { const [core, suffix] = value.split(/-(.*)/s); return { core: core.split('.').map(Number), suffix }; };
    const a = parse(left), b = parse(right);
    for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] - b.core[i];
    if (!a.suffix || !b.suffix) return a.suffix ? -1 : b.suffix ? 1 : 0;
    const aa = a.suffix.split('.'), bb = b.suffix.split('.');
    for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
      if (aa[i] === bb[i]) continue;
      if (aa[i] === undefined) return -1;
      if (bb[i] === undefined) return 1;
      const an = /^\d+$/.test(aa[i]), bn = /^\d+$/.test(bb[i]);
      if (an && bn) return Number(aa[i]) - Number(bb[i]);
      if (an !== bn) return an ? -1 : 1;
      return aa[i].localeCompare(bb[i]);
    }
    return 0;
  }
  function releaseURL(item, repository) {
    const fallback = `https://github.com/${repository}/releases`;
    try {
      const url = new URL(item?.html_url || item?.url);
      return url.origin === 'https://github.com' && url.pathname.startsWith(`/${repository}/releases/tag/`) && !url.username && !url.password ? url.href : fallback;
    } catch { return fallback; }
  }
  function assetURL(asset, repository, tag) {
    try {
      const url = new URL(asset.browser_download_url || asset.url);
      const parts = url.pathname.split('/').map(decodeURIComponent);
      return url.origin === 'https://github.com' && !url.username && !url.password && parts.slice(1, 3).join('/') === repository && parts[3] === 'releases' && parts[4] === 'download' && parts[5] === tag && parts.slice(6).join('/') === asset.name ? url.href : null;
    } catch { return null; }
  }
  function selectReleases(releases, repository = 'Headmaster218/MoE4All', { agentReleases = releases, agentRepository = repository } = {}) {
    const eligible = (items, source) => items.filter(item => !item.draft && item.published_at && item.html_url?.startsWith(`https://github.com/${source}/releases/tag/`) && releaseURL(item, source) === item.html_url);
    const pick = (items, source, pattern, prerelease) => eligible(items, source).filter(item => pattern.test(item.tag_name) && (prerelease === undefined || item.prerelease === prerelease)).map(item => ({
      version: item.tag_name.match(pattern)[1], tag: item.tag_name, url: item.html_url, prerelease: item.prerelease, publishedAt: item.published_at,
      assets: (item.assets || []).filter(asset => asset.state === 'uploaded' && asset.size > 0 && assetURL(asset, source, item.tag_name) && !/(?:\.sha\d+|\.txt|\.asc|\.sig|checksums?)$/i.test(asset.name)).map(asset => ({ name: asset.name, url: assetURL(asset, source, item.tag_name), size: asset.size }))
    })).sort((a, b) => compareVersions(b.version, a.version) || b.publishedAt.localeCompare(a.publishedAt))[0] || null;
    const engine = pick(releases, repository, /^(?:release-|v)(\d+\.\d+\.\d+)$/, false);
    if (!engine) throw new Error('No published stable Engine release found; keeping the existing manifest.');
    const preview = pick(releases, repository, /^(?:release-|v)(\d+\.\d+\.\d+-[0-9A-Za-z.-]+)$/, true);
    const agentPattern = agentRepository === repository ? /^agent-v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/ : /^(?:agent-v|release-|v)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;
    const agent = pick(agentReleases, agentRepository, agentPattern, false) || pick(agentReleases, agentRepository, agentPattern, true);
    return { schema: 1, engine, enginePreview: preview && compareVersions(preview.version, engine.version) > 0 ? preview : null, agent };
  }
  function detectPlatform(navigatorLike = {}) {
    const platform = navigatorLike.userAgentData?.platform || navigatorLike.platform || '';
    const ua = `${platform} ${navigatorLike.userAgent || ''}`;
    const os = /Android|iPhone|iPad|iPod/i.test(ua) || (/Mac/i.test(platform) && navigatorLike.maxTouchPoints > 1) ? 'unknown' : /Windows|Win32|Win64/i.test(ua) ? 'windows' : /Mac/i.test(ua) ? 'macos' : /Linux/i.test(ua) ? 'linux' : 'unknown';
    const arch = /arm64|aarch64/i.test(ua) ? 'arm64' : /i[3-6]86|\bx86\b(?!_64)/i.test(ua) ? 'x86' : /x86_64|amd64|x64|Win64|WOW64/i.test(ua) ? 'x86_64' : 'unknown';
    return { os, arch };
  }
  function assetPlatform(name) {
    const os = /windows|win32|win64|(?:^|[-_.])win(?:[-_.]|$)/i.test(name) || /\.(exe|msi)$/i.test(name) ? 'windows' : /linux|appimage|\.(deb|rpm)$/i.test(name) ? 'linux' : /macos|darwin|(?:^|[-_.])mac(?:[-_.]|$)|\.(dmg|pkg)$/i.test(name) ? 'macos' : 'unknown';
    const arch = /arm64|aarch64/i.test(name) ? 'arm64' : /x86_64|amd64|x64/i.test(name) ? 'x86_64' : /i[3-6]86|(?:^|[-.])x86(?:[-.]|$)|win32/i.test(name) ? 'x86' : /universal/i.test(name) ? 'universal' : 'unknown';
    return { os, arch };
  }
  function downloadFor(item, repository, platform) {
    const fallback = { url: releaseURL(item, repository), direct: false, asset: null };
    if (!item || platform.os === 'unknown') return fallback;
    const packages = (item.assets || []).filter(asset => {
      const target = assetPlatform(asset.name);
      return asset.size > 0 && assetURL(asset, repository, item.tag) && /\.(zip|exe|msi|dmg|pkg|AppImage|deb|rpm|tar\.(gz|xz|zst))$/i.test(asset.name) && !/source|symbols?|debug|checksum/i.test(asset.name) && target.os === platform.os && (target.arch === 'universal' || platform.arch !== 'unknown' && target.arch === platform.arch);
    }).sort((a, b) => {
      const score = asset => /\.(zip|tar\.gz|dmg)$/i.test(asset.name) ? 0 : 1;
      return score(a) - score(b) || a.name.localeCompare(b.name);
    });
    const asset = packages[0];
    return asset ? { url: assetURL(asset, repository, item.tag), direct: true, asset: asset.name } : fallback;
  }
  return { compareVersions, selectReleases, detectPlatform, downloadFor, assetPlatform, releaseURL };
});
