// CE QUE CE PROJET CONSOMME COMME MODÈLES D'E-MAIL — et rien de plus.
//
// docs/architecture/EMAIL_TEMPLATE_AUTHORITY.md.
//
// ── CE QUI A DISPARU AVEC CE FICHIER, ET POURQUOI ───────────────────────────
//
// Ce module s'appuyait sur `utils/emailTemplateRegistry.js` : mille cent lignes
// qui redéclaraient, côté projet, le sujet, le HTML, les variables, leurs
// types, leur obligation et la PORTÉE de chaque modèle. Le Panel déclarait
// exactement les mêmes choses de son côté.
//
// Deux registres indépendants pour un seul contrat. L'audit a mesuré le
// résultat : les variables étaient encore alignées — par chance, rien ne le
// vérifiait — mais SEPT contenus sur quatorze avaient déjà divergé. Le Manager
// affichait donc, pour la moitié des modèles, un e-mail qui n'était pas celui
// qui partait.
//
// Le registre local est supprimé. Il ne reste ici que ce dont ce projet est
// réellement autorité : LA LISTE DES CODES QU'IL CONSOMME, et d'où vient chaque
// consommation.
//
// ── POURQUOI LA PORTÉE N'EST PLUS FILTRÉE ICI ───────────────────────────────
//
// Ce fichier écartait autrefois les codes de portée PANEL, en s'appuyant sur un
// `ownerScope` recopié du Panel. C'était une troisième copie du même contrat —
// et elle masquait un vrai défaut : l'alerte d'incident technique appelait un
// modèle PANEL depuis un chemin projet, et le filtre la faisait disparaître de
// la déclaration au lieu de la signaler. L'appel échouait ensuite en silence, à
// l'envoi, pour tous les incidents du parc.
//
// Le projet déclare désormais TOUT ce qu'il appelle. C'est le Panel qui tranche
// — `accepted`, `forbidden`, `unknown` — et un code refusé devient VISIBLE dans
// son compte rendu de réconciliation, au lieu de s'évaporer ici.

import crypto from 'node:crypto';

import { DOMAIN_EVENT_ACTION_REGISTRY } from './domainEventActionRegistry.js';
import { ACTION_TYPE } from './domainEventConstants.js';

/**
 * LES CONSOMMATEURS DIRECTS — ceux qu'aucun événement de domaine ne déclenche.
 *
 * Un modèle appelé par une action d'événement se déduit du registre d'actions.
 * Ceux-ci sont appelés par du code de service, à la main : rien ne permettrait
 * de les découvrir, et un modèle non déclaré est un modèle que le Panel refuse
 * d'expédier. Les recenser à la main est donc la seule option — la validation
 * ci-dessous vérifie qu'aucun ne se contente d'être écrit ici.
 */
export const DIRECT_TEMPLATE_CONSUMERS = Object.freeze([
  {
    templateId: 'PASSWORD_RESET_REQUEST',
    source: 'services/auth.service.js',
    reason: "Réinitialisation du mot de passe d'un compte local.",
  },
  {
    templateId: 'DEV_ACCOUNT_ACTIVATION',
    source: 'services/localDevBootstrap.service.js',
    reason: "Activation du PREMIER accès d'administration — le tout premier e-mail d'un projet neuf.",
  },
  {
    templateId: 'SITE_SUSPENDED_MANUAL_ADMIN',
    source: 'services/siteSuspensionNotice.service.js',
    reason: "Suspension décidée à la main par l'équipe technique, quand elle demande d'en informer les administrateurs.",
  },
  {
    templateId: 'EMAIL_SENDER_VERIFICATION_TEST',
    source: 'services/email/emailModule.js',
    reason:
      "Test technique déclenché depuis le Manager. Il ÉPROUVE la chaîne d'envoi de ce projet : "
      + "sans instance à lui, le seul outil de diagnostic de l'e-mail serait le premier à échouer.",
  },
]);

/** Les codes appelés par une action d'événement ACTIVE. */
export function templatesFromEventActions() {
  const codes = new Set();
  for (const actions of Object.values(DOMAIN_EVENT_ACTION_REGISTRY)) {
    for (const action of actions) {
      if (action.actionType !== ACTION_TYPE.SEND_EMAIL) continue;
      if (!action.enabled) continue;
      if (action.templateId) codes.add(action.templateId);
    }
  }
  return [...codes];
}

/**
 * TOUS les codes que ce projet peut demander à la plateforme. TRIÉS.
 *
 * Le tri n'est pas cosmétique : l'empreinte ci-dessous en dépend, et l'ordre
 * d'itération d'un registre ne doit pas pouvoir produire une fausse nouveauté.
 */
export function declaredTemplateCodes() {
  const codes = new Set([
    ...templatesFromEventActions(),
    ...DIRECT_TEMPLATE_CONSUMERS.map((c) => c.templateId),
  ]);
  return [...codes].sort();
}

/** Les codes que ce projet sait résoudre en variables — utile aux gardes. */
export const CONSUMED_TEMPLATE_CODES = Object.freeze(declaredTemplateCodes());

/**
 * L'EMPREINTE DE LA DÉCLARATION — codes ET contrats.
 *
 * ── POURQUOI LES EMPREINTES DE CONTRAT EN FONT PARTIE (L12.1) ──────────────
 *
 * Cette révision décide seule s'il y a quelque chose à réémettre : révision
 * identique ⇒ aucune écriture, aucune réconciliation. Elle ne hachait que la
 * liste des codes.
 *
 * Le déployé a montré ce que cela coûtait. Quand le Panel change le contrat de
 * variables d'un modèle — une variable devient obligatoire, un type change — la
 * liste des codes, elle, ne bouge pas. La révision restait donc identique, la
 * déclaration n'était jamais réémise, et le Panel n'apprenait JAMAIS la nouvelle
 * empreinte. Le contrôle de compatibilité restait aveugle exactement dans le
 * seul cas où il sert.
 *
 * Une révision qui prétend résumer une déclaration doit résumer TOUT ce que la
 * déclaration transporte.
 */
export function declarationRevision(codes = declaredTemplateCodes(), fingerprints = {}) {
  const contrats = Object.keys(fingerprints ?? {})
    .sort()
    .map((code) => `${code}=${fingerprints[code]}`);
  return crypto
    .createHash('sha256')
    .update([...codes, '--', ...contrats].join('\n'))
    .digest('hex')
    .slice(0, 32);
}

export function describeDeclaredTemplates() {
  const parEvenement = new Map();
  for (const [eventType, actions] of Object.entries(DOMAIN_EVENT_ACTION_REGISTRY)) {
    for (const action of actions) {
      if (action.actionType !== ACTION_TYPE.SEND_EMAIL || !action.enabled) continue;
      if (!action.templateId) continue;
      const liste = parEvenement.get(action.templateId) ?? [];
      liste.push(`${eventType}#${action.actionId}`);
      parEvenement.set(action.templateId, liste);
    }
  }
  return declaredTemplateCodes().map((templateId) => {
    const direct = DIRECT_TEMPLATE_CONSUMERS.find((c) => c.templateId === templateId);
    return {
      templateId,
      eventActions: parEvenement.get(templateId) ?? [],
      directConsumer: direct ? { source: direct.source, reason: direct.reason } : null,
    };
  });
}

/**
 * LES INCOHÉRENCES DE LA DÉCLARATION — celles que ce projet peut encore juger.
 *
 * Il ne peut plus vérifier qu'un code EXISTE, ni qu'il a le droit d'être servi
 * en portée projet : ces deux vérités appartiennent au Panel, et les rejuger
 * ici reviendrait à recopier son registre. Le compte rendu de réconciliation
 * les rend, sous `unknown` et `forbidden`.
 *
 * Reste ce qui est vérifiable localement, et qui l'est vraiment : un code
 * déclaré que RIEN n'envoie.
 */
export function validateTemplateUsage() {
  const problemes = [];
  for (const d of describeDeclaredTemplates()) {
    if (d.eventActions.length === 0 && !d.directConsumer) {
      problemes.push(`« ${d.templateId} » est déclaré mais aucun consommateur ne l'envoie.`);
    }
  }
  return problemes;
}

export default {
  CONSUMED_TEMPLATE_CODES,
  DIRECT_TEMPLATE_CONSUMERS,
  declarationRevision,
  declaredTemplateCodes,
  describeDeclaredTemplates,
  templatesFromEventActions,
  validateTemplateUsage,
};
