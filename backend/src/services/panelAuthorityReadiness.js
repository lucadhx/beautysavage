// « CE FOURNISSEUR EST-IL PRÊT ? » — QUAND LA RÉPONSE APPARTIENT AU PANEL.
//
// ══ LE RENVERSEMENT ═════════════════════════════════════════════════════════
//
// `getProviderReadiness` répondait en regardant deux faits LOCAUX : une clé
// est-elle enregistrée dans ce projet, et quelqu'un a-t-il cliqué « Tester » ?
//
// Pour un fournisseur administré par la plateforme, ces deux faits sont sans
// autorité — et leur combinaison produisait la pire des réponses possibles :
//
//     clé locale présente + plateforme en panne   →  « prêt »    (faux)
//     aucune clé locale  + plateforme parfaite    →  « pas prêt » (faux)
//
// Le second cas est le plus coûteux : il envoie un opérateur coller une clé
// dans le projet, c'est-à-dire refaire exactement ce que la centralisation
// vient de défaire.
//
// ══ CE QUE CE MODULE NE FAIT PAS ════════════════════════════════════════════
//
// Il ne consulte PAS le document local, pas même « pour compléter ». Le lire
// d'abord et n'en tirer qu'un champ d'affichage rouvrirait la porte au premier
// refactor pressé — quelqu'un finirait par s'en servir pour décider.
import {
  diagnoseStripeAvailability,
  STRIPE_DIAGNOSTIC,
} from '../integrations/stripe/stripeControlPlaneDiagnostic.js';
import {
  diagnoseSignatureAvailability,
} from '../integrations/signature/signatureControlPlaneDiagnostic.js';

/**
 * Les diagnostics du Control Plane, par fournisseur.
 *
 * Une TABLE plutôt qu'un `if` : le jour où un quatrième fournisseur passe sous
 * autorité Panel, il s'ajoute ici, et l'absence d'entrée est une erreur franche
 * plutôt qu'un « prêt » par défaut.
 */
const DIAGNOSTICS = Object.freeze({
  STRIPE: async () => {
    const { invokeCapability, capabilitiesAvailable } = await import('./panelBridge/capabilityClient.js');
    return diagnoseStripeAvailability({
      invoke: capabilitiesAvailable() ? invokeCapability : null,
    });
  },
  /**
   * LA SIGNATURE — une CAPACITÉ, pas un fournisseur.
   *
   * L'entrée s'appelait `YOUSIGN`. Elle nommait celui qui servait ; depuis la
   * bascule, ce n'est plus lui, et la question serait devenue sans rapport avec
   * ce qui se passe réellement.
   *
   * Sans entrée du tout, le refus par défaut ci-dessous s'appliquerait : chaque
   * lancement de signature échouerait en `CAPABILITY_MISSING` alors que la
   * plateforme sert parfaitement la capacité.
   */
  SIGNATURE: async () => {
    const { invokeCapability, capabilitiesAvailable } = await import('./panelBridge/capabilityClient.js');
    return diagnoseSignatureAvailability({
      invoke: capabilitiesAvailable() ? invokeCapability : null,
    });
  },
});

/**
 * Traduction du diagnostic vers le vocabulaire de readiness du parc.
 *
 * ── POURQUOI PAS UN SIMPLE BOOLÉEN ──────────────────────────────────────────
 *
 * `assertProviderReady` rend le `reason` à l'appelant, qui l'affiche. Réduire
 * huit états distincts à « pas prêt » ferait disparaître l'information qui
 * compte : « la plateforme n'a pas de clé » et « ce projet n'a pas le droit »
 * envoient deux personnes différentes vers deux écrans différents.
 */
const RAISONS = Object.freeze({
  [STRIPE_DIAGNOSTIC.PANEL_NOT_PAIRED]: 'PANEL_NOT_PAIRED',
  [STRIPE_DIAGNOSTIC.PANEL_UNREACHABLE]: 'PANEL_UNREACHABLE',
  [STRIPE_DIAGNOSTIC.CAPABILITY_MISSING]: 'CAPABILITY_MISSING',
  [STRIPE_DIAGNOSTIC.CAPABILITY_NOT_GRANTED]: 'CAPABILITY_NOT_GRANTED',
  [STRIPE_DIAGNOSTIC.PANEL_CREDENTIAL_MISSING]: 'PANEL_CREDENTIAL_MISSING',
  [STRIPE_DIAGNOSTIC.PROVIDER_UNAVAILABLE]: 'PROVIDER_UNAVAILABLE',
  [STRIPE_DIAGNOSTIC.PROVIDER_TIMEOUT]: 'PROVIDER_TIMEOUT',
});

/**
 * L'état de préparation d'un fournisseur administré par la plateforme.
 *
 * La forme rendue est celle de `getProviderReadiness` — mêmes clés, mêmes
 * types — pour que les appelants n'aient rien à apprendre. Ce qui change est
 * l'ORIGINE de `ok`, et deux champs qui le disent franchement.
 *
 * @param {string} provider
 * @param {'TEST'|'PROD'} environment
 */
export async function providerReadinessViaControlPlane(provider, environment) {
  const sonde = DIAGNOSTICS[provider];
  if (!sonde) {
    /**
     * Fournisseur déclaré sous autorité Panel mais sans diagnostic : on refuse
     * plutôt que de supposer. Un « prêt » par défaut ici laisserait passer un
     * parcours dont personne n'a vérifié la chaîne.
     */
    return {
      provider, environment, activeMode: null, legacyModeMismatch: false,
      authority: 'PANEL', configured: false, verified: false, ok: false,
      reason: 'CAPABILITY_MISSING',
      message: `Aucun diagnostic de plateforme n’est défini pour ${provider}.`,
    };
  }

  const verdict = await sonde();
  return {
    provider,
    environment,
    /**
     * `activeMode` et `legacyModeMismatch` n'ont plus de sens ici : le monde
     * qui compte est celui du Panel, et le projet n'en choisit aucun. On les
     * rend neutres plutôt que de les omettre — un champ absent ferait planter
     * un écran qui les lit encore.
     */
    activeMode: null,
    legacyModeMismatch: false,
    authority: 'PANEL',
    /**
     * `configured` et `verified` gardent leur nom mais changent de sujet : ils
     * décrivent la PLATEFORME, plus le projet. Les rendre identiques à `ok`
     * est délibéré — il n'existe pas d'état « configuré mais pas vérifié »
     * quand c'est une chaîne complète qu'on vient d'éprouver.
     */
    configured: verdict.available,
    verified: verdict.available,
    ok: verdict.available,
    reason: verdict.available ? null : (RAISONS[verdict.code] ?? 'PROVIDER_UNAVAILABLE'),
    /** La phrase à afficher : elle dit QUI doit agir, et ce n'est jamais ce projet. */
    message: verdict.message,
    diagnostic: verdict.code,
  };
}

export default { providerReadinessViaControlPlane };
