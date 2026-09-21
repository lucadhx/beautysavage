import { z } from 'zod';
import { validateGithubRepositoryUrl, normalizeGithubRepositoryUrl } from '../utils/githubRepositoryUrl.js';
import { BACKUP_ROOT } from '../deployment-engine/config/project.profile.js';

/** Une URL complète de cible (le moteur en déduit host/type/domaine). */
const urlField = z.string().trim().min(3, 'URL requise');

/*
 * SÉCURITÉ (anti-injection shell) : ces valeurs sont interpolées dans des
 * commandes distantes (mongodump, tar, mkdir, nginx…). On les contraint à des
 * jeux de caractères sûrs — aucun métacaractère shell (; | & $ ` ' " \ espace…).
 * Le hostname de la cible est, lui, déjà validé caractère par caractère par
 * parseTargetUrl.
 */
const dbNameField = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9_-]{1,63}$/, 'Nom de base invalide (lettres, chiffres, tiret, underscore).');
const remoteRootField = z
  .string()
  .trim()
  .regex(/^\/[a-zA-Z0-9_./-]{1,255}$/, 'Chemin distant invalide.');
const sshHostField = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9_.:-]{1,255}$/, 'Adresse serveur invalide.');
const sshUserField = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9_-]{1,64}$/, 'Utilisateur serveur invalide.');
/**
 * L'ARCHIVE DOIT VENIR DE LA RACINE DE SAUVEGARDE DE *CE* PROJET.
 *
 * Le motif nommait `/var/backups/sbauto/` en dur, alors que `BACKUP_ROOT` est
 * dérivée du slug (`/var/backups/<slug>/`). Sur toute copie, la restauration
 * refusait donc ses PROPRES archives — et n'aurait accepté que celles du projet
 * source, si elles avaient été là. Le contrôle est ancré sur la racine réelle.
 */
const archiveField = z
  .string()
  .trim()
  .regex(
    new RegExp(`^${BACKUP_ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[A-Za-z0-9_.-]+\\.tar\\.gz$`),
    'Archive de sauvegarde invalide.',
  );

export const createTargetSchema = {
  body: z.object({
    name: z.string().trim().min(1, 'Nom requis').max(80),
    url: urlField,
    /**
     * L'ENVIRONNEMENT est EXIGÉ à la création, et n'a pas de valeur par défaut.
     *
     * Il était choisi au moment de déployer, avec PROD présélectionné : un clic
     * de trop publiait en production. Il appartient à la destination — c'est lui
     * qui décide de la base, de l'isolation des médias et de l'unicité de la
     * destination active. Un défaut ici reproduirait le défaut d'origine.
     */
    environment: z.enum(['TEST', 'PROD'], {
      errorMap: () => ({ message: 'Environnement requis : TEST ou PROD.' }),
    }),
    dbName: dbNameField.optional().nullable(),
    remoteRoot: remoteRootField.optional(),
    // Serveur (optionnel à la création) : IP/hôte + utilisateur (défaut root).
    sshHost: sshHostField.optional().nullable(),
    sshUser: sshUserField.optional(),
  }),
};

export const idParam = {
  params: z.object({ id: z.string().trim().min(1) }),
};

/** Ouverture d'une session VPS : le mot de passe transite ici (jamais stocké). */
export const vpsSessionSchema = {
  body: z.object({
    host: z.string().trim().min(1, 'Hôte VPS requis'),
    username: z.string().trim().min(1, 'Utilisateur VPS requis'),
    password: z.string().min(1, 'Mot de passe VPS requis'),
  }),
};

export const sessionIdParam = {
  params: z.object({ sessionId: z.string().trim().min(1) }),
};

/** Préflight : URL + session VPS (+ racine distante optionnelle). */
export const preflightSchema = {
  body: z.object({
    url: urlField.optional(),
    targetId: z.string().trim().optional(),
    sessionId: z.string().trim().min(1, 'Session VPS requise'),
    remoteRoot: z.string().trim().optional(),
  }),
};

/** Déploiement d'une cible existante. */
export const deploySchema = {
  body: z.object({
    targetId: z.string().trim().min(1, 'Cible requise'),
    sessionId: z.string().trim().min(1, 'Session VPS requise'),
    email: z.string().trim().email().optional(),
    /**
     * ── `env` A DISPARU DU CORPS DE DÉPLOIEMENT ──────────────────────────
     *
     * Il venait du formulaire, avec PROD par défaut : la même destination
     * pouvait être déployée en TEST puis en PROD, et un clic de trop publiait
     * en production. L'environnement est désormais lu sur la DESTINATION.
     * L'accepter encore ici laisserait une seconde source de vérité.
     */
    remoteEnv: z.record(z.string()).optional(),
    skipBuild: z.boolean().optional().default(false),
    skipPreflight: z.boolean().optional().default(false),
  }),
};

/** Duplication du projet courant. */
export const duplicateSchema = {
  body: z.object({
    projectName: z.string().trim().min(1).max(80),
    folderName: z.string().trim().min(1).max(100).optional(),
    dbTest: z.string().trim().min(1).max(63),
    dbProd: z.string().trim().min(1).max(63),
    /**
     * LE PREMIER DÉVELOPPEUR LOCAL — une identité, pas un secret (LOT 2C).
     *
     * L'adresse est obligatoire : c'est elle qui recevra le lien d'activation,
     * et sans elle le projet dupliqué naîtrait sans personne pour
     * l'administrer. Le nom est facultatif — il ne sert qu'à l'affichage.
     */
    devEmail: z.string().trim().email(),
    devName: z.string().trim().max(80).optional().default(''),
    /**
     * LE PREMIER ADMINISTRATEUR — celui qu'on remet au client.
     *
     * Contrairement au développeur, il reçoit son mot de passe de vive voix à
     * la livraison : sa boîte n'est parfois pas encore relevée, et un lien
     * d'activation envoyé dans le vide produirait un projet livré sans accès.
     *
     * Le schéma vérifie ici la FORME (présence, longueur, concordance) ; le
     * moteur vérifie ensuite le FOND (secret diffusé du parc, mot de passe
     * déduit de l'adresse). Les deux sont nécessaires : ce schéma ne connaît
     * pas l'histoire du parc, et le moteur ne doit pas dépendre de zod.
     */
    adminEmail: z.string().trim().email('Adresse du premier administrateur invalide.'),
    adminPassword: z.string().min(6, 'Mot de passe administrateur : 6 caractères minimum.'),
    adminPasswordConfirmation: z.string().min(1, 'Confirmation du mot de passe requise.'),
    // URL du dépôt GitHub de la COPIE — obligatoire, normalisée vers
  // https://github.com/<owner>/<repo>.git (jamais l'URL du dépôt source).
  githubRepositoryUrl: z
    .string()
    .trim()
    .min(1, 'URL du dépôt GitHub requise.')
    .max(300)
    .superRefine((v, ctx) => {
      const r = validateGithubRepositoryUrl(v);
      if (!r.valid) ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.error });
    })
    .transform((v) => normalizeGithubRepositoryUrl(v)),
  })
    .strict()
    .refine((d) => d.adminPassword === d.adminPasswordConfirmation, {
      message: 'Les deux mots de passe administrateur ne correspondent pas.',
      path: ['adminPasswordConfirmation'],
    }),
};

/** Backup / restore d'une cible. */
export const backupSchema = {
  body: z.object({
    targetId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
  }),
};

export const restoreSchema = {
  body: z.object({
    targetId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    archive: archiveField,
  }),
};
