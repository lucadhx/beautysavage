/**
 * QUEL CHEMIN DNS ? — il n'y en a plus qu'un (L9.2).
 *
 * ══ UN SEUL CHEMIN, ET C'EST LE POINT DU LOT ════════════════════════════════
 *
 *   PANEL   capacité `dns.*` — aucun credential local, appartenance du nom
 *           vérifiée côté Panel, écriture faite avec la clé du Panel.
 *   NONE    aucun DNS automatique, avec un motif nommé.
 *
 * `LOCAL` a disparu. Ce n'était pas un troisième chemin : c'était le retour de
 * l'ancien monde sous condition, et une condition finit toujours par être
 * remplie.
 *
 * ══ CE QUE LA RECETTE RÉELLE A CLOS ═════════════════════════════════════════
 *
 * Le déploiement du 2026-08-11 (`demo-sbauto06.ly-solution.com`, TEST, commit
 * 5c615ae) est passé de bout en bout par `hostinger (via Panel)` : zone
 * `ly-solution.com` résolue en `managed`, wildcard comprise, résolutions
 * publiques du site et du Manager vérifiées, `deployment.finalize = OK`.
 *
 * C'était exactement la preuve que L9.1 exigeait pour refermer la fenêtre de
 * déploiement progressif — son critère était « un rapport de déploiement réel
 * sans ligne `DNS_PATH_LOCAL` ». Le critère est rempli, la fenêtre se ferme, et
 * `withLocal()` est supprimé avec elle.
 *
 * ══ POURQUOI SUPPRIMER PLUTÔT QUE DÉSACTIVER ════════════════════════════════
 *
 * Un repli désactivé par un drapeau reste un repli : le jour d'un incident,
 * quelqu'un le rallume « le temps de dépanner », et la centralisation qu'on
 * croyait acquise n'existe plus — sans que rien ne le signale. Le code part
 * donc, comme le pilote Brevo local est parti au lot L8.2, et pour la même
 * raison.
 *
 * ══ CE QU'UNE INDISPONIBILITÉ DU PANEL PRODUIT ══════════════════════════════
 *
 * Un motif explicite et traçable, jamais un contournement. Le déploiement
 * poursuit sans DNS automatique — il ne se croit pas complet — et le rapport
 * porte `DNS_PATH_NONE` avec la cause.
 */
import { CapabilityDnsProvider } from './capabilityDnsProvider.js';

/** Le chemin retenu. Deux valeurs : il n'y a plus de troisième voie. */
export const DNS_PATH = Object.freeze({
  PANEL: 'PANEL_CAPABILITY',
  NONE: 'NONE',
});

/**
 * Résout le fournisseur DNS à utiliser pour CE déploiement.
 *
 * @param {object} args
 * @param {string} args.siteHost   l'hôte déployé — la ressource administrée
 * @param {string} [args.runId]
 * @param {((code: string, input: object) => Promise<object>)|null} [args.invoke]
 *   La façade de capacités du pont, ou `null` si le projet n'est pas appairé.
 *   INJECTÉE : ce module ne connaît ni le pont, ni l'appairage, ni le Panel.
 * @returns {Promise<{provider: object|null, path: string, reason: string|null,
 *   available: boolean}>}
 */
export async function resolveDnsProvider({ siteHost, runId = null, invoke = null }) {
  if (typeof invoke !== 'function') return refus(siteHost ? 'PANEL_NOT_PAIRED' : 'NO_SITE_HOST');
  if (!siteHost) return refus('NO_SITE_HOST');

  const provider = new CapabilityDnsProvider({ invoke, siteHost, runId });

  /**
   * On ÉPROUVE la voie avant de la retenir.
   *
   * `verifyCredentials()` résout la zone : un aller-retour réel qui répond à la
   * seule question qui compte — « le Panel peut-il administrer CE nom pour CE
   * projet ? ». La retenir sans l'éprouver ferait échouer le déploiement plus
   * tard, au milieu de la phase DNS, là où l'échec coûte le plus cher.
   */
  try {
    await provider.verifyCredentials();
    return { provider, path: DNS_PATH.PANEL, reason: null, available: true };
  } catch (err) {
    /**
     * `capabilityCode` est lu d'abord parce que le provider TRADUIT le refus de
     * la passerelle en `HostingerError` — le vocabulaire que le moteur connaît.
     * Le code d'origine survit dans ce champ, et c'est lui qui rend le motif
     * exploitable : « pas le droit » et « Panel injoignable » ne se réparent pas
     * au même endroit.
     */
    return refus(err?.capabilityCode ?? err?.code ?? 'UNKNOWN');
  }
}

/** Aucun DNS automatique — et le motif est toujours nommé. */
function refus(cause) {
  return { provider: null, path: DNS_PATH.NONE, reason: `PANEL_UNAVAILABLE:${cause}`, available: false };
}

export default { resolveDnsProvider, DNS_PATH };
