/**
 * Catalogue des intégrations d'API tierces (IntegratedAPI).
 *
 * Source de vérité UNIQUE des fournisseurs supportés et de leurs champs de
 * credentials. Ajouter un fournisseur = ajouter une entrée ici + un driver fin.
 *
 * MODE FOURNISSEUR ≠ ENVIRONNEMENT APPLICATIF. Chaque fournisseur possède son
 * propre `activeMode` (TEST | PROD), choisi par un DEV depuis le Manager,
 * INDÉPENDAMMENT de `config.env` (ENV/DB de l'application). Le choix des
 * credentials se fait TOUJOURS via `activeMode`, jamais via ENV. Aucun fallback
 * entre modes.
 *
 * Les URL de base des fournisseurs sous autorité Panel ne vivent plus ici :
 * elles appartiennent au coffre de la plateforme.
 */

export const INTEGRATED_API_PROVIDERS = Object.freeze({
  STRIPE: 'STRIPE',
  /**
   * LA SIGNATURE EST UN DOMAINE, PLUS UN FOURNISSEUR.
   *
   * L'entree s'appelait `YOUSIGN`. Depuis la bascule, une nouvelle demande part
   * chez OpenSign : l'ecran aurait affiche « Yousign » pour un service qui ne
   * l'utilise plus, et la question « Yousign est-il pret ? » aurait porte sur un
   * fournisseur qui n'allait pas servir.
   *
   * Ce que ce projet a besoin de savoir n'a jamais ete l'identite du
   * fournisseur -- il n'en detient aucune credential. C'est : LA SIGNATURE
   * REPOND-ELLE ? La plateforme, elle, sait qui l'execute, et pourra en changer
   * sans que cette ligne bouge.
   */
  SIGNATURE: 'SIGNATURE',
  BREVO: 'BREVO',
  HOSTINGER: 'HOSTINGER',
});

export const PROVIDER_VALUES = Object.values(INTEGRATED_API_PROVIDERS);

/**
 * LES NOMS QUI PEUVENT ENCORE EXISTER EN BASE, SANS ÊTRE OFFERTS.
 *
 * ══ POURQUOI LES DEUX LISTES SONT DIFFÉRENTES ═══════════════════════
 *
 * `PROVIDER_VALUES` dit ce que ce projet PROPOSE aujourd'hui. Le schéma, lui,
 * doit accepter ce qui EXISTE déjà : une base déployée porte encore un
 * document `YOUSIGN`, avec ses credentials morts.
 *
 * Sans cette distinction, ce document serait devenu illégal au moment même où
 * le catalogue a changé de nom — et la purge, qui doit justement le vider, ne
 * pourrait plus l'écrire. On aurait verrouillé la porte en laissant la clé à
 * l'intérieur.
 *
 * Un nom hérité n'est ni au catalogue, ni administrable, ni testable : il est
 * seulement LISIBLE et PURGEABLE. Il quittera cette liste quand plus aucune
 * base n'en portera.
 */
export const LEGACY_PROVIDER_VALUES = Object.freeze(['YOUSIGN']);

/** Ce que le schéma tolère : l'offre d'aujourd'hui, plus l'héritage. */
export const STORABLE_PROVIDER_VALUES = Object.freeze([
  ...PROVIDER_VALUES, ...LEGACY_PROVIDER_VALUES,
]);

/** Modes d'un fournisseur externe (indépendants de l'ENV applicatif). */
export const PROVIDER_MODES = Object.freeze({ TEST: 'TEST', PROD: 'PROD' });
export const MODE_VALUES = Object.values(PROVIDER_MODES);
// Alias rétro-compat (mêmes valeurs TEST/PROD).
export const ENVIRONMENT_VALUES = MODE_VALUES;

/**
 * Définition des champs par fournisseur.
 *  - `required`     : nécessaire pour considérer le mode « configuré ».
 *  - `secret`       : chiffré au repos + masqué en sortie (n'expose que lastFour).
 *  - `prefixHint`   : préfixe générique (aide UI + garde-fou).
 *  - `prefixByMode` : préfixe ATTENDU selon le mode (détecte une clé live saisie
 *    dans TEST, ou test dans PROD). Absent = pas de distinction de mode possible
 *    (ex. whsec_ : l'appartenance au mode vient de la configuration choisie).
 */
export const INTEGRATED_API_CATALOG = Object.freeze({
  /**
   * STRIPE — PLUS AUCUN CHAMP LOCAL (lot L6.3 FINAL).
   *
   * ── CE QUI A DISPARU, ET POURQUOI ─────────────────────────────────────────
   *
   * `secretKey` était le dernier champ saisissable. Elle n'était plus lue par
   * aucun chemin d'exécution depuis L6.3C — pas même par le diagnostic, migré
   * juste avant — et la laisser aurait été pire qu'inutile : un opérateur qui
   * la remplit croit avoir réparé quelque chose, alors que la valeur ne sert à
   * rien ; et le secret, lui, existe vraiment.
   *
   * Elle aurait surtout permis de RECONSTRUIRE la dépendance : la clé revenue
   * en base, il ne manquait plus qu'un appelant.
   *
   * ── CE QUI RESTE, ET POURQUOI CE N'EST PAS UNE EXCEPTION ──────────────────
   *
   * `webhookSecret` (`whsec_…`) demeure — mais il n'est PAS un champ de ce
   * catalogue, et c'est le point. Il est livré par le Panel via le canal étroit
   * de L6.3A, écrit directement dans le coffre par le service de
   * provisionnement, et il ne permet AUCUN appel : il sert uniquement à
   * constater qu'un événement reçu vient bien de Stripe.
   *
   * Le sortir du catalogue est donc exact plutôt que commode — un catalogue
   * décrit ce qu'un humain peut SAISIR, et personne ne saisit celui-là.
   *
   * `authority: 'PANEL'` est le drapeau qui exprime tout cela, et l'API s'en
   * sert pour REFUSER toute écriture. La garde n'est pas dans l'écran, qui ne
   * fait que la refléter.
   *
   * L'entrée reste au catalogue : la page doit pouvoir dire « les paiements
   * sont gérés par la plateforme ». La retirer ferait disparaître Stripe de
   * l'écran, et l'on chercherait longtemps qui encaisse.
   */
  STRIPE: {
    provider: 'STRIPE',
    displayName: 'Stripe',
    active: true,
    authority: 'PANEL',
    website: 'https://dashboard.stripe.com/apikeys',
    usage: 'Encaissements, abonnements, portail client et remboursements — assurés par la plateforme.',
    fields: [],
  },
  SIGNATURE: {
    provider: 'SIGNATURE',
    displayName: 'Signature électronique',
    active: true,
    /**
     * AUTORITE PANEL (R10.5C) — comme Stripe depuis L6.3.
     *
     * Ce projet ne detient AUCUNE credential de signature : ni cle d appel, ni
     * secret de webhook. Les signatures passent par les capacites du Panel, et
     * les webhooks arrivent au Panel puis sont projetes par le pont.
     *
     * C'est precisement ce qui rend le changement de fournisseur invisible
     * d'ici : il n'y avait rien a remplacer.
     *
     *  n est pas un oubli : c est la forme qui empeche le Manager
     * d afficher un formulaire, et la route d ecriture de rien accepter.
     */
    authority: 'PANEL',
    /**
     * AUCUNE ADRESSE DE FOURNISSEUR ICI.
     *
     * Cette ligne pointait `yousign.app`. Ce n'était pas grave tant que le
     * fournisseur ne changeait pas ; depuis, elle enverrait quiconque la suit
     * chez un prestataire qui ne sert plus ce projet — et la laisser à jour
     * supposerait que ce projet SACHE qui sert, ce qui est précisément ce dont
     * la centralisation l'a débarrassé.
     *
     * L'adresse qui compte est celle de la plateforme, et elle est déjà la
     * seule que ce projet connaisse.
     */
    website: null,
    usage: 'Signature electronique des contrats — assuree par la plateforme.',
    fields: [],
  },
  /**
   * BREVO — DERNIER FOURNISSEUR PASSE SOUS AUTORITE PLATEFORME (lot R11).
   *
   * -- POURQUOI CE PROJET N'A PLUS DE CLE BREVO ------------------------------
   *
   * Les envois partent du compte Brevo DU PANEL depuis la bascule L8 : c'est la
   * capacite `email.send_template` qui ecrit, avec le coffre et la politique
   * commerciale de la plateforme. Le driver local a ete retire en R10.5A, et
   * avec lui le dernier appelant.
   *
   * Restait une cle, et une administration de webhook qui s'en servait pour
   * declarer un endpoint chez Brevo. Or les webhooks de livraison suivent le
   * COMPTE : depuis la bascule, les `delivered` / `bounced` n'arrivent plus a
   * ce projet mais au Panel, qui les reprojette par le pont
   * (`EMAIL_DELIVERY_EVENT` -> `emailDeliveryEvent.applier`). L'endpoint local
   * declarait donc une adresse que Brevo n'appelait plus, et la cle ne servait
   * qu'a maintenir cette declaration morte.
   *
   * -- POURQUOI RETIRER LES CHAMPS PLUTOT QUE LES MASQUER --------------------
   *
   * Un champ de saisie qui subsiste est une promesse : l'operateur qui le
   * remplit croit avoir repare quelque chose, alors que la valeur n'est lue par
   * aucun chemin d'execution. Et le secret, lui, existe vraiment. Surtout, une
   * cle revenue en base ne laisse plus manquer qu'un appelant pour reconstruire
   * la dependance.
   *
   * `authority: 'PANEL'` est le drapeau qui exprime tout cela, et l'API s'en
   * sert pour REFUSER toute ecriture. La garde n'est pas dans l'ecran, qui ne
   * fait que la refleter.
   */
  BREVO: {
    provider: 'BREVO',
    displayName: 'Brevo',
    active: true,
    authority: 'PANEL',
    website: 'https://app.brevo.com',
    usage: 'E-mails transactionnels et suivi de livraison — assures par la plateforme.',
    fields: [],
  },
  /**
   * HOSTINGER — LE PREMIER FOURNISSEUR SANS AUCUN CHAMP LOCAL (lot L9.2).
   *
   * ── POURQUOI `fields` EST VIDE ────────────────────────────────────────────
   *
   * Le DNS d'une publication passe par la plateforme : elle prouve que le nom
   * appartient à ce projet, puis écrit avec SA clé. Ce projet n'a donc plus
   * besoin d'un jeton Hostinger — et laisser le champ de saisie serait pire
   * qu'inutile. Un opérateur qui le remplit croit avoir réparé quelque chose,
   * alors que la valeur n'est plus lue par aucun chemin d'exécution ; et le
   * secret, lui, existe vraiment.
   *
   * `authority: 'PANEL'` est le drapeau qui l'exprime, et l'API s'en sert pour
   * REFUSER toute écriture de credential — la garde n'est pas dans l'écran, qui
   * ne fait que la refléter.
   *
   * L'entrée reste au catalogue : la page doit pouvoir dire « ce fournisseur
   * est géré par la plateforme ». La retirer ferait disparaître Hostinger de
   * l'écran, et l'on chercherait longtemps qui administre les domaines.
   */
  HOSTINGER: {
    provider: 'HOSTINGER',
    displayName: 'Hostinger',
    active: true,
    authority: 'PANEL',
    website: 'https://hpanel.hostinger.com/profile/api',
    usage: 'Gestion automatique des domaines et DNS lors des publications — assurée par la plateforme.',
    fields: [],
  },
});

/**
 * Ce fournisseur est-il servi par le plan de contrôle de la plateforme ?
 *
 * Une seule lecture, pour que la règle ne se recopie pas — l'écran, l'API et
 * les tests doivent tous répondre la même chose au même moment.
 */
export function isPanelAuthority(provider) {
  return INTEGRATED_API_CATALOG[String(provider ?? '').toUpperCase()]?.authority === 'PANEL';
}

/*
 * `deriveYousignBaseUrl` a ete RETIRE en R10.5C.
 *
 * Il fournissait un hote Yousign par defaut, cote projet. Plus aucun code
 * d ici n appelle Yousign : cet hote etait devenu un repli sans appelant,
 * c est-a-dire une invitation a en rebrancher un.
 */

/**
 * L6.3 FINAL — L'ADRESSE DE STRIPE A DISPARU DE CE PROJET.
 *
 * `STRIPE_BASE_URL` était purement déclarative depuis L6.3C : plus aucun code
 * ne l'utilisait pour appeler quoi que ce soit. Elle a été retirée parce que
 * c'est exactement le genre de constante qu'un futur helper reprendrait
 * « puisqu'elle est là » — et il ne manquerait plus qu'une clé.
 *
 * L'adresse du fournisseur vit désormais du seul côté qui l'appelle : le
 * coffre du Panel, où elle est éditable par monde.
 */

/**
 * URL de base par DÉFAUT d'un fournisseur/mode. Pré-remplie à la création et
 * éditable : le backend utilise TOUJOURS la baseUrl du mode actif (stockée), et
 * ne retombe sur ce défaut que si aucune n'est configurée. Jamais de constante
 * codée en dur dans les drivers.
 */
export function defaultBaseUrl(provider, mode) {
  /**
   * R11 — PLUS AUCUNE ADRESSE DE FOURNISSEUR DANS CE PROJET.
   *
   * L'adresse d'un fournisseur n'a de sens que pour qui l'appelle. Ce projet
   * n'appelle plus aucun des quatre : elles vivent desormais du seul cote qui
   * compose des requetes, le coffre du Panel, ou elles sont editables par monde.
   *
   * Les laisser ici serait exactement le genre de constante qu'un futur helper
   * reprendrait « puisqu'elle est la » — et il ne manquerait plus qu'une cle.
   */
  return '';
}

/** Le fournisseur expose-t-il une base URL configurable ? (tous en V1). */
export function hasBaseUrl(provider) {
  /**
   * Stripe n'y figure plus (L6.3 FINAL) : une base URL éditable n'a de sens
   * que pour un fournisseur que ce projet appelle. Il ne l'appelle plus.
   */
  return false;
}

/** Fournisseurs actifs (exposés dans l'UI et seedés). */
export function activeProviders() {
  return Object.values(INTEGRATED_API_CATALOG).filter((p) => p.active);
}

export function fieldKeys(provider) {
  return (INTEGRATED_API_CATALOG[provider]?.fields || []).map((f) => f.key);
}

export function requiredFieldKeys(provider) {
  return (INTEGRATED_API_CATALOG[provider]?.fields || [])
    .filter((f) => f.required)
    .map((f) => f.key);
}

export function fieldDef(provider, key) {
  return (INTEGRATED_API_CATALOG[provider]?.fields || []).find((f) => f.key === key);
}

/** Verbe de confirmation exigé pour activer le mode PROD d'un fournisseur. */
export function confirmVerb(provider) {
  return INTEGRATED_API_CATALOG[provider]?.confirmVerb || `ACTIVER ${provider} PROD`;
}

export function isKnownProvider(provider) {
  return Boolean(INTEGRATED_API_CATALOG[provider]);
}

export function isValidMode(mode) {
  return MODE_VALUES.includes(mode);
}

export default INTEGRATED_API_CATALOG;
