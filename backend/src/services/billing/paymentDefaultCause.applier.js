import { SiteStatus } from '../../models/SiteStatus.model.js';
import { getSingleton } from '../../utils/singleton.js';
import { reconcileSiteStatus } from '../siteEnforcement.service.js';
import { logger } from '../../utils/logger.js';

/**
 * LA CAUSE « DÉFAUT DE PAIEMENT », REÇUE DU PANEL (L10.6).
 *
 * ══ CE QUE LE PANEL ENVOIE, ET CE QU'IL N'ENVOIE PAS ═══════════════════════
 *
 * Il envoie une CAUSE : « pour ce projet, le défaut de paiement est actif », ou
 * « il ne l'est plus ». Il n'envoie JAMAIS un état de site.
 *
 * La différence n'est pas de vocabulaire. Un ordre `status: SUSPENDED` créerait
 * un second maître : le jour où une maintenance technique serait en cours,
 * l'ordre du Panel la lèverait — ou serait levé par elle — et personne n'aurait
 * pris cette décision. En recevant une cause, ce projet la combine avec les
 * siennes et tranche seul, ce qui est son rôle.
 *
 * ══ POURQUOI L'APPLICATEUR APPELLE LE MOTEUR ═══════════════════════════════
 *
 * Écrire le champ ne suffit pas : `status`, `suspensionSource` et `reason` sont
 * DÉRIVÉS. Sans réconciliation, la cause serait enregistrée et le site
 * resterait ouvert — un impayé invisible.
 *
 * C'est aussi ce qui rend la réactivation correcte sans une ligne de plus :
 * retirer la cause rend la main au moteur, qui recalcule la conjonction. Si une
 * maintenance subsiste, le site reste fermé. Il n'existe nulle part de
 * `status = ACTIVE` écrit à la main.
 *
 * ══ IDEMPOTENT PAR CONSTRUCTION ════════════════════════════════════════════
 *
 * L'écriture est un REMPLACEMENT d'état, pas un incrément. Rejouer la même
 * livraison — push doublé, rattrapage après une absence — ne produit aucun
 * second effet : la cause est déjà dans l'état demandé, et la réconciliation
 * qui suit rend le même résultat.
 */
export async function applyPaymentDefaultCause({ change }) {
  const payload = change?.payload ?? null;

  /**
   * UNE TOMBE RETIRE LA CAUSE. Le Panel n'en émet pas aujourd'hui — il envoie
   * `active: false` —, mais un type synchronisable doit savoir mourir : laisser
   * une cause active après suppression fermerait un site pour un incident que
   * plus personne ne suit.
   */
  const active = change?.deleted ? false : payload?.active === true;

  const site = await getSingleton(SiteStatus);
  const avant = Boolean(site.paymentDefault?.active);

  site.paymentDefault = {
    active,
    /** Le motif exact, tel que le Panel le nomme. Jamais reformulé ici. */
    reason: active ? (payload?.reason || 'Défaut de paiement') : '',
    since: active ? (payload?.since ? new Date(payload.since) : new Date()) : null,
    paymentDefaultId: active ? (payload?.paymentDefaultId ?? null) : null,
    amountDueCents: active && Number.isInteger(payload?.amountDueCents)
      ? payload.amountDueCents
      : 0,
  };
  await site.save();

  /**
   * LE MOTEUR TRANCHE — et il est le SEUL à écrire `status`.
   *
   * Il émet lui-même l'événement de changement d'état vers le Panel quand
   * l'accessibilité bascule réellement. C'est ce retour, et non notre écriture,
   * qui prouve au Panel que le site est fermé : `suspensionRequestedAt` n'est
   * qu'une demande.
   */
  const apres = await reconcileSiteStatus({ actor: 'PANEL' });

  if (avant !== active) {
    logger.info(
      `[billing] cause « défaut de paiement » ${active ? 'activée' : 'levée'} — `
      + `site ${apres?.status ?? 'inconnu'}${apres?.suspensionSource && apres.suspensionSource !== 'NONE' ? ` (${apres.suspensionSource})` : ''}.`,
    );
  }
  return apres;
}

export default { applyPaymentDefaultCause };
