// Galerie éditable intégrée à « Identité » : 1re image = couverture (mention + preview),
// ajout par URL ou upload (à la chaîne), réordonnancement par glisser-déposer animé, suppression.
import { useState } from 'react';

export function CatalogueGalleryEditor({
  images,
  onChange,
  onUpload,
  uploadDisabledHint,
}: {
  images: string[];
  onChange: (images: string[]) => void;
  /** Si absent, l'upload est désactivé (ajout par URL reste possible). */
  onUpload?: (file: File) => Promise<string>;
  uploadDisabledHint?: string;
}) {
  const [url, setUrl] = useState('');
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const list = images ?? [];

  const addUrl = () => {
    const v = url.trim();
    if (!v) return;
    onChange([...list, v]);
    setUrl('');
  };
  const remove = (i: number) => onChange(list.filter((_, idx) => idx !== i));
  const reorder = (from: number, to: number) => {
    if (from === to) return;
    const next = list.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  const onFiles = async (files: FileList | null) => {
    if (!onUpload || !files || !files.length) return;
    setUploading(true);
    setError('');
    try {
      const urls: string[] = [];
      for (const file of Array.from(files)) urls.push(await onUpload(file));
      onChange([...list, ...urls]);
    } catch {
      setError('Échec du téléversement — réessayez.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="cat-gal">
      {list.length ? (
        <ul className="cat-gal__grid">
          {list.map((src, i) => (
            <li
              key={`${src}-${i}`}
              className={[
                'cat-gal__item',
                i === 0 ? 'cat-gal__item--cover' : '',
                drag === i ? 'cat-gal__item--drag' : '',
                over === i && drag !== null && drag !== i ? 'cat-gal__item--over' : '',
              ].filter(Boolean).join(' ')}
              draggable
              onDragStart={() => setDrag(i)}
              onDragEnd={() => { setDrag(null); setOver(null); }}
              onDragOver={(e) => { e.preventDefault(); if (over !== i) setOver(i); }}
              onDrop={(e) => { e.preventDefault(); if (drag !== null) reorder(drag, i); setDrag(null); setOver(null); }}
            >
              <span className="cat-gal__handle" aria-hidden="true"><i className="bi bi-grip-vertical" /></span>
              <img className="cat-gal__img" src={src} alt="" loading="lazy" />
              {i === 0 ? <span className="cat-gal__badge"><i className="bi bi-star-fill" aria-hidden="true" /> Couverture</span> : null}
              <button type="button" className="cat-gal__remove" aria-label="Retirer l'image" onClick={() => remove(i)}>
                <i className="bi bi-x-lg" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="cat-note">Aucune image. Ajoutez-en une ci-dessous — la 1re sera la couverture.</p>
      )}

      <div className="cat-gal__add">
        <div className="cat-gal__url">
          <input
            className="cat-input"
            placeholder="Coller une URL d'image…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addUrl(); } }}
          />
          <button type="button" className="cat-btn cat-btn--ghost" disabled={!url.trim()} onClick={addUrl}>
            <i className="bi bi-link-45deg" aria-hidden="true" /> Ajouter
          </button>
        </div>
        <label className={`cat-gal__upload${onUpload ? '' : ' cat-gal__upload--off'}`}>
          <input type="file" accept="image/*" multiple hidden disabled={!onUpload || uploading} onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }} />
          <i className="bi bi-upload" aria-hidden="true" /> {uploading ? 'Téléversement…' : 'Téléverser'}
        </label>
      </div>

      {!onUpload && uploadDisabledHint ? <p className="cat-note">{uploadDisabledHint}</p> : null}
      {error ? <p className="cat-note cat-note--error">{error}</p> : null}
      {list.length > 1 ? <p className="cat-note"><i className="bi bi-arrows-move" aria-hidden="true" /> Glissez-déposez pour changer l'ordre.</p> : null}
    </div>
  );
}
