import * as React from 'react';
import { Award, BookOpen, CalendarClock, Check, ChevronDown, Clock, Coffee, GraduationCap, Infinity as InfinityIcon, Info, ListChecks, MapPin, MessageCircle, Package, Phone, PlayCircle, RefreshCw, Sparkles, UserRound } from 'lucide-react';
import type { CommerceProduct } from '@/lib/api';
import { RichDescription } from '@/components/RichDescription';
import { durationText } from '@/components/CommerceProductCard';

/**
 * LA FICHE STRUCTURÉE (2026-11-13) — ce que la description mélangeait, mis en
 * page : chiffres clés, programme, contenu inclus, infos pratiques, « Bon à
 * savoir ». Pensé pour le TÉLÉPHONE d'abord : peu de hauteur, rien qui oblige
 * à faire défiler pour comprendre l'offre.
 */

type Training = NonNullable<CommerceProduct['training']>;

const ICONS: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  livret: BookOpen, certificat: Award, suivi: MessageCircle, video: PlayCircle, acces: InfinityIcon,
  maj: RefreshCw, appel: Phone, kit: Package, pause: Coffee, etoile: Sparkles,
};

const muted = { color: 'var(--v-muted-foreground)' } as const;
const tint = (pct: number) => `color-mix(in srgb, var(--v-accent) ${pct}%, transparent)`;

/** « 09:00 » → « 9h », « 13:30 » → « 13h30 ». */
const hour = (hhmm: string) => { const [h, m] = String(hhmm || '').split(':'); return h ? `${Number(h)}h${m && m !== '00' ? m : ''}` : ''; };

export function trainingDuration(product: CommerceProduct): string {
  const t = (product.training || {}) as Training;
  if (t.durationLabel) return t.durationLabel;
  if (product.kind === 'DISTANCE_TRAINING') return 'À ton rythme';
  const days = Number(t.durationDays || 0);
  if (!days) return '';
  return days === 1 ? '1 journée' : `${days} jours`;
}

function hoursLabel(t: Training) {
  const first = Array.isArray(t.dayHours) ? t.dayHours[0] : null;
  return first?.start && first?.end ? `${hour(first.start)} – ${hour(first.end)}` : '';
}

/* ── Chiffres clés ─────────────────────────────────────────────────────────── */

export function KeyFacts({ product }: { product: CommerceProduct }) {
  const t = (product.training || {}) as Training;
  const training = product.kind === 'IN_PERSON_TRAINING' || product.kind === 'DISTANCE_TRAINING';
  const facts: { Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; label: string; value: string }[] = [];
  if (training) {
    const duration = trainingDuration(product);
    if (duration) facts.push({ Icon: Clock, label: 'Durée', value: duration });
    facts.push({ Icon: UserRound, label: 'Format', value: t.format || (product.kind === 'DISTANCE_TRAINING' ? 'En ligne' : 'En institut') });
    if (t.level) facts.push({ Icon: GraduationCap, label: 'Niveau', value: t.level });
    if (t.prerequisites || t.program?.length) facts.push({ Icon: ListChecks, label: 'Prérequis', value: t.prerequisites || 'Aucun' });
    if ((t.includes || []).some((i) => i.icon === 'certificat')) facts.push({ Icon: Award, label: 'À la clé', value: 'Certificat' });
  } else if (product.kind === 'SERVICE') {
    if (product.durationMinutes) facts.push({ Icon: Clock, label: 'Durée', value: durationText(product.durationMinutes) });
    if (product.service?.longevity) facts.push({ Icon: Sparkles, label: 'Tenue', value: product.service.longevity });
  }
  if (!facts.length) return null;
  return (
    <dl className="mt-3 grid grid-cols-2 gap-1.5 sm:mt-5 sm:gap-2" data-testid="key-facts">
      {facts.map(({ Icon, label, value }) => (
        <div key={label} className="flex min-w-0 items-center gap-2 rounded-xl px-2.5 py-2" style={{ background: tint(8) }} data-testid="key-fact">
          <Icon className="h-4 w-4 shrink-0" style={{ color: 'var(--v-accent)' }} />
          <div className="min-w-0">
            <dt className="text-[9.5px] font-semibold uppercase tracking-[0.14em]" style={muted}>{label}</dt>
            <dd className="text-[13px] font-semibold leading-tight sm:text-sm">{value}</dd>
          </div>
        </div>
      ))}
    </dl>
  );
}

/* ── Titre de section ──────────────────────────────────────────────────────── */

function SectionTitle({ eyebrow, children }: { eyebrow: string; children: React.ReactNode }) {
  return (
    <div className="mb-2.5">
      <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em]" style={{ color: 'var(--v-accent)' }}>
        <span className="h-px w-5" style={{ background: 'var(--v-accent)' }} aria-hidden /> {eyebrow}
      </p>
      <h2 className="mt-1 text-lg font-semibold leading-tight sm:text-xl" style={{ fontFamily: 'var(--font-heading)' }}>{children}</h2>
    </div>
  );
}

/* ── Description ───────────────────────────────────────────────────────────── */

/**
 * LA DESCRIPTION — une carte douce aux couleurs de l'institut, ornée, plutôt
 * qu'un bloc de texte gris. Repliée à quelques lignes sur téléphone, avec
 * « Lire la suite » : l'essentiel d'abord, le détail sur demande.
 */
export function DescriptionCard({ product }: { product: CommerceProduct }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const [long, setLong] = React.useState(false);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (el) setLong(el.scrollHeight > 190);
  }, [product.description]);
  if (!product.description?.trim()) return null;
  const label = product.kind === 'SERVICE' ? 'La prestation' : product.kind === 'GIFT_CARD' ? 'La carte cadeau' : 'La formation';
  return (
    <section className="relative mt-5 overflow-hidden rounded-2xl p-4 sm:p-5" style={{ background: `linear-gradient(160deg, ${tint(10)}, ${tint(3)} 55%, transparent)`, border: `1px solid ${tint(22)}` }} data-testid="description-card">
      <Sparkles className="pointer-events-none absolute -right-3 -top-3 h-16 w-16 opacity-[0.08]" style={{ color: 'var(--v-accent)' }} aria-hidden />
      <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em]" style={{ color: 'var(--v-accent)' }}>
        <span className="grid h-5 w-5 place-items-center rounded-full" style={{ background: tint(16) }}><Sparkles className="h-3 w-3" /></span> {label}
      </p>
      <div ref={ref} className="relative mt-2.5 overflow-hidden transition-[max-height] duration-300" style={{ maxHeight: open || !long ? 'none' : 190 }}>
        <RichDescription value={product.description} className="v-description text-[13.5px] leading-6 sm:text-[15px] sm:leading-7" />
        {long && !open && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14" style={{ background: 'linear-gradient(to bottom, transparent, color-mix(in srgb, var(--v-surface) 96%, transparent))' }} />}
      </div>
      {long && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--v-accent)' }} data-testid="description-toggle">
          {open ? 'Réduire' : 'Lire la suite'} <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      )}
    </section>
  );
}

/* ── Programme ─────────────────────────────────────────────────────────────── */

/**
 * LE PROGRAMME — plusieurs parties (« Cil à cil », « Volume russe ») : un
 * sélecteur, une partie à la fois — la hauteur reste celle d'UNE liste. Une
 * longue liste montre ses six premiers points, puis « Tout le programme ».
 */
export function ProgramSection({ product }: { product: CommerceProduct }) {
  const program = (product.training?.program || []).filter((s) => s.items?.length);
  const [active, setActive] = React.useState(0);
  const [all, setAll] = React.useState(false);
  if (!program.length) return null;
  const section = program[Math.min(active, program.length - 1)];
  const total = program.reduce((n, s) => n + s.items.length, 0);
  const shown = all ? section.items : section.items.slice(0, 6);
  return (
    <section className="mt-6" data-testid="program">
      <SectionTitle eyebrow="Au programme">{program.length > 1 ? `${program.length} techniques, ${total} étapes` : `${total} étapes clés`}</SectionTitle>
      {program.length > 1 && (
        <div className="no-scrollbar -mx-1 mb-2.5 flex gap-1.5 overflow-x-auto px-1" role="tablist">
          {program.map((s, i) => (
            <button key={`${s.title}-${i}`} type="button" role="tab" aria-selected={i === active} onClick={() => { setActive(i); setAll(false); }}
              className="shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition"
              style={i === active ? { background: 'var(--v-accent)', borderColor: 'var(--v-accent)', color: '#111' } : { borderColor: 'var(--v-border)' }}
              data-testid="program-tab">
              {s.title || `Partie ${i + 1}`}
            </button>
          ))}
        </div>
      )}
      <ol className="grid gap-1.5">
        {shown.map((item, i) => (
          <li key={`${item}-${i}`} className="flex items-start gap-2.5 text-[13.5px] leading-snug sm:text-sm" data-testid="program-item">
            <span className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold tabular-nums" style={{ background: tint(14), color: 'var(--v-foreground)' }}>{i + 1}</span>
            <span>{item}</span>
          </li>
        ))}
      </ol>
      {section.items.length > 6 && (
        <button type="button" onClick={() => setAll((a) => !a)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--v-accent)' }}>
          {all ? 'Réduire' : `Tout le programme (${section.items.length})`} <ChevronDown className={`h-3.5 w-3.5 transition-transform ${all ? 'rotate-180' : ''}`} />
        </button>
      )}
    </section>
  );
}

/* ── Contenu inclus ────────────────────────────────────────────────────────── */

export function IncludesSection({ product }: { product: CommerceProduct }) {
  const includes = product.training?.includes || [];
  if (!includes.length) return null;
  return (
    <section className="mt-6" data-testid="includes">
      <SectionTitle eyebrow="Inclus">{product.kind === 'DISTANCE_TRAINING' ? 'Ta formation comprend' : 'La formation comprend'}</SectionTitle>
      <ul className="grid grid-cols-2 gap-1.5 sm:gap-2">
        {includes.map((item, i) => {
          const Icon = ICONS[item.icon] || Sparkles;
          return (
            <li key={`${item.label}-${i}`} className="flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-[12.5px] font-medium leading-tight sm:text-[13px]" style={{ borderColor: tint(25) }} data-testid="include-item">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full" style={{ background: tint(12) }}><Icon className="h-3.5 w-3.5" style={{ color: 'var(--v-accent)' }} /></span>
              <span className="min-w-0">{item.label}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ── Infos pratiques (formation en institut) ───────────────────────────────── */

function Fold({ icon: Icon, title, children, testId }: { icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; title: string; children: React.ReactNode; testId: string }) {
  return (
    <details className="group border-b py-2.5 last:border-b-0" style={{ borderColor: 'var(--v-border)' }} data-testid={testId}>
      <summary className="flex cursor-pointer list-none items-center gap-2.5 text-sm font-semibold">
        <Icon className="h-4 w-4 shrink-0" style={{ color: 'var(--v-accent)' }} />
        <span className="flex-1">{title}</span>
        <ChevronDown className="h-4 w-4 shrink-0 transition group-open:rotate-180" style={muted} />
      </summary>
      <div className="mt-2 whitespace-pre-line pl-[26px] text-[13px] leading-6" style={muted}>{children}</div>
    </details>
  );
}

export function PracticalInfo({ product }: { product: CommerceProduct }) {
  if (product.kind !== 'IN_PERSON_TRAINING') return null;
  const t = (product.training || {}) as Training;
  const hours = hoursLabel(t);
  const where = [t.location, hours ? `Horaires : ${hours}` : ''].filter(Boolean).join('\n');
  if (!where && !t.formalities && !t.cancellationPolicy) return null;
  return (
    <section className="mt-6" data-testid="practical">
      <SectionTitle eyebrow="Infos pratiques">Avant de venir</SectionTitle>
      <div className="rounded-xl border px-3" style={{ borderColor: 'var(--v-border)' }}>
        {where && <Fold icon={MapPin} title="Lieu & horaires" testId="practical-where">{where}</Fold>}
        {t.formalities && <Fold icon={CalendarClock} title="À prévoir" testId="practical-bring">{t.formalities.replace(/^📋[^\n]*\n+/, '')}</Fold>}
        {t.cancellationPolicy && <Fold icon={Info} title="Conditions d’annulation" testId="practical-cancel">{t.cancellationPolicy.replace(/^Politique d’annulation\s*\n+/, '')}</Fold>}
      </div>
    </section>
  );
}

/* ── Bon à savoir ──────────────────────────────────────────────────────────── */

export function GoodToKnow({ product }: { product: CommerceProduct }) {
  const lines = (product.additionalInfo || []).filter(Boolean);
  if (!lines.length) return null;
  return (
    <section className="mt-6 rounded-xl px-3.5 py-3" style={{ background: 'color-mix(in srgb, var(--v-foreground) 4%, transparent)' }} data-testid="good-to-know">
      <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em]" style={muted}>
        <Info className="h-3.5 w-3.5" /> Bon à savoir
      </p>
      <ul className="mt-2 grid gap-1.5">
        {lines.map((line, i) => (
          <li key={`${line}-${i}`} className="flex items-start gap-2 text-[13px] leading-snug" data-testid="good-to-know-item">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: 'var(--v-accent)' }} />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
