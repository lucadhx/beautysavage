import { describe, it, expect } from 'vitest';
import { PROXY_PATHS, buildProxyMap, DEFAULT_PROXY_TARGET } from './proxy';

describe('proxy config', () => {
  it('couvre /api, /auth et /uploads', () => {
    expect(PROXY_PATHS).toContain('/api');
    expect(PROXY_PATHS).toContain('/auth');
    expect(PROXY_PATHS).toContain('/uploads');
  });

  it('construit une map vers la cible par défaut (localhost:3000)', () => {
    const map = buildProxyMap();
    expect(Object.keys(map).sort()).toEqual(['/api', '/auth', '/uploads']);
    expect(map['/api'].target).toBe(DEFAULT_PROXY_TARGET);
    expect(map['/api'].changeOrigin).toBe(true);
  });

  it('respecte une cible personnalisée', () => {
    const map = buildProxyMap('http://localhost:4000');
    expect(map['/auth'].target).toBe('http://localhost:4000');
  });
});
