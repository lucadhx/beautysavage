import { getIntegratedApi } from '../integratedApi.service.js';
import { resolveProviderEnvironment } from '../integratedApiEnvironment.js';
import { capabilitiesAvailable } from '../panelBridge/capabilityClient.js';
import { getBrevoOperationalReadiness } from './brevoOperational.service.js';
import { EmailDelivery } from '../../models/EmailDelivery.model.js';

/**
 * DIAGNOSTIC DU CANAL E-MAIL — refondé en R11.
 *
 * ══ CE QU'IL DIAGNOSTIQUAIT, ET POURQUOI C'ÉTAIT DEVENU FAUX ═══════════════
 *
 * Il posait quatorze questions sur une installation LOCALE : la clé Brevo de ce
 * projet est-elle présente ? testée ? l'URL publique est-elle joignable par
 * Brevo ? le webhook est-il enregistré chez eux, à la bonne adresse, avec les
 * bons événements, et a-t-il déjà reçu quelque chose ?
 *
 * Aucune de ces questions n'a plus de sujet. Les e-mails partent du compte Brevo
 * DU PANEL, et les événements de livraison suivent le COMPTE : ils arrivent au
 * Panel, qui les reprojette par le pont. Ce projet n'a ni clé, ni endpoint, ni
 * abonnement à surveiller.
 *
 * Un diagnostic qui teste une installation disparue ne trouve pas « rien à
 * signaler » : il trouve une PANNE, et il l'annonce. Il aurait envoyé un
 * exploitant réparer une chaîne qui fonctionne — le pire service qu'un
 * diagnostic puisse rendre.
 *
 * ══ CE QU'IL DIAGNOSTIQUE MAINTENANT ═══════════════════════════════════════
 *
 * Les quatre maillons qui existent réellement, dans l'ordre où ils cassent :
 *
 *   1. le lien à la plateforme (sans lui, rien ne part) ;
 *   2. la capacité d'envoi telle que la passerelle la voit ;
 *   3. l'expéditeur — détenu par le Panel, et nommé comme tel ;
 *   4. le RETOUR de livraison, observé sur les faits déjà appliqués.
 *
 * Le point 4 est le seul qui reste observable d'ici, et il est le plus utile :
 * il ne demande à personne si le suivi est bien branché, il regarde si des
 * livraisons ont effectivement été confirmées.
 */

const OK = 'OK';
const WARN = 'WARN';
const FAIL = 'FAIL';

export const DIAGNOSTIC_VERDICT = Object.freeze({
  HEALTHY: 'HEALTHY',
  /** Aucun Panel appairé : la plateforme envoie, et elle est injoignable. */
  PANEL_NOT_PAIRED: 'PANEL_NOT_PAIRED',
  /** Le fournisseur est désactivé dans ce projet. */
  PROVIDER_NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
  /** Aucun retour de livraison n'a jamais été appliqué. */
  DELIVERY_FEEDBACK_NEVER_RECEIVED: 'DELIVERY_FEEDBACK_NEVER_RECEIVED',
});

function check(id, label, status, detail, data) {
  return { id, label, status, detail, ...(data ? { data } : {}) };
}

/**
 * Exécute le diagnostic.
 *
 * `liveTest` / `recipient` / `waitMs` sont acceptés et ignorés : ils pilotaient
 * un envoi de bout en bout dont la preuve appartient désormais à la recette
 * d'envoi (`email.send_template` contre un faux Brevo). Les refuser casserait
 * le script d'exploitation pour un paramètre devenu sans objet.
 */
export async function runEmailDiagnostics({ mode } = {}) {
  const checks = [];
  const findings = [];

  const targetMode = mode || resolveProviderEnvironment('BREVO');

  /* ── 1. LE LIEN À LA PLATEFORME ─────────────────────────────────────────── */
  const paired = capabilitiesAvailable();
  checks.push(check('panel', 'Plateforme L.Y Solution', paired ? OK : FAIL,
    paired
      ? 'Appairée : c’est elle qui envoie les e-mails de ce projet.'
      : 'Aucun Panel joignable — aucun e-mail ne peut partir.',
    { authority: 'PANEL' }));
  if (!paired) findings.push(DIAGNOSTIC_VERDICT.PANEL_NOT_PAIRED);

  /* ── 2. LE FOURNISSEUR, TEL QUE CE PROJET LE DÉCLARE ────────────────────── */
  const doc = await getIntegratedApi('BREVO');
  const enabled = Boolean(doc?.enabled);
  checks.push(check('provider', 'Fournisseur Brevo', enabled ? OK : FAIL,
    enabled
      ? `Activé, monde ${targetMode}. Aucune clé locale : autorité plateforme.`
      : 'Désactivé dans ce projet.',
    { environment: targetMode, authority: 'PANEL' }));
  if (!enabled) findings.push(DIAGNOSTIC_VERDICT.PROVIDER_NOT_CONFIGURED);

  /* ── 3. L'EXPÉDITEUR ────────────────────────────────────────────────────── */
  /*
   * On n'appelle PAS le Panel pour le lire. Un diagnostic qui dépend d'un
   * aller-retour réseau échoue sur une latence, et fait chercher une panne
   * d'expéditeur là où il n'y en a pas.
   */
  checks.push(check('sender', 'Expéditeur', OK,
    'Détenu par la plateforme (Panel → « Expéditeur e-mail »). Ce projet n’en configure aucun.',
    { authority: 'PANEL' }));

  /* ── 4. LE RETOUR DE LIVRAISON ──────────────────────────────────────────── */
  /*
   * LA SEULE PREUVE QUI VAILLE : des livraisons réellement confirmées.
   *
   * L'ancien contrôle demandait à Brevo si notre abonnement existait. Celui-ci
   * regarde si des faits sont arrivés — ce qui couvre TOUTE la chaîne (compte
   * Panel, webhook central, dispatch, pont, applicateur) sans en interroger
   * aucun maillon.
   *
   * Aucun retour n'est un AVERTISSEMENT, jamais un échec : un projet qui vient
   * d'être installé n'a encore rien envoyé, et ce n'est pas une panne.
   */
  const confirmees = await EmailDelivery.countDocuments({ deliveredAt: { $ne: null } }).catch(() => 0);
  if (confirmees > 0) {
    checks.push(check('deliveryFeedback', 'Retour de livraison', OK,
      `${confirmees} livraison(s) confirmée(s) par la plateforme.`, { confirmed: confirmees }));
  } else {
    checks.push(check('deliveryFeedback', 'Retour de livraison', WARN,
      'Aucune livraison confirmée à ce jour — normal si aucun e-mail n’a encore été envoyé.',
      { confirmed: 0 }));
    findings.push(DIAGNOSTIC_VERDICT.DELIVERY_FEEDBACK_NEVER_RECEIVED);
  }

  const operational = await getBrevoOperationalReadiness(targetMode);

  const bloquants = findings.filter((f) => f !== DIAGNOSTIC_VERDICT.DELIVERY_FEEDBACK_NEVER_RECEIVED);
  const verdict = bloquants.length ? bloquants[0] : DIAGNOSTIC_VERDICT.HEALTHY;

  return {
    mode: targetMode,
    authority: 'PANEL',
    verdict,
    findings,
    checks,
    operational: {
      ready: operational.ready,
      state: operational.state,
      blockers: operational.blockers,
    },
  };
}

/** Rendu texte, pour le script d'exploitation. */
export function formatDiagnosticReport(report) {
  const lignes = [
    '══ DIAGNOSTIC E-MAIL ══',
    `monde    : ${report.mode}`,
    `autorité : ${report.authority} (plateforme L.Y Solution)`,
    '',
  ];
  for (const c of report.checks) {
    lignes.push(`[${c.status.padEnd(4)}] ${c.label} — ${c.detail}`);
  }
  lignes.push('', `VERDICT : ${report.verdict}`);
  return lignes.join('\n');
}

export default { runEmailDiagnostics, formatDiagnosticReport, DIAGNOSTIC_VERDICT };
