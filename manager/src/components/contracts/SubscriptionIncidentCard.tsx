/**
 * MON PRÉLÈVEMENT A ÉCHOUÉ — ce que le client a le droit de lire (L10.6B-3).
 *
 * ══ VISIBLE DÈS LE PREMIER ÉCHEC, ET C'EST TOUT L'OBJET DU LOT ══════════════
 *
 * Avant ce lot, le projet n'apprenait l'existence d'un impayé qu'au moment où
 * son site fermait. Le client découvrait donc l'incident ET la sanction dans le
 * même écran, alors qu'il avait eu sept jours pour l'éviter. Cette carte
 * apparaît à la première carte refusée, pendant que le site fonctionne encore.
 *
 * ══ CE QUE CET ÉCRAN NE DIT JAMAIS ══════════════════════════════════════════
 *
 * « Nous retenterons le … ». Ce projet ne retente RIEN : Stripe est l'unique
 * ordonnanceur des tentatives de prélèvement. L'écran dit « prochaine tentative
 * prévue par Stripe », et quand la date manque, il dit qu'elle n'a pas été
 * communiquée — jamais qu'il n'y en aura pas.
 *
 * « Votre site est suspendu », tant que la suspension n'est pas CONFIRMÉE. Une
 * demande de fermeture n'est pas une fermeture : entre les deux, il y a ce
 * projet, qui peut avoir été hors ligne. Tant que `suspensionConfirmedAt`
 * manque, l'écran écrit « suspension en cours d'application ».
 *
 * ══ CE QU'IL NE CALCULE PAS ═════════════════════════════════════════════════
 *
 * Ni l'échéance de grâce — elle est REÇUE, figée par le Panel à l'ouverture de
 * l'incident — ni l'accessibilité du site, qui se lit dans `SiteStatus`.
 * Reconstruire l'échéance depuis `firstFailedAt + graceDaysSnapshot`
 * fonctionnerait aujourd'hui et mentirait le jour où le Panel bornerait un
 * cycle autrement.
 */
import * as React from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Eye, Download } from 'lucide-react';

import {
  Card, CardContent, CardHeader, CardTitle, Badge, buttonVariants,
} from '@/components/ui/primitives';
import { useSiteStatus } from '@/context/SiteStatusContext';
import { useResource } from '@/hooks/useResource';
import { api } from '@/lib/api';
import { formatCents, formatDate } from '@/lib/utils';
import type { SubscriptionIncidentView } from '@/types';

/** `null` s'affiche comme une absence, jamais comme le 1er janvier 1970. */
const quand = (v: string | null) => (v ? formatDate(v) : '—');

function Ligne({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-border py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm sm:text-right">{children}</span>
    </div>
  );
}

/**
 * LA PHRASE DU HAUT — la seule chose que beaucoup de clients liront.
 *
 * Elle est construite à partir de faits DISTINCTS, jamais d'un état unique :
 * une confirmation de suspension, une demande non confirmée, une résolution,
 * un échec en cours. Les fusionner produirait la phrase fausse du cas le plus
 * délicat — « paiement régularisé » sur un site encore fermé pour maintenance.
 */
function titre(i: SubscriptionIncidentView): { texte: string; ton: string; Icone: typeof AlertTriangle } {
  if (i.status === 'RESOLVED') {
    return { texte: 'Paiement régularisé', ton: 'bg-green-100 text-green-700', Icone: CheckCircle2 };
  }
  if (i.status === 'CLOSED') {
    return { texte: 'Abonnement terminé sans règlement', ton: 'bg-zinc-100 text-zinc-600', Icone: Clock };
  }
  if (i.suspensionConfirmedAt) {
    return { texte: 'Site suspendu pour défaut de paiement', ton: 'bg-red-100 text-red-700', Icone: AlertTriangle };
  }
  if (i.suspensionRequestedAt) {
    /*
      ORANGE, ET NON ROUGE. La suspension a été DEMANDÉE ; elle n'est pas
      confirmée. Annoncer une fermeture certaine à un client dont le site
      répond encore parfaitement serait un mensonge coûteux.
    */
    return { texte: 'Suspension en cours d’application', ton: 'bg-amber-100 text-amber-700', Icone: Clock };
  }
  return { texte: 'Paiement en échec', ton: 'bg-red-100 text-red-700', Icone: AlertTriangle };
}

function IncidentDetail({ i }: { i: SubscriptionIncidentView }) {
  const { status: site } = useSiteStatus();
  const { texte, ton, Icone } = titre(i);

  /**
   * ══ LA PREUVE EST `causes.paymentDefault`, JAMAIS `suspensionSource` ══════
   *
   * Sous maintenance technique, la cause dominante affichée par le site reste
   * `TECHNICAL` alors que le défaut de paiement est bel et bien appliqué. En
   * conclure « il n'y a pas d'impayé » cacherait au client la vraie raison pour
   * laquelle il doit payer.
   *
   * `undefined` sur une projection antérieure au lot se lit « je ne sais pas » —
   * et on n'en tire rien.
   */
  const autresCauses: string[] = [];
  if (site?.causes?.technical) autresCauses.push('maintenance technique');
  if (site?.causes?.contract) autresCauses.push('aucun contrat en cours');

  const accessible = site ? site.status === 'ACTIVE' : null;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Icone className="h-4 w-4 shrink-0" />
          {texte}
        </span>
        <span className="flex items-center gap-2">
          <Badge className={ton}>{i.reason}</Badge>
          <span className="text-sm font-semibold">{formatCents(i.amountDueCents)}</span>
        </span>
      </div>

      {/* ── PAIEMENT ─────────────────────────────────────────────────────── */}
      <Ligne label="Facture concernée">
        {i.invoiceNumber || 'Numéro non communiqué'}
      </Ligne>
      <Ligne label="Premier échec">{quand(i.firstFailedAt)}</Ligne>
      <Ligne label="Tentatives effectuées par Stripe">{i.attemptCount}</Ligne>
      {/*
        « PRÉVUE PAR STRIPE », JAMAIS « NOUS RETENTERONS ». Et une date absente
        signifie que Stripe ne l'a pas communiquée — pas qu'il n'y en aura pas.
      */}
      <Ligne label="Prochaine tentative prévue par Stripe">
        {i.nextAttemptKnown ? quand(i.nextPaymentAttemptAt) : 'Non communiquée'}
      </Ligne>

      {/* ── GRÂCE ────────────────────────────────────────────────────────── */}
      {/*
        ══ `null` ET `0` SONT DEUX DÉCISIONS OPPOSÉES ══════════════════════════

        Le test porte sur `graceConfigured`, un booléen fourni par le serveur, et
        JAMAIS sur la vérité du nombre : `i.graceDaysSnapshot ?` afficherait
        « aucun délai de grâce » à un client qui en a zéro, et lui promettrait
        qu'aucune suspension automatique n'aura lieu — alors qu'elle peut tomber
        dès l'échec.
      */}
      {i.graceConfigured ? (
        <>
          <Ligne label="Délai de grâce">
            {i.graceDaysSnapshot} jour{(i.graceDaysSnapshot ?? 0) > 1 ? 's' : ''}
          </Ligne>
          <Ligne label="Expiration du délai">
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {quand(i.graceDeadlineAt)}
            </span>
          </Ligne>
        </>
      ) : (
        <Ligne label="Délai de grâce">
          <span className="text-muted-foreground">
            Aucun délai de grâce automatique n’est configuré pour cet incident.
            Le site ne sera pas suspendu automatiquement pour ce défaut.
          </span>
        </Ligne>
      )}

      {/* ── SUSPENSION : DEMANDÉE, PUIS CONFIRMÉE ────────────────────────── */}
      {i.suspensionRequestedAt ? (
        <>
          <Ligne label="Suspension demandée le">{quand(i.suspensionRequestedAt)}</Ligne>
          <Ligne label="Suspension confirmée le">
            {i.suspensionConfirmedAt
              ? quand(i.suspensionConfirmedAt)
              : (
                <span className="text-muted-foreground">
                  Pas encore confirmée — votre site n’est pas présenté comme suspendu
                  tant que cette confirmation n’est pas reçue.
                </span>
              )}
          </Ligne>
        </>
      ) : null}

      {i.causeRemovalConfirmedAt ? (
        <Ligne label="Défaut de paiement retiré le">{quand(i.causeRemovalConfirmedAt)}</Ligne>
      ) : null}
      {i.resolvedAt ? <Ligne label="Régularisé le">{quand(i.resolvedAt)}</Ligne> : null}

      {/* ── L'ÉTAT RÉEL DU SITE ──────────────────────────────────────────── */}
      {/*
        ══ « RÉSOLU » NE VEUT PAS DIRE « ACCESSIBLE » ══════════════════════════

        Le cas obligatoire : paiement régularisé, cause financière retirée, et
        site TOUJOURS fermé parce qu'une maintenance technique subsiste. Les deux
        affirmations sont vraies en même temps, et l'écran doit les dire toutes
        les deux plutôt que d'en choisir une.
      */}
      <Ligne label="État de votre site">
        {accessible === null ? (
          <span className="text-muted-foreground">Inconnu</span>
        ) : accessible ? (
          <Badge className="bg-green-100 text-green-700">Accessible</Badge>
        ) : (
          <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
            <Badge className="bg-red-100 text-red-700">Suspendu</Badge>
            {autresCauses.length > 0 ? (
              <span className="text-xs text-muted-foreground">
                Autre cause : {autresCauses.join(', ')}
              </span>
            ) : null}
          </span>
        )}
      </Ligne>

      {/* ── LA FACTURE, ET LE SEUL GESTE POSSIBLE ────────────────────────── */}
      {/*
        ══ « PAYER » MÈNE À LA FACTURE STRIPE, ET À RIEN D'AUTRE ══════════════

        Pas d'appel à Stripe depuis ce projet, pas de montant transmis, pas de
        session ouverte : `hostedInvoiceUrl` EST la page de paiement que Stripe
        a émise pour cette facture précise. Il n'y a rien à réserver et rien à
        falsifier.

        Le bouton n'apparaît que si l'argent n'est pas rentré ET que l'adresse
        existe. Un bouton « Payer » sur une facture réglée, ou qui ne mène nulle
        part, est pire que pas de bouton.
      */}
      {(i.hostedInvoiceUrl || i.invoicePdfUrl) ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
          {i.hostedInvoiceUrl && (i.status === 'OPEN' || i.status === 'GRACE_EXPIRED') ? (
            <a
              href={i.hostedInvoiceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ size: 'sm' })}
            >
              Payer cette facture
            </a>
          ) : null}
          {i.hostedInvoiceUrl && i.status !== 'OPEN' && i.status !== 'GRACE_EXPIRED' ? (
            <a
              href={i.hostedInvoiceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <Eye className="h-4 w-4" /> Voir la facture
            </a>
          ) : null}
          {i.invoicePdfUrl ? (
            <a
              href={i.invoicePdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <Download className="h-4 w-4" /> PDF
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * LA SECTION — l'incident en cours, puis l'historique repliable.
 *
 * ══ MASQUÉE QUAND IL N'Y A RIEN ═════════════════════════════════════════════
 *
 * Un client dont les prélèvements aboutissent n'a pas à voir un bloc « aucun
 * incident » : ce serait lui annoncer un problème qui n'existe pas.
 */
export function SubscriptionIncidentCard() {
  const { data, loading } = useResource(() => api.getMySubscriptionIncidents(), []);
  const [historique, setHistorique] = React.useState(false);

  const items = data?.items ?? [];
  const actif = data?.active ?? null;

  if (loading || items.length === 0) return null;

  const passes = items.filter((i) => i.paymentDefaultId !== actif?.paymentDefaultId);

  return (
    <Card className="mb-5">
      <CardHeader>
        <CardTitle>Abonnement — incident de paiement</CardTitle>
        <p className="text-sm text-muted-foreground">
          {actif
            ? 'Un prélèvement d’abonnement n’a pas abouti. Voici où en est la situation.'
            : 'Aucun incident en cours. L’historique reste consultable ci-dessous.'}
        </p>
      </CardHeader>
      <CardContent>
        {actif ? <IncidentDetail i={actif} /> : null}

        {/*
          ══ DEUX INCIDENTS RESTENT DEUX INCIDENTS ═══════════════════════════

          Ils ne sont jamais fusionnés par contrat : deux périodes d'abonnement
          impayées sont deux factures, donc deux incidents, et les regrouper en
          effacerait un de l'historique du client.
        */}
        {passes.length > 0 ? (
          <div className="mt-4">
            <button
              type="button"
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              aria-expanded={historique}
              onClick={() => setHistorique((v) => !v)}
            >
              {historique
                ? 'Masquer les incidents précédents'
                : `Voir les incidents précédents (${passes.length})`}
            </button>
            {historique ? (
              <div className="mt-3 space-y-5">
                {passes.map((i) => (
                  <IncidentDetail key={i.paymentDefaultId} i={i} />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default SubscriptionIncidentCard;
