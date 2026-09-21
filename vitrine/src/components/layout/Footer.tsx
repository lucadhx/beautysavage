import { Link } from 'react-router-dom';
import { Globe, ArrowUpRight } from 'lucide-react';
import { useSiteData } from '@/context/SiteDataContext';
import { MediaIcon } from '@/components/MediaIcon';
import type { LegalDocumentType } from '@/types';
import { mediaHref } from '@/lib/utils';
import { copyrightNotice } from '@/lib/copyright';
import { resolvePreviewMediaUrl } from '@/lib/media';

/**
 * TYPE DE DOCUMENT → ROUTE FRANÇAISE.
 *
 * Une table plutôt qu'une transformation : `LEGAL_NOTICE` ne donne pas
 * « mentions-legales » par une règle, et le déduire aurait exigé un
 * dictionnaire de toute façon — mais caché dans une fonction. Ici la
 * correspondance se lit, et elle est la même que celle des routes d'App.tsx.
 */
const LEGAL_ROUTES: Record<LegalDocumentType, string> = {
  LEGAL_NOTICE: '/mentions-legales',
  PRIVACY_POLICY: '/politique-de-confidentialite',
};

/**
 * LE PIED DE PAGE — ce qu'on cherche quand on a fini de lire.
 *
 * ══ CE QU'IL NE PORTE PLUS ══════════════════════════════════════════════════
 *
 * Ni horaires d'ouverture, ni statut « ouvert / fermé », ni liste de services.
 * Le moteur vient d'un projet de commerce, où ces trois blocs sont l'essentiel
 * du pied de page. Une maison de conception n'a pas de guichet : un tableau
 * « samedi — fermé » y annoncerait une indisponibilité inexacte, et une
 * colonne « nos services » recréerait par la petite porte le catalogue que le
 * plan de site refuse.
 *
 * Restent quatre choses : qui nous sommes, comment nous joindre, où aller, et
 * ce que la loi exige.
 */
export function Footer() {
  const { data } = useSiteData();
  const company = data?.company;
  const developer = data?.developer;
  const enabledMedia = (company?.media || []).filter((m) => m.enabled && m.value);
  const chapitres = (data?.chapters ?? []).filter((c) => c.showInNav);
  /**
   * Le backend ne renvoie que les documents RÉELLEMENT servis. On filtre tout
   * de même sur la table de routes : un type inconnu — un backend plus récent
   * qui en publierait un troisième — produirait sinon un lien vers undefined.
   */
  const legalDocuments = (data?.legalDocuments ?? []).filter((doc) => LEGAL_ROUTES[doc.type]);
  const logo = resolvePreviewMediaUrl(company?.logos?.header, data?.network?.backendUrl);

  return (
    /*
      LE PIED DE PAGE EST UNE SURFACE, PAS UNE COULEUR DE MARQUE.

      Il se distingue par un écart de VALEUR, pas par une teinte : `--v-surface`
      décale le fond de la page d'un cran vers le texte (voir `index.css`). Fond
      noir → noir un peu plus gris ; fond blanc → blanc un peu moins blanc. Un
      aplat de marque, lui, forcerait tout ce qui s'y pose à être écrit en
      blanc — et deviendrait illisible à la première palette claire.
    */
    <footer
      style={{
        background: 'var(--v-surface)',
        color: 'var(--v-foreground)',
        borderTop: '1px solid var(--v-border)',
      }}
    >
      <div className="mx-auto max-w-6xl px-5 py-16 md:px-8 md:py-20">
        {/*
          L'APPEL FINAL — la dernière chose que lit quelqu'un qui a tout lu.

          Il est dans le pied de page et non dans une section de plus : à cet
          endroit, le visiteur a fini. Lui redemander de descendre encore pour
          trouver comment nous écrire serait le perdre au moment précis où il
          est décidé.
        */}
        <Link
          to="/contact"
          className="group flex flex-wrap items-end justify-between gap-6 border-b pb-14 md:pb-16"
          style={{ borderColor: 'var(--v-border)' }}
        >
          <p
            className="max-w-2xl text-3xl font-semibold leading-[1.1] tracking-[-0.02em] md:text-5xl"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            Une question ou une envie de rendez-vous ?
          </p>
          <ArrowUpRight className="h-8 w-8 shrink-0 transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-1" />
        </Link>

        <div className="mt-14 grid gap-12 md:grid-cols-4">
          <div className="md:col-span-2">
            {logo ? (
              <img src={logo} alt={company?.name || ''} className="h-9 object-contain" />
            ) : (
              <span
                className="text-lg font-semibold tracking-[-0.02em]"
                style={{ fontFamily: 'var(--font-heading)' }}
              >
                {company?.name}
              </span>
            )}
            {company?.tagline && (
              <p
                className="mt-5 max-w-sm text-sm font-light leading-relaxed"
                style={{ color: 'color-mix(in srgb, var(--v-foreground) 60%, var(--v-background))' }}
              >
                {company.tagline}
              </p>
            )}
            {enabledMedia.length > 0 && (
              <div className="mt-7 flex flex-wrap gap-2">
                {enabledMedia.map((m) => (
                  <a
                    key={m.key}
                    href={mediaHref(m.kind, m.value)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-10 w-10 items-center justify-center border transition-colors"
                    style={{ borderColor: 'var(--v-border)', borderRadius: 'var(--v-radius)' }}
                    title={m.label}
                    aria-label={m.label}
                  >
                    <MediaIcon name={m.icon} className="h-4 w-4" />
                  </a>
                ))}
              </div>
            )}
          </div>

          {chapitres.length > 0 && (
            <div>
              <h4
                className="mb-5 text-[11px] font-semibold uppercase tracking-[0.24em]"
                style={{ color: 'color-mix(in srgb, var(--v-foreground) 42%, var(--v-background))' }}
              >
                Le parcours
              </h4>
              <ul className="space-y-3 text-sm">
                {chapitres.map((c) => (
                  <li key={c._id}>
                    <Link
                      to={`/${c.slug}`}
                      className="transition-opacity hover:opacity-100"
                      style={{ color: 'color-mix(in srgb, var(--v-foreground) 68%, var(--v-background))' }}
                    >
                      {c.navLabel || c.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h4
              className="mb-5 text-[11px] font-semibold uppercase tracking-[0.24em]"
              style={{ color: 'color-mix(in srgb, var(--v-foreground) 42%, var(--v-background))' }}
            >
              Le site
            </h4>
            <ul
              className="space-y-3 text-sm"
              style={{ color: 'color-mix(in srgb, var(--v-foreground) 68%, var(--v-background))' }}
            >
              <li><Link to="/" className="hover:underline">Accueil</Link></li>
              <li><Link to="/prestations" className="hover:underline">Prestations</Link></li>
              <li><Link to="/formations" className="hover:underline">Formations</Link></li>
              <li><Link to="/contact" className="hover:underline">Contact</Link></li>
            </ul>
            {/*
              ── LES LIENS LÉGAUX ────────────────────────────────────────────

              Ils ne s'affichent que si le Panel a réellement publié les
              documents pour ce projet. Codés en dur, ils mèneraient à une page
              « document indisponible » sur un projet sans affectation —
              c'est-à-dire à un lien mort au pied de CHAQUE page du site.

              Bloc séparé de la navigation : « Accueil » se suit pour continuer
              sa visite ; les mentions légales se cherchent pour vérifier
              quelque chose. Les mêler ferait passer les premières pour des
              pages administratives.

              Le LIBELLÉ vient du Panel : c'est le titre réel du document servi.
            */}
            {legalDocuments.length > 0 && (
              <ul
                className="mt-6 space-y-3 border-t pt-5 text-sm"
                style={{
                  borderColor: 'var(--v-border)',
                  color: 'color-mix(in srgb, var(--v-foreground) 50%, var(--v-background))',
                }}
              >
                {legalDocuments.map((doc) => (
                  <li key={doc.type}>
                    <Link to={LEGAL_ROUTES[doc.type]} className="hover:underline">
                      {doc.title}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div
          className="mt-16 flex flex-col items-center justify-between gap-3 border-t pt-7 text-xs md:flex-row"
          style={{
            borderColor: 'var(--v-border)',
            color: 'color-mix(in srgb, var(--v-foreground) 45%, var(--v-background))',
          }}
        >
          <p>{copyrightNotice(company?.name)}</p>
          {/*
            QUI A RÉALISÉ CE SITE — l'identité vient du Panel, qui en est
            l'autorité, et le projet en conserve la dernière version reçue.

            Sur CE projet, l'éditeur et le réalisateur sont la même entreprise :
            la ligne dira donc « Réalisé par L.Y Solution » sous « © L.Y
            Solution ». C'est redondant, et c'est juste — la mention n'est pas
            une signature d'auteur, c'est une information sur qui opère le site,
            et la supprimer ici demanderait un cas particulier dans un composant
            partagé par tout le parc. Le Panel reste libre de ne rien publier :
            le bloc disparaît alors de lui-même.
          */}
          {developer?.name && (
            <p className="flex items-center gap-1.5">
              Réalisé par
              {developer.websiteUrl ? (
                <a
                  href={developer.websiteUrl}
                  target="_blank"
                  /* `noopener` : sans lui, la page ouverte peut manipuler la
                     nôtre via `window.opener`. */
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium hover:underline"
                >
                  {developer.name}
                  <Globe className="h-3 w-3 shrink-0" aria-hidden="true" />
                </a>
              ) : (
                <span className="font-medium">{developer.name}</span>
              )}
            </p>
          )}
        </div>
      </div>
    </footer>
  );
}
