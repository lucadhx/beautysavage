import { Building2, Mail, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useResource } from '@/hooks/useResource';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@/components/ui/primitives';
import { BrandLoader } from '@/components/ui/BrandLoader';

/**
 * MON ENTREPRISE — l'identité JURIDIQUE de ce client, en LECTURE SEULE.
 *
 * ══ POURQUOI CET ÉCRAN NE PORTE AUCUN BOUTON « MODIFIER » ═══════════════════
 *
 * Ce qu'il affiche — raison sociale, SIREN, adresse de facturation, signataire
 * contractuel — est ce qui figure sur LES FACTURES de ce client et sur LES
 * CONTRATS qu'il signe. Lui laisser modifier ces champs reviendrait à lui
 * laisser choisir sur quelle entité il est facturé et qui l'engage.
 *
 * L'autorité est la fiche « Clients » du Panel. Cet écran est une FENÊTRE.
 *
 * ══ NE PAS CONFONDRE AVEC « INFORMATIONS » ══════════════════════════════════
 *
 *   Entreprise → Informations   la fiche COMMERCIALE de ce site : enseigne,
 *                               slogan, logos, horaires. Éditable, et elle doit
 *                               l'être — c'est le contenu du site.
 *   Mon espace → Mon entreprise CET écran : l'identité JURIDIQUE de la société
 *                               qui exploite le site. Non éditable.
 *
 * « Garage Dupont » peut être l'enseigne d'une « SARL DUPONT AUTOMOBILES » : la
 * première s'affiche sur le site, la seconde sur la facture.
 *
 * ══ AUCUNE INTERROGATION DU PANEL ═══════════════════════════════════════════
 *
 * La page lit la copie que le pont a fait converger dans ce projet. Une panne du
 * Panel ne vide pas l'écran, elle fige ce qu'on sait déjà — même discipline que
 * la page « Aide ».
 *
 * `live: 'client-company'` fait le reste : quand L.Y Solution rattache le
 * projet ou complète la fiche, cet écran se revalide SILENCIEUSEMENT, sans
 * rechargement. C'est le moment qui compte — celui où le client passe de
 * « paiement indisponible » à « paiement possible ».
 */

/** Une ligne « libellé / valeur ». `null` n'affiche RIEN — jamais un tiret seul. */
/**
 * CE QUI MANQUE, EN FRANÇAIS — jamais une liste de chemins techniques.
 *
 * Le Panel rend des libellés lisibles (« SIREN », « Adresse de facturation —
 * ville »). On les recopie tels quels : les réécrire ici créerait une seconde
 * traduction à tenir alignée, et la première divergence se lirait à l'écran.
 */
/**
 * UNE LIGNE D’ÉTAT DU DOSSIER — pastille, libellé court, explication.
 *
 * ══ POURQUOI UN BADGE PLUTÔT QU’UNE PHRASE ═══════════════════════════════════
 *
 * « Prête — vos paiements peuvent être ouverts. » se lit comme un document
 * administratif : il faut lire toute la phrase pour savoir si c’est une bonne
 * nouvelle. Une pastille colorée répond à la première question — « est-ce que
 * ça va ? » — avant même la lecture, et la phrase répond à la seconde.
 *
 * ══ TROIS ÉTATS, TROIS COULEURS, ET PAS UNE DE PLUS ══════════════════════════
 *
 *   vert   prête             rien à faire
 *   orange à compléter       il manque des informations, le service continue
 *   rouge  bloquée           l’acte est impossible aujourd’hui
 *
 * Le rouge est RÉSERVÉ à un blocage réel : aucune entreprise rattachée, ou un
 * signataire absent. Le banaliser sur une adresse manquante apprendrait à
 * l’ignorer le jour où il compte.
 *
 * Les classes viennent du vocabulaire déjà employé par les badges de contrat
 * (`bg-emerald-100 text-emerald-700`, `bg-amber-100…`) : inventer une seconde
 * palette ici ferait diverger deux écrans du même Manager.
 */
function EtatDossier({
  titre, pret, rattachee, quandPret, manquants: absents, bloquantSiIncomplet = false,
}: {
  titre: string;
  pret: boolean;
  rattachee: boolean;
  quandPret: string;
  manquants?: string[] | null;
  bloquantSiIncomplet?: boolean;
}) {
  const bloque = !pret && (!rattachee || bloquantSiIncomplet);
  const badge = pret
    ? { libelle: 'Prête', cls: 'bg-emerald-100 text-emerald-700', point: 'bg-emerald-600' }
    : bloque
      ? { libelle: 'Bloquée', cls: 'bg-red-100 text-red-700', point: 'bg-red-600' }
      : { libelle: 'À compléter', cls: 'bg-amber-100 text-amber-700', point: 'bg-amber-600' };

  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-baseline sm:gap-3">
      {/* Largeur fixe au-delà du mobile : les deux pastilles s’alignent. */}
      <Badge className={`${badge.cls} shrink-0 self-start sm:w-[7.5rem] sm:justify-center`}>
        <span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${badge.point}`} aria-hidden="true" />
        {badge.libelle}
      </Badge>
      <div className="min-w-0">
        <p className="text-sm font-medium">{titre}</p>
        <p className="text-sm text-muted-foreground">
          {pret ? quandPret : phraseManquants(absents, rattachee)}
        </p>
      </div>
    </div>
  );
}

/** Ce qui manque, en une phrase — ou la cause racine quand rien n’est rattaché. */
function phraseManquants(absents: string[] | null | undefined, rattachee: boolean): string {
  if (!rattachee) return "Aucune information sur votre entreprise n’est rattachée à ce projet.";
  return manquants(absents);
}

function manquants(liste?: string[] | null): string {
  const items = (liste ?? []).filter(Boolean);
  if (items.length === 0) return 'des informations sont attendues.';
  return 'il manque : ' + items.join(', ') + '.';
}

function Ligne({ label, value }: { label: string; value: string | null | undefined }) {
  const texte = String(value ?? '').trim();
  if (!texte) return null;
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-3 last:border-0 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="w-full shrink-0 text-sm text-muted-foreground sm:w-56">{label}</dt>
      <dd className="text-sm font-medium">{texte}</dd>
    </div>
  );
}

interface Adresse {
  line1?: string | null;
  line2?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
}

/**
 * Une adresse sur UNE ligne lisible.
 *
 * Les morceaux absents sont écartés plutôt que remplacés par des virgules
 * vides : « 12 rue des Lilas, , 06000 » se lit comme une donnée corrompue.
 */
function formatAdresse(adresse: Adresse | null | undefined): string | null {
  if (!adresse) return null;
  const rue = [adresse.line1, adresse.line2].map((v) => String(v ?? '').trim()).filter(Boolean);
  const ville = [adresse.postalCode, adresse.city].map((v) => String(v ?? '').trim()).filter(Boolean);
  const pays = String(adresse.country ?? '').trim();
  const morceaux = [...rue, ville.join(' '), pays === 'FR' ? '' : pays].filter(Boolean);
  return morceaux.length > 0 ? morceaux.join(', ') : null;
}

export default function MyCompanyPage() {
  const { data, loading } = useResource(
    () => api.getMyCompany(),
    [],
    { live: 'client-company' },
  );

  if (loading) return <BrandLoader />;

  const contact = data?.support?.contactEmail ?? null;
  /**
   * LE NOM DU PRESTATAIRE VIENT DU PANEL, ET DE NULLE PART AILLEURS.
   *
   * Le repli était la chaîne « L.Y Solution » — exact aujourd’hui, et faux le
   * jour où ce manager sert un autre prestataire. Surtout, il masquait une
   * configuration absente : la phrase paraissait complète alors que le Panel
   * n’avait rien publié, et personne n’allait vérifier.
   *
   * Le repli neutre était DÉJÀ celui de la ligne « Ces informations sont
   * tenues par… ». Deux replis différents pour la même donnée, dans le même
   * écran, c’est ainsi qu’un écran finit par se contredire.
   */
  const prestataire = data?.support?.providerName ?? 'votre prestataire';

  /**
   * LE PIED DE PAGE — « une information incorrecte ? ».
   *
   * L'adresse vient de la configuration publiée par le Panel
   * (`contacts.publicContactEmail`), jamais d'une constante de cet écran. Sans
   * elle, on affiche la phrase SANS lien : un `mailto:` vide ouvrirait un
   * brouillon sans destinataire, ce qui est pire que pas de lien du tout.
   */
  const pied = (
    <p className="mt-6 text-sm text-muted-foreground">
      <Mail className="mr-1.5 inline h-4 w-4 align-[-2px]" />
      Une information incorrecte ?{' '}
      {contact ? (
        <>
          Écrivez-nous à{' '}
          <a className="font-medium underline underline-offset-2" href={`mailto:${contact}`}>
            {contact}
          </a>
          .
        </>
      ) : (
        <>Contactez {prestataire} pour la faire corriger.</>
      )}
    </p>
  );

  /**
   * AUCUNE ENTREPRISE RATTACHÉE — un ÉTAT, pas une page vide.
   *
   * C'est l'état d'un projet dont le dossier client n'est pas encore constitué.
   * Il a des conséquences exactes et visibles ailleurs : ni paiement, ni
   * signature. L'écran doit donc dire ce qui se passe et vers qui se tourner,
   * pas afficher un cadre vide.
   */
  if (!data?.linked) {
    return (
      <div>
        <PageHeader
          title="Mon entreprise"
          description="Les informations légales de votre entreprise, telles que nous les détenons."
        />
        <EmptyState
          icon={Building2}
          title="Aucune information sur votre entreprise"
          description={
            "Aucune information sur votre entreprise n'est actuellement rattachée à ce projet. "
            + `Veuillez contacter ${prestataire} afin de compléter votre dossier.`
          }
          action={
            contact ? (
              <a
                className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
                href={`mailto:${contact}`}
              >
                Nous contacter
              </a>
            ) : undefined
          }
        />
      </div>
    );
  }

  const c = data.company;
  const siege = formatAdresse(c?.registeredOffice);
  const facturation = formatAdresse(c?.billingAddress);
  const signataire = c?.contractualSigner ?? null;
  const nomSignataire = [signataire?.firstName, signataire?.lastName]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
    .join(' ');

  return (
    <div>
      <PageHeader
        title="Mon entreprise"
        description="Les informations légales de votre entreprise, telles que nous les détenons. Elles figurent sur vos factures et vos contrats."
      />

      {/*
        ── DEUX ÉTATS, JAMAIS UN SEUL ────────────────────────────────────────

        Facturer et signer n’exigent pas les mêmes informations. Une entreprise
        parfaitement facturable dont le gérant vient de partir peut régler ses
        échéances mais pas signer ; l’inverse existe aussi.

        Les fondre en un seul « dossier complet / incomplet » aurait laissé le
        client deviner LEQUEL de ses deux boutons est bloqué, et pourquoi. Deux
        états séparés répondent à la seule question qu’il se pose : « pourquoi
        ne puis-je pas faire ceci ? »

        Le verdict vient du Panel. Cet écran ne le recalcule pas : deux
        implémentations de la complétude finiraient par diverger, et l’écran
        annoncerait vert ce que le serveur refuse.
      */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Ce que votre dossier permet</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:gap-5">
            <EtatDossier
              titre="Facturation"
              pret={Boolean(data.readiness?.billing?.ready)}
              rattachee={Boolean(data.linked)}
              quandPret="Les paiements peuvent être ouverts."
              manquants={data.readiness?.billing?.missing}
            />
            <EtatDossier
              titre="Signature"
              pret={Boolean(data.readiness?.signing?.ready)}
              rattachee={Boolean(data.linked)}
              quandPret="Le signataire contractuel est configuré."
              manquants={data.readiness?.signing?.missing}
              /**
               * Un signataire absent BLOQUE l’acte contractuel : il n’y a pas
               * de demi-mesure, personne ne peut signer. Une information de
               * facturation manquante, elle, se complète pendant que le service
               * continue — d’où deux couleurs différentes pour deux situations
               * qui n’ont pas la même gravité.
               */
              bloquantSiIncomplet
            />
          </div>
          {!data.readiness?.billing?.ready || !data.readiness?.signing?.ready ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Ces informations sont tenues par {prestataire}.
              {data.support?.contactEmail ? (
                <>
                  {' '}
                  <a className="underline" href={`mailto:${data.support.contactEmail}`}>
                    Nous contacter
                  </a>
                  {' pour les compléter.'}
                </>
              ) : null}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Identité
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl>
            <Ligne label="Raison sociale" value={c?.legalName} />
            <Ligne label="Nom commercial" value={c?.tradingName} />
            <Ligne label="Forme juridique" value={c?.legalForm} />
            <Ligne label="SIREN" value={c?.siren} />
            <Ligne label="SIRET" value={c?.siret} />
            <Ligne label="N° de TVA intracommunautaire" value={c?.vatNumber} />
            <Ligne label="Ville d'immatriculation" value={c?.registrationCity} />
          </dl>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Coordonnées et facturation</CardTitle>
        </CardHeader>
        <CardContent>
          <dl>
            <Ligne label="Siège social" value={siege} />
            {/*
              L'adresse de facturation n'est affichée que si elle DIFFÈRE du
              siège. La répéter à l'identique laisserait croire à deux adresses
              distinctes qu'il faudrait maintenir séparément.
            */}
            {facturation && facturation !== siege ? (
              <Ligne label="Adresse de facturation" value={facturation} />
            ) : null}
            <Ligne label="E-mail de facturation" value={c?.billingEmail} />
            <Ligne label="Téléphone" value={c?.phone} />
            <Ligne label="Site web" value={c?.website} />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Signataire contractuel
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            La personne qui engage votre entreprise lors de la signature d'un contrat.
          </p>
        </CardHeader>
        <CardContent>
          {nomSignataire ? (
            <dl>
              <Ligne label="Nom" value={nomSignataire} />
              <Ligne label="Fonction" value={signataire?.jobTitle} />
              <Ligne label="E-mail" value={signataire?.email} />
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              Aucun signataire contractuel n'est enregistré pour votre entreprise. La signature
              d'un contrat restera indisponible tant qu'il n'aura pas été renseigné par{' '}
              {prestataire}.
            </p>
          )}
        </CardContent>
      </Card>

      {pied}
    </div>
  );
}
