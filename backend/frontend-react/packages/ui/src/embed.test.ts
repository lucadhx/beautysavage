// C2 — Embed util : résolution YouTube/Vimeo/Loom/Wistia/iframe + validation.
import { describe, it, expect } from 'vitest';
import { resolveEmbed, isValidEmbed } from './embed';

describe('resolveEmbed', () => {
  it('YouTube watch + youtu.be → embed + thumbnail', () => {
    const a = resolveEmbed('https://www.youtube.com/watch?v=abc123');
    expect(a.provider).toBe('youtube');
    expect(a.embedUrl).toBe('https://www.youtube.com/embed/abc123');
    expect(a.thumbnail).toContain('abc123');
    const b = resolveEmbed('https://youtu.be/xyz789');
    expect(b.embedUrl).toBe('https://www.youtube.com/embed/xyz789');
  });

  it('Vimeo → player', () => {
    const v = resolveEmbed('https://vimeo.com/123456');
    expect(v.provider).toBe('vimeo');
    expect(v.embedUrl).toBe('https://player.vimeo.com/video/123456');
  });

  it('Loom → embed', () => {
    const l = resolveEmbed('https://www.loom.com/share/deadbeef');
    expect(l.provider).toBe('loom');
    expect(l.embedUrl).toBe('https://www.loom.com/embed/deadbeef');
  });

  it('Wistia → fast.wistia embed', () => {
    const w = resolveEmbed('https://mybrand.wistia.com/medias/abc');
    expect(w.provider).toBe('wistia');
    expect(w.embedUrl).toContain('fast.wistia.net/embed/iframe/abc');
  });

  it('iframe générique (https direct)', () => {
    const g = resolveEmbed('https://example.com/video.html');
    expect(g.provider).toBe('iframe');
    expect(g.embedUrl).toBe('https://example.com/video.html');
  });

  it('invalide → null', () => {
    expect(resolveEmbed('').embedUrl).toBeNull();
    expect(resolveEmbed('pas une url').embedUrl).toBeNull();
    expect(resolveEmbed('javascript:alert(1)').embedUrl).toBeNull();
    expect(isValidEmbed('https://youtu.be/ok')).toBe(true);
    expect(isValidEmbed('nope')).toBe(false);
  });
});
