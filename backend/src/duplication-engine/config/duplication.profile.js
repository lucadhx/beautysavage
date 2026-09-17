/**
 * PROFIL DE DUPLICATION — le seul fichier du moteur de duplication qui
 * connaisse les secrets et les variables propres à CE projet.
 *
 * Règle de sécurité de l'écosystème (Phase 2C, §« JWT et secrets ») :
 *   « Ne JAMAIS réutiliser le secret d'un autre projet ou d'un autre
 *     déploiement : chaque déploiement possède le sien. »
 *
 * Le moteur de duplication l'applique littéralement : chaque secret listé ici
 * est REGÉNÉRÉ aléatoirement dans la copie. Un projet dupliqué n'hérite donc
 * jamais des secrets de sa source — la compromission de l'un ne compromet
 * pas les autres.
 */

/**
 * Secrets régénérés dans toute copie.
 *  - `key`      nom de la variable dans le `.env` ;
 *  - `bytes`    nombre d'octets aléatoires (source cryptographique) ;
 *  - `encoding` `hex` ou `base64url` ;
 *  - `why`      raison, reprise dans la documentation et les rapports.
 */
export const SECRETS_TO_GENERATE = Object.freeze([
  Object.freeze({
    key: 'JWT_SECRET',
    bytes: 64,
    encoding: 'hex',
    why: 'signature des sessions — un secret partagé rendrait les sessions interchangeables entre projets',
  }),
  Object.freeze({
    key: 'INTEGRATED_API_ENCRYPTION_KEY',
    bytes: 32,
    encoding: 'hex',
    why: 'chiffrement au repos des credentials IntegratedAPI et du bridgeToken',
  }),
]);

/**
 * Variables d'environnement dont la valeur est IMPOSÉE par l'assistant de
 * duplication (bases, identité du projet, compte DEV initial).
 */
export const ENV_KEYS = Object.freeze({
  dbTest: 'DB_TEST',
  dbProd: 'DB_PROD',
  projectName: 'PROJECT_NAME',
  githubRepositoryUrl: 'PROJECT_GITHUB_REPOSITORY_URL',
  /**
   * L'IDENTITÉ du premier développeur local — jamais son secret (LOT 2C).
   * Le compte est créé sans mot de passe au premier démarrage, et son
   * titulaire choisit le sien par un lien d'activation.
   */
  firstDevEmail: 'FIRST_DEV_EMAIL',
  firstDevName: 'FIRST_DEV_NAME',
});

/**
 * VARIABLES SUPPRIMÉES DU `.env` DE LA COPIE (LOT 2C).
 *
 * ── POURQUOI LES EFFACER PLUTÔT QUE LES IGNORER ────────────────────────────
 *
 * Le `.env` de la copie est un décalque de celui de la source. Une source
 * installée avant ce lot porte encore `SEED_DEV_PASSWORD` — et la copie en
 * hériterait telle quelle. Le code ne les lit plus, donc « ça ne sert à rien » ;
 * mais un secret oublié dans un fichier n'est pas inerte : il est lisible, il
 * ressemble à une consigne, et quelqu'un finira par le remettre en service en
 * croyant réparer quelque chose.
 *
 * `SEED_DEV_EMAIL` n'est PAS dans cette liste : elle ne porte aucun secret, et
 * le bootstrap l'accepte encore comme alias déprécié de `FIRST_DEV_EMAIL` — la
 * supprimer casserait les copies en cours d'installation.
 */
export const ENV_KEYS_TO_STRIP = Object.freeze([
  'SEED_DEV_PASSWORD',
  'SEED_ADMIN_PASSWORD',
]);


/**
 * ══ LE PREMIER ADMINISTRATEUR — LA FORME DU COMPTE, PROPRE À CE PROJET ══════
 *
 * Le cœur du moteur sait POURQUOI créer ce compte, quand, et qu'il est
 * bloquant. Il ne peut pas savoir à quoi il ressemble : ce projet écrit un
 * `User` (`password` haché par bcrypt, `status`, `mustResetPassword`) ; le
 * Panel écrit un `PanelUser` (`passwordHash` dérivé par scrypt, `userId`,
 * `projectAccess`). Ce ne sont pas des variantes d'un même document.
 *
 * Le cœur portait cette forme en dur, avec un import tardif de `bcryptjs`
 * justifié par « le Panel ne l'embarque pas ». L'import tardif ne faisait que
 * déplacer la panne : dupliquer un Panel échouait ici, module introuvable, les
 * bases déjà créées. La différence descend donc là où elle doit vivre — dans ce
 * fichier, le seul du moteur qui connaisse ce projet.
 *
 * Le comportement de CE projet est inchangé, au hachage près qui reste le même
 * `pre('save')` canonique : 10 tours de sel.
 */
export const FIRST_ADMIN = Object.freeze({
  /** Le modèle Mongoose qui porte ce compte ; sa collection fait autorité. */
  modelName: 'User',
  /** Repli si le modèle n'est pas chargé dans le processus appelant. */
  collection: 'users',
  /** Le champ d'identité, pour la recherche d'un doublon. */
  emailField: 'email',
  /** Le filtre « un administrateur existe-t-il déjà ? ». */
  existingAdminFilter: { role: 'ADMIN' },

  /**
   * Le document, tel que Mongoose l'écrirait lui-même.
   * @param {{email:string, password:string, name:string, now:Date}} entree
   */
  async buildDocument({ email, password, name, now }) {
    const { default: bcrypt } = await import('bcryptjs');
    return {
      email,
      password: await bcrypt.hash(password, await bcrypt.genSalt(10)),
      name,
      role: 'ADMIN',
      status: 'ACTIVE',
      mustResetPassword: false,
      passwordReset: null,
      createdAt: now,
      updatedAt: now,
    };
  },
});

export default { SECRETS_TO_GENERATE, ENV_KEYS, ENV_KEYS_TO_STRIP, FIRST_ADMIN };
