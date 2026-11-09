import * as React from 'react';
import { Camera, Loader2, X } from 'lucide-react';
import { customerApi } from '@/lib/api';
import { resolvePreviewMediaUrl } from '@/lib/media';

/**
 * PHOTOS D'UN AVIS — trois au plus, facultatives. Chaque photo part au serveur
 * dès qu'elle est choisie (ré-encodée là-bas, sans ses métadonnées) ; l'avis
 * n'emporte que leurs adresses.
 */
export const REVIEW_PHOTO_MAX = 3;

export function ReviewPhotoPicker({ value, onChange, onBusy }: { value: string[]; onChange: (urls: string[]) => void; onBusy?: (busy: boolean) => void }) {
  const input = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(0);
  const [error, setError] = React.useState('');
  const latest = React.useRef(value);
  latest.current = value;

  React.useEffect(() => { onBusy?.(uploading > 0); }, [uploading, onBusy]);

  async function pick(files: FileList | null) {
    setError('');
    const room = REVIEW_PHOTO_MAX - latest.current.length - uploading;
    const chosen = Array.from(files || []).filter((f) => f.type.startsWith('image/'));
    if (!chosen.length) return;
    if (chosen.length > room) setError(`${REVIEW_PHOTO_MAX} photos au plus : ${room > 0 ? `seules les ${room} premières sont ajoutées` : 'retirez-en une pour en ajouter'}.`);
    for (const file of chosen.slice(0, Math.max(0, room))) {
      setUploading((n) => n + 1);
      try {
        const { url } = await customerApi.uploadReviewPhoto(file);
        onChange([...latest.current, url].slice(0, REVIEW_PHOTO_MAX));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Envoi de la photo impossible.');
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (input.current) input.current.value = '';
  }

  const full = value.length + uploading >= REVIEW_PHOTO_MAX;
  return (
    <div className="mt-5" data-testid="review-photos">
      <p className="text-sm font-semibold">
        Vos photos <span className="font-normal" style={{ color: 'var(--v-muted-foreground)' }}>(facultatif, {REVIEW_PHOTO_MAX} au plus)</span>
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {value.map((url) => (
          <div key={url} className="relative h-20 w-20 overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--v-border)' }} data-testid="review-photo">
            <img src={resolvePreviewMediaUrl(url)} alt="" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => onChange(value.filter((u) => u !== url))}
              className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/70 text-white"
              aria-label="Retirer cette photo"
              data-testid="review-photo-remove"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {Array.from({ length: uploading }).map((_, i) => (
          <div key={`up-${i}`} className="grid h-20 w-20 place-items-center rounded-2xl border" style={{ borderColor: 'var(--v-border)' }}>
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ))}
        {!full && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="grid h-20 w-20 place-items-center rounded-2xl border border-dashed text-xs"
            style={{ borderColor: 'var(--v-border)', color: 'var(--v-muted-foreground)' }}
            data-testid="review-photo-add"
          >
            <span className="grid justify-items-center gap-1"><Camera className="h-5 w-5" />Ajouter</span>
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => pick(e.target.files)} data-testid="review-photo-input" />
      {error && <p className="mt-2 text-xs text-red-700" role="alert">{error}</p>}
    </div>
  );
}

/** Les photos d'un avis publié : vignettes, ouvertes en grand d'un toucher. */
export function ReviewPhotos({ photos, className = '' }: { photos?: { url: string }[] | null; className?: string }) {
  const [open, setOpen] = React.useState<string | null>(null);
  const list = (photos || []).filter((p) => p?.url).slice(0, REVIEW_PHOTO_MAX);
  if (!list.length) return null;
  return (
    <>
      <div className={`flex gap-2 ${className}`} data-testid="review-photos-shown">
        {list.map((p) => (
          <button key={p.url} type="button" onClick={() => setOpen(p.url)} className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border" style={{ borderColor: 'var(--v-border)' }} aria-label="Voir la photo en grand">
            <img src={resolvePreviewMediaUrl(p.url)} alt="" loading="lazy" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
      {open && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-[80] grid place-items-center bg-black/85 p-4" onClick={() => setOpen(null)} data-testid="review-photo-viewer">
          <img src={resolvePreviewMediaUrl(open)} alt="" className="max-h-[88vh] max-w-full rounded-xl object-contain" />
          <button type="button" onClick={() => setOpen(null)} className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white" aria-label="Fermer">
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </>
  );
}
