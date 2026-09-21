import { getSingleton } from '../utils/singleton.js';
import { Company } from '../models/Company.model.js';
import { resolveRecipients } from './email/emailRecipientResolvers.js';
import { RECIPIENT_RESOLVER } from '../utils/emailTemplateConstants.js';
import { logger } from '../utils/logger.js';

/**
 * PRÉVENIR LES ADMINISTRATEURS D'UNE SUSPENSION MANUELLE (L10.6 FINAL).
 *
 * ══ CE MODULE NE PEUT PAS DÉFAIRE UNE SUSPENSION ════════════════════════════
 *
 * C'est sa propriété la plus importante, et elle est structurelle : il est
 * appelé APRÈS que la cause est persistée et le site réconcilié. Il ne reçoit
 * pas le document du site, ne l'écrit pas, et ne rend aucune valeur dont
 * l'appelant aurait besoin pour conclure son travail.
 *
 * Le cahier des charges est catégorique là-dessus : une panne de Brevo ne doit
 * jamais empêcher, retarder ou annuler la fermeture d'un site. Chaque échec
 * possible — plan de contrôle injoignable, template refusé, aucun destinataire,
 * fournisseur en panne, réponse perdue — est donc RAPPORTÉ, jamais propagé.
 *
 * ══ AUCUN TRANSPORT LOCAL ═══════════════════════════════════════════════════
 *
 * Ce module ne connaît pas Brevo. Il appelle `sendTemplate`, qui demande le
 * verbe `email.send_template` au Panel : c'est le Panel qui détient le modèle,
 * l'expéditeur et la clé, et qui parle au fournisseur. Il n'existe ici ni
 * driver, ni credential, ni repli — et un test statique le vérifie.
 *
 * ══ LES DESTINATAIRES SONT RECALCULÉS À CHAQUE ENVOI ════════════════════════
 *
 * `ADMIN_EMAILS` est le résolveur canonique des administrateurs du projet : les
 * comptes de rôle ADMIN, jamais les comptes DEV. Ce sont deux publics
 * différents, et les confondre enverrait au client un message d'exploitation —
 * ou, plus grave, priverait le client d'une information qui le concerne.
 *
 * Un administrateur ajouté hier reçoit le message d'aujourd'hui, sans qu'aucune
 * liste n'ait à être tenue à jour.
 */

/** Le motif TEL QU'IL S'AFFICHE quand il n'y en a pas. */
export const AUCUN_MOTIF = 'Aucun';

export const MANUAL_SUSPENSION_TEMPLATE = 'SITE_SUSPENDED_MANUAL_ADMIN';

const dateFr = (valeur) => {
  const d = valeur instanceof Date ? valeur : new Date(valeur);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Paris',
  }).format(d);
};

/**
 * LE MOTIF, MIS EN MOTS — et c'est le SEUL endroit qui le fasse.
 *
 * ══ POURQUOI « Aucun » N'EST PAS PERSISTÉ ══════════════════════════════════
 *
 * Parce que ce serait inscrire une phrase d'affichage dans une donnée métier.
 * La base dirait alors qu'un motif « Aucun » a été saisi, ce qui est faux — et
 * le jour où l'écran se traduit, ou bien la base ment, ou bien il faut la
 * migrer. La vérité stockée est la chaîne vide ; la présentation est ici.
 *
 * Exporté pour que la recette éprouve la règle plutôt que sa recopie.
 */
export function motifPourAffichage(reason) {
  const texte = String(reason ?? '').trim();
  return texte || AUCUN_MOTIF;
}

/**
 * Envoie l'annonce à chaque administrateur. NE LÈVE JAMAIS.
 *
 * ══ UNE INTENTION PAR DESTINATAIRE, ET PAS DEUX ════════════════════════════
 *
 * `actionExecutionId` dérive de l'INSTANT de la suspension et de la clé du
 * destinataire. Deux propriétés en découlent :
 *
 *  · huit clics simultanés ne produisent qu'UNE transition côté métier, donc
 *    un seul appel ici, donc un seul envoi ;
 *  · si cet appel était rejoué avec la même suspension, l'index unique de
 *    `EmailDelivery` rendrait la livraison déjà envoyée au lieu d'en créer une
 *    seconde.
 *
 * Aucune horloge courante : `Date.now()` fabriquerait une identité neuve à
 * chaque appel, et le rejeu enverrait un doublon.
 *
 * @param {{reason: string|null, actorEmail: string|null, at: Date}} notice
 * @returns {Promise<{attempted: number, sent: number, failed: number,
 *   recipients: number, skipped: string|null}>}
 */
export async function announceManualSuspension(notice) {
  const rapport = { attempted: 0, sent: 0, failed: 0, recipients: 0, skipped: null };
  if (!notice) return { ...rapport, skipped: 'NOT_REQUESTED' };

  try {
    const destinataires = await resolveRecipients(RECIPIENT_RESOLVER.ADMIN_EMAILS);
    rapport.recipients = destinataires.length;

    /**
     * AUCUN DESTINATAIRE N'EST UN CAS NORMAL, PAS UNE ERREUR.
     *
     * Un projet sans compte administrateur existe — pendant la préouverture,
     * par exemple. La suspension reste parfaitement valide ; il n'y a
     * simplement personne à prévenir, et on le dit.
     */
    if (destinataires.length === 0) {
      logger.warn(
        '[site] suspension manuelle : notification demandée, aucun administrateur à prévenir.',
      );
      return { ...rapport, skipped: 'NO_RECIPIENTS' };
    }

    const company = await getSingleton(Company).catch(() => null);
    const quand = dateFr(notice.at);
    /** L'identité de l'acte — dérivée de l'instant de la suspension. */
    const acte = new Date(notice.at).toISOString();

    const { sendTemplate } = await import('./email/emailDelivery.service.js');

    for (const destinataire of destinataires) {
      rapport.attempted += 1;
      try {
        // eslint-disable-next-line no-await-in-loop
        await sendTemplate({
          templateId: MANUAL_SUSPENSION_TEMPLATE,
          recipient: destinataire,
          variables: {
            'company.name': company?.name || 'Votre site',
            /** « Aucun » quand il n'y en a pas — la donnée, elle, reste vide. */
            'suspension.reason': motifPourAffichage(notice.reason),
            'suspension.suspendedOn': quand,
          },
          actionExecutionId: `manual-suspension:${acte}:${destinataire.key}`,
        });
        rapport.sent += 1;
      } catch (err) {
        rapport.failed += 1;
        /**
         * UN ÉCHEC PAR DESTINATAIRE N'ARRÊTE PAS LES AUTRES. Une adresse
         * refusée par le fournisseur ne doit pas priver les trois suivantes de
         * leur message.
         */
        logger.error(
          `[site] notification de suspension non envoyée — ${err?.code ?? 'ERREUR'} : `
          + `${err?.message ?? 'erreur inconnue'}. La suspension reste effective.`,
        );
      }
    }
  } catch (err) {
    /**
     * LE FILET GLOBAL. Résolution des destinataires impossible, plan de
     * contrôle injoignable, base indisponible : rien de tout cela ne défait la
     * suspension, qui est acquise depuis l'appel précédent.
     */
    rapport.skipped = 'ANNOUNCE_FAILED';
    logger.error(
      `[site] annonce de suspension manuelle impossible — ${err?.message ?? 'erreur inconnue'}. `
      + 'La suspension reste effective.',
    );
  }

  return rapport;
}

export default { announceManualSuspension, motifPourAffichage, MANUAL_SUSPENSION_TEMPLATE, AUCUN_MOTIF };
