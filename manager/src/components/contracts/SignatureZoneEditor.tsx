import * as React from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Trash2, Plus, Copy, Users, AlertTriangle, Check, User, Briefcase } from 'lucide-react';
import { FloatingSaveWidget, Fab } from '@/components/ui/FloatingSaveWidget';
import { PageNav } from '@/components/contracts/PageNav';
import { useFloatingSave } from '@/hooks/useFloatingSave';
import { cn } from '@/lib/utils';
import type { SignatureZone, SignerRole } from '@/types';
import {
  ROLE_COLOR,
  ROLE_LABEL,
  clampZone,
  createZone,
  duplicateZone,
  changeZoneRole,
  missingRoles,
  zonesEqual,
} from '@/lib/signatureZones';

/** Icône par signataire — le rôle doit se lire sans lire le texte. */
const ROLE_ICON: Record<SignerRole, React.ComponentType<{ className?: string }>> = {
  DEVELOPER: Briefcase,
  CLIENT: User,
};

/** Client d'abord : c'est la zone que l'on place le plus souvent. */
const ROLE_ORDER: SignerRole[] = ['CLIENT', 'DEVELOPER'];

/** Amplitude minimale d'un balayage, pour ne pas confondre avec un appui. */
const SWIPE_MIN_PX = 60;

/**
 * DÉLAI MAXIMAL DE CHARGEMENT D'UN DOCUMENT.
 *
 * ══ POURQUOI UNE BORNE, ET PAS « ça finira bien par arriver » ═══════════════
 *
 * `getDocument().promise` ne rejette pas toujours. Quand le worker ne se charge
 * pas — module servi avec un type MIME que le navigateur refuse, réseau coupé
 * en plein téléchargement — PDF.js bascule sur un worker de secours qui peut, à
 * son tour, ne jamais aboutir. La promesse reste alors PENDANTE, et un écran
 * qui l'attend reste en « Chargement… » indéfiniment : l'utilisateur n'a aucun
 * moyen de savoir si le document arrive dans deux secondes ou jamais.
 *
 * Une attente sans fin n'est pas un état : c'est l'absence d'état. On borne.
 */
const PDF_LOAD_TIMEOUT_MS = 20_000;

/**
 * L'URL DU WORKER PORTE L'IDENTITÉ DE LA RELEASE — et pas seulement celle de
 * son contenu.
 *
 * ══ LE DÉFAUT QUE CETTE LIGNE FERME ═════════════════════════════════════════
 *
 * Vite empreinte ses assets sur le CONTENU. C'est juste tant que le contenu
 * seul détermine ce que le navigateur reçoit — et faux dès que l'asset est
 * servi `immutable`.
 *
 * Ce worker a été servi un temps en `application/octet-stream` (extension
 * `.mjs` absente de la table MIME de nginx). Le serveur a été corrigé ; les
 * octets, eux, n'ont pas bougé, donc l'URL non plus. Un navigateur ayant
 * mémorisé la MAUVAISE réponse sous `immutable, max-age=1an` ne la redemande
 * jamais : il rejoue indéfiniment
 *
 *     Failed to load module script … "application/octet-stream"
 *     Setting up fake worker failed
 *
 * sur une adresse que le serveur sert pourtant correctement. Aucun en-tête ne
 * peut réhabiliter une URL déjà mise en cache comme immuable — seule une URL
 * DIFFÉRENTE le peut.
 *
 * ══ POURQUOI UNE RÉVISION DE RELEASE, ET NON UN HORODATAGE ══════════════════
 *
 * `Date.now()` à chaque chargement détruirait tout cache utile : le worker
 * entier serait retéléchargé à chaque ouverture de l'éditeur. La révision est
 * FIGÉE pendant
 * toute une release et ne change qu'à la suivante — le cache reste efficace, et
 * une entrée empoisonnée d'une release ne peut pas contaminer la suivante.
 *
 * Elle est injectée au build par le moteur de déploiement (`VITE_BUILD_REVISION`,
 * dérivée de l'horodatage de l'artefact). En développement, la variable est
 * absente : on retombe sur l'URL nue, ce qui est le comportement voulu — le
 * serveur de dev ne sert rien en `immutable`.
 */
const BUILD_REVISION = import.meta.env?.VITE_BUILD_REVISION ?? '';
const workerSrc = BUILD_REVISION
  ? `${workerUrl}${workerUrl.includes('?') ? '&' : '?'}build=${BUILD_REVISION}`
  : workerUrl;

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

/** Rend une page PDF dans un canvas. */
function PdfPageCanvas({ doc, pageNumber, onSize }: {
  doc: pdfjs.PDFDocumentProxy;
  pageNumber: number;
  onSize: (w: number, h: number) => void;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    let cancelled = false;
    let task: pdfjs.RenderTask | null = null;
    (async () => {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.3 });
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      onSize(viewport.width, viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      task = page.render({ canvasContext: ctx, viewport });
      try { await task.promise; } catch { /* render annulé */ }
    })();
    return () => { cancelled = true; task?.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageNumber]);
  return <canvas ref={canvasRef} className="block w-full" />;
}

type DragState =
  | { mode: 'move'; id: string; startX: number; startY: number; origX: number; origY: number }
  | { mode: 'resize'; id: string; startX: number; startY: number; origW: number; origH: number }
  | null;

/**
 * Barre d'actions flottante de la zone sélectionnée.
 *
 * Rendue en SŒUR de la zone (jamais dedans) : la zone capture le pointeur pour
 * le déplacement, un bouton imbriqué avalerait les clics. Positionnée en
 * pourcentages comme les zones, elle suit donc la zone à toute taille d'écran.
 *
 * `pointer-events-none` sur le conteneur + `auto` sur la barre : les 8 px de
 * marge sous la barre ne doivent pas voler de clics au document.
 */
function ZoneActionBar({
  zone,
  onChangeRole,
  onDuplicate,
  onRemove,
}: {
  zone: SignatureZone;
  onChangeRole: (role: SignerRole) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const barRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!menuOpen) return;
    const onDocDown = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [menuOpen]);

  // Près du haut de la page, la barre passe SOUS la zone pour rester visible.
  const below = zone.yRatio < 0.12;

  return (
    <div
      className="pointer-events-none absolute z-20"
      style={{
        left: `${zone.xRatio * 100}%`,
        top: `${(below ? zone.yRatio + zone.heightRatio : zone.yRatio) * 100}%`,
        transform: below ? 'translateY(8px)' : 'translateY(calc(-100% - 8px))',
      }}
      onPointerDown={(e) => e.stopPropagation()} // ne jamais déclencher un drag
    >
      <div
        ref={barRef}
        className="pointer-events-auto flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5 shadow-lg"
        role="toolbar"
        aria-label={`Actions de la zone ${zone.name}`}
      >
        {/* Changer de signataire */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="Changer de signataire"
            className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Users className="h-3.5 w-3.5" />
            <span className="h-2 w-2 rounded-full" style={{ background: ROLE_COLOR[zone.signerRole] }} />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute left-0 top-full z-30 mt-1 min-w-[9rem] overflow-hidden rounded-md border border-border bg-card py-1 shadow-lg"
            >
              {(['DEVELOPER', 'CLIENT'] as SignerRole[]).map((r) => (
                <button
                  key={r}
                  role="menuitemradio"
                  aria-checked={zone.signerRole === r}
                  onClick={() => { onChangeRole(r); setMenuOpen(false); }}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-muted focus:bg-muted focus:outline-none"
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: ROLE_COLOR[r] }} />
                  <span className="flex-1">{ROLE_LABEL[r]}</span>
                  {zone.signerRole === r && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <span className="h-4 w-px bg-border" aria-hidden />

        <button
          type="button"
          onClick={onDuplicate}
          title="Dupliquer la zone"
          className="rounded px-1.5 py-1 hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Copy className="h-3.5 w-3.5" />
          <span className="sr-only">Dupliquer</span>
        </button>

        <span className="h-4 w-px bg-border" aria-hidden />

        <button
          type="button"
          onClick={onRemove}
          title="Supprimer la zone"
          className="rounded px-1.5 py-1 text-red-600 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span className="sr-only">Supprimer</span>
        </button>
      </div>
    </div>
  );
}

/**
 * FAB « Ajouter une zone » — ouvre le choix du signataire.
 *
 * Le signataire se choisit AU MOMENT de créer la zone, pas via un mode
 * persistant dans la barre latérale : un état « signataire actif » invisible
 * depuis le document produit des zones du mauvais rôle sans prévenir. Le rôle
 * reste modifiable après coup sur la zone elle-même (`ZoneActionBar`).
 */
function AddZoneFab({ onAdd }: { onAdd: (role: SignerRole) => void }) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      {open && (
        <div
          role="menu"
          aria-label="Signataire de la nouvelle zone"
          className="m-rise absolute bottom-full right-0 mb-2 min-w-[11.5rem] overflow-hidden rounded-lg border border-border bg-card py-1 shadow-xl"
        >
          {ROLE_ORDER.map((r) => {
            const Icon = ROLE_ICON[r];
            return (
              <button
                key={r}
                role="menuitem"
                type="button"
                onClick={() => { onAdd(r); setOpen(false); }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-muted focus:bg-muted focus:outline-none"
              >
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                  style={{ background: `${ROLE_COLOR[r]}22`, color: ROLE_COLOR[r] }}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                Zone {ROLE_LABEL[r]}
              </button>
            );
          })}
        </div>
      )}
      <Fab
        label="Ajouter une zone"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(open && 'bg-muted')}
      >
        <Plus className={cn('h-5 w-5 transition-transform duration-200', open && 'rotate-45')} />
      </Fab>
    </div>
  );
}

export function SignatureZoneEditor({
  pdfBlob,
  initialZones,
  onChange,
  onSave,
  readOnly = false,
}: {
  pdfBlob: Blob;
  initialZones: SignatureZone[];
  onChange: (zones: SignatureZone[]) => void;
  /**
   * Fourni par le parent : l'enregistrement reste son affaire, mais le bouton
   * vit ici (widget flottant). DOIT propager ses erreurs — le widget s'appuie
   * sur le rejet pour ne pas afficher un succès mensonger.
   */
  onSave?: () => Promise<unknown>;
  readOnly?: boolean;
}) {
  const [doc, setDoc] = React.useState<pdfjs.PDFDocumentProxy | null>(null);
  /**
   * L'ÉCHEC EST UN ÉTAT, au même titre que le succès. Sans lui, le composant
   * n'a que « j'ai le document » et « je ne l'ai pas encore » — et il présente
   * le second indéfiniment quand le premier n'arrivera jamais.
   */
  const [loadError, setLoadError] = React.useState<string | null>(null);
  /** Incrémenté par « Réessayer » : c'est lui qui relance l'effet. */
  const [loadAttempt, setLoadAttempt] = React.useState(0);
  const [zones, setZones] = React.useState<SignatureZone[]>(initialZones);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  // Une seule page à l'écran : c'est ELLE qui décide de tout — les zones
  // affichées, la page d'une nouvelle zone, les calculs de coordonnées.
  const [page, setPage] = React.useState(1);
  const pageRects = React.useRef<Record<number, { w: number; h: number }>>({});
  const pageEl = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<DragState>(null);

  // Cycle d'enregistrement mutualisé avec les pages d'édition (même widget,
  // mêmes états). `zonesEqual` plutôt que la comparaison par sérialisation :
  // l'ordre du tableau de zones n'est pas signifiant.
  const { state: saveState, save } = useFloatingSave(
    zones,
    async () => {
      // Pas de `onSave?.()` : un appel optionnel résout sans rien enregistrer,
      // et le widget afficherait « ✓ Enregistré » — précisément le mensonge que
      // `lib/saveState` existe pour empêcher. Sans handler, on refuse.
      if (!onSave) throw new Error('SignatureZoneEditor : onSave manquant');
      await onSave();
      return zones;
    },
    zonesEqual
  );

  React.useEffect(() => {
    let cancelled = false;
    let task: ReturnType<typeof pdfjs.getDocument> | null = null;
    let minuteur: ReturnType<typeof setTimeout> | null = null;

    setDoc(null);
    setLoadError(null);

    (async () => {
      try {
        const buf = await pdfBlob.arrayBuffer();
        task = pdfjs.getDocument({ data: buf });

        /**
         * LA COURSE QUI GARANTIT UNE SORTIE.
         *
         * On n'attend pas seulement le document : on attend le premier des deux
         * — le document, ou l'échéance. Sans cela, une promesse pendante fige
         * l'écran, et aucun `catch` ne se déclenche jamais puisque rien ne
         * rejette.
         */
        const echeance = new Promise<never>((_, rejeter) => {
          minuteur = setTimeout(
            () => rejeter(new Error(`PDF_LOAD_TIMEOUT_${PDF_LOAD_TIMEOUT_MS}MS`)),
            PDF_LOAD_TIMEOUT_MS,
          );
        });

        const loaded = await Promise.race([task.promise, echeance]);
        if (!cancelled) setDoc(loaded);
      } catch (err) {
        /**
         * LE DÉTAIL TECHNIQUE VA À LA CONSOLE, PAS À L'ÉCRAN.
         *
         * « Setting up fake worker failed: Failed to fetch dynamically imported
         * module… » ne dit rien à qui veut placer une zone de signature, et
         * l'afficher tel quel donne l'impression d'un logiciel cassé sans
         * indiquer le moindre geste. L'écran dit ce qui s'est passé et ce qu'on
         * peut faire ; le journal garde de quoi diagnostiquer.
         */
        console.error('[SignatureZoneEditor] chargement du PDF impossible', err);
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (minuteur) clearTimeout(minuteur);
      }
    })();

    return () => {
      cancelled = true;
      if (minuteur) clearTimeout(minuteur);
      /** Libère le worker : un document abandonné ne doit pas continuer à lire. */
      void task?.destroy().catch(() => {});
    };
  }, [pdfBlob, loadAttempt]);

  const pageCount = doc?.numPages ?? 1;
  const goTo = React.useCallback(
    (p: number) => setPage(Math.min(pageCount, Math.max(1, p))),
    [pageCount]
  );

  // Un document ne rétrécit pas en cours de route, mais un AUTRE document peut
  // arriver (remplacement du PDF) : rester sur une page qui n'existe plus
  // afficherait un cadre vide.
  React.useEffect(() => { setPage((p) => Math.min(p, pageCount)); }, [pageCount]);

  // Flèches ←/→ : on ignore la frappe destinée à un champ, et pendant un
  // glisser — changer de page en plein déplacement d'une zone la perdrait de vue.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (drag.current) return;
      e.preventDefault();
      goTo(page + (e.key === 'ArrowRight' ? 1 : -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page, goTo]);

  /*
    La garde « fermeture d'onglet / rechargement » vit désormais dans
    `useFloatingSave` : elle profite ainsi à TOUTES les surfaces d'édition, et
    non à cet éditeur seul. La garder ici en double poserait deux écouteurs
    pour un même avertissement.
  */

  const update = (next: SignatureZone[]) => { setZones(next); onChange(next); };

  /**
   * Crée une zone SUR LA PAGE AFFICHÉE, au centre de ce qui est à l'écran.
   *
   * `createZone` la placerait en haut à gauche : sur une page plus haute que
   * l'écran, elle naîtrait hors du champ de vision et le clic semblerait sans
   * effet. On vise donc le centre de la bande réellement visible.
   */
  const addZone = (role: SignerRole) => {
    const base = createZone(page, role);
    const el = pageEl.current;

    let placed = base;
    if (el) {
      const rect = el.getBoundingClientRect();
      const top = Math.max(rect.top, 0);
      const bottom = Math.min(rect.bottom, window.innerHeight);
      // Page hors écran (course de défilement) : on garde le placement par
      // défaut plutôt que de diviser par zéro.
      if (rect.height > 0 && bottom > top) {
        const centerY = (top + bottom) / 2 - rect.top;
        placed = clampZone({
          ...base,
          xRatio: 0.5 - base.widthRatio / 2,
          yRatio: centerY / rect.height - base.heightRatio / 2,
        });
      }
    }
    update([...zones, placed]);
    setSelectedId(placed.id);
  };
  const removeZone = (id: string) => { update(zones.filter((z) => z.id !== id)); setSelectedId(null); };
  const patchZone = (id: string, patch: Partial<SignatureZone>) =>
    update(zones.map((z) => (z.id === id ? { ...z, ...patch } : z)));

  const applyToZone = (id: string, fn: (z: SignatureZone) => SignatureZone) =>
    update(zones.map((z) => (z.id === id ? fn(z) : z)));

  /** La copie devient la zone sélectionnée : on enchaîne les duplications. */
  const duplicate = (id: string) => {
    const src = zones.find((z) => z.id === id);
    if (!src) return;
    const copy = duplicateZone(src);
    update([...zones, copy]);
    setSelectedId(copy.id);
  };

  const onPointerMove = (e: React.PointerEvent, page: number) => {
    const d = drag.current;
    if (!d) return;
    const rect = pageRects.current[page];
    if (!rect) return;
    const container = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const dx = (e.clientX - d.startX) / container.width;
    const dy = (e.clientY - d.startY) / container.height;
    const z = zones.find((zz) => zz.id === d.id);
    if (!z) return;
    if (d.mode === 'move') {
      patchZone(d.id, {
        xRatio: Math.max(0, Math.min(1 - z.widthRatio, d.origX + dx)),
        yRatio: Math.max(0, Math.min(1 - z.heightRatio, d.origY + dy)),
      });
    } else {
      patchZone(d.id, {
        widthRatio: Math.max(0.05, Math.min(1 - z.xRatio, d.origW + dx)),
        heightRatio: Math.max(0.03, Math.min(1 - z.yRatio, d.origH + dy)),
      });
    }
  };
  const endDrag = () => { drag.current = null; };

  /**
   * Balayage mobile — changer de page au doigt.
   *
   * Deux garde-fous, sinon le geste vole le travail de l'utilisateur :
   * on ignore le balayage démarré sur une zone (`drag.current`), et on exige un
   * mouvement franchement HORIZONTAL — sans quoi un simple défilement vertical
   * du document ferait sauter de page. `touch-pan-y` laisse le défilement
   * vertical au navigateur.
   */
  const touchStart = React.useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    if (drag.current) { touchStart.current = null; return; }
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || drag.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    goTo(page + (dx < 0 ? 1 : -1)); // balayer vers la gauche = page suivante
  };

  /**
   * TROIS ÉTATS, ET AUCUN N'EST UNE ATTENTE SANS FIN.
   *
   * L'échec passe AVANT le chargement : tant que l'erreur n'était pas un état,
   * l'écran retombait sur « Chargement du PDF… » et l'y restait pour toujours.
   */
  if (loadError) {
    return (
      <div className="py-16 text-center">
        <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-destructive" aria-hidden />
        <p className="text-sm font-medium">Impossible de charger le document PDF.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Le détail technique est disponible dans la console du navigateur.
        </p>
        <button
          type="button"
          className="mt-4 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          onClick={() => setLoadAttempt((n) => n + 1)}
        >
          Réessayer
        </button>
      </div>
    );
  }
  if (!doc) return <div className="py-16 text-center text-sm text-muted-foreground">Chargement du PDF…</div>;

  const selected = readOnly ? null : zones.find((z) => z.id === selectedId) || null;
  const missing = missingRoles(zones);
  const pageZones = zones.filter((z) => z.page === page);
  // Repérer les pages qui portent des zones sans avoir à les visiter.
  const zonesByPage = zones.reduce<Record<number, number>>((acc, z) => {
    acc[z.page] = (acc[z.page] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
      {/* La FRAME du document : une page à la fois, et le dock à sa fin. */}
      <div className="rounded-md border border-border bg-muted/30 p-3 sm:p-4">
        <PageNav page={page} pageCount={pageCount} onChange={goTo} zonesByPage={zonesByPage} className="mb-3" />

        <div
          ref={pageEl}
          className="relative select-none touch-pan-y"
          onPointerMove={(e) => onPointerMove(e, page)}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          // Cliquer le document (hors zone) désélectionne : la barre flottante
          // ne doit pas rester en place sans raison.
          onPointerDown={() => setSelectedId(null)}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <PdfPageCanvas doc={doc} pageNumber={page} onSize={(w, h) => (pageRects.current[page] = { w, h })} />

          {/* SEULES les zones de la page affichée existent à l'écran. Celles des
              autres pages ne sont pas cachées : elles ne sont pas rendues — et
              reviennent intactes quand on revient sur leur page. */}
          {pageZones.map((z) => (
            <div
              key={z.id}
              onPointerDown={readOnly ? undefined : (e) => {
                e.stopPropagation();
                setSelectedId(z.id);
                drag.current = { mode: 'move', id: z.id, startX: e.clientX, startY: e.clientY, origX: z.xRatio, origY: z.yRatio };
                (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
              }}
              // `touch-none` : la frame est en `touch-pan-y` (défilement
              // vertical + balayage horizontal). Sans cette exception, le
              // navigateur avalerait le geste vertical et une zone ne pourrait
              // plus être déplacée au doigt que latéralement.
              className={`absolute rounded border-2 ${readOnly ? '' : 'cursor-move touch-none'}`}
              style={{
                left: `${z.xRatio * 100}%`,
                top: `${z.yRatio * 100}%`,
                width: `${z.widthRatio * 100}%`,
                height: `${z.heightRatio * 100}%`,
                borderColor: ROLE_COLOR[z.signerRole],
                background: `${ROLE_COLOR[z.signerRole]}22`,
                outline: selectedId === z.id ? `2px solid ${ROLE_COLOR[z.signerRole]}` : 'none',
              }}
            >
              {/* Le libellé cède la place à la barre quand la zone est
                  sélectionnée : les deux occupent le même espace au-dessus. */}
              {selectedId !== z.id && (
                <span
                  className="pointer-events-none absolute -top-5 left-0 whitespace-nowrap text-[10px] font-semibold"
                  style={{ color: ROLE_COLOR[z.signerRole] }}
                >
                  {z.name}
                </span>
              )}
              {!readOnly && (
                <div
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    drag.current = { mode: 'resize', id: z.id, startX: e.clientX, startY: e.clientY, origW: z.widthRatio, origH: z.heightRatio };
                    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                  }}
                  className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-se-resize rounded-full border border-white"
                  style={{ background: ROLE_COLOR[z.signerRole] }}
                />
              )}
            </div>
          ))}

          {/* Barre d'actions — sœur des zones, jamais imbriquée. */}
          {selected && selected.page === page && (
            <ZoneActionBar
              zone={selected}
              onChangeRole={(role) => applyToZone(selected.id, (z) => changeZoneRole(z, role))}
              onDuplicate={() => duplicate(selected.id)}
              onRemove={() => removeZone(selected.id)}
            />
          )}
        </div>

        {/* Ajouter + Enregistrer — DOCKÉS AU BAS DE LA FRAME (`sticky`) : collés
            au bas de l'écran tant que la frame descend plus bas, puis posés à sa
            fin. Dernier enfant : c'est là leur point d'arrêt naturel. */}
        {!readOnly && (
          <FloatingSaveWidget
            anchor="sticky"
            className="mt-4"
            state={saveState}
            onSave={save}
            before={<AddZoneFab onAdd={addZone} />}
          />
        )}
      </div>

      {/* Sidebar : liste défilante + pied fixe. Elle ne porte plus d'action —
          « Ajouter » et « Enregistrer » vivent sur le document, là où se fait
          le travail. Le sélecteur « Signataire à placer » a disparu avec eux :
          le rôle se choisit à la création, dans le FAB.

          `sticky` : la frame fait désormais toute la hauteur du document, et
          la liste des zones est le seul chemin vers les autres pages — elle ne
          doit pas défiler hors de vue. */}
      <div className="flex max-h-[calc(var(--m-viewport-h)*0.7)] flex-col gap-3 lg:sticky lg:top-0 lg:self-start">
        {/* Liste — seule zone défilante. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-md border border-border p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Zones ({zones.length})</p>
          <div className="space-y-1.5">
            {[...zones]
              .sort((a, b) => a.page - b.page || a.yRatio - b.yRatio || a.xRatio - b.xRatio)
              .map((z) => (
                <div
                  key={z.id}
                  // La liste est le seul chemin vers une zone d'une AUTRE page :
                  // sélectionner sans y aller mettrait en avant un invisible.
                  onClick={() => { goTo(z.page); setSelectedId(z.id); }}
                  className={`flex cursor-pointer items-center justify-between rounded px-2 py-1 text-xs ${selectedId === z.id ? 'bg-muted' : ''}`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: ROLE_COLOR[z.signerRole] }} />
                    <span className={z.page === page ? '' : 'text-muted-foreground'}>{z.name} · p.{z.page}</span>
                  </span>
                  {!readOnly && (
                    <span className="flex items-center gap-1">
                      <button
                        // La copie reste sur SA page : on suit donc la copie.
                        onClick={(e) => { e.stopPropagation(); goTo(z.page); duplicate(z.id); }}
                        title="Dupliquer"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeZone(z.id); }}
                        title="Supprimer"
                        className="text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  )}
                </div>
              ))}
            {zones.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {readOnly ? 'Aucune zone configurée.' : 'Aucune zone. Utilisez le bouton « + » sur le document.'}
              </p>
            )}
          </div>
        </div>

        {/* La contrainte backend (1 zone par signataire) est annoncée ICI,
            avant l'enregistrement — pas découverte à la validation.
            « Modifications non enregistrées » n'y figure plus : le widget
            flottant porte cette information en permanence. */}
        {!readOnly && missing.length > 0 && (
          <div className="shrink-0 rounded-md border border-amber-300 bg-amber-50 p-3">
            <p className="flex items-start gap-1.5 text-[11px] text-amber-800">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>
                Zone manquante : {missing.map((r) => ROLE_LABEL[r]).join(', ')}. La validation du contrat
                l'exigera.
              </span>
            </p>
          </div>
        )}

        {readOnly && (
          <div className="shrink-0 rounded-md border border-border p-3 text-xs text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">Légende</p>
            <p className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: ROLE_COLOR.DEVELOPER }} /> Développeur (signe en 1er)
            </p>
            <p className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: ROLE_COLOR.CLIENT }} /> Client
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
