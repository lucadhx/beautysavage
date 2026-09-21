import { resolveProviderEnvironment } from '../integratedApiEnvironment.js';
// R10.5B — plus aucune lecture d'expéditeur local : il n'y en a plus.
/**
 * La façade `capabilityClient` — un verbe, jamais le mécanisme du pont.
 * `bridge-conformity` interdit au métier d'atteindre appairage et transport.
 */
import { capabilitiesAvailable } from '../panelBridge/capabilityClient.js';
import { EMAIL_DELIVERY_ERROR_CODES as D } from '../../utils/emailTemplateConstants.js';

/**
 * Peut-on envoyer un e-mail, ici, maintenant ?
 *
 * ─── CE SERVICE N'EST PAS LE GARDE-FOU ───────────────────────────────────────
 *
 * ⚠️ Il l'a été. Il ne l'est plus, et le croire serait dangereux.
 *
 * Il vérifie les préconditions de CONTENU d'un envoi par template (fournisseur,
 * clé, expéditeur, template, destinataire) et n'est appelé que par
 * `emailDelivery.service`. L'e-mail de test, lui, ne passe pas par ici.
 *
 * Le contrôle réellement incontournable — celui qui décide si Brevo a le droit
 * d'envoyer — vit dans `brevoOperational.service`, appelé depuis le driver juste
 * avant le `fetch`. C'est LUI qui garantit qu'aucun chemin ne passe au travers.
 *
 * Trois critères sont évalués ici ET là-bas (fournisseur activé, clé présente,
 * expéditeur configuré), par des chemins de lecture différents. Ce recoupement
 * est une dette connue, consignée dans `docs/BREVO_FINAL_REPORT.md`.
 *
 * ─── ON NE BLOQUE QUE SUR CE QUI EST CERTAIN ─────────────────────────────────
 *
 * Un blocage est un refus LOCAL, prononcé avant tout appel : il n'est légitime
 * que si l'envoi est impossible avec certitude — pas de fournisseur, pas de clé,
 * pas d'expéditeur, pas de destinataire, template invalide.
 *
 * Ce qui a DISPARU de cette liste, et pourquoi : l'expéditeur « non vérifié » et
 * le domaine « non authentifié ». Ces deux états s'administrent chez Brevo, où
 * ils peuvent changer à tout moment sans que nous en soyons informés. Les
 * recopier ici revenait à refuser des envois légitimes sur la foi d'un miroir
 * périmé — et sur les comptes où l'API de gestion des expéditeurs est
 * indisponible, ce miroir ne pouvait même pas être rafraîchi. C'est désormais
 * Brevo qui tranche, au moment de l'envoi, et son refus est enregistré comme un
 * échec de livraison plutôt que deviné à l'avance.
 *
 * `warnings` reste dans le contrat de retour mais n'est JAMAIS alimenté : aucun
 * `warnings.push` n'existe. Sa suppression est recommandée — voir
 * `docs/BREVO_FINAL_REPORT.md`.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param {object} [input]
 * @param {string} [input.templateId]     Si fourni : existence, activation, validité.
 * @param {string} [input.recipientEmail] Si fourni : validité syntaxique.
 * @returns {Promise<{
 *   ready: boolean,
 *   blockers: {code:string,message:string}[],
 *   warnings: {code:string,message:string}[],
 *   context: object
 * }>}
 */
export async function getEmailReadiness({
  templateId = null,
  recipientEmail = null,
  /**
   * SONDE DU PLAN DE CONTRÔLE — injectable, comme le reste des dépendances
   * sortantes de ce module. En exploitation c'est toujours la vraie façade ;
   * une recette unitaire, elle, doit pouvoir éprouver la readiness sans monter
   * un Panel appairé — sinon elle n'éprouverait plus que l'appairage.
   */
  controlPlaneAvailable = capabilitiesAvailable,
} = {}) {
  const blockers = [];
  // Toujours vide depuis la simplification — conservé pour la stabilité du contrat.
  const warnings = [];
  /**
   * ══ « PAS CONFIGURÉ » ET « PAS JOIGNABLE » NE SE TRAITENT PAS PAREIL ══════
   *
   * Un blocage porte désormais son caractère TRANSITOIRE. Le défaut par défaut
   * reste `false`, et c'est le bon : une configuration manquante ne se répare
   * pas en réessayant, et quatre tentatives espacées ne feraient que retarder
   * un échec inévitable.
   *
   * Mais tous les blocages ne sont pas des configurations. « La plateforme
   * n'est pas joignable » est une INDISPONIBILITÉ : elle se répare toute
   * seule, souvent en quelques secondes. Les confondre a coûté un message réel
   * — la confirmation d'encaissement du 21 août, reprise pendant le
   * redémarrage d'un déploiement, alors que le pont n'était pas encore levé.
   * Elle est partie en DEAD_LETTER pour une cause qui avait disparu deux
   * secondes plus tard, et le client n'a jamais été confirmé.
   */
  const block = (code, message, { retryable = false } = {}) => blockers.push({ code, message, retryable });

  const context = {
    providerMode: null,
    sender: { name: '', email: '' },
    template: null,
  };

  /* --- 1. LE PLAN DE CONTRÔLE PEUT-IL SERVIR ? (L8.4C) ----------------------
   *
   * ══ CE BLOC A CHANGÉ DE SUJET, ET C'EST TOUT LE LOT ═══════════════════════
   *
   * Il vérifiait la clé Brevo LOCALE : présente, activée, testée. Depuis que
   * l'envoi passe par la capacité `email.send_template`, cette clé ne sert
   * plus à rien — la vérifier reviendrait à barrer un envoi parfaitement
   * possible parce qu'un credential devenu inutile n'a pas été renseigné.
   *
   * Et l'inverse est plus grave encore : une clé locale valide aurait laissé
   * croire l'envoi possible alors que la plateforme, elle, n'est pas joignable.
   *
   * ══ CE QU'ON NE VÉRIFIE PLUS, ET POURQUOI C'EST JUSTE ═════════════════════
   *
   * La validité de la clé, l'existence du compte, l'autorisation du projet :
   * ce sont désormais des questions du PANEL, et il y répond au moment de
   * l'appel, avec des codes précis (`CAPABILITY_NOT_GRANTED`,
   * `CAPABILITY_CREDENTIALS_MISSING`…). Les redemander ici produirait une
   * seconde autorité, plus pauvre, et systématiquement en retard.
   */
  const environment = resolveProviderEnvironment('BREVO');
  if (!environment) {
    block(D.PROVIDER_NOT_CONFIGURED, 'Environnement fournisseur non résolu.');
    return { ready: false, blockers, warnings, context };
  }
  context.providerMode = environment;

  if (!controlPlaneAvailable()) {
    /**
     * TRANSITOIRE, ET SOUVENT TRÈS BREF.
     *
     * Le pont se lève au démarrage, après la reprise des actions en attente :
     * un envoi rejoué pendant cette fenêtre trouve la plateforme injoignable
     * pour quelques secondes. Le classer définitif jetait le message.
     */
    block(
      D.PROVIDER_NOT_CONFIGURED,
      'La plateforme qui envoie les e-mails de ce projet n’est pas joignable pour l’instant.',
      { retryable: true },
    );
    return { ready: false, blockers, warnings, context };
  }

  /**
   * --- 2. L'EXPÉDITEUR : IL N'Y A PLUS RIEN À VÉRIFIER ICI (R10.5B) ---------
   *
   * L8.4C avait déjà dégradé ce contrôle en avertissement, en constatant que
   * l'expéditeur qui compte est celui du Panel. R10.5 va au bout : la copie
   * locale n'existe plus, donc l'avertissement n'a plus de sujet.
   *
   * On ne le remplace PAS par une interrogation du Panel. Une readiness qui
   * appelle le Panel pour savoir s'il a un expéditeur transformerait chaque
   * envoi en deux allers-retours, et échouerait sur une latence réseau là où
   * l'envoi lui-même aurait très bien abouti. Un expéditeur global absent est
   * refusé par la capacité, avec un code qui nomme l'écran à remplir —
   * c'est-à-dire au seul endroit qui puisse en être sûr.
   *
   * Les deux champs restent dans `context` pour la stabilité du contrat de
   * retour, et restent vides : mieux vaut un trou visible qu'une valeur
   * inventée que personne ne pourrait retrouver.
   */
  context.sender.email = '';
  context.sender.name = '';

  // --- 3. Le template --------------------------------------------------------
  /**
   * ── LE MODÈLE N'EST PLUS UNE PRÉCONDITION LOCALE (L12.1) ──────────────────
   *
   * Ce bloc lisait la copie locale du modèle et BLOQUAIT l'envoi sur trois
   * motifs : code inconnu du registre local, `enabled: false`, contenu invalide.
   * Aucun des trois n'appartenait à ce projet.
   *
   *   `enabled`    — un interrupteur du Manager coupait un e-mail que le Panel
   *                  aurait expédié. C'est le veto que le lot supprime.
   *   validité     — un HTML local pouvait devenir invalide sans que le contenu
   *                  réellement expédié change d'un octet.
   *   code inconnu — le registre local a disparu ; la liste des codes valides
   *                  appartient au Panel, qui refuse un code inconnu à l'envoi
   *                  avec un diagnostic bien plus précis que celui-ci.
   *
   * Les transformer en avertissements n'aurait rien réglé : un avertissement
   * qui n'informe de rien encombre un journal et fait croire qu'un contrôle a
   * lieu. Ce qui reste — le fournisseur, la plateforme, le destinataire — est
   * exactement ce dont ce projet est autorité.
   *
   * Le CONTRÔLE DES VARIABLES, lui, vit dans `emailDelivery.service.js`, sur le
   * contrat servi par le Panel. C'est un contrôle de ce que le projet FOURNIT,
   * pas de ce qu'il posséderait.
   */
  context.template = templateId ? { templateId } : null;

  if (recipientEmail !== null) {
    const value = String(recipientEmail || '').trim();
    if (!value) block(D.NO_RECIPIENT, 'Aucun destinataire.');
    else if (!EMAIL_RE.test(value)) block(D.RECIPIENT_INVALID, `Adresse destinataire invalide : « ${value} ».`);
  }

  return { ready: blockers.length === 0, blockers, warnings, context };
}

export default { getEmailReadiness };
