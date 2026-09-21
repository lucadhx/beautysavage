import * as React from 'react';
import { FolderOpen, LinkIcon, Loader2, Search, UploadCloud, X } from 'lucide-react';
import { api, uploadFile, type MediaLibraryItem } from '@/lib/api';
import { resolvePreviewMediaUrl } from '@/lib/media';
import type { StoredMediaDescriptor } from '@/types';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { MEDIA_LIMITS, MEDIA_DEFAULT_MAX_MO, MEDIA_FORMATS_LISIBLES } from '@/config/limits';
import { messageUtilisateur } from '@/lib/erreurs';
import { Modal } from '@/components/ui/dialog';
import { Button, Field, Input } from '@/components/ui/primitives';

/**
 * IMPORT D'UNE IMAGE MÉTIER — le seul point d'entrée du projet.
 *
 * ══ DEUX DÉFAUTS CORRIGÉS ═══════════════════════════════════════════════════
 *
 * 1. `mediaType` n'était JAMAIS transmis. Le paramètre existait côté client et
 *    côté serveur ; personne ne le remplissait. Tous les médias métier —
 *    logo, bannière, avant/après, avis, galerie — étaient donc enregistrés en
 *    `other`. Le champ existait, l'inventaire était aveugle, et la
 *    déduplication scopée par type ne scopait rien.
 *
 * 2. Le DESCRIPTEUR rendu par l'API était jeté. Seule l'URL remontait, et la
 *    fiche la stockait comme vérité : le jour d'un changement de domaine,
 *    toutes les fiches pointaient encore sur l'ancien, et rien ne permettait
 *    de savoir si une image avait changé (aucune empreinte), ni son type
 *    réel, ni ses dimensions.
 *
 * `mediaType` est désormais REQUIS — pas optionnel avec un défaut : un défaut
 * est exactement ce qui a produit six mille médias `other`.
 */
export type MediaType =
  | 'company-logo'
  | 'company-favicon'
  | 'hero'
  // Le récit du site — la liste fait foi côté serveur (`upload.controller.js`).
  | 'chapter-image'
  | 'page-image'
  | 'gallery-image'
  | 'team-photo'
  | 'commerce-cover';

interface Props {
  value: string;
  /**
   * Rend le CHEMIN DE STOCKAGE, le DESCRIPTEUR (la source de vérité) et
   * l'adresse d'aperçu du moment. Le parent enregistre les deux premiers ;
   * la troisième ne sert qu'à l'affichage et n'est jamais persistée.
   */
  onChange: (path: string, descriptor: StoredMediaDescriptor | null, previewUrl?: string) => void;
  /** Ce que l'image REPRÉSENTE — jamais déduit du nom de fichier. */
  mediaType: MediaType;
  kind?: 'image' | 'favicon';
  aspect?: string; // e.g. 'aspect-video', 'aspect-square'
  label?: string;
  hint?: string;
  className?: string;
  /** Adresse d'affichage résolue par le parent, quand elle diffère du chemin. */
  previewUrl?: string | null;
}

export function ImageUpload({
  value,
  onChange,
  mediaType,
  kind = 'image',
  aspect = 'aspect-video',
  hint,
  className,
  previewUrl,
}: Props) {
  const [uploading, setUploading] = React.useState(false);
  const [libraryOpen, setLibraryOpen] = React.useState(false);
  const [sourceOpen, setSourceOpen] = React.useState(false);
  const [urlOpen, setUrlOpen] = React.useState(false);
  const [externalUrl, setExternalUrl] = React.useState('');
  const [fit, setFit] = React.useState<'cover' | 'contain'>('cover');
  const inputRef = React.useRef<HTMLInputElement>(null);
  const maxMo = (MEDIA_LIMITS as Record<string, { maxMo: number }>)[mediaType]?.maxMo
    ?? MEDIA_DEFAULT_MAX_MO;

  /**
   * L'adresse d'APERÇU, qui n'est pas l'identité. Elle vient de l'import quand
   * il vient d'avoir lieu, du parent sinon. À défaut, le chemin de stockage
   * suffit : le backend sert ses propres médias sur `/uploads/…`, y compris
   * sur un poste jamais déployé.
   */
  const [apercuImport, setApercuImport] = React.useState<string | null>(null);
  const affichee = apercuImport ?? previewUrl ?? value ?? '';

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const importe = await uploadFile(file, kind, mediaType);
      setApercuImport(importe.publicUrl ?? importe.url);
      // Le chemin ET le descripteur entrent dans la fiche ; l'aperçu, non.
      onChange(importe.url, importe.descriptor ?? null, importe.publicUrl ?? importe.url);
      toast.success('Image envoyée');
    } catch (err) {
      toast.error(messageUtilisateur(err, "Échec de l'upload"));
    } finally {
      setUploading(false);
      // Sans cela, réimporter le MÊME fichier après une erreur ne déclencherait
      // aucun évènement : la valeur de l'input n'aurait pas changé.
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const applyExternalUrl = () => {
    const normalized = externalUrl.trim();
    if (!/^https?:\/\//i.test(normalized) && !normalized.startsWith('/uploads/')) {
      toast.error('URL invalide : utilisez une adresse https ou un media interne.');
      return;
    }
    setApercuImport(normalized);
    onChange(normalized, null, normalized);
    setUrlOpen(false);
    setSourceOpen(false);
  };

  return (
    <div className={className}>
      <div
        className={cn(
          'group relative flex items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-border bg-muted/40 transition hover:border-primary/50',
          aspect
        )}
        onClick={() => !uploading && setSourceOpen(true)}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !uploading) {
            e.preventDefault();
            setSourceOpen(true);
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="Choisir une image"
      >
        {affichee ? (
          <>
            {/* L'APERÇU SE MET À JOUR SEUL, sans paramètre anti-cache : le nom
                d'un média porte l'empreinte de son contenu, donc une image
                remplacée a forcément une AUTRE adresse. */}
            <img
              key={affichee}
              src={resolvePreviewMediaUrl(affichee)}
              alt=""
              className={`h-full w-full ${fit === 'cover' ? 'object-cover' : 'object-contain'}`}
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                // Retirer, c'est effacer LES DEUX : le chemin et le
                // descripteur. N'effacer que l'un laisserait la fiche décrire
                // un média qu'elle ne référence plus.
                setApercuImport(null);
                onChange('', null);
              }}
              aria-label="Supprimer l'image"
              className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100"
            >
              <X className="h-4 w-4" />
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 p-6 text-center text-muted-foreground">
            {uploading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <UploadCloud className="h-6 w-6" />
            )}
            <span className="text-xs">
              {uploading ? 'Envoi…' : 'Cliquez pour importer une image'}
            </span>
          </div>
        )}
        {uploading && affichee && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Loader2 className="h-6 w-6 animate-spin text-white" />
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setSourceOpen(true)} disabled={uploading}>
          {affichee ? 'Remplacer' : 'Ajouter une image'}
        </Button>
      </div>
      {affichee && (
        <div className="mt-3 rounded-lg border bg-card p-3 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="inline-flex rounded-md border p-1">
              <button
                type="button"
                onClick={() => setFit('cover')}
                className={`h-8 rounded px-3 text-xs font-medium ${fit === 'cover' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
              >
                Fill
              </button>
              <button
                type="button"
                onClick={() => setFit('contain')}
                className={`h-8 rounded px-3 text-xs font-medium ${fit === 'contain' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
              >
                Fit
              </button>
            </div>
            <button
              type="button"
              onClick={() => setFit('cover')}
              className="text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              Reinitialiser
            </button>
          </div>
        </div>
      )}
      {/*
        LA CONTRAINTE SE LIT AVANT DE CHOISIR LE FICHIER.

        Le serveur la contrôle déjà, et il refuse en français — mais APRÈS
        l'envoi. Sur une connexion mobile, l'utilisateur attendait la montée
        complète d'un fichier trop lourd pour apprendre qu'il l'était. La
        limite est donc annoncée ici, avec les formats acceptés : deux
        informations que seul le serveur détenait.
      */}
      <p className="mt-1.5 text-xs text-muted-foreground">
        {hint ? `${hint} ` : ''}
        {MEDIA_FORMATS_LISIBLES}, {maxMo} Mo maximum.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <MediaLibraryDialog
        open={libraryOpen}
        mediaType={mediaType}
        onClose={() => setLibraryOpen(false)}
        onSelect={(item) => {
          const preview = item.publicUrl ?? item.path;
          setApercuImport(preview);
          onChange(item.path, item.descriptor ?? null, preview);
          setLibraryOpen(false);
        }}
      />
      <Modal open={sourceOpen} onClose={() => setSourceOpen(false)} title={affichee ? 'Remplacer l image' : 'Ajouter une image'} className="max-w-xl">
        <div className="grid gap-3 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => {
              setSourceOpen(false);
              inputRef.current?.click();
            }}
            className="grid gap-2 rounded-lg border bg-background p-4 text-left transition hover:border-primary hover:bg-muted/40"
          >
            <UploadCloud className="h-5 w-5 text-primary" />
            <span className="font-semibold">Appareil</span>
            <span className="text-xs text-muted-foreground">Importer depuis cet ordinateur.</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setSourceOpen(false);
              setLibraryOpen(true);
            }}
            className="grid gap-2 rounded-lg border bg-background p-4 text-left transition hover:border-primary hover:bg-muted/40"
          >
            <FolderOpen className="h-5 w-5 text-primary" />
            <span className="font-semibold">Bibliotheque</span>
            <span className="text-xs text-muted-foreground">Reutiliser un media existant.</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setExternalUrl(affichee || '');
              setUrlOpen(true);
            }}
            className="grid gap-2 rounded-lg border bg-background p-4 text-left transition hover:border-primary hover:bg-muted/40"
          >
            <LinkIcon className="h-5 w-5 text-primary" />
            <span className="font-semibold">URL</span>
            <span className="text-xs text-muted-foreground">Coller une image distante.</span>
          </button>
        </div>
      </Modal>
      <Modal open={urlOpen} onClose={() => setUrlOpen(false)} title="Image depuis une URL" className="max-w-2xl">
        <div className="grid gap-4">
          <Field label="URL de l'image">
            <Input value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} placeholder="https://..." />
          </Field>
          <div className="overflow-hidden rounded-lg border bg-muted/30">
            <div className="grid aspect-video place-items-center">
              {externalUrl.trim() ? (
                <img src={externalUrl.trim()} alt="" className="h-full w-full object-contain" />
              ) : (
                <p className="text-sm text-muted-foreground">La preview apparait ici.</p>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setUrlOpen(false)}>Annuler</Button>
            <Button type="button" onClick={applyExternalUrl}>Utiliser cette image</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function MediaLibraryDialog({
  open,
  mediaType,
  onClose,
  onSelect,
}: {
  open: boolean;
  mediaType: MediaType;
  onClose: () => void;
  onSelect: (item: MediaLibraryItem) => void;
}) {
  const [query, setQuery] = React.useState('');
  const [items, setItems] = React.useState<MediaLibraryItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    api.mediaLibrary({ mediaType, q: query, limit: 120 })
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch((err) => {
        if (!cancelled) setError(messageUtilisateur(err, 'Mediatheque indisponible'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, mediaType, query]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="flex max-h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border bg-background shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b p-4">
          <div>
            <h2 className="text-base font-semibold">Mediatheque</h2>
            <p className="text-xs text-muted-foreground">Images centralisees du projet, reutilisables sans nouvel upload.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-2 hover:bg-muted" aria-label="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="border-b p-4">
          <div className="flex h-10 items-center gap-2 rounded-md border px-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rechercher par nom, type ou auteur"
              className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {loading && <p className="text-sm text-muted-foreground">Chargement...</p>}
          {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {!loading && !error && items.length === 0 && (
            <p className="rounded-md border p-4 text-sm text-muted-foreground">
              Aucun media trouve pour ce type. Importez une image depuis le champ, elle apparaitra ici ensuite.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item)}
                className="group overflow-hidden rounded-lg border bg-card text-left transition hover:border-primary hover:shadow-md"
              >
                <div className="aspect-video bg-muted">
                  <img
                    src={resolvePreviewMediaUrl(item.publicUrl ?? item.path)}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </div>
                <div className="space-y-1 p-3">
                  <p className="truncate text-xs font-medium">{item.objectKey}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {item.width ?? '?'} x {item.height ?? '?'} - {Math.round((item.size || 0) / 1024)} Ko
                  </p>
                  <p className="text-[11px] text-muted-foreground">{item.mediaType}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
