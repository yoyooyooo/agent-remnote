export function normalizeApiBasePath(basePath: string): string {
  const trimmed = basePath.trim();
  if (!trimmed) return '/v1';
  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const withoutTrailing = normalized.replace(/\/+$/, '');
  return withoutTrailing && withoutTrailing !== '/' ? withoutTrailing : '/';
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function resolveBasePrefix(baseUrl: string, fallbackBasePath: string): string {
  const parsed = new URL(normalizeBaseUrl(baseUrl));
  const pathname = normalizeApiBasePath(parsed.pathname);
  if (pathname && pathname !== '/') return normalizeApiBasePath(pathname);
  return normalizeApiBasePath(fallbackBasePath);
}

function normalizeRoutePath(routePath: string): string {
  const trimmed = routePath.trim();
  if (!trimmed) return '';
  return `/${trimmed.replace(/^\/+/, '')}`;
}

export function buildApiBaseUrl(baseUrl: string, fallbackBasePath = '/v1'): string {
  const parsed = new URL(normalizeBaseUrl(baseUrl));
  const prefix = resolveBasePrefix(baseUrl, fallbackBasePath);
  return prefix === '/' ? parsed.origin : `${parsed.origin}${prefix}`;
}

export function apiLocalBaseUrl(port: number, basePath = '/v1'): string {
  return buildApiBaseUrl(`http://127.0.0.1:${port}`, basePath);
}

export function apiContainerBaseUrl(port: number, basePath = '/v1'): string {
  return buildApiBaseUrl(`http://host.docker.internal:${port}`, basePath);
}

export function joinApiUrl(baseUrl: string, routePath: string, fallbackBasePath = '/v1'): string {
  return `${buildApiBaseUrl(baseUrl, fallbackBasePath)}${normalizeRoutePath(routePath)}`;
}
