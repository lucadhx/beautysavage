// « STRIPE EST-IL DISPONIBLE ? » — LA RÉPONSE NE VIENT PLUS D'ICI (L6.3 FINAL).
//
// ══ CE QUE CE MODULE REMPLACE ═══════════════════════════════════════════════
//
// Le projet répondait à cette question en regardant sa propre base : une clé
// `sk_…` est-elle enregistrée, et quelqu'un a-t-il cliqué « Tester » un jour ?
//
// Les deux faits sont devenus faux. Une clé locale peut exister sans qu'aucun
// paiement ne passe par elle — c'est le cas depuis L6.2B. Et un « vérifié »
// posé il y a six mois ne dit rien de l'état actuel du compte.
//
// Pire : la réponse était rassurante à l'envers. Un projet sans clé locale mais
// dont la plateforme est parfaitement configurée s'entendait dire « Stripe
// n'est pas prêt », et un opérateur allait coller une clé qui ne servirait
// jamais.
//
// ══ CE QU'IL FAIT ══════════════════════════════════════════════════════════
//
// Il pose la question à la seule autorité qui puisse y répondre : le Control
// Plane. Aucune lecture de credential local, aucun appel à Stripe depuis ce
// projet.
//
// ══ POURQUOI CE VERBE-LÀ ═══════════════════════════════════════════════════
//
// `billing.checkout.retrieve` est la capacité de LECTURE la plus représentative
// du parcours : elle exige que le Panel ait un credential Stripe exploitable,
// que la capacité soit accordée au projet, et que le fournisseur réponde.
//
// On l'invoque avec un identifiant de session VOLONTAIREMENT INEXISTANT. Ce
// n'est pas un détour : c'est ce qui rend le diagnostic sans effet. Une session
// introuvable et un compte injoignable produisent des refus DIFFÉRENTS, et
// c'est exactement la distinction qu'on cherche —
//
//     « la chaîne fonctionne, cette session n'existe pas »   → DISPONIBLE
//     « la plateforme n'a pas de clé »                       → INDISPONIBLE
//
// Aucune ressource n'est créée, aucun paiement déclenché, aucun état modifié.
//
// ── UNE SEULE SOURCE POUR TOUS LES ÉCRANS ──────────────────────────────────
//
// Le bouton « Tester », la préparation d'un parcours de paiement et le
// diagnostic du Manager lisent le MÊME verdict. Trois implémentations auraient
// dérivé, et c'est celle qui rassure qui aurait survécu.
/**
 * Les états possibles. Le vocabulaire est celui du parc — le même que le
 * diagnostic DNS de L9.2 — parce qu'un opérateur qui a appris à lire l'un doit
 * pouvoir lire l'autre.
 */
export const STRIPE_DIAGNOSTIC = Object.freeze({
  OK: 'OK',
  PANEL_NOT_PAIRED: 'PANEL_NOT_PAIRED',
  PANEL_UNREACHABLE: 'PANEL_UNREACHABLE',
  CAPABILITY_MISSING: 'CAPABILITY_MISSING',
  CAPABILITY_NOT_GRANTED: 'CAPABILITY_NOT_GRANTED',
  PANEL_CREDENTIAL_MISSING: 'PANEL_CREDENTIAL_MISSING',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
});

/**
 * Refus de la passerelle → état de diagnostic. Une TABLE, jamais une devinette.
 *
 * Deux refus méritent une attention particulière, et ce sont les deux qui
 * signifient l'inverse de ce qu'ils ont l'air de dire :
 *
 *   `CAPABILITY_RESOURCE_NOT_OWNED` — la session n'appartient pas à ce projet.
 *      Évidemment : elle n'existe pas. Mais pour répondre cela, le Panel a dû
 *      consulter son registre de liens — donc la chaîne fonctionne.
 *
 *   `CAPABILITY_PROVIDER_UNAVAILABLE` avec une session introuvable — le
 *      fournisseur a répondu « resource_missing ». Il a donc répondu, et la clé
 *      du Panel est bonne.
 */
const PAR_CODE = Object.freeze({
  BRIDGE_NOT_PAIRED: STRIPE_DIAGNOSTIC.PANEL_NOT_PAIRED,
  PANEL_UNREACHABLE: STRIPE_DIAGNOSTIC.PANEL_UNREACHABLE,
  CAPABILITY_UNKNOWN: STRIPE_DIAGNOSTIC.CAPABILITY_MISSING,
  CAPABILITY_NOT_AVAILABLE: STRIPE_DIAGNOSTIC.CAPABILITY_MISSING,
  CAPABILITY_NOT_GRANTED: STRIPE_DIAGNOSTIC.CAPABILITY_NOT_GRANTED,
  /**
   * `CAPABILITY_BLOCKED_PREOPENING` A ÉTÉ RETIRÉ DE CETTE TABLE.
   *
   * Il traduisait le refus d'une écriture réelle tant que le Panel n'avait
   * pas été « ouvert commercialement ». Ce mécanisme a été supprimé côté
   * Panel : aucun Panel du parc ne peut plus émettre ce code, et le laisser
   * ici laisserait croire qu'un tel refus reste possible.
   */
  CAPABILITY_PROJECT_SCOPE_MISMATCH: STRIPE_DIAGNOSTIC.CAPABILITY_NOT_GRANTED,
  CAPABILITY_CREDENTIALS_MISSING: STRIPE_DIAGNOSTIC.PANEL_CREDENTIAL_MISSING,
  CAPABILITY_ENVIRONMENT_MISMATCH: STRIPE_DIAGNOSTIC.PANEL_CREDENTIAL_MISSING,
  CAPABILITY_TIMEOUT: STRIPE_DIAGNOSTIC.PROVIDER_TIMEOUT,
  CAPABILITY_PROVIDER_UNAVAILABLE: STRIPE_DIAGNOSTIC.PROVIDER_UNAVAILABLE,
});

/**
 * Les refus qui PROUVENT que la chaîne est saine.
 *
 * Le diagnostic demande une session qui n'existe pas. Un refus d'appartenance
 * est donc la réponse ATTENDUE : pour le formuler, le Panel a authentifié le
 * projet, résolu son monde, vérifié l'octroi, chargé son credential et consulté
 * son registre. Tout ce qui bloque un vrai paiement a déjà été franchi.
 */
const REFUS_QUI_VALIDENT = Object.freeze(new Set([
  'CAPABILITY_RESOURCE_NOT_OWNED',
]));

/** Phrase affichable. Elle dit QUI doit agir — c'est toute son utilité. */
const MESSAGES = Object.freeze({
  [STRIPE_DIAGNOSTIC.OK]:
    'Les paiements sont disponibles via la plateforme.',
  [STRIPE_DIAGNOSTIC.PANEL_NOT_PAIRED]:
    'Ce projet n’est relié à aucune plateforme : les paiements passent par elle, et ne peuvent pas être faits localement.',
  [STRIPE_DIAGNOSTIC.PANEL_UNREACHABLE]:
    'La plateforme ne répond pas. Aucun paiement ne peut aboutir — et aucune clé locale ne prend le relais.',
  [STRIPE_DIAGNOSTIC.CAPABILITY_MISSING]:
    'Cette plateforme ne sert pas encore les paiements. Mettez-la à jour.',
  [STRIPE_DIAGNOSTIC.CAPABILITY_NOT_GRANTED]:
    'La plateforme refuse : les paiements ne sont pas accordés à ce projet, ou son ouverture commerciale n’est pas faite.',
  [STRIPE_DIAGNOSTIC.PANEL_CREDENTIAL_MISSING]:
    'La plateforme ne détient aucune clé de paiement exploitable pour ce monde.',
  [STRIPE_DIAGNOSTIC.PROVIDER_UNAVAILABLE]:
    'Le fournisseur de paiement a refusé la demande ou n’est pas joignable depuis la plateforme.',
  [STRIPE_DIAGNOSTIC.PROVIDER_TIMEOUT]:
    'Le fournisseur de paiement n’a pas répondu à temps : l’état est indéterminé, aucune reprise automatique.',
});

const resultat = (code, extra = {}) => ({
  /**
   * L'AUTORITÉ EST TOUJOURS LA PLATEFORME — même en échec.
   *
   * C'est ce champ qui empêche l'appelant d'estampiller « vérifié » sur un
   * credential LOCAL. Un test qui n'a éprouvé aucune clé locale ne doit rien
   * écrire sur elle : ce serait un mensonge daté, et un opérateur garderait la
   * clé sur cette foi.
   */
  authority: 'PANEL',
  code,
  available: code === STRIPE_DIAGNOSTIC.OK,
  message: MESSAGES[code],
  capabilityErrorCode: null,
  checkedAt: new Date().toISOString(),
  ...extra,
});

/**
 * La sonde. Un identifiant de session qui ne peut appartenir à personne.
 *
 * Il porte un préfixe reconnaissable pour qu'un opérateur qui le croiserait
 * dans un journal comprenne immédiatement qu'il s'agit d'une sonde, et non
 * d'une vraie session perdue.
 */
const SESSION_SONDE = 'cs_diagnostic_control_plane_probe';

/**
 * Les paiements sont-ils utilisables par ce projet, ici et maintenant ?
 *
 * @param {object} args
 * @param {Function|null} [args.invoke]  façade de capacités, `null` si non appairé
 * @returns {Promise<{authority:'PANEL', code:string, available:boolean, message:string}>}
 */
export async function diagnoseStripeAvailability({ invoke = null } = {}) {
  if (typeof invoke !== 'function') return resultat(STRIPE_DIAGNOSTIC.PANEL_NOT_PAIRED);

  try {
    await invoke('billing.checkout.retrieve', {
      checkoutSessionId: SESSION_SONDE,
      operationId: `diagnostic-control-plane-${Date.now()}`,
    });
    /**
     * Une réponse POSITIVE serait surprenante — la session n'existe pas — mais
     * elle prouverait la chaîne encore plus directement. On la traite comme un
     * succès plutôt que de s'en étonner.
     */
    return resultat(STRIPE_DIAGNOSTIC.OK);
  } catch (err) {
    const code = String(err?.code ?? '');

    if (REFUS_QUI_VALIDENT.has(code)) {
      return resultat(STRIPE_DIAGNOSTIC.OK, { capabilityErrorCode: code });
    }

    /**
     * Le fournisseur a répondu « cette session n'existe pas ». Il a donc
     * RÉPONDU : la clé de la plateforme est bonne, le compte est joignable, et
     * seul l'objet demandé manque — ce qui était le but.
     */
    if (code === 'CAPABILITY_PROVIDER_UNAVAILABLE' && ressourceIntrouvable(err)) {
      return resultat(STRIPE_DIAGNOSTIC.OK, { capabilityErrorCode: code });
    }

    /**
     * Un refus qu'on ne connaît pas : de qui vient-il ?
     *
     * Le préfixe est écrit ICI plutôt qu'importé du transport de pont. Une
     * règle d'architecture interdit à un composant métier d'importer le module
     * de pont — et elle a raison : ce diagnostic doit pouvoir vivre sans
     * connaître la mécanique du transport. Trois caractères recopiés valent
     * mieux qu'une dépendance qui, une fois posée, en autorise d'autres.
     *
     * Un code `CAPABILITY_*` vient de la PASSERELLE : elle a donc répondu, et
     * l'échec est du côté fournisseur. Tout autre code signifie qu'on n'a même
     * pas atteint le Panel.
     */
    const etat = PAR_CODE[code]
      ?? (code.startsWith('CAPABILITY_')
        ? STRIPE_DIAGNOSTIC.PROVIDER_UNAVAILABLE
        : STRIPE_DIAGNOSTIC.PANEL_UNREACHABLE);

    return resultat(etat, { capabilityErrorCode: code || null });
  }
}

/**
 * Le refus vient-il d'un objet manquant plutôt que d'une panne ?
 *
 * On lit le CODE fournisseur normalisé par le Panel, jamais le message : un
 * message se traduit, se reformule, et finirait par ne plus correspondre.
 */
function ressourceIntrouvable(err) {
  const details = err?.details?.panelDetails ?? err?.details ?? {};
  return details.stripeCode === 'resource_missing'
    || details.reason === 'RESOURCE_MISSING'
    || details.httpStatus === 404;
}

export default { STRIPE_DIAGNOSTIC, diagnoseStripeAvailability };
