/**
 * LA PAGE « À PROPOS » — en-tête (portrait en arche, titre, chapô), citation,
 * sections numérotées, valeurs.
 *
 * Rendue À L'IDENTIQUE par la vitrine (/a-propos) et par l'aperçu du Manager :
 * d'où les règles de ce fichier —
 *   · AUCUN import en `@/…` (l'alias désigne `src` de l'application qui
 *     compile, donc deux fichiers différents) ;
 *   · des adresses d'images DÉJÀ RÉSOLUES, passées par l'appelant ;
 *   · aucun lien de navigation : les appels à l'action sont ceux de la page.
 *
 * Sur téléphone, tout reste mesuré : portrait borné à 220 px, titres sous
 * 2 rem, texte en 15 px — la page se lit, elle ne crie pas.
 */
export interface AboutPageView {
  eyebrow?: string;
  title?: string;
  intro?: string;
  image?: string;
  sections?: { _id?: string; eyebrow?: string; title?: string; text?: string; image?: string }[];
  values?: { _id?: string; title?: string; text?: string }[];
  quote?: string;
}

const muted = { color: 'var(--v-muted-foreground)' } as const;
const accent = { color: 'var(--v-accent)' } as const;
const heading = { fontFamily: 'var(--font-heading)' } as const;
const paragraphs = (text?: string) => String(text || '').split(/\n{2,}/).map((t) => t.trim()).filter(Boolean);

/** Un portrait en arche, cerné d'un filet décalé. */
export function ArchPortrait({ src, alt, className = '' }: { src: string; alt: string; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <div className="absolute -inset-2 rounded-t-full border sm:-inset-2.5" style={{ borderColor: 'color-mix(in srgb, var(--v-accent) 45%, transparent)' }} aria-hidden="true" />
      <img src={src} alt={alt} loading="lazy" className="relative aspect-[4/5] w-full rounded-t-full object-cover" />
    </div>
  );
}

export function AboutContent({ page }: { page: AboutPageView }) {
  const sections = (page.sections || []).filter((s) => s.title?.trim() || s.text?.trim());
  const values = (page.values || []).filter((v) => v.title?.trim());
  return (
    <div data-testid="about-page">
      <header className="mx-auto max-w-6xl px-5 pb-8 pt-6 sm:pb-14 sm:pt-10 md:px-8">
        <div className={`grid items-center gap-8 ${page.image ? 'md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] md:gap-16' : ''}`}>
          <div className={page.image ? 'order-2 text-center md:order-1 md:text-left' : 'mx-auto max-w-3xl text-center'}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={accent}>{page.eyebrow?.trim() || 'À propos'}</p>
            <h1 className="mt-3 text-[1.75rem] font-semibold leading-tight tracking-normal sm:text-4xl md:text-[2.75rem]" style={heading} data-testid="about-title">
              {page.title?.trim() || 'À propos'}
            </h1>
            {paragraphs(page.intro).map((t, i) => (
              <p key={i} className="mx-auto mt-4 max-w-xl text-[15px] leading-7 sm:text-lg sm:leading-8 md:mx-0" style={muted}>{t}</p>
            ))}
            <span className="mx-auto mt-6 block h-px w-12 md:mx-0" style={{ background: 'var(--v-accent)' }} aria-hidden="true" />
          </div>
          {page.image && (
            <ArchPortrait src={page.image} alt={page.title || 'Portrait'} className="order-1 mx-auto w-[min(58vw,220px)] md:order-2 md:w-full md:max-w-[320px]" />
          )}
        </div>
      </header>

      {page.quote?.trim() && (
        <figure className="mx-auto max-w-3xl px-6 py-8 text-center sm:py-12" data-testid="about-quote">
          <span className="mx-auto block text-3xl leading-none sm:text-4xl" style={{ ...heading, ...accent }} aria-hidden="true">“</span>
          <blockquote className="mt-1 text-lg italic leading-snug sm:text-2xl sm:leading-snug" style={heading}>{page.quote}</blockquote>
        </figure>
      )}

      {sections.length > 0 && (
        <div className="mx-auto max-w-5xl px-5 pb-6 md:px-8" data-testid="about-sections">
          {sections.map((s, i) => (
            <article key={s._id || i} className="grid gap-3 border-t py-8 sm:py-11 md:grid-cols-[minmax(0,0.4fr)_minmax(0,0.6fr)] md:gap-12" style={{ borderColor: 'var(--v-border)' }} data-testid="about-section">
              <div>
                <p className="flex items-baseline gap-3 text-[11px] font-semibold uppercase tracking-[0.2em]" style={muted}>
                  <span className="text-sm tracking-normal" style={{ ...heading, ...accent }}>{String(i + 1).padStart(2, '0')}</span>
                  {s.eyebrow}
                </p>
                {s.title?.trim() && <h2 className="mt-2 text-xl font-semibold leading-snug tracking-normal sm:text-2xl" style={heading}>{s.title}</h2>}
              </div>
              <div className="grid gap-4">
                {paragraphs(s.text).map((t, j) => <p key={j} className="text-[15px] leading-7 sm:text-base sm:leading-8" style={muted}>{t}</p>)}
                {s.image && <img src={s.image} alt={s.title || ''} loading="lazy" className="max-h-56 w-full rounded-lg object-cover sm:max-h-80" />}
              </div>
            </article>
          ))}
        </div>
      )}

      {values.length > 0 && (
        <section className="py-10 sm:py-14" style={{ background: 'var(--v-surface)' }} data-testid="about-values">
          <ul className={`mx-auto grid max-w-5xl gap-6 px-5 sm:gap-8 md:px-8 ${values.length >= 3 ? 'sm:grid-cols-3' : values.length === 2 ? 'sm:grid-cols-2' : ''}`}>
            {values.map((v, i) => (
              <li key={v._id || i} className="text-center sm:text-left">
                <span className="mx-auto mb-3 block h-2 w-2 rotate-45 sm:mx-0" style={{ background: 'var(--v-accent)' }} aria-hidden="true" />
                <p className="text-lg font-semibold" style={heading}>{v.title}</p>
                {v.text && <p className="mt-1.5 text-sm leading-6" style={muted}>{v.text}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Une page publiable : activée, et au moins un chapô ou une section (même règle que le serveur). */
export function aboutPageReady(page?: (AboutPageView & { enabled?: boolean }) | null) {
  return Boolean(page && page.enabled !== false && (page.intro?.trim() || (page.sections || []).some((s) => s.title?.trim() || s.text?.trim())));
}
