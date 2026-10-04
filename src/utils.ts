import { NormalizedTarget } from './types';

export function normalizeTarget(input: string): NormalizedTarget {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Domain is required.');

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error('Invalid domain or URL. Example: example.com or https://example.com/path');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP and HTTPS targets are supported.');
  }

  const hostname = url.hostname;
  if (!hostname || hostname.length > 253 || /[\s/\\]/.test(hostname)) {
    throw new Error('Invalid hostname.');
  }

  const protocol = url.protocol as 'http:' | 'https:';
  const port = url.port ? Number(url.port) : protocol === 'https:' ? 443 : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid port.');
  }

  return {
    input: trimmed,
    hostname,
    protocol,
    port,
    path: `${url.pathname || '/'}${url.search || ''}`,
    url: url.toString()
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function compactRaw(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.length > 12000 ? `${value.slice(0, 12000)}\n…[truncated]` : value;
}
