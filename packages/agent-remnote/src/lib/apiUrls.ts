export function normalizeApiBasePath(basePath: string): string {
  const trimmed = basePath.trim();
  if (!trimmed) return '/v1';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function apiLocalBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export function apiContainerBaseUrl(port: number): string {
  return `http://host.docker.internal:${port}`;
}

export function joinApiUrl(baseUrl: string, basePath: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${normalizeApiBasePath(basePath)}`;
}
