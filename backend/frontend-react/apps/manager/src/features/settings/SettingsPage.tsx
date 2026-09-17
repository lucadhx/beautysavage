// Paramètres (admin + dev) : identité du site (nom + logo), page d'accueil (bannière + slogan),
// et accès à l'éditeur de thème vitrine. Mobile-first, icônes Bootstrap, feedback explicite.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LoadingState, ErrorState, Button, FormField, TextInput } from '@bs/ui';
import {
  ApiError,
  resolveMediaUrl,
  getManagerSiteIdentity, uploadTempSiteLogo, saveSiteIdentity,
  getHomeHeroSettings, uploadTempHomeAsset, saveHomeHero,
} from '@bs/api-client';
import './settings.css';

type AssetSource = 'upload' | 'url' | 'none';

function errMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message || 'Enregistrement impossible.';
  return 'Enregistrement impossible.';
}

/** Sélecteur d'image réutilisable (logo / bannière) : upload, URL ou aucune, avec aperçu. */
function ImageField({
  source, onSource, urlValue, onUrl, onPickFile, uploading, previewUrl, uploadHint,
}: {
  source: AssetSource;
  onSource: (s: AssetSource) => void;
  urlValue: string;
  onUrl: (v: string) => void;
  onPickFile: (file: File) => void;
  uploading: boolean;
  previewUrl: string | null;
  uploadHint?: ReactNode;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const SEG: { value: AssetSource; label: string; icon: string }[] = [
    { value: 'upload', label: 'Fichier', icon: 'bi-upload' },
    { value: 'url', label: 'Lien', icon: 'bi-link-45deg' },
    { value: 'none', label: 'Aucune', icon: 'bi-slash-circle' },
  ];
  return (
    <div className="set-asset">
      <div className="set-asset__preview" aria-hidden={previewUrl ? undefined : true}>
        {previewUrl ? <img src={previewUrl} alt="" /> : <i className="bi bi-image" />}
      </div>
      <div className="set-asset__controls">
        <div className="set-seg" role="group" aria-label="Source de l'image">
          {SEG.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`set-seg__btn${source === o.value ? ' set-seg__btn--on' : ''}`}
              aria-pressed={source === o.value}
              onClick={() => onSource(o.value)}
            >
              <i className={`bi ${o.icon}`} aria-hidden="true" /> {o.label}
            </button>
          ))}
        </div>

        {source === 'upload' ? (
          <div className="set-asset__upload">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="set-visually-hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickFile(f); e.target.value = ''; }}
            />
            <Button type="button" variant="secondary" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? <><span className="set-spin" aria-hidden="true" /> Envoi…</> : <><i className="bi bi-upload" aria-hidden="true" /> Choisir un fichier</>}
            </Button>
            {uploadHint ? <p className="set-hint">{uploadHint}</p> : null}
          </div>
        ) : null}

        {source === 'url' ? (
          <TextInput value={urlValue} onChange={(e) => onUrl(e.target.value)} placeholder="https://…" aria-label="URL de l'image" />
        ) : null}
      </div>
    </div>
  );
}

function IdentityCard() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['settings', 'identity'], queryFn: ({ signal }) => getManagerSiteIdentity(signal) });
  const [siteName, setSiteName] = useState('');
  const [source, setSource] = useState<AssetSource>('none');
  const [urlValue, setUrlValue] = useState('');
  const [tempId, setTempId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!query.data) return;
    const d = query.data;
    setSiteName(d.siteName);
    setSource(d.logoType === 'upload' ? 'upload' : d.logoType === 'url' ? 'url' : 'none');
    setUrlValue(d.logoType === 'url' ? (d.logoUrl ?? '') : '');
    setTempId(null);
    setPreview(d.logoUrlResolved ? resolveMediaUrl(d.logoUrlResolved) : null);
  }, [query.data]);

  const upload = useMutation({
    mutationFn: (file: File) => uploadTempSiteLogo(file),
    onSuccess: (res) => { setTempId(res.tempLogoId); setPreview(resolveMediaUrl(res.tempLogoUrl)); setFeedback(null); },
    onError: (e) => setFeedback({ tone: 'error', text: errMessage(e) }),
  });
  const save = useMutation({
    mutationFn: () => saveSiteIdentity({
      siteName: siteName.trim() || 'Beauty Savage',
      logoType: source === 'none' ? null : source,
      logoUrl: source === 'url' ? urlValue.trim() : undefined,
      tempLogoId: source === 'upload' ? tempId : undefined,
    }),
    onSuccess: (d) => {
      setFeedback({ tone: 'success', text: 'Identité enregistrée.' });
      qc.setQueryData(['settings', 'identity'], d);
      void qc.invalidateQueries({ queryKey: ['home'] });
    },
    onError: (e) => setFeedback({ tone: 'error', text: errMessage(e) }),
  });

  if (query.status === 'pending') return <section className="set-card"><LoadingState label="Chargement…" /></section>;
  if (query.status === 'error') return <section className="set-card"><ErrorState title="Identité indisponible." /></section>;

  const previewUrl = source === 'url' ? (urlValue.trim() ? resolveMediaUrl(urlValue.trim()) : null) : source === 'none' ? null : preview;

  return (
    <section className="set-card">
      <header className="set-card__head">
        <span className="set-card__ic"><i className="bi bi-fonts" aria-hidden="true" /></span>
        <div>
          <h2 className="set-card__title">Identité du site</h2>
          <p className="set-card__sub">Nom de l'institut et logo affichés sur le site.</p>
        </div>
      </header>
      <FormField label="Nom de l'institut">
        <TextInput value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="Beauty Savage" />
      </FormField>
      <FormField label="Logo">
        <ImageField
          source={source} onSource={setSource}
          urlValue={urlValue} onUrl={setUrlValue}
          onPickFile={(f) => upload.mutate(f)} uploading={upload.isPending}
          previewUrl={previewUrl}
          uploadHint="PNG, JPG ou WEBP, 2 Mo max."
        />
      </FormField>
      <div className="set-card__foot">
        <Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? <><span className="set-spin" aria-hidden="true" /> Enregistrement…</> : <><i className="bi bi-save" aria-hidden="true" /> Enregistrer</>}
        </Button>
        {feedback ? <span className={`set-feedback set-feedback--${feedback.tone}`} role={feedback.tone === 'error' ? 'alert' : undefined}><i className={`bi ${feedback.tone === 'success' ? 'bi-check-circle-fill' : 'bi-exclamation-triangle-fill'}`} aria-hidden="true" /> {feedback.text}</span> : null}
      </div>
    </section>
  );
}

function HomeCard() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['settings', 'home-hero'], queryFn: ({ signal }) => getHomeHeroSettings(signal) });
  const [slogan, setSlogan] = useState('');
  const [source, setSource] = useState<AssetSource>('none');
  const [urlValue, setUrlValue] = useState('');
  const [tempId, setTempId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!query.data) return;
    const b = query.data.banner;
    setSlogan(query.data.slogan);
    setSource(b.type === 'upload' ? 'upload' : b.type === 'url' ? 'url' : 'none');
    setUrlValue(b.type === 'url' ? (b.url ?? '') : '');
    setTempId(null);
    setPreview(b.urlResolved ? resolveMediaUrl(b.urlResolved) : null);
  }, [query.data]);

  const upload = useMutation({
    mutationFn: (file: File) => uploadTempHomeAsset(file),
    onSuccess: (res) => { setTempId(res.tempAssetId); setPreview(resolveMediaUrl(res.tempAssetUrl)); setFeedback(null); },
    onError: (e) => setFeedback({ tone: 'error', text: errMessage(e) }),
  });
  const save = useMutation({
    mutationFn: () => saveHomeHero({
      banner: {
        type: source === 'none' ? null : source,
        url: source === 'url' ? urlValue.trim() : undefined,
        tempAssetId: source === 'upload' ? tempId : undefined,
      },
      slogan: slogan.trim(),
    }),
    onSuccess: (d) => {
      setFeedback({ tone: 'success', text: "Page d'accueil enregistrée." });
      qc.setQueryData(['settings', 'home-hero'], d);
      void qc.invalidateQueries({ queryKey: ['home'] });
    },
    onError: (e) => setFeedback({ tone: 'error', text: errMessage(e) }),
  });

  if (query.status === 'pending') return <section className="set-card"><LoadingState label="Chargement…" /></section>;
  if (query.status === 'error') return <section className="set-card"><ErrorState title="Réglages d'accueil indisponibles." /></section>;

  const previewUrl = source === 'url' ? (urlValue.trim() ? resolveMediaUrl(urlValue.trim()) : null) : source === 'none' ? null : preview;

  return (
    <section className="set-card">
      <header className="set-card__head">
        <span className="set-card__ic"><i className="bi bi-image" aria-hidden="true" /></span>
        <div>
          <h2 className="set-card__title">Page d'accueil</h2>
          <p className="set-card__sub">Bannière en haut de l'accueil et slogan.</p>
        </div>
      </header>
      <FormField label="Bannière d'accueil">
        <ImageField
          source={source} onSource={setSource}
          urlValue={urlValue} onUrl={setUrlValue}
          onPickFile={(f) => upload.mutate(f)} uploading={upload.isPending}
          previewUrl={previewUrl}
          uploadHint="Format large conseillé. PNG, JPG ou WEBP, 6 Mo max."
        />
      </FormField>
      <FormField label="Slogan" hint="Court texte affiché sous le nom sur l'accueil.">
        <TextInput value={slogan} onChange={(e) => setSlogan(e.target.value)} placeholder="La beauté, sans compromis." />
      </FormField>
      <div className="set-card__foot">
        <Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? <><span className="set-spin" aria-hidden="true" /> Enregistrement…</> : <><i className="bi bi-save" aria-hidden="true" /> Enregistrer</>}
        </Button>
        {feedback ? <span className={`set-feedback set-feedback--${feedback.tone}`} role={feedback.tone === 'error' ? 'alert' : undefined}><i className={`bi ${feedback.tone === 'success' ? 'bi-check-circle-fill' : 'bi-exclamation-triangle-fill'}`} aria-hidden="true" /> {feedback.text}</span> : null}
      </div>
    </section>
  );
}

function ThemeCard() {
  return (
    <section className="set-card">
      <header className="set-card__head">
        <span className="set-card__ic"><i className="bi bi-palette" aria-hidden="true" /></span>
        <div>
          <h2 className="set-card__title">Thème du site</h2>
          <p className="set-card__sub">Couleurs, typographie et arrondis de la vitrine.</p>
        </div>
      </header>
      <Link className="set-linkrow" to="/parametres/theme">
        <span className="set-linkrow__body">
          <span className="set-linkrow__title">Éditer le thème vitrine</span>
          <span className="set-linkrow__sub">Aperçu en direct puis activation.</span>
        </span>
        <i className="bi bi-chevron-right" aria-hidden="true" />
      </Link>
    </section>
  );
}

export function SettingsPage() {
  return (
    <div className="set-page">
      <header className="set-head">
        <h1 className="set-head__title">Paramètres</h1>
        <p className="set-head__sub">Identité, page d'accueil et thème de votre site.</p>
      </header>
      <IdentityCard />
      <HomeCard />
      <ThemeCard />
    </div>
  );
}
