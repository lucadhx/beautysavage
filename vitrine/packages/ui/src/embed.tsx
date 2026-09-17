// C2 — Embed vidéo (aucun upload). YouTube / Vimeo / Loom / Wistia / iframe générique. Résolution
// vers une URL embarquable + validation + détection du fournisseur (pour la preview immédiate).
export type EmbedProvider = 'youtube' | 'vimeo' | 'loom' | 'wistia' | 'iframe' | null;

export interface EmbedInfo {
  provider: EmbedProvider;
  embedUrl: string | null;
  /** Vignette automatique si dérivable (YouTube uniquement de façon fiable). */
  thumbnail: string | null;
}

export function resolveEmbed(rawValue: string): EmbedInfo {
  const source = String(rawValue || '').trim();
  if (!source) return { provider: null, embedUrl: null, thumbnail: null };
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return { provider: null, embedUrl: null, thumbnail: null };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { provider: null, embedUrl: null, thumbnail: null };
  }
  const host = url.hostname.toLowerCase();

  // YouTube
  if (host.includes('youtube.com')) {
    const id = url.searchParams.get('v') || (url.pathname.startsWith('/embed/') ? url.pathname.split('/')[2] : '');
    if (id) {
      return { provider: 'youtube', embedUrl: `https://www.youtube.com/embed/${encodeURIComponent(id)}`, thumbnail: `https://img.youtube.com/vi/${id}/hqdefault.jpg` };
    }
  }
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    if (id) return { provider: 'youtube', embedUrl: `https://www.youtube.com/embed/${encodeURIComponent(id)}`, thumbnail: `https://img.youtube.com/vi/${id}/hqdefault.jpg` };
  }

  // Vimeo
  if (host.includes('vimeo.com')) {
    if (host.includes('player.vimeo.com')) return { provider: 'vimeo', embedUrl: url.href, thumbnail: null };
    const id = url.pathname.split('/').filter(Boolean)[0];
    if (id && /^\d+$/.test(id)) return { provider: 'vimeo', embedUrl: `https://player.vimeo.com/video/${id}`, thumbnail: null };
  }

  // Loom
  if (host.includes('loom.com')) {
    const parts = url.pathname.split('/').filter(Boolean); // /share/<id> | /embed/<id>
    const id = parts[1];
    if (id) return { provider: 'loom', embedUrl: `https://www.loom.com/embed/${encodeURIComponent(id)}`, thumbnail: null };
  }

  // Wistia
  if (host.includes('wistia.com') || host.includes('wistia.net')) {
    const parts = url.pathname.split('/').filter(Boolean); // /medias/<id>
    const id = parts[parts.length - 1];
    if (id) return { provider: 'wistia', embedUrl: `https://fast.wistia.net/embed/iframe/${encodeURIComponent(id)}`, thumbnail: null };
  }

  // iframe générique (https direct)
  return { provider: 'iframe', embedUrl: url.href, thumbnail: null };
}

export function isValidEmbed(rawValue: string): boolean {
  return resolveEmbed(rawValue).embedUrl !== null;
}

const PROVIDER_LABEL: Record<Exclude<EmbedProvider, null>, string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  loom: 'Loom',
  wistia: 'Wistia',
  iframe: 'Lien intégré',
};

/** Aperçu/lecture d'une vidéo embarquée (ratio 16:9). Placeholder si URL vide/invalide. */
export function LessonEmbed({ url, title = 'Vidéo' }: { url: string; title?: string }) {
  const info = resolveEmbed(url);
  if (!info.embedUrl) {
    return (
      <div className="bs-embed bs-embed--empty" role="img" aria-label="Aucune vidéo">
        <i className="bi bi-camera-video-off" aria-hidden="true" />
        <span>{url ? 'URL vidéo non reconnue' : 'Aucune vidéo'}</span>
      </div>
    );
  }
  return (
    <div className="bs-embed">
      <iframe
        className="bs-embed__frame"
        src={info.embedUrl}
        title={title}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
      {info.provider ? <span className="bs-embed__provider">{PROVIDER_LABEL[info.provider]}</span> : null}
    </div>
  );
}
