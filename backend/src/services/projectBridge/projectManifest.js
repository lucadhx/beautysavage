/**
 * REGISTRE DÉCLARATIF du manifeste de projet (Phase 2A, objectif 4).
 *
 * Le Panel ne doit JAMAIS déduire ce que sait faire un projet : ce fichier le
 * DÉCLARE. C'est un registre code-first (même philosophie que
 * emailTemplateRegistry ou managedWebhookRegistry) : il évolue par commit,
 * jamais par déduction runtime — un module retiré du produit se retire ici
 * dans le même commit.
 *
 * Le manifeste complet (schéma `projectManifestSchema` du contrat, servi par
 * GET /api/project-bridge/v1/manifest et joint au bootstrap) est assemblé par
 * projectBridge.service.js : identité réelle + CE registre + capacités de
 * synchronisation dérivées du contrat (PHASE1_APPLIED_ENTITY_TYPES et
 * catalogue d'opérations — seules valeurs calculées, car elles doivent par
 * construction rester alignées sur ce que le code accepte réellement).
 */

/**
 * Modules installés dans CE produit. `id` est stable et contractuel (le Panel
 * s'y réfère) ; `status` : ACTIVE = livré et opérationnel, OPTIONAL = présent
 * mais désactivable par configuration.
 */
export const INSTALLED_MODULES = Object.freeze([
  { id: 'vitrine', title: 'Site vitrine public', status: 'ACTIVE' },
  { id: 'manager', title: 'Back-office Manager (ADMIN + DEV)', status: 'ACTIVE' },
  { id: 'contracts-engine', title: 'Moteur de contrats (machine à états)', status: 'ACTIVE' },
  { id: 'stripe-billing', title: 'Facturation Stripe (frais de lancement + abonnement)', status: 'ACTIVE' },
  /**
   * LE MODULE EST UNE FONCTION, PAS UN PRESTATAIRE.
   *
   * L'entrée s'appelait `yousign-signature`, titrée « Signature électronique
   * Yousign ». Le manifeste décrit ce que ce projet SAIT FAIRE ; le nom de
   * celui qui l'exécute pour la plateforme n'en fait pas partie — il a déjà
   * changé une fois, et ce projet n'a jamais eu à le connaître.
   *
   * L'identifiant change avec le titre : il n'est référencé nulle part
   * ailleurs, ni en base, ni côté Panel.
   */
  { id: 'signature', title: 'Signature électronique des contrats', status: 'OPTIONAL' },
  { id: 'brevo-email', title: 'E-mails transactionnels Brevo (templates + livraisons)', status: 'ACTIVE' },
  { id: 'managed-webhooks', title: 'Webhooks gérés (enregistrement distant automatique)', status: 'ACTIVE' },
  { id: 'deployment-engine', title: 'Moteur de déploiement VPS', status: 'ACTIVE' },
  { id: 'duplication-engine', title: 'Moteur de duplication de projet', status: 'ACTIVE' },
  { id: 'panel-bridge', title: 'Pont Panel (PanelBridge + ProjectBridge)', status: 'ACTIVE' },
]);

/**
 * Fonctionnalités exposées au Panel. AVAILABLE = utilisable aujourd'hui ;
 * RESERVED = prévue par le contrat mais lot non livré (le Panel sait ainsi ce
 * qu'il ne doit PAS tenter). Les identifiants sont stables.
 */
export const PROJECT_FEATURES = Object.freeze([
  { id: 'sync.diagnostic', status: 'AVAILABLE' },
  { id: 'sync.contracts', status: 'RESERVED' },
  { id: 'sync.invoicing', status: 'RESERVED' },
  { id: 'sync.dev-company', status: 'RESERVED' },
  { id: 'sync.email-templates', status: 'RESERVED' },
  { id: 'sync.integrated-api-config', status: 'RESERVED' },
  { id: 'sync.events-meetings', status: 'RESERVED' },
  { id: 'operations.catalog', status: 'AVAILABLE' }, // le mécanisme existe (catalogue vide)
  { id: 'manager-access-grant', status: 'RESERVED' }, // jeton {admin, dev} — Phase ultérieure
]);

/**
 * DESCRIPTEUR DU PROJET — carte de visite déclarative, publiée au Panel
 * (contrat >= 1.2.0) pour la supervision en LECTURE SEULE.
 *
 * Déclaratif, comme le reste de ce registre : ces valeurs évoluent par commit,
 * jamais par déduction runtime. Le `layout` décrit la topologie du produit tel
 * que son équipe la déclare — le moteur de déploiement n'est PAS interrogé
 * (le ProjectBridge ne dépend d'aucun moteur, c'est un invariant testé).
 */
export const PROJECT_DESCRIPTOR = Object.freeze({
  type: 'vitrine',
  description: 'Site vitrine + Manager, projet de référence de l’écosystème L.Y Solution.',
  layout: 'vitrine:web + manager:web-subdomain + backend:server',
});
