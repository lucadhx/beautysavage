import * as React from 'react';
import { motion } from 'framer-motion';
import { FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { useSeo } from '@/lib/useSeo';
import { Section } from '@/components/ui';
import type { LegalDocument, LegalDocumentType } from '@/types';

/**
 * UNE PAGE LÉGALE — mentions légales ou politique de confidentialité.
 *
 * ══ AUCUN TEXTE LÉGAL N'EST ÉCRIT ICI ═════════════════════════════════════
 *
 * Pas une phrase, pas un nom d'entreprise, pas un SIRET. Tout vient du Panel,
 * déjà résolu, par la route publique `/api/public/legal/:type`. C'est le cœur
 * du chantier : cette vitrine peut changer entièrement de gabarit graphique
 * sans que ses pages légales bougent, et une correction de texte au Panel se
 * répand sans reconstruire ce frontend.
 *
 * ══ CE COMPOSANT NE FAIT QUE METTRE EN FORME ══════════════════════════════
 *
 * Il reçoit des sections, des paragraphes, des listes et des lignes
 * « libellé : valeur ». Il ne connaît ni variables, ni règles de
 * conditionnalité, ni données d'entreprise. Un bloc absent est un bloc que le
 * Panel a retiré — et il n'y a rien à afficher à sa place.
 *
 * ══ ET LE DESIGN ? ════════════════════════════════════════════════════════
 *
 * Il est d'ICI, entièrement : tokens du thème, typographie du site, largeur de
 * lecture. Le contenu vient du système légal, la forme vient de la vitrine.
 * C'est précisément la séparation que l'architecture pose.
 *
 * Pas de grand hero marketing : on vient lire, pas être convaincu. Une en-tête
 * courte, une largeur de lecture confortable, des titres franchement
 * hiérarchisés.
 */

const TYPE_BY_PATH: Record<string, { type: LegalDocumentType; fallbackTitle: string; description: string }> = {
  '/mentions-legales': {
    type: 'LEGAL_NOTICE',
    fallbackTitle: 'Mentions légales',
    description: "Éditeur du site, identification légale, conception et hébergement.",
  },
  '/politique-de-confidentialite': {
    type: 'PRIVACY_POLICY',
    fallbackTitle: 'Politique de confidentialité',
    description: 'Données collectées, finalités, durées de conservation et exercice de vos droits.',
  },
};

export function LegalPage({ path }: { path: keyof typeof TYPE_BY_PATH }) {
  const meta = TYPE_BY_PATH[path];
  const [document, setDocument] = React.useState<LegalDocument | null>(null);
  /**
   * TROIS ÉTATS, ET PAS DEUX.
   *
   * « en cours », « chargé », « indisponible ». Confondre les deux derniers
   * afficherait « aucun document » pendant le chargement — c'est-à-dire une
   * page vide, une fraction de seconde, sur une page qu'on vient consulter
   * exprès.
   */
  const [state, setState] = React.useState<'loading' | 'ready' | 'unavailable'>('loading');

  useSeo({ title: document?.title ?? meta.fallbackTitle, description: meta.description });

  React.useEffect(() => {
    let annule = false;
    setState('loading');
    setDocument(null);
    api
      .legalDocument(meta.type)
      .then((doc) => { if (!annule) { setDocument(doc); setState('ready'); } })
      /**
       * UNE 404 EST UN ÉTAT ATTENDU : le Panel n'a assigné aucun template à ce
       * projet. On l'annonce sobrement au lieu de rendre une page vide ou un
       * texte générique — des mentions légales approximatives seraient pires
       * qu'absentes, puisqu'elles sont opposables.
       */
      .catch(() => { if (!annule) setState('unavailable'); });
    return () => { annule = true; };
  }, [meta.type]);

  return (
    <div className="pt-20">
      <Section>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          /* La LARGEUR DE LECTURE, et rien d'autre : au-delà de ~70 caractères
             par ligne, l'œil perd le début de la ligne suivante. Un document
             juridique se lit en entier, et c'est là que ça compte. */
          className="mx-auto max-w-3xl"
        >
          <header className="mb-10">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Informations légales
            </p>
            <span className="mt-2 block h-px w-12" style={{ background: 'var(--v-accent)' }} />
            <h1 className="mt-5 text-3xl font-bold tracking-tight md:text-4xl">
              {document?.title ?? meta.fallbackTitle}
            </h1>
            {document?.updatedAt && (
              <p className="mt-3 text-sm text-muted-foreground">
                Dernière mise à jour : {formatDate(document.updatedAt)}
              </p>
            )}
          </header>

          {state === 'loading' && (
            /* Une hauteur RÉSERVÉE : sans elle, le pied de page se glisse dans
               le champ puis est repoussé quand le document arrive. */
            <div className="min-h-[50vh]" aria-busy="true" aria-live="polite">
              <p className="text-sm text-muted-foreground">Chargement du document…</p>
            </div>
          )}

          {state === 'unavailable' && (
            <div
              className="flex min-h-[40vh] flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-16 text-center"
              style={{ borderColor: 'var(--v-border)' }}
            >
              <FileText className="mb-3 h-9 w-9 text-muted-foreground" aria-hidden="true" />
              <h2 className="text-lg font-semibold">Document momentanément indisponible</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Cette page n’a pas pu être chargée. Merci de réessayer dans quelques instants, ou de
                nous contacter directement.
              </p>
            </div>
          )}

          {state === 'ready' && document && (
            <div className="legal-content">
              {document.sections.map((section, i) => (
                <section key={`${section.heading}-${i}`} className={i === 0 ? '' : 'mt-10'}>
                  {section.heading && (
                    <h2 className="mb-3 text-lg font-bold tracking-tight md:text-xl">
                      {section.heading}
                    </h2>
                  )}
                  {section.blocks.map((block, j) => {
                    if (block.type === 'PARAGRAPH') {
                      return (
                        <p
                          key={j}
                          /* `whitespace-pre-line` : les retours à la ligne saisis
                             dans l'éditeur du Panel sont voulus. Les écraser
                             recollerait des paragraphes que quelqu'un a séparés. */
                          className="mb-3 whitespace-pre-line leading-relaxed text-muted-foreground"
                        >
                          {block.text}
                        </p>
                      );
                    }
                    if (block.type === 'LIST') {
                      return (
                        <ul key={j} className="mb-3 list-disc space-y-1.5 pl-5 leading-relaxed text-muted-foreground">
                          {block.items.map((item, k) => (
                            <li key={k} className="whitespace-pre-line">{item}</li>
                          ))}
                        </ul>
                      );
                    }
                    return (
                      <dl
                        key={j}
                        className="mb-4 divide-y rounded-xl border"
                        /* La couleur des filets internes est posée sur CHAQUE ligne :
                            ne fixe qu'une épaisseur, et la couleur de bordure
                           ne s'hérite pas — le préflet Tailwind la pose sur '*'. */
                        style={{ borderColor: 'var(--v-border)' }}
                      >
                        {block.items.map((item, k) => (
                          <div
                            key={k}
                            /* Deux colonnes sur grand écran, empilées sur mobile :
                               un libellé et une valeur côte à côte dans 320 px se
                               réduiraient à deux ou trois mots par ligne. */
                            className="grid gap-1 px-4 py-2.5 sm:grid-cols-[minmax(9rem,14rem)_1fr] sm:gap-4"
                            style={{ borderColor: 'var(--v-border)' }}
                          >
                            <dt className="text-sm font-medium text-muted-foreground">{item.label}</dt>
                            <dd className="text-sm">{item.value}</dd>
                          </div>
                        ))}
                      </dl>
                    );
                  })}
                </section>
              ))}
            </div>
          )}
        </motion.div>
      </Section>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Deux pages, un composant. Elles ne diffèrent que par le TYPE demandé : leur
 * mise en forme, leur en-tête et leurs états d'erreur sont identiques, et deux
 * fichiers auraient garanti qu'une correction n'atteigne qu'une des deux.
 */
export function MentionsLegalesPage() {
  return <LegalPage path="/mentions-legales" />;
}

export function PolitiqueConfidentialitePage() {
  return <LegalPage path="/politique-de-confidentialite" />;
}

export default MentionsLegalesPage;
