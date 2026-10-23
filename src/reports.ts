/** Remove URL query values and credentials from reports/history, retaining parameter names. */
export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return value;
    url.username = ''; url.password = ''; url.hash = '';
    const names = [...new Set(url.searchParams.keys())];
    for (const key of names) url.searchParams.set(key, '[redacted]');
    return url.toString();
  } catch { return value; }
}

function redactLocation(value: string): string {
  if (/^https?:\/\//i.test(value)) return redactUrl(value);
  if (value.startsWith('//')) return redactUrl(`https:${value}`).replace(/^https:/, '');
  const withoutFragment = value.split('#')[0];
  const query = withoutFragment.indexOf('?');
  if (query < 0) return withoutFragment;
  const params = new URLSearchParams(withoutFragment.slice(query + 1));
  for (const name of [...new Set(params.keys())]) params.set(name, '[redacted]');
  return withoutFragment.slice(0, query) + '?' + params.toString();
}

/** No request options are stored. Also strip credential-bearing response fields. */
export function sanitizeReport<T>(value: T): T {
  function walk(item: unknown, key = ''): unknown {
    if (/^(authorization|proxy-authorization|cookie|set-cookie)$/i.test(key)) return '[redacted]';
    if (typeof item === 'string') {
      if (key === 'input') return redactUrl(/^[a-z][a-z0-9+.-]*:\/\//i.test(item) ? item : `https://${item}`);
      if (/^location$/i.test(key)) return redactLocation(item);
      if (/^url$/i.test(key)) return redactUrl(item);
      if (key === 'summary' && /^HTTP \d{3} → /.test(item)) return item.replace(/^(HTTP \d{3} → )(.*)$/, (_, prefix: string, location: string) => prefix + redactLocation(location));
      if (key === 'path' && item.includes('?')) return item.slice(0, item.indexOf('?')) + '?[redacted]';
      return item.replace(/https?:\/\/[^\s<>"']+/g, match => redactUrl(match))
        .replace(/^(location:\s*)(.*)$/gim, (_, prefix: string, location: string) => prefix + redactLocation(location))
        .replace(/^(authorization|proxy-authorization|cookie|set-cookie):.*$/gim, '$1: [redacted]');
    }
    if (Array.isArray(item)) return item.map(v => walk(v));
    if (item && typeof item === 'object') {
      const result: Record<string, unknown> = {};
      for (const [name, entry] of Object.entries(item)) result[name] = walk(entry, name);
      return result;
    }
    return item;
  }
  return walk(value) as T;
}
