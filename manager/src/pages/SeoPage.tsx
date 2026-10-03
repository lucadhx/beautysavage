import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, Bot, Building, CheckCircle2, ExternalLink, Globe2, Image as ImageIcon, Link2,
  MapPin, Plus, Search, Tag, Trash2, XCircle,
} from 'lucide-react';
import { api, type SeoDiagnostic, type SeoSettings } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, Field, Input, Switch, Textarea } from '@/components/ui/primitives';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { ImageUpload } from '@/components/fields/ImageUpload';
import { FloatingSaveWidget } from '@/components/ui/FloatingSaveWidget';
import { useFloatingSave } from '@/hooks/useFloatingSave';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { Skeleton } from '@/components/ui/Skeleton';

/**
 * RÉFÉRENCEMENT — SEO (Google, Bing) et GEO (ChatGPT, Claude, Perplexity…).
 *
 * Le référencement du site est AUTOMATIQUE : chaque page compose son titre, sa
 * description, ses données structurées et le plan du site à partir de ce que
 * le Manager publie. Cet écran porte ce qu'aucune autre fiche ne sait
 * (adresse structurée, type d'établissement, profils externes…) et dit, à
 * partir des données réelles, ce qui manque encore.
 */

const EMPTY: SeoSettings = {
  indexable: true,
  businessType: 'BeautySalon',
  homeTitle: '',
  homeDescription: '',
  address: { street: '', postalCode: '', city: '', region: '', country: 'FR' },
  geo: { latitude: null, longitude: null },
  areaServed: '',
  priceRange: '',
  sameAs: [],
  shareImage: '',
};

function normalize(doc: Partial<SeoSettings>): SeoSettings {
  return {
    ...EMPTY,
    ...doc,
    address: { ...EMPTY.address, ...(doc.address || {}) },
    geo: { ...EMPTY.geo, ...(doc.geo || {}) },
    sameAs: Array.isArray(doc.sameAs) ? doc.sameAs : [],
  };
}

export function GooglePreview({ url, title, description }: { url: string; title: string; description: string }) {
  const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);
  return (
    <div className="rounded-lg border bg-white p-4 text-left shadow-sm dark:bg-card" data-testid="google-preview">
      <p className="truncate text-xs text-emerald-800 dark:text-emerald-400">{url}</p>
      <p className="mt-0.5 line-clamp-1 text-lg leading-snug text-[#1a0dab] dark:text-sky-300">{clip(title, 65)}</p>
      <p className="mt-1 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{clip(description, 160)}</p>
    </div>
  );
}

function LengthHint({ value, ideal }: { value: string; ideal: [number, number] }) {
  const n = value.length;
  const tone = n === 0 ? 'text-muted-foreground' : n < ideal[0] ? 'text-amber-600' : n > ideal[1] ? 'text-amber-600' : 'text-emerald-600';
  return <span className={`text-[11px] tabular-nums ${tone}`}>{n} / {ideal[1]} signes{n === 0 ? ' · automatique' : ''}</span>;
}

export default function SeoPage() {
  const [settings, setSettings] = React.useState<SeoSettings | null>(null);
  const [diag, setDiag] = React.useState<SeoDiagnostic | null>(null);
  const [error, setError] = React.useState('');
  // Premier diagnostic en vol : « Diagnostic indisponible » n'est dit qu'une fois la réponse (ou l'échec) reçue.
  const [diagLoading, setDiagLoading] = React.useState(true);

  const loadDiag = React.useCallback(() => {
    api.seoDiagnostic().then(setDiag).catch(() => setDiag(null)).finally(() => setDiagLoading(false));
  }, []);

  React.useEffect(() => {
    api.getSeoSettings().then((doc) => setSettings(normalize(doc))).catch((err) => setError(err instanceof Error ? err.message : 'Chargement impossible'));
    loadDiag();
  }, [loadDiag]);

  const { state, save } = useFloatingSave<SeoSettings>(settings, async () => {
    const saved = normalize(await api.updateSeoSettings({ ...settings!, sameAs: settings!.sameAs.map((u) => u.trim()).filter(Boolean) }));
    setSettings(saved);
    loadDiag();
    return saved;
  });

  const set = <K extends keyof SeoSettings>(key: K, value: SeoSettings[K]) => setSettings((s) => (s ? { ...s, [key]: value } : s));
  const setAddress = (key: keyof SeoSettings['address'], value: string) => setSettings((s) => (s ? { ...s, address: { ...s.address, [key]: value } } : s));

  if (error) return <div className="p-6 text-sm text-destructive">{error}</div>;
  if (!settings) return <div className="mx-auto w-full max-w-5xl p-4 md:p-6"><BrandLoader variant="form" /></div>;

  const previewTitle = settings.homeTitle || diag?.preview.title || '';
  const previewDescription = settings.homeDescription || diag?.preview.description || '';
  const checks = diag?.checks || [];
  const diagPending = diagLoading && !diag;
  const actionOf = (action?: string) => (action && action !== 'settings' ? action : null);

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 p-4 md:p-6" data-testid="seo-page">
      <PageHeader
        title="Référencement"
        description="Google, Bing et les assistants IA (ChatGPT, Claude, Perplexity). Titres, descriptions, données structurées et plan du site sont générés automatiquement à partir de vos offres, avis et horaires : ils suivent chaque modification."
      />

      {/* ── Diagnostic ── */}
      <section className="grid gap-4 rounded-xl border bg-card p-4 md:grid-cols-[180px_1fr]" data-testid="seo-diagnostic">
        <div className="flex flex-col items-center justify-center rounded-lg bg-muted/30 p-4 text-center">
          {diagPending ? <Skeleton className="h-10 w-20" /> : <p className="text-4xl font-bold tabular-nums">{diag ? `${diag.score}%` : '—'}</p>}
          <p className="mt-1 text-xs text-muted-foreground">des points au vert</p>
          {diag && (
            <p className="mt-3 text-xs text-muted-foreground">{diag.counts.products} offres · {diag.counts.pages} pages · {diag.counts.reviews} avis</p>
          )}
        </div>
        <ul className="grid gap-1.5">
          {checks.map((c) => (
            <li key={c.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/40" data-level={c.level}>
              {c.level === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : c.level === 'warning' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />}
              <span className="min-w-0 flex-1">
                <span className="font-medium">{c.label}</span>
                <span className="block text-xs text-muted-foreground">{c.detail}</span>
              </span>
              {c.level !== 'ok' && actionOf(c.action) && <Link to={actionOf(c.action)!} className="shrink-0 text-xs font-semibold text-primary hover:underline">Corriger</Link>}
            </li>
          ))}
          {diagPending && Array.from({ length: 5 }, (_, i) => (
            <li key={i} aria-hidden className="flex items-start gap-2 px-2 py-1.5">
              <Skeleton className="mt-0.5 h-4 w-4 shrink-0 rounded-full" />
              <span className="grid min-w-0 flex-1 gap-1.5">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-3/5" />
              </span>
            </li>
          ))}
          {!diag && !diagPending && <li className="text-sm text-muted-foreground">Diagnostic indisponible.</li>}
        </ul>
      </section>

      {diag?.urls.site && (
        <section className="flex flex-wrap gap-2 text-sm">
          {[
            ['Plan du site', diag.urls.sitemap],
            ['robots.txt', diag.urls.robots],
            ['llms.txt (assistants IA)', diag.urls.llms],
          ].map(([label, href]) => (
            <a key={href} href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 font-medium hover:bg-muted">
              <ExternalLink className="h-3.5 w-3.5" /> {label}
            </a>
          ))}
        </section>
      )}

      {/* ── Accueil ── */}
      <section className="grid gap-4 rounded-xl border bg-card p-4">
        <h2 className="inline-flex items-center gap-2 text-lg font-semibold"><Search className="h-5 w-5 text-muted-foreground" /> Page d’accueil dans Google</h2>
        <GooglePreview url={diag?.preview.url || ''} title={previewTitle} description={previewDescription} />
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Titre" icon={<Tag />} hint="Laissez vide : « Nom · accroche » est utilisé.">
            <Input value={settings.homeTitle} maxLength={120} onChange={(e) => set('homeTitle', e.target.value)} placeholder={diag?.preview.title} />
          </Field>
          <div className="flex items-end justify-end pb-6"><LengthHint value={settings.homeTitle} ideal={[30, 65]} /></div>
          <Field label="Description" className="md:col-span-2" hint="Laissez vide : l’accroche et l’introduction de l’accueil sont utilisées.">
            <Textarea value={settings.homeDescription} maxLength={320} onChange={(e) => set('homeDescription', e.target.value)} placeholder={diag?.preview.description} />
          </Field>
          <div className="-mt-3 flex justify-end md:col-span-2"><LengthHint value={settings.homeDescription} ideal={[110, 160]} /></div>
        </div>
      </section>

      {/* ── Établissement ── */}
      <section className="grid gap-4 rounded-xl border bg-card p-4">
        <div>
          <h2 className="inline-flex items-center gap-2 text-lg font-semibold"><Building className="h-5 w-5 text-muted-foreground" /> L’établissement</h2>
          <p className="text-sm text-muted-foreground">Ce que Google Maps et les assistants IA utilisent pour recommander un institut « près de chez moi ». Doit correspondre à votre fiche Google Business Profile.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Type d’établissement" icon={<Building />}>
            <CustomSelect
              value={settings.businessType}
              onChange={(value) => set('businessType', value as SeoSettings['businessType'])}
              options={[
                { value: 'BeautySalon', label: 'Institut de beauté' },
                { value: 'NailSalon', label: 'Onglerie' },
                { value: 'DaySpa', label: 'Spa' },
                { value: 'HealthAndBeautyBusiness', label: 'Santé et beauté (autre)' },
              ]}
            />
          </Field>
          <Field label="Gamme de prix" unit="€ à €€€€" icon={<Tag />}>
            <CustomSelect
              value={settings.priceRange || 'none'}
              onChange={(value) => set('priceRange', value === 'none' ? '' : value)}
              options={[
                { value: 'none', label: 'Non précisée' },
                { value: '€', label: '€ — abordable' },
                { value: '€€', label: '€€ — intermédiaire' },
                { value: '€€€', label: '€€€ — haut de gamme' },
                { value: '€€€€', label: '€€€€ — luxe' },
              ]}
            />
          </Field>
          <Field label="Rue" icon={<MapPin />} className="md:col-span-2">
            <Input value={settings.address.street} onChange={(e) => setAddress('street', e.target.value)} placeholder="12 rue de France" />
          </Field>
          <Field label="Code postal"><Input value={settings.address.postalCode} onChange={(e) => setAddress('postalCode', e.target.value)} placeholder="06000" /></Field>
          <Field label="Ville"><Input value={settings.address.city} onChange={(e) => setAddress('city', e.target.value)} placeholder="Nice" /></Field>
          <Field label="Zone desservie" icon={<Globe2 />} hint="Utilisée dans les titres et les données structurées." className="md:col-span-2">
            <Input value={settings.areaServed} onChange={(e) => set('areaServed', e.target.value)} placeholder="Nice et alentours" />
          </Field>
          <Field label="Latitude" unit="facultatif">
            <Input type="number" step="0.000001" value={settings.geo.latitude ?? ''} onChange={(e) => set('geo', { ...settings.geo, latitude: e.target.value === '' ? null : Number(e.target.value) })} placeholder="43.7009" />
          </Field>
          <Field label="Longitude" unit="facultatif">
            <Input type="number" step="0.000001" value={settings.geo.longitude ?? ''} onChange={(e) => set('geo', { ...settings.geo, longitude: e.target.value === '' ? null : Number(e.target.value) })} placeholder="7.2683" />
          </Field>
        </div>
      </section>

      {/* ── Profils externes ── */}
      <section className="grid gap-3 rounded-xl border bg-card p-4">
        <div>
          <h2 className="inline-flex items-center gap-2 text-lg font-semibold"><Link2 className="h-5 w-5 text-muted-foreground" /> Profils externes</h2>
          <p className="text-sm text-muted-foreground">Fiche Google Business Profile, Facebook, TikTok, Planity… Ces liens prouvent aux moteurs et aux IA que ces pages décrivent le même institut. Instagram et LinkedIn activés dans Coordonnées sont repris automatiquement.</p>
        </div>
        {settings.sameAs.map((url, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input value={url} onChange={(e) => set('sameAs', settings.sameAs.map((u, i) => (i === index ? e.target.value : u)))} placeholder="https://g.page/…" aria-label={`Profil ${index + 1}`} />
            <Button type="button" size="icon" variant="ghost" aria-label="Retirer ce profil" onClick={() => set('sameAs', settings.sameAs.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        <Button type="button" variant="outline" className="justify-self-start" onClick={() => set('sameAs', [...settings.sameAs, ''])} disabled={settings.sameAs.length >= 12}>
          <Plus className="h-4 w-4" /> Ajouter un profil
        </Button>
      </section>

      {/* ── Partage et indexation ── */}
      <section className="grid gap-4 rounded-xl border bg-card p-4 md:grid-cols-2">
        <div className="grid content-start gap-2">
          <h2 className="inline-flex items-center gap-2 text-lg font-semibold"><ImageIcon className="h-5 w-5 text-muted-foreground" /> Image de partage</h2>
          <p className="text-sm text-muted-foreground">Affichée quand un lien du site est partagé (WhatsApp, Instagram, Facebook…). Sans image, la bannière de l’accueil est utilisée ; chaque offre partage sa propre photo.</p>
          <ImageUpload value={settings.shareImage} mediaType="commerce-cover" aspect="aspect-[1.91/1]" hint="Format conseillé : 1200 × 630 px." onChange={(url) => set('shareImage', url)} />
          {settings.shareImage && <button type="button" className="justify-self-start text-xs font-semibold text-muted-foreground" onClick={() => set('shareImage', '')}>Retirer l’image</button>}
        </div>
        <div className="grid content-start gap-3">
          <h2 className="inline-flex items-center gap-2 text-lg font-semibold"><Bot className="h-5 w-5 text-muted-foreground" /> Indexation</h2>
          <label className="flex items-start gap-3 rounded-lg border p-3">
            <Switch checked={settings.indexable} onChange={(v) => set('indexable', v)} label="Autoriser l’indexation" />
            <span className="text-sm">
              <span className="font-semibold">{settings.indexable ? 'Site visible des moteurs et des assistants IA' : 'Site masqué des moteurs'}</span>
              <span className="block text-xs text-muted-foreground">À ne désactiver que pour un site en préparation : toutes les pages passent en « noindex » et le robots.txt ferme l’accès.</span>
            </span>
          </label>
          <p className="rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground">
            Les robots des assistants IA (GPTBot, ClaudeBot, PerplexityBot, Google-Extended…) sont explicitement autorisés : vos pages publiques peuvent être lues, citées et recommandées dans leurs réponses. L’espace client et le panier restent fermés.
          </p>
        </div>
      </section>

      <FloatingSaveWidget state={state} onSave={save} />
    </div>
  );
}
