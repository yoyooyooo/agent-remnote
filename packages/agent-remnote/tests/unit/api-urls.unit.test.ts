import { describe, expect, it } from 'vitest';

import { buildApiBaseUrl, joinApiUrl, normalizeApiBasePath } from '../../src/lib/apiUrls.js';

describe('unit: apiUrls', () => {
  it('normalizes base paths without trailing slashes', () => {
    expect(normalizeApiBasePath('v1')).toBe('/v1');
    expect(normalizeApiBasePath('/v1/')).toBe('/v1');
    expect(normalizeApiBasePath('/')).toBe('/');
    expect(normalizeApiBasePath('')).toBe('/v1');
  });

  it('builds base urls without duplicate slashes', () => {
    expect(buildApiBaseUrl('http://127.0.0.1:3000/')).toBe('http://127.0.0.1:3000/v1');
    expect(buildApiBaseUrl('http://127.0.0.1:3000/remnote/v1/')).toBe('http://127.0.0.1:3000/remnote/v1');
    expect(buildApiBaseUrl('http://127.0.0.1:3000/', '/')).toBe('http://127.0.0.1:3000');
  });

  it('joins route paths with exactly one slash', () => {
    expect(joinApiUrl('http://127.0.0.1:3000/', '/status')).toBe('http://127.0.0.1:3000/v1/status');
    expect(joinApiUrl('http://127.0.0.1:3000/remnote/v1/', 'status')).toBe('http://127.0.0.1:3000/remnote/v1/status');
  });
});
