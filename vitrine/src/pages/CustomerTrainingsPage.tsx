import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, FileText, Loader2, MessageCircle, Play, Trash2, UploadCloud, XCircle } from 'lucide-react';
import { customerApi } from '@/lib/api';
import { useCustomer } from '@/context/CustomerContext';
import { resolvePreviewMediaUrl } from '@/lib/media';

export default function CustomerTrainingsPage() {
  const { customer } = useCustomer();
  const [items, setItems] = React.useState<Record<string, any>[]>([]);
  const [selectedIndex, setSelectedIndex] = React.useState<number | null>(null);

  const refresh = React.useCallback(() => {
    if (!customer) return;
    customerApi.formations().then((rows) => setItems(rows as Record<string, any>[])).catch(() => setItems([]));
  }, [customer]);

  React.useEffect(refresh, [refresh]);

  if (!customer) {
    return (
      <section className="mx-auto min-h-screen max-w-5xl px-5 pb-24 pt-32 md:px-8">
        <Link to="/connexion-client" className="font-semibold">Connectez-vous pour accéder à vos formations.</Link>
      </section>
    );
  }

  const selected = selectedIndex === null ? null : items[selectedIndex];

  return (
    <section className="mx-auto min-h-screen max-w-6xl px-5 pb-24 pt-32 md:px-8">
      {!selected ? (
        <TrainingList items={items} onOpen={(index) => setSelectedIndex(index)} />
      ) : (
        <TrainingWorkspace item={selected} onBack={() => setSelectedIndex(null)} onSubmitted={refresh} />
      )}
    </section>
  );
}

function TrainingList({ items, onOpen }: { items: Record<string, any>[]; onOpen: (index: number) => void }) {
  return (
    <div>
      <Link to="/espace-client" className="inline-flex items-center gap-2 text-sm font-semibold"><ArrowLeft className="h-4 w-4" /> Retour à mon espace</Link>
      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--v-accent)' }}>Espace formation</p>
          <h1 className="mt-3 text-4xl font-semibold">Mes formations</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6" style={{ color: 'var(--v-muted-foreground)' }}>
            Retrouvez vos parcours, leur statut et votre progression.
          </p>
        </div>
        <strong className="text-3xl">{items.length}</strong>
      </div>
      {items.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed p-5 text-sm" style={{ borderColor: 'var(--v-border)', color: 'var(--v-muted-foreground)' }}>Aucune formation achetée pour le moment.</p>
      ) : (
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {items.map((item, index) => {
            const product = item.product || {};
            const title = product.title || item.productSnapshot?.title || 'Formation';
            const progress = trainingProgress(item);
            const cover = resolvePreviewMediaUrl(product.coverUrl || product.gallery?.[0] || '');
            return (
              <article key={`${item.saleId || index}-${item.productId || title}`} className="grid gap-4 rounded-lg border p-4 sm:grid-cols-[120px_1fr]" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
                <div className="aspect-square overflow-hidden rounded-md border" style={{ borderColor: 'var(--v-border)', background: 'color-mix(in srgb, var(--v-foreground) 5%, var(--v-background))' }}>
                  {cover ? <img src={cover} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-xs" style={{ color: 'var(--v-muted-foreground)' }}>Image</div>}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-xl font-semibold">{title}</h2>
                    <StatusPill item={item} />
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full" style={{ background: 'color-mix(in srgb, var(--v-muted-foreground) 16%, transparent)' }}>
                    <div className="h-full rounded-full" style={{ width: `${progress}%`, background: 'var(--v-primary)' }} />
                  </div>
                  <p className="mt-2 text-xs" style={{ color: 'var(--v-muted-foreground)' }}>{progress}% complété</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={() => onOpen(index)} className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold" style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}>
                      Accéder <ArrowRight className="h-4 w-4" />
                    </button>
                    {product.whatsappGroup?.url && (
                      <a href={product.whatsappGroup.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white" style={{ background: '#16a34a' }}>
                        <MessageCircle className="h-4 w-4" /> WhatsApp
                      </a>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TrainingWorkspace({ item, onBack, onSubmitted }: { item: Record<string, any>; onBack: () => void; onSubmitted: () => void }) {
  const product = item.product || {};
  const modules = Array.isArray(item.modules) ? item.modules : [];
  const evaluation = item.evaluation || {};
  const latest = item.latestSubmission;
  const [moduleIndex, setModuleIndex] = React.useState(0);
  const [answers, setAnswers] = React.useState<Record<string, unknown>>({});
  const [deliverables, setDeliverables] = React.useState<Record<string, unknown>>({});
  const [sending, setSending] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const refs = React.useRef<Record<string, HTMLElement | null>>({});
  const finalStepEnabled = evaluation.enabled !== false;
  const steps = React.useMemo(
    () => [
      ...modules.map((module, index) => ({ kind: 'module', module, title: module.title || `Module ${index + 1}` })),
      ...(finalStepEnabled ? [{ kind: 'final', module: null, title: 'Dossier final' }] : []),
    ],
    [modules, finalStepEnabled],
  );
  const currentStep = steps[Math.min(moduleIndex, Math.max(0, steps.length - 1))] || null;
  const module = currentStep?.kind === 'module' ? currentStep.module : null;
  const isFinalStep = currentStep?.kind === 'final';
  const rejected = latest?.status === 'REJECTED';
  const pending = latest?.status === 'PENDING';
  const validated = latest?.status === 'VALIDATED';
  const dossierReady = isEvaluationComplete(evaluation, answers, deliverables);

  async function submit() {
    setSending(true);
    setMessage('Envoi de votre dossier...');
    try {
      await customerApi.createTrainingSubmission({ saleId: item.saleId, productId: item.productId, answers, deliverables });
      setMessage('Votre dossier a été envoyé. Il est maintenant en attente de correction.');
      onSubmitted();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Envoi impossible');
    } finally {
      setSending(false);
    }
  }

  const scrollTo = (key: string) => refs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div>
      <nav className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
        <button type="button" onClick={onBack} className="font-semibold" style={{ color: 'var(--v-accent)' }}>Mes formations</button>
        <span style={{ color: 'var(--v-muted-foreground)' }}>/</span>
        <span className="font-semibold">{product.title || item.productSnapshot?.title || 'Formation'}</span>
      </nav>

      <div className="mt-6 rounded-lg border p-5" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold">{product.title || item.productSnapshot?.title || 'Formation'}</h1>
            <p className="mt-2 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>Avancement : {trainingProgress(item)}%</p>
          </div>
          <StatusPill item={item} />
        </div>
        {product.whatsappGroup?.url && (
          <a href={product.whatsappGroup.url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white" style={{ background: '#16a34a' }}>
            <MessageCircle className="h-4 w-4" /> Rejoindre le groupe WhatsApp
          </a>
        )}
        <div className="mt-4 h-2 overflow-hidden rounded-full" style={{ background: 'color-mix(in srgb, var(--v-muted-foreground) 16%, transparent)' }}>
          <div className="h-full rounded-full" style={{ width: `${trainingProgress(item)}%`, background: 'var(--v-primary)' }} />
        </div>
        {pending && <StateBox tone="neutral" icon={<CheckCircle2 className="h-4 w-4" />} text="Votre dossier est en attente de correction." />}
        {validated && <StateBox tone="success" icon={<CheckCircle2 className="h-4 w-4" />} text="Formation validée." />}
        {rejected && <StateBox tone="danger" icon={<XCircle className="h-4 w-4" />} text={`Retentative possible. Commentaire : ${latest?.decision?.comment || 'Ajustez votre dossier puis renvoyez-le.'}`} />}
      </div>

      {steps.length > 0 && (
        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_280px]">
          <main className="min-w-0">
            <ModuleTimeline modules={steps} current={moduleIndex} onSelect={setModuleIndex} />
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <button type="button" disabled={moduleIndex === 0} onClick={() => setModuleIndex((value) => Math.max(0, value - 1))} className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold disabled:opacity-50" style={{ borderColor: 'var(--v-border)' }}>
                <ChevronLeft className="h-4 w-4" /> Module précédent
              </button>
              <button type="button" disabled={moduleIndex >= steps.length - 1} onClick={() => setModuleIndex((value) => Math.min(steps.length - 1, value + 1))} className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold disabled:opacity-50" style={{ borderColor: 'var(--v-border)' }}>
                Module suivant <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            {module && <ModuleContent module={module} refsMap={refs} />}
            {isFinalStep && (
              <section className="mt-6 rounded-lg border p-5" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
                <h3 className="text-xl font-semibold">Dossier final</h3>
                <p className="mt-2 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>
                  Complétez le questionnaire et ajoutez les livrables demandés pour envoyer votre dossier.
                </p>
                <Questionnaire sections={evaluation.sections || []} answers={answers} onChange={setAnswers} />
                <DeliverableUpload deliverables={evaluation.deliverables || []} value={deliverables} onChange={setDeliverables} />
                {!dossierReady && (
                  <p className="mt-4 rounded-md border px-3 py-2 text-sm" style={{ borderColor: 'var(--v-border)', color: 'var(--v-muted-foreground)' }}>
                    Complétez toutes les réponses et les livrables obligatoires pour envoyer votre dossier.
                  </p>
                )}
                <button disabled={sending || pending || validated || !dossierReady} onClick={submit} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md px-5 py-3 font-semibold disabled:opacity-60" style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}>
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                  {rejected ? 'Renvoyer mon dossier' : 'Envoyer mon dossier'}
                </button>
                {message && <p className="mt-3 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>{message}</p>}
              </section>
            )}
          </main>
          {module && <ModulePlan module={module} onJump={scrollTo} />}
        </div>
      )}
    </div>
  );
}

function ModuleTimeline({ modules, current, onSelect }: { modules: any[]; current: number; onSelect: (index: number) => void }) {
  return (
    <div className="overflow-x-auto rounded-lg border p-4" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
      <div className="flex min-w-max items-center gap-3">
        {modules.map((module, index) => (
          <button key={module.id || index} type="button" onClick={() => onSelect(index)} className="relative grid min-w-36 justify-items-center gap-2 text-center">
            {index === current && <span className="absolute -top-1 h-3 w-3 animate-bounce rotate-45" style={{ background: 'var(--v-accent)' }} />}
            <span className="mt-4 grid h-10 w-10 place-items-center rounded-full border text-sm font-semibold" style={{ borderColor: index === current ? 'var(--v-accent)' : 'var(--v-border)', background: index === current ? 'var(--v-accent)' : 'var(--v-background)', color: index === current ? 'var(--v-background)' : 'inherit' }}>{index + 1}</span>
            <span className="line-clamp-2 text-xs font-semibold">{module.title || `Module ${index + 1}`}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ModulePlan({ module, onJump }: { module: any; onJump: (key: string) => void }) {
  const videos = Array.isArray(module.videos) ? module.videos : [];
  const files = Array.isArray(module.files) ? module.files : [];
  return (
    <aside className="rounded-lg border p-4 lg:sticky lg:top-28 lg:self-start" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
      <h3 className="font-semibold">Plan du module</h3>
      <div className="mt-4 grid gap-2">
        {videos.map((video: any, index: number) => (
          <button key={video.id || index} type="button" onClick={() => onJump(`video-${index}`)} className="inline-flex items-start gap-2 rounded-md border px-3 py-2 text-left text-sm" style={{ borderColor: 'var(--v-border)' }}>
            <Play className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--v-accent)' }} />
            <span>{video.title || `Vidéo ${index + 1}`}</span>
          </button>
        ))}
        {files.map((file: any, index: number) => (
          <button key={file.id || index} type="button" onClick={() => onJump(`file-${index}`)} className="inline-flex items-start gap-2 rounded-md border px-3 py-2 text-left text-sm" style={{ borderColor: 'var(--v-border)' }}>
            <FileText className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--v-accent)' }} />
            <span>{file.title || `Fichier ${index + 1}`}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function ModuleContent({ module, refsMap }: { module: any; refsMap: React.MutableRefObject<Record<string, HTMLElement | null>> }) {
  const videos = Array.isArray(module.videos) ? module.videos : [];
  const files = Array.isArray(module.files) ? module.files : [];
  return (
    <section className="mt-6 rounded-lg border" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
      <div className="border-b p-5" style={{ borderColor: 'var(--v-border)', background: 'color-mix(in srgb, var(--v-primary) 8%, transparent)' }}>
        <h2 className="text-2xl font-semibold">{module.title}</h2>
        {module.description && <p className="mt-2 text-sm leading-6" style={{ color: 'var(--v-muted-foreground)' }}>{module.description}</p>}
      </div>
      <div className="grid gap-5 p-5">
        {module.text && <p className="text-sm leading-7">{module.text}</p>}
        {videos.map((video: any, index: number) => (
          <article key={video.id || index} ref={(node) => { refsMap.current[`video-${index}`] = node; }} className="scroll-mt-28 rounded-lg border p-4" style={{ borderColor: 'var(--v-border)' }}>
            <h3 className="font-semibold">{video.title || `Vidéo ${index + 1}`}</h3>
            {video.description && <p className="mt-1 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>{video.description}</p>}
            <div className="mt-3">
              <ClientVideoPlayer shortcode={video.streamableShortcode} title={video.title || `Vidéo ${index + 1}`} coverUrl={resolvePreviewMediaUrl(video.coverUrl || '')} />
            </div>
          </article>
        ))}
        {files.map((file: any, index: number) => (
          <article key={file.id || index} ref={(node) => { refsMap.current[`file-${index}`] = node; }} className="scroll-mt-28 rounded-lg border p-4" style={{ borderColor: 'var(--v-border)' }}>
            <h3 className="font-semibold">{file.title || `Fichier ${index + 1}`}</h3>
            {file.description && <p className="mt-1 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>{file.description}</p>}
            <a href={file.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold" style={{ borderColor: 'var(--v-border)' }}>
              <FileText className="h-4 w-4" /> Ouvrir le fichier
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}

function StateBox({ icon, text, tone }: { icon: React.ReactNode; text: string; tone: 'neutral' | 'success' | 'danger' }) {
  const color = tone === 'success' ? '#047857' : tone === 'danger' ? '#b91c1c' : 'var(--v-muted-foreground)';
  return <p className="mt-3 inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm" style={{ borderColor: 'var(--v-border)', color }}>{icon}{text}</p>;
}

function StatusPill({ item }: { item: Record<string, any> }) {
  const latest = item.latestSubmission;
  const label = latest?.status === 'PENDING'
    ? 'En attente'
    : latest?.status === 'VALIDATED'
      ? 'Validée'
      : latest?.status === 'REJECTED'
        ? 'À reprendre'
        : trainingProgress(item) >= 100
          ? 'Terminée'
          : 'En cours';
  return <span className="rounded-full border px-3 py-1 text-xs font-semibold" style={{ borderColor: 'var(--v-border)' }}>{label}</span>;
}

function ClientVideoPlayer({ shortcode, title, coverUrl }: { shortcode?: string; title: string; coverUrl?: string }) {
  const [started, setStarted] = React.useState(false);
  const [src, setSrc] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');

  async function start() {
    if (!shortcode) {
      setStarted(true);
      setError('Vidéo indisponible');
      return;
    }
    setStarted(true);
    setLoading(true);
    setError('');
    try {
      const data = await customerApi.streamablePlaybackUrl(shortcode);
      setSrc(data.playbackUrl);
    } catch (err) {
      setSrc('');
      setError(err instanceof Error ? err.message : 'Vidéo indisponible');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-black" style={{ borderColor: 'var(--v-border)' }}>
      <div className="relative aspect-video">
        {!started && (
          <button type="button" onClick={start} className="absolute inset-0 grid place-items-center bg-black text-white">
            {coverUrl && <img src={coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />}
            <span className="relative inline-flex h-16 w-16 items-center justify-center rounded-full bg-white text-black shadow-xl"><Play className="h-7 w-7" /></span>
          </button>
        )}
        {started && loading && <div className="absolute inset-0 grid place-items-center text-sm text-white/70"><Loader2 className="h-4 w-4 animate-spin" /> Chargement</div>}
        {src ? <video src={src} controls playsInline className="h-full w-full object-contain" /> : started && !loading && <div className="absolute inset-0 grid place-items-center text-sm text-white/70">{error || 'Vidéo indisponible'}</div>}
      </div>
      <p className="p-3 text-sm font-semibold text-white">{title}</p>
    </div>
  );
}

function Questionnaire({ sections, answers, onChange }: { sections: any[]; answers: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void }) {
  const setAnswer = (id: string, value: unknown) => onChange({ ...answers, [id]: value });
  return (
    <div className="mt-4 grid gap-4">
      {sections.map((section, sectionIndex) => (
        <div key={section.id || sectionIndex} className="rounded-lg border p-4" style={{ borderColor: 'var(--v-border)' }}>
          <h4 className="font-semibold">{section.title || `Section ${sectionIndex + 1}`}</h4>
          {(section.items || []).map((question: any, index: number) => {
            const id = String(question.id || question.label || index);
            const options = question.type === 'TRUE_FALSE' ? [{ id: 'true', label: 'Vrai' }, { id: 'false', label: 'Faux' }] : question.options || [];
            return (
              <div key={id} className="mt-4">
                <p className="text-sm font-semibold">{question.label || `Question ${index + 1}`}</p>
                <div className="mt-2 grid gap-2">
                  {options.map((option: any) => {
                    const selected = question.type === 'MULTIPLE' ? Array.isArray(answers[id]) && (answers[id] as string[]).includes(String(option.id)) : answers[id] === String(option.id);
                    return (
                      <label
                        key={option.id}
                        className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm transition duration-200"
                        style={{
                          borderColor: selected ? 'var(--v-accent)' : 'var(--v-border)',
                          background: selected ? 'color-mix(in srgb, var(--v-accent) 82%, #111111)' : 'transparent',
                          color: selected ? 'var(--v-background)' : 'inherit',
                        }}
                      >
                        <input
                          type={question.type === 'MULTIPLE' ? 'checkbox' : 'radio'}
                          checked={selected}
                          className="sr-only"
                          onChange={(event) => {
                            if (question.type !== 'MULTIPLE') return setAnswer(id, String(option.id));
                            const current = Array.isArray(answers[id]) ? answers[id] as string[] : [];
                            setAnswer(id, event.target.checked ? [...current, String(option.id)] : current.filter((value) => value !== String(option.id)));
                          }}
                        />
                        <span
                          className="grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-transform duration-200"
                          style={{
                            borderColor: selected ? 'var(--v-background)' : 'var(--v-border)',
                            background: selected ? 'var(--v-background)' : 'transparent',
                            transform: selected ? 'scale(1.08)' : 'scale(1)',
                          }}
                        >
                          {selected && <CheckCircle2 className="h-3.5 w-3.5" style={{ color: 'var(--v-accent)' }} />}
                        </span>
                        {option.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

type Uploaded = { url: string; name?: string; mimeType?: string; kind?: string };

/**
 * LES LIVRABLES : envoyés sur NOTRE serveur, visibles aussitôt, remplaçables.
 *
 * Chaque envoi affiche sa progression (une vidéo pèse vite des dizaines de
 * mégaoctets). Une fois envoyée, la vidéo se lit ici même et la photo
 * s'affiche. « Remplacer » envoie le nouveau fichier PUIS retire l'ancien du
 * serveur ; « Supprimer » le retire tout de suite. Rien n'encombre le disque,
 * et la correctrice verra exactement ce qui aura été soumis.
 */
function DeliverableUpload({ deliverables, value, onChange }: { deliverables: any[]; value: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void }) {
  const [progress, setProgress] = React.useState<Record<string, number>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const valueRef = React.useRef(value);
  valueRef.current = value;

  async function send(slotKey: string, file: File) {
    setErrors((e) => ({ ...e, [slotKey]: '' }));
    setProgress((p) => ({ ...p, [slotKey]: 0 }));
    try {
      return await customerApi.uploadTrainingDeliverable(file, (ratio) => setProgress((p) => ({ ...p, [slotKey]: ratio })));
    } catch (err) {
      setErrors((e) => ({ ...e, [slotKey]: err instanceof Error ? err.message : 'Envoi impossible' }));
      return null;
    } finally {
      setProgress((p) => { const next = { ...p }; delete next[slotKey]; return next; });
    }
  }

  const discard = (url?: string) => { if (url) customerApi.deleteTrainingDeliverable(url).catch(() => null); };

  async function putSingle(id: string, file: File, slot?: string) {
    const key = slot ? `${id}.${slot}` : id;
    const previous = slot ? (valueRef.current[id] as any)?.[slot] : valueRef.current[id];
    const uploaded = await send(key, file);
    if (!uploaded) return;
    const current = valueRef.current;
    onChange(slot ? { ...current, [id]: { ...((current[id] as Record<string, unknown>) || {}), [slot]: uploaded } } : { ...current, [id]: uploaded });
    discard(previous?.url);
  }

  function removeSingle(id: string, slot?: string) {
    const current = valueRef.current;
    const previous = slot ? (current[id] as any)?.[slot] : current[id];
    discard(previous?.url);
    if (slot) {
      const next = { ...((current[id] as Record<string, unknown>) || {}) };
      delete next[slot];
      onChange({ ...current, [id]: next });
    } else {
      const next = { ...current };
      delete next[id];
      onChange(next);
    }
  }

  async function addToGallery(id: string, files: FileList | File[] | null, maxImages: number) {
    if (!files?.length) return;
    const room = Math.max(0, maxImages - (Array.isArray(valueRef.current[id]) ? (valueRef.current[id] as any[]).length : 0));
    for (const file of Array.from(files).slice(0, room)) {
      const uploaded = await send(`${id}.gallery`, file);
      if (!uploaded) continue;
      const current = valueRef.current;
      const list = Array.isArray(current[id]) ? current[id] as any[] : [];
      onChange({ ...current, [id]: [...list, uploaded] });
    }
  }

  function removeFromGallery(id: string, index: number) {
    const current = valueRef.current;
    const list = Array.isArray(current[id]) ? [...(current[id] as any[])] : [];
    const [removed] = list.splice(index, 1);
    discard(removed?.url);
    onChange({ ...current, [id]: list });
  }

  return (
    <div className="mt-4 grid gap-3">
      {deliverables.map((deliverable, index) => {
        const id = String(deliverable.id || deliverable.label || index);
        const uploaded = value[id] as any;
        const maxImages = Number(deliverable.maxImages || 6);
        const type = String(deliverable.type || 'FILE');
        return (
          <div key={id} className="grid gap-3 rounded-lg border p-4 text-sm" style={{ borderColor: 'var(--v-border)' }} data-testid={`deliverable-${type}`}>
            <div>
              <span className="font-semibold">{deliverable.label || `Livrable ${index + 1}`}</span>
              {deliverable.required && <span className="ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: 'color-mix(in srgb, var(--v-accent) 18%, transparent)', color: 'var(--v-accent)' }}>obligatoire</span>}
            </div>
            {deliverable.description && <span style={{ color: 'var(--v-muted-foreground)' }}>{deliverable.description}</span>}
            {type === 'PHOTO_BEFORE_AFTER' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {(['before', 'after'] as const).map((slot) => (
                  <MediaSlot
                    key={slot}
                    label={slot === 'before' ? 'Avant' : 'Après'}
                    accept="image/*"
                    file={uploaded?.[slot]}
                    progress={progress[`${id}.${slot}`]}
                    error={errors[`${id}.${slot}`]}
                    onPick={(file) => putSingle(id, file, slot)}
                    onRemove={() => removeSingle(id, slot)}
                  />
                ))}
              </div>
            ) : type === 'PHOTO_GALLERY' ? (
              <div className="grid gap-3">
                {Array.isArray(uploaded) && uploaded.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {uploaded.map((item: Uploaded, itemIndex: number) => (
                      <div key={`${item.url}-${itemIndex}`} className="relative aspect-square overflow-hidden rounded-md border" style={{ borderColor: 'var(--v-border)' }}>
                        <img src={resolvePreviewMediaUrl(item.url)} alt="" className="h-full w-full object-cover" />
                        <button type="button" onClick={() => removeFromGallery(id, itemIndex)} aria-label="Supprimer la photo" className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-black/70 text-white">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {(!Array.isArray(uploaded) || uploaded.length < maxImages) && (
                  <DropZone
                    label={`Ajouter des photos (${Array.isArray(uploaded) ? uploaded.length : 0}/${maxImages})`}
                    accept="image/*"
                    multiple
                    progress={progress[`${id}.gallery`]}
                    onFiles={(files) => void addToGallery(id, files, maxImages)}
                  />
                )}
                {errors[`${id}.gallery`] && <p className="text-xs" style={{ color: '#b91c1c' }}>{errors[`${id}.gallery`]}</p>}
              </div>
            ) : (
              <MediaSlot
                label={type === 'VIDEO' ? 'Vidéo' : 'Fichier'}
                accept={type === 'VIDEO' ? 'video/*' : 'image/*,application/pdf'}
                file={uploaded}
                progress={progress[id]}
                error={errors[id]}
                onPick={(file) => putSingle(id, file)}
                onRemove={() => removeSingle(id)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function UploadProgress({ ratio }: { ratio: number }) {
  const percent = Math.round(ratio * 100);
  return (
    <div className="grid min-h-32 place-items-center rounded-lg border border-dashed p-4" style={{ borderColor: 'var(--v-accent)' }} data-testid="upload-progress">
      <div className="w-full max-w-xs text-center">
        <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" style={{ color: 'var(--v-accent)' }} />
        <p className="text-xs font-semibold">{percent < 100 ? `Envoi en cours… ${percent} %` : 'Finalisation…'}</p>
        <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: 'color-mix(in srgb, var(--v-muted-foreground) 16%, transparent)' }}>
          <div className="h-full rounded-full transition-all duration-200" style={{ width: `${percent}%`, background: 'var(--v-accent)' }} />
        </div>
      </div>
    </div>
  );
}

function DropZone({ label, accept, multiple = false, progress, onFiles }: { label: string; accept: string; multiple?: boolean; progress?: number; onFiles: (files: File[]) => void }) {
  if (progress !== undefined) return <UploadProgress ratio={progress} />;
  return (
    <label
      className="grid min-h-32 cursor-pointer place-items-center rounded-lg border border-dashed p-4 text-center transition hover:opacity-80"
      style={{ borderColor: 'var(--v-border)', background: 'color-mix(in srgb, var(--v-accent) 7%, transparent)' }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onFiles(Array.from(event.dataTransfer.files || []));
      }}
    >
      <input type="file" accept={accept} multiple={multiple} className="sr-only" onChange={(event) => { onFiles(Array.from(event.target.files || [])); event.target.value = ''; }} />
      <span>
        <UploadCloud className="mx-auto mb-2 h-6 w-6" />
        <span className="block font-semibold">{label}</span>
        <span className="block text-xs" style={{ color: 'var(--v-muted-foreground)' }}>Glissez-déposez ou cliquez pour choisir</span>
      </span>
    </label>
  );
}

function MediaSlot({ label, accept, file, progress, error, onPick, onRemove }: {
  label: string;
  accept: string;
  file?: Uploaded;
  progress?: number;
  error?: string;
  onPick: (file: File) => void;
  onRemove: () => void;
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const url = file?.url ? resolvePreviewMediaUrl(file.url) : '';
  const isVideo = String(file?.mimeType || '').startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(url);
  const isImage = String(file?.mimeType || '').startsWith('image/') || /\.(png|jpe?g|webp|gif|avif)$/i.test(url);
  if (progress !== undefined) return <UploadProgress ratio={progress} />;
  if (!url) {
    return (
      <div className="grid gap-1">
        <DropZone label={`Importer : ${label}`} accept={accept} onFiles={(files) => files[0] && onPick(files[0])} />
        {error && <p className="text-xs" style={{ color: '#b91c1c' }}>{error}</p>}
      </div>
    );
  }
  return (
    <div className="grid gap-2 rounded-lg border p-2" style={{ borderColor: 'var(--v-border)' }}>
      <span className="text-xs font-semibold" style={{ color: 'var(--v-accent)' }}>{label}</span>
      {isVideo ? (
        <video src={url} controls playsInline preload="metadata" className="aspect-video w-full rounded-md bg-black object-contain" data-testid="deliverable-player" />
      ) : isImage ? (
        <img src={url} alt="" className="aspect-square w-full rounded-md object-cover" />
      ) : (
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 font-semibold"><FileText className="h-4 w-4" /> {file?.name || 'Fichier'}</a>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="inline-flex min-w-0 items-center gap-1 truncate" style={{ color: 'var(--v-muted-foreground)' }}><CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> {file?.name || 'Fichier envoyé'}</span>
        <span className="flex gap-2">
          <button type="button" onClick={() => inputRef.current?.click()} className="rounded-md border px-2 py-1 font-semibold" style={{ borderColor: 'var(--v-border)' }}>Remplacer</button>
          <button type="button" onClick={onRemove} className="rounded-md border px-2 py-1 font-semibold" style={{ borderColor: 'var(--v-border)', color: '#b91c1c' }}>Supprimer</button>
        </span>
      </div>
      <input ref={inputRef} type="file" accept={accept} className="sr-only" onChange={(event) => { const picked = event.target.files?.[0]; if (picked) onPick(picked); event.target.value = ''; }} />
      {error && <p className="text-xs" style={{ color: '#b91c1c' }}>{error}</p>}
    </div>
  );
}

function trainingProgress(item: Record<string, any>) {
  const direct = Number(item.progressPercent ?? item.progress?.percent ?? item.progression?.percent);
  if (Number.isFinite(direct) && direct >= 0) return Math.min(100, Math.round(direct));
  const completed = Number(item.completedModules ?? item.progress?.completedModules ?? item.latestSubmission?.progressSnapshot?.completedModules ?? 0);
  const total = Number(item.totalModules ?? item.progress?.totalModules ?? item.productSnapshot?.modulesCount ?? item.latestSubmission?.progressSnapshot?.totalModules ?? 0);
  if (total > 0) return Math.min(100, Math.round((completed / total) * 100));
  return item.status === 'VALIDATED' || item.completedAt ? 100 : 0;
}

function isEvaluationComplete(evaluation: Record<string, any>, answers: Record<string, unknown>, deliverables: Record<string, unknown>) {
  const sections = Array.isArray(evaluation.sections) ? evaluation.sections : [];
  for (const section of sections) {
    for (const question of section.items || []) {
      if (!question.required) continue;
      const id = String(question.id || question.label || '');
      const value = answers[id];
      if (Array.isArray(value) ? value.length === 0 : value === undefined || value === null || value === '') return false;
    }
  }
  for (const deliverable of evaluation.deliverables || []) {
    if (!deliverable.required) continue;
    const id = String(deliverable.id || deliverable.label || '');
    const value = deliverables[id] as any;
    if (deliverable.type === 'PHOTO_BEFORE_AFTER') {
      if (!value?.before?.url || !value?.after?.url) return false;
    } else if (deliverable.type === 'PHOTO_GALLERY') {
      if (!Array.isArray(value) || value.length === 0) return false;
    } else if (!value?.url) {
      return false;
    }
  }
  return true;
}
