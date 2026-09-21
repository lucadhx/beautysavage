import { ContactSubmission } from '../../models/ContactSubmission.model.js';
import { Company } from '../../models/Company.model.js';
import { SystemConfiguration } from '../../models/SystemConfiguration.model.js';
import { getSingleton } from '../../utils/singleton.js';
import { contactReasonLabel } from '../../utils/contactConstants.js';
import { EmailVariableResolverError } from './emailVariableResolvers.js';
import { EMAIL_DELIVERY_ERROR_CODES as D } from '../../utils/emailTemplateConstants.js';

/**
 * Résolveur de variables de `CONTACT_ADMIN_NOTIFICATION`.
 *
 * ─── IL CHARGE LA DEMANDE, IL NE LIT PAS L'ÉVÉNEMENT ─────────────────────────
 *
 * L'événement ne porte ni le message, ni l'adresse en clair (voir le registre) :
 * il ne pourrait donc pas alimenter l'e-mail. Le résolveur relit la demande dans
 * `ContactSubmission`, sa seule copie.
 *
 * C'est aussi ce qui garantit que l'e-mail dit la VÉRITÉ AU MOMENT DE L'ENVOI :
 * si un retry a lieu dix minutes après, on renvoie ce que la demande contient,
 * pas une photographie prise à l'émission.
 *
 * ─── CHAQUE CLÉ EST ÉCRITE À LA MAIN ─────────────────────────────────────────
 *
 * Aucun accès générique du type `{{contact.anything}}` : un mapping explicite ne
 * peut pas exposer par accident un champ que personne n'avait prévu de publier.
 */

/**
 * URL de la demande dans le Manager, construite depuis la configuration réseau.
 *
 * JAMAIS D'URL EN DUR : le Manager change d'adresse entre développement, TEST et
 * production. Une URL codée en dur produirait un lien mort dans un e-mail réel,
 * et personne ne s'en apercevrait avant qu'un administrateur ne clique.
 *
 * Même source et même normalisation que `contract.admin.controller.js`.
 */
async function managerSubmissionUrl(submissionId) {
  const cfg = await getSingleton(SystemConfiguration);
  const managerUrl = (cfg.network?.managerUrl || '').replace(/\/+$/, '');
  if (!managerUrl) {
    // `manager.contactSubmissionUrl` est REQUISE par le template : sans URL, le
    // rendu échouerait sur un message obscur (« variable obligatoire absente »).
    // On échoue ici, où la cause est nommable.
    throw new EmailVariableResolverError(
      D.UNKNOWN_RESOLVER,
      "L'URL du Manager n'est pas configurée (Configuration système → réseau) : " +
        "impossible de construire le lien vers la demande."
    );
  }
  return `${managerUrl}/demandes-contact/${submissionId}`;
}

/**
 * @param {{ event: object }} context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function resolveContactAdminNotification({ event }) {
  const submissionId = event?.entityId || event?.payloadSafe?.submissionId;
  if (!submissionId) {
    throw new EmailVariableResolverError(
      D.UNKNOWN_RESOLVER,
      "L'événement ne porte aucun identifiant de demande."
    );
  }

  const submission = await ContactSubmission.findOne({ submissionId }).lean();
  if (!submission) {
    // La demande a disparu entre l'émission et l'envoi (purge, suppression
    // manuelle). Non retryable : elle ne reviendra pas.
    throw new EmailVariableResolverError(
      D.UNKNOWN_RESOLVER,
      `La demande ${submissionId} n'existe plus : notification sans objet.`
    );
  }

  const company = await getSingleton(Company);

  /**
   * ══ L'ENTREPRISE ET SON ACTIVITÉ — RÉTABLIES LE 27/08/2026 ═════════════════
   *
   * ── LA PANNE QUI A PRÉCÉDÉ, PARCE QU'ELLE DOIT RESTER LISIBLE ─────────────
   *
   * Ces deux clés ont été servies AVANT que le contrat ne les déclare. Le Panel
   * valide l'ENTRÉE d'un envoi contre le contrat du gabarit et refuse toute clé
   * inconnue :
   *
   *     CAPABILITY_INPUT_INVALID — panelDetails.reason: UNKNOWN_VARIABLE
   *
   * CHAQUE notification partait alors en `DEAD_LETTER` : la demande était bien
   * enregistrée — elle restait visible au Manager — mais personne n'était
   * prévenu, et rien ne le disait sur le site. La leçon tient en une phrase :
   * le contrat se déploie AVANT l'émetteur, jamais l'inverse.
   *
   * Une correction intermédiaire avait filtré sur le contrat en cache. Elle
   * était fausse : `EmailTemplateContract` ne porte QUE l'empreinte et le
   * propriétaire, `variables` y est systématiquement vide. Le filtre n'aurait
   * jamais rien laissé passer, en ayant l'air de conditionner quelque chose —
   * une garde qui semble dynamique et vaut toujours faux trompe le prochain
   * lecteur plus sûrement qu'une absence franche.
   *
   * ── CE QUI A CHANGÉ ──────────────────────────────────────────────────────
   *
   * Le Panel a été déployé au commit `d59f792` : `CONTACT_ADMIN_NOTIFICATION`
   * déclare désormais onze variables, dont ces deux-là en `required: false`.
   * Vérifié contre l'API en ligne avant de rouvrir le robinet — pas déduit du
   * code local, qui n'est pas ce que la plateforme exécute.
   */
  return {
    'company.name': company?.name || 'Votre site',
    'contact.name': submission.contact.name,
    'contact.email': submission.contact.email,
    /**
     * L'ENTREPRISE est OBLIGATOIRE au modèle (`companyName`, `required: true`) :
     * elle est donc toujours servie, sans repli. Un « Non renseigné » ici
     * masquerait une demande enregistrée sans entreprise — c'est-à-dire un
     * défaut de validation, qu'il vaut mieux voir échouer que voir maquillé.
     */
    'contact.company': submission.companyName,
    /**
     * L'ACTIVITÉ est facultative, et vide dans la plupart des demandes : le
     * projet la raconte souvent mieux que deux mots. Absente, la clé n'est PAS
     * fournie — comme `contact.pageUrl` plus bas, et pour la même raison : une
     * variable facultative absente n'est ni vide ni nulle, elle est absente, et
     * le gabarit l'entoure d'un `{{#if}}` qui efface la ligne entière.
     */
    ...(submission.activity ? { 'contact.activity': submission.activity } : {}),
    // Le template affiche cette ligne quoi qu'il arrive : une valeur vide y
    // laisserait un blanc que le lecteur prendrait pour un bug d'affichage.
    // « Non renseigné » dit ce qui s'est passé — le visiteur n'a rien saisi.
    'contact.phone': submission.contact.phone || 'Non renseigné',
    // Le CODE devient un LIBELLÉ ici : le template n'a pas à connaître « QUOTE ».
    'contact.reason': contactReasonLabel(submission.reason),
    // Texte brut. L'échappement est l'affaire du renderer (type TEXT), et le HTML
    // par défaut le rend dans un bloc `white-space: pre-line` pour conserver les
    // retours à la ligne sans interpréter quoi que ce soit.
    'contact.message': submission.message,
    // Type DATETIME : le renderer formate en 17/07/2026 à 14:32 (Europe/Paris).
    'contact.submittedAt': submission.submittedAt,
    /**
     * ── UNE ABSENCE RESTE UNE ABSENCE ────────────────────────────────────────
     *
     * ══ LE DÉFAUT QUE CETTE LIGNE RÉPARE ═══════════════════════════════════
     *
     * Elle s'écrivait `submission.pageUrl || ''`. La chaîne vide traversait le
     * moteur de rendu, qui la confrontait au type URL et REFUSAIT :
     *
     *     Valeur invalide pour « contact.pageUrl » : une URL doit commencer
     *     par http://, https://, mailto: ou tel:
     *
     * L'e-mail entier partait en DEAD_LETTER. Un administrateur n'était donc
     * pas prévenu d'une demande de contact — parce que le visiteur n'avait pas
     * transmis la page depuis laquelle il écrivait, ce qui est parfaitement
     * légitime et arrive tous les jours.
     *
     * ══ LA CORRECTION, EN UNE PHRASE ═══════════════════════════════════════
     *
     * Une variable FACULTATIVE absente n'est pas fournie. Elle n'est ni vide,
     * ni nulle, ni « à valider » : elle est ABSENTE, et la clé ne figure pas
     * dans la carte. Le modèle, lui, l'entoure d'un bloc `{{#if}}` — le lien
     * apparaît quand la page est connue, et la ligne entière disparaît sinon.
     *
     * Ce qui reste REFUSÉ : une adresse présente et invalide. « pas-une-url »
     * et « javascript:… » font toujours échouer le rendu, et c'est le
     * comportement voulu.
     */
    ...(submission.pageUrl ? { 'contact.pageUrl': submission.pageUrl } : {}),
    'manager.contactSubmissionUrl': await managerSubmissionUrl(submissionId),
  };
}

export default { resolveContactAdminNotification };
