import * as React from 'react';

/**
 * LES TONS DES ÉDITEURS — une couleur par NATURE de bloc.
 *
 * Dans les éditeurs de formation et de prestation, tout était carte blanche
 * sur fond blanc : une fois entré dans un module, puis dans une vidéo, rien
 * ne disait plus où l'on se trouvait. Chaque nature de bloc porte désormais sa
 * teinte — en-tête, liseré, fond léger — et la garde partout où elle apparaît :
 * une vidéo est fuchsia dans la liste du module comme dans son propre éditeur.
 *
 * Les classes sont écrites EN ENTIER (jamais `bg-${couleur}-50`) : Tailwind ne
 * génère que les classes qu'il lit littéralement dans les sources.
 */
export type EditorTone =
  | 'infos'
  | 'social'
  | 'faq'
  | 'modules'
  | 'module'
  | 'video'
  | 'file'
  | 'sessions'
  | 'promotion'
  | 'boost'
  | 'options'
  | 'evaluation'
  | 'question'
  | 'deliverable'
  | 'payment'
  | 'photos'
  | 'advanced';

interface ToneClasses {
  /** Liseré et bordure du bloc. */
  border: string;
  /** En-tête du bloc. */
  head: string;
  /** Fond du corps, très léger. */
  body: string;
  /** Pastille de repère dans l'en-tête. */
  dot: string;
  /** Onglet actif qui ouvre ce bloc. */
  tab: string;
}

const TONES: Record<EditorTone, ToneClasses> = {
  infos: { border: 'border-sky-200 dark:border-sky-900', head: 'bg-sky-100/80 text-sky-950 dark:bg-sky-950/60 dark:text-sky-100', body: 'bg-sky-50/40 dark:bg-sky-950/10', dot: 'bg-sky-500', tab: 'bg-sky-600 text-white' },
  social: { border: 'border-green-200 dark:border-green-900', head: 'bg-green-100/80 text-green-950 dark:bg-green-950/60 dark:text-green-100', body: 'bg-green-50/40 dark:bg-green-950/10', dot: 'bg-green-500', tab: 'bg-green-600 text-white' },
  faq: { border: 'border-lime-200 dark:border-lime-900', head: 'bg-lime-100/80 text-lime-950 dark:bg-lime-950/60 dark:text-lime-100', body: 'bg-lime-50/40 dark:bg-lime-950/10', dot: 'bg-lime-500', tab: 'bg-lime-600 text-white' },
  modules: { border: 'border-violet-200 dark:border-violet-900', head: 'bg-violet-100/80 text-violet-950 dark:bg-violet-950/60 dark:text-violet-100', body: 'bg-violet-50/40 dark:bg-violet-950/10', dot: 'bg-violet-500', tab: 'bg-violet-600 text-white' },
  module: { border: 'border-indigo-200 dark:border-indigo-900', head: 'bg-indigo-100/80 text-indigo-950 dark:bg-indigo-950/60 dark:text-indigo-100', body: 'bg-indigo-50/40 dark:bg-indigo-950/10', dot: 'bg-indigo-500', tab: 'bg-indigo-600 text-white' },
  video: { border: 'border-fuchsia-200 dark:border-fuchsia-900', head: 'bg-fuchsia-100/80 text-fuchsia-950 dark:bg-fuchsia-950/60 dark:text-fuchsia-100', body: 'bg-fuchsia-50/40 dark:bg-fuchsia-950/10', dot: 'bg-fuchsia-500', tab: 'bg-fuchsia-600 text-white' },
  file: { border: 'border-cyan-200 dark:border-cyan-900', head: 'bg-cyan-100/80 text-cyan-950 dark:bg-cyan-950/60 dark:text-cyan-100', body: 'bg-cyan-50/40 dark:bg-cyan-950/10', dot: 'bg-cyan-500', tab: 'bg-cyan-600 text-white' },
  sessions: { border: 'border-emerald-200 dark:border-emerald-900', head: 'bg-emerald-100/80 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-100', body: 'bg-emerald-50/40 dark:bg-emerald-950/10', dot: 'bg-emerald-500', tab: 'bg-emerald-600 text-white' },
  promotion: { border: 'border-amber-200 dark:border-amber-900', head: 'bg-amber-100/80 text-amber-950 dark:bg-amber-950/60 dark:text-amber-100', body: 'bg-amber-50/40 dark:bg-amber-950/10', dot: 'bg-amber-500', tab: 'bg-amber-600 text-white' },
  boost: { border: 'border-rose-200 dark:border-rose-900', head: 'bg-rose-100/80 text-rose-950 dark:bg-rose-950/60 dark:text-rose-100', body: 'bg-rose-50/40 dark:bg-rose-950/10', dot: 'bg-rose-500', tab: 'bg-rose-600 text-white' },
  options: { border: 'border-teal-200 dark:border-teal-900', head: 'bg-teal-100/80 text-teal-950 dark:bg-teal-950/60 dark:text-teal-100', body: 'bg-teal-50/40 dark:bg-teal-950/10', dot: 'bg-teal-500', tab: 'bg-teal-600 text-white' },
  evaluation: { border: 'border-blue-200 dark:border-blue-900', head: 'bg-blue-100/80 text-blue-950 dark:bg-blue-950/60 dark:text-blue-100', body: 'bg-blue-50/40 dark:bg-blue-950/10', dot: 'bg-blue-500', tab: 'bg-blue-600 text-white' },
  question: { border: 'border-indigo-200 dark:border-indigo-900', head: 'bg-indigo-100/80 text-indigo-950 dark:bg-indigo-950/60 dark:text-indigo-100', body: 'bg-indigo-50/40 dark:bg-indigo-950/10', dot: 'bg-indigo-500', tab: 'bg-indigo-600 text-white' },
  deliverable: { border: 'border-orange-200 dark:border-orange-900', head: 'bg-orange-100/80 text-orange-950 dark:bg-orange-950/60 dark:text-orange-100', body: 'bg-orange-50/40 dark:bg-orange-950/10', dot: 'bg-orange-500', tab: 'bg-orange-600 text-white' },
  payment: { border: 'border-emerald-200 dark:border-emerald-900', head: 'bg-emerald-100/80 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-100', body: 'bg-emerald-50/40 dark:bg-emerald-950/10', dot: 'bg-emerald-500', tab: 'bg-emerald-600 text-white' },
  photos: { border: 'border-pink-200 dark:border-pink-900', head: 'bg-pink-100/80 text-pink-950 dark:bg-pink-950/60 dark:text-pink-100', body: 'bg-pink-50/40 dark:bg-pink-950/10', dot: 'bg-pink-500', tab: 'bg-pink-600 text-white' },
  advanced: { border: 'border-slate-300 dark:border-slate-700', head: 'bg-slate-100 text-slate-900 dark:bg-slate-900 dark:text-slate-100', body: 'bg-slate-50/60 dark:bg-slate-900/20', dot: 'bg-slate-500', tab: 'bg-slate-700 text-white' },
};

export function toneTabClass(tone: EditorTone, active: boolean) {
  return active ? TONES[tone].tab : 'text-muted-foreground hover:bg-muted';
}

/**
 * UN BLOC D'ÉDITION teinté : en-tête coloré, liseré, fond léger.
 * `level="nested"` pour un bloc DANS un bloc (liseré gauche plus marqué).
 */
export function ToneSection({
  tone,
  title,
  description,
  icon,
  actions,
  children,
  level = 'main',
  className = '',
}: {
  tone: EditorTone;
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  level?: 'main' | 'nested';
  className?: string;
}) {
  const t = TONES[tone];
  return (
    <section
      data-tone={tone}
      className={`min-w-0 overflow-hidden rounded-xl border ${t.border} ${level === 'nested' ? 'border-l-4' : 'shadow-sm'} bg-card ${className}`}
    >
      <header className={`flex flex-wrap items-center justify-between gap-3 border-b ${t.border} ${t.head} px-4 py-3`}>
        <div className="flex min-w-0 items-start gap-3">
          <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${t.dot}`} aria-hidden="true" />
          <div className="min-w-0">
            <h2 className={`${level === 'main' ? 'text-lg' : 'text-base'} inline-flex items-center gap-2 font-semibold`}>{icon}{title}</h2>
            {description && <p className="mt-0.5 text-sm opacity-80">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </header>
      {children !== undefined && <div className={`grid gap-4 p-3 sm:p-4 ${t.body}`}>{children}</div>}
    </section>
  );
}
