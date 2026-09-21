/**
 * LA SURFACE STRIPE LOCALE — GELÉE (L6.3).
 *
 * ══ CE QUE CETTE SUITE GARDE, ET POURQUOI ELLE EXISTE ═══════════════════════
 *
 * Les lots L6.2B→L6.2G ont migré les parcours financiers vers le Panel. Mais
 * migrer un parcours n'empêche personne de rouvrir l'ancien chemin demain : le
 * SDK Stripe est toujours installé, la clé est toujours dans le coffre, et un
 * `stripe.customers.create()` de trois lignes recompilerait sans un mot.
 *
 * Cette suite transforme donc l'état actuel en INVARIANT VÉRIFIÉ :
 *
 *   · un seul endroit du projet construit un client Stripe ;
 *   · ce client expose EXACTEMENT quatre méthodes, nommées une par une ;
 *   · les neuf méthodes retirées en L6.3 ne peuvent pas revenir ;
 *   · aucun appel HTTP direct vers Stripe hors des adaptateurs déclarés ;
 *   · aucun repli local sur un parcours migré.
 *
 * ══ CE QU'ELLE N'AFFIRME PAS ════════════════════════════════════════════════
 *
 * Elle ne prétend PAS que le projet ne parle plus à Stripe. Il lui parle
 * encore — quatre appels métier, un diagnostic, et la gestion de son propre
 * endpoint webhook. Le rapport L6.3 les nomme et explique pourquoi ils
 * bloquent.
 *
 * Ce que cette suite garantit est plus modeste et plus solide : cette liste ne
 * peut que RÉTRÉCIR. Toute addition la fait rougir. C'est ce qui rend la
 * fermeture progressive irréversible, avant même qu'elle soit complète.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(ICI, '..');

let pass = 0;
let fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };
const section = (n) => console.log(`\n${n}`);

const lire = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

/** Retire commentaires et chaînes : un invariant ne se prouve pas sur de la prose. */
function codeSeul(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');
}

/** Tous les fichiers runtime du backend (ni tests, ni helpers de test). */
function fichiersRuntime() {
  const out = [];
  const ignorer = new Set(['node_modules', 'scripts', 'uploads', 'dist']);
  (function marcher(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!ignorer.has(e.name)) marcher(path.join(dir, e.name));
      } else if (e.name.endsWith('.js')) {
        out.push(path.join(dir, e.name));
      }
    }
  })(SRC);
  return out;
}

const RUNTIME = fichiersRuntime().map((f) => ({
  rel: path.relative(SRC, f).replace(/\\/g, '/'),
  code: codeSeul(fs.readFileSync(f, 'utf8')),
}));

try {
  /* ══════════════════════════════════════════════════════════════════════════
     1. UN SEUL CLIENT STRIPE DANS TOUT LE PROJET
     ══════════════════════════════════════════════════════════════════════════ */
  section('1. Un seul endroit construit un client Stripe');
  {
    /**
     * On cherche le SDK par son import ET par son constructeur. Les deux, parce
     * qu'ils se contournent différemment : un `import Stripe from 'stripe'`
     * sans `new` ne sert à rien, et un `new Stripe(...)` sans import ne compile
     * pas — mais un futur helper pourrait ré-exporter l'un ou l'autre.
     */
    const importeurs = RUNTIME.filter((f) => /from\s+['"]stripe['"]|require\(\s*['"]stripe['"]\s*\)/.test(f.code));
    const constructeurs = RUNTIME.filter((f) => /new\s+Stripe\s*\(/.test(f.code));

    /**
     * L6.3C — L'INVARIANT S'INVERSE, ET C'EST LE LOT EN UNE LIGNE.
     *
     * Il disait « un seul fichier importe le SDK ». Il dit désormais AUCUN.
     * Le dernier appel métier est parti, donc le pilote aussi, donc l'import.
     *
     * C'est la forme la plus forte que cette garde puisse prendre : tant qu'un
     * fichier importait le SDK, trois lignes suffisaient à rouvrir un appel.
     * Il n'y a plus de fichier à modifier.
     */
    check('AUCUN fichier runtime n’importe le SDK Stripe', importeurs.length === 0);
    check('…et aucun ne construit de client', constructeurs.length === 0);
    importeurs.forEach((f) => console.error(`      · importe le SDK : ${f.rel}`));
    constructeurs.forEach((f) => console.error(`      · construit un client : ${f.rel}`));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     2. LA SURFACE AUTORISÉE, NOMMÉE UNE PAR UNE
     ══════════════════════════════════════════════════════════════════════════ */
  section('2. Le provider expose EXACTEMENT la surface déclarée');
  {
    /**
     * L'INVENTAIRE DU RESTE À FAIRE.
     *
     * Ces quatre-là subsistent parce qu'aucune capacité Panel ne les sert
     * encore. La liste est volontairement écrite en dur : c'est une DETTE
     * nommée, pas un paramètre. La retoucher doit être un geste conscient,
     * relu, et justifié dans le rapport du lot qui la retouche.
     */
    /**
     * L6.3C — L'INVENTAIRE EST VIDE, ET LE FICHIER AUSSI.
     *
     * Ce contrôle énumérait la surface restante, méthode par méthode. Il n'y a
     * plus rien à énumérer : `stripe.provider.js` et `stripe.stub.js` ont été
     * supprimés avec le dernier appel qui les justifiait.
     *
     * On vérifie donc leur ABSENCE — c'est plus fort qu'une liste vide, qu'un
     * fichier vide satisferait aussi.
     */
    for (const parti of ['services/stripe/stripe.provider.js', 'services/stripe/stripe.stub.js']) {
      check(`${parti} n’existe plus`, !fs.existsSync(path.join(SRC, parti)));
    }
    const service = await import('../services/stripe/stripe.service.js');
    check('le service n’expose plus getStripeProvider', service.getStripeProvider === undefined);
    check('…ni par son export par défaut', service.default?.getStripeProvider === undefined);

    /**
     * ET CE QU'IL GARDE EST EXACTEMENT CE QUI NE PARLE PAS À STRIPE : la
     * vérification cryptographique des webhooks entrants, la traduction des
     * statuts, les metadata d'audit. Aucune de ces fonctions ne sort sur le
     * réseau.
     */
    check('il vérifie toujours les signatures entrantes',
      typeof service.verifyStripeWebhookAnyMode === 'function');
    check('…et traduit toujours les statuts', typeof service.mapSubscriptionStatus === 'function');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     3. LES NEUF RETIRÉES NE REVIENNENT PAS
     ══════════════════════════════════════════════════════════════════════════ */
  section('3. Les gestes migrés ne peuvent pas rouvrir localement');
  {
    /**
     * On garde les NOMS retirés, et on vérifie qu'ils n'apparaissent nulle part
     * dans le runtime. C'est plus fort qu'un contrôle sur le seul provider : un
     * développeur pressé écrirait plutôt un `stripe.customers.create()` ailleurs.
     */
    const RETIREES = {
      // L6.3C — LE DERNIER. Retiré sans remplacement : un `pi_…` seul ne prouve
      // rien, et le Panel ne possède une intention que par filiation depuis une
      // session — or ce chemin partait justement d'un paiement sans session.
      retrievePaymentIntent: 'supprimé : plus aucune autorisation possible (L6.3C)',
      // L6.3B — les dernières lectures, et le portail.
      createBillingPortalSession: 'billing.portal.create (L6.3B)',
      retrieveInvoice: 'billing.invoice.retrieve (L6.3B)',
      listInvoices: 'billing.invoice.list (L6.3B)',
      createCustomer: 'billing.customer.ensure (L6.2D)',
      createProduct: 'billing.price.ensure (L6.2E)',
      createPrice: 'billing.price.ensure (L6.2E)',
      createCheckoutSession: 'billing.checkout.create (L6.2B)',
      retrieveCheckoutSession: 'billing.checkout.retrieve (L6.2C)',
      retrieveSubscription: 'billing.subscription.retrieve (L6.2F)',
      listSubscriptions: 'supprimée : rattachait par metadata, donc par un champ éditable',
      cancelSubscriptionAtPeriodEnd: 'billing.subscription.cancel_at_period_end (L6.2G)',
      cancelSubscriptionNow: 'billing.subscription.cancel_now (L6.2G)',
    };

    for (const [nom, remplacant] of Object.entries(RETIREES)) {
      const coupables = RUNTIME.filter((f) => new RegExp(`[.\\s]${nom}\\s*[(:]`).test(f.code));
      check(`${nom} n’existe plus dans le runtime → ${remplacant}`, coupables.length === 0);
      coupables.forEach((f) => console.error(`      · ${f.rel}`));
    }

    /**
     * LES PRIMITIVES DU SDK, AUSSI.
     *
     * Retirer nos noms de méthode ne suffirait pas : le SDK expose les siens.
     * On interdit donc les familles d'objets que le Panel possède désormais,
     * partout sauf dans le provider — qui n'en contient plus aucune.
     */
    const PRIMITIVES = [
      'customers.create', 'products.create', 'prices.create',
      'checkout.sessions.create', 'checkout.sessions.retrieve',
      'subscriptions.create', 'subscriptions.update', 'subscriptions.cancel',
      'subscriptions.retrieve', 'subscriptions.list',
      // L6.3B — les primitives des factures et du portail.
      'invoices.list', 'invoices.retrieve', 'billingPortal.sessions.create',
      // L6.3C — la dernière.
      'paymentIntents.retrieve',
    ];
    for (const p of PRIMITIVES) {
      const motif = new RegExp(p.replace(/\./g, '\\s*\\.\\s*'));
      const coupables = RUNTIME.filter((f) => motif.test(f.code));
      check(`aucun appel SDK « ${p} »`, coupables.length === 0);
      coupables.forEach((f) => console.error(`      · ${f.rel}`));
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     4. LE STUB NE PREND PAS D'AVANCE SUR LE PROVIDER
     ══════════════════════════════════════════════════════════════════════════ */
  section('4. Il n’y a plus ni pilote ni double à faire correspondre');
  {
    /**
     * L6.3C — CETTE SECTION A PERDU SON OBJET, ET C'EST UNE BONNE NOUVELLE.
     *
     * Elle vérifiait qu'un double de test n'exposait aucun geste absent du
     * pilote : un stub plus riche aurait permis d'écrire un test pour un verbe
     * qui n'existe plus, et ce test aurait ensuite réclamé son implémentation.
     *
     * Les deux fichiers ont disparu. On garde donc le contrôle sous sa forme
     * la plus simple : personne ne les importe, ni en runtime ni ailleurs.
     */
    const importeurs = RUNTIME.filter((f) => /stripe\.(provider|stub)/.test(f.code));
    check('aucun fichier runtime n’importe le pilote ou son double', importeurs.length === 0);
    importeurs.forEach((f) => console.error(`      · ${f.rel}`));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     5. AUCUN APPEL HTTP DIRECT HORS DES ADAPTATEURS DÉCLARÉS
     ══════════════════════════════════════════════════════════════════════════ */
  section('5. Personne n’appelle Stripe « à la main »');
  {
    /**
     * Le contrôle porte sur l'ADRESSE, pas sur le nom du fichier : contourner
     * le provider en écrivant un `fetch('https://api.stripe.com/v1/…')` est le
     * chemin le plus court vers un retour en arrière, et le plus discret.
     *
     * Deux fichiers ont le droit d'y aller, et c'est précisément la dette que
     * le rapport L6.3 documente.
     */
    /**
     * L6.3 FINAL — L'ADRESSE DE STRIPE A DISPARU DU PROJET.
     *
     * `STRIPE_BASE_URL` était purement déclarative : plus aucun code ne s'en
     * servait pour appeler. Elle a été retirée parce que c'est exactement le
     * genre de constante qu'un futur helper reprendrait « puisqu'elle est là ».
     */
    const adresses = RUNTIME.filter((f) => /api\.stripe\.com/.test(f.code)).map((f) => f.rel).sort();
    check('AUCUNE adresse Stripe dans le runtime', adresses.length === 0);
    adresses.forEach((r) => console.error(`      · adresse Stripe : ${r}`));

    /**
     * ══ LE CONTRÔLE QUI COMPTE VRAIMENT : QUI LIT LA CLÉ ? ═══════════════════
     *
     * Une adresse en dur se contourne (le catalogue la fournit). Ce qui ne se
     * contourne pas, c'est la LECTURE DU SECRET : sans elle, aucun appel
     * sortant n'est possible, quelle que soit l'adresse.
     *
     * Ces trois fichiers sont donc l'inventaire exact de ce que L6.3 n'a PAS
     * pu fermer. Chacun est une dette nommée dans le rapport :
     *
     *   stripe.provider.js            les 4 appels métier sans capacité Panel
     *   remoteWebhookAdapters.js      provisionne l'endpoint du projet chez
     *                                 Stripe — le blocage structurel du lot
     *   providerConnectionTest.…js    diagnostic « la clé répond-elle ? »
     *
     * En ajouter un quatrième fait rougir cette suite. C'est ce qui empêche la
     * surface de regrandir pendant que les capacités manquantes s'écrivent.
     */
    /**
     * L6.3A — ILS SONT DEUX, ET NON PLUS TROIS.
     *
     * `remoteWebhookAdapters.js` a disparu de cette liste : le projet ne
     * provisionne plus son endpoint chez Stripe, c'est le Panel qui le fait
     * avec SA clé. C'est le seul changement de ce lot sur cette garde, et il ne
     * va que dans un sens.
     */
    /**
     * L6.3 FINAL — IL N'EN RESTE AUCUN.
     *
     * Le dernier lecteur était le test de connexion. Il éprouvait la clé locale
     * alors que les paiements passaient par celle du Panel : il était déjà
     * trompeur, et il disait « Connexion Stripe réussie » pour une clé dont
     * plus rien ne dépendait. Il interroge désormais le Control Plane.
     *
     * La liste est VIDE, et c'est la forme la plus forte de cette garde : il
     * n'existe plus aucun fichier à modifier pour rouvrir une lecture.
     */
    const LECTEURS_DE_CLE = [];
    const lecteurs = RUNTIME
      .filter((f) => /getCredential\(\s*['"]STRIPE['"]\s*,\s*['"]secretKey['"]|readStoredCredential\([^)]*['"]secretKey['"]/.test(f.code))
      .map((f) => f.rel).sort();

    check(`exactement ${LECTEURS_DE_CLE.length} fichiers lisent la clé secrète Stripe`,
      lecteurs.length === LECTEURS_DE_CLE.length);
    for (const rel of LECTEURS_DE_CLE) check(`…dont ${rel}`, lecteurs.includes(rel));
    lecteurs.filter((r) => !LECTEURS_DE_CLE.includes(r))
      .forEach((r) => console.error(`      · NOUVEAU lecteur de clé : ${r}`));

    /**
     * Et surtout : aucun SERVICE MÉTIER ne lit la clé. Les trois lecteurs sont
     * un adaptateur de transport, un gestionnaire de webhook et un diagnostic —
     * jamais un parcours contrat, paiement ou abonnement.
     */
    const metiers = lecteurs.filter((r) => /^services\/(contract|payment|subscription|billing|reconciliation)/.test(r));
    check('aucun service métier ne lit la clé secrète', metiers.length === 0);
    metiers.forEach((r) => console.error(`      · ${r}`));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     5bis. LE PROVISIONNEMENT DE WEBHOOK A QUITTÉ LE PROJET (L6.3A)
     ══════════════════════════════════════════════════════════════════════════ */
  section('5bis. Plus aucun endpoint webhook n’est administré d’ici');
  {
    /**
     * LE GESTE QUI RENDAIT LA CLÉ INDISPENSABLE.
     *
     * Tant que le projet enregistrait lui-même son endpoint chez Stripe, il lui
     * fallait une clé d'API — et donc le pouvoir d'appeler Stripe pour tout le
     * reste. C'est pour cela que L6.3 était BLOCKED, et c'est ce que ce lot
     * ferme.
     *
     * On cherche l'ADRESSE de la ressource, pas le nom d'une fonction : un
     * futur helper qui la rappellerait sous un autre nom serait attrapé quand
     * même.
     */
    const provisionneurs = RUNTIME.filter((f) => /webhook_endpoints/.test(f.code));
    check('aucun code ne touche à /v1/webhook_endpoints', provisionneurs.length === 0);
    provisionneurs.forEach((f) => console.error(`      · ${f.rel}`));

    /** Et le pilote distant lui-même n'existe plus. */
    const adaptateurs = codeSeul(lire('services/webhooks/remoteWebhookAdapters.js'));
    check('l’adaptateur webhook Stripe a été SUPPRIMÉ',
      !/stripeWebhookAdapter/.test(adaptateurs));
    /**
     * ET CELUI DE YOUSIGN A SUIVI (R10.5C).
     *
     * Cette ligne disait « lui, reste légitimement » — c'était vrai tant que
     * Yousign appelait ce projet. Il appelle désormais le Panel : garder
     * l'adaptateur aurait laissé un provisionneur capable d'enregistrer, chez
     * le fournisseur, une adresse qui rend 404 — c'est-à-dire de rompre le
     * chemin retour en croyant le réparer.
     */
    check('…et celui de Yousign a été supprimé lui aussi',
      !/yousignWebhookAdapter/.test(adaptateurs));

    /**
     * LE DRIVER N'EXIGE PLUS DE CREDENTIAL LOCAL. C'est cette déclaration que
     * lit l'orchestrateur pour décider s'il peut agir : la laisser à
     * `'secretKey'` aurait fait sauter le provisionnement dès qu'on retirera
     * la clé, sans que rien n'explique pourquoi.
     */
    const drivers = codeSeul(lire('services/webhooks/integrationWebhookProviders.js'));
    check('le driver Stripe n’exige plus aucun credential local',
      /engineProvider\('STRIPE', 'payment', stripeManager, null\)/.test(drivers));
    check('…et il est servi par le Panel',
      /createPanelBackedStripeWebhookManager/.test(drivers));

    /**
     * AUCUN REPLI : le module de provisionnement ne doit contenir aucun chemin
     * qui retomberait sur Stripe en cas d'indisponibilité du Panel.
     */
    const provisionnement = codeSeul(lire('services/webhooks/panelWebhookProvisioning.js'));
    check('le provisionnement ne construit aucun client Stripe',
      !/new\s+Stripe|stripeProvider/.test(provisionnement));
    check('…et ne lit aucune clé secrète',
      !/getCredential\([^)]*secretKey/.test(provisionnement));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     5ter. LE SECRET DE VÉRIFICATION NE SERT QU'À VÉRIFIER
     ══════════════════════════════════════════════════════════════════════════ */
  section('5ter. Le secret de signature ne peut pas devenir une clé d’appel');
  {
    /**
     * LA CONFUSION QUE CE LOT NE DOIT PAS INTRODUIRE.
     *
     * Un `whsec_` descend désormais jusqu'ici. S'il pouvait ensuite être
     * présenté au transport Stripe comme un credential, on aurait déplacé le
     * problème au lieu de le résoudre — un secret qui traverse le pont et qui
     * ouvre des portes est exactement ce que la frontière L4 interdit.
     *
     * On vérifie donc qu'aucun appel sortant ne le lit.
     */
    /**
     * L6.3C — il n'y a plus de pilote à interroger : la question devient
     * « aucun appel SORTANT ne lit ce secret », et le seul candidat restant
     * est le diagnostic.
     */
    const diagnostic = codeSeul(lire('services/providerConnectionTest.service.js'));
    check('le test de connexion non plus', !/webhookSecret/.test(diagnostic));

    /**
     * Et il n'est utilisé QUE là où l'on vérifie une signature entrante : le
     * service Stripe (vérification) et le provisionnement (rangement).
     */
    /**
     * Le secret de signature STRIPE n'est lu que là où l'on vérifie une
     * signature entrante, ou là où on le range. Chaque fournisseur a le sien ;
     * on ne parle ici que de celui de Stripe.
     */
    const LECTEURS_ATTENDUS = [
      'services/stripe/stripe.service.js',
      'services/webhooks/panelWebhookProvisioning.js',
    ];
    const lecteursDuSecret = RUNTIME
      .filter((f) => /['"]STRIPE['"]\s*,\s*['"]webhookSecret['"]|credentials\.set\(\s*['"]webhookSecret['"]/.test(f.code))
      .map((f) => f.rel).sort();
    check('le secret de signature Stripe n’est lu qu’aux endroits attendus',
      lecteursDuSecret.every((r) => LECTEURS_ATTENDUS.includes(r)));
    lecteursDuSecret.filter((r) => !LECTEURS_ATTENDUS.includes(r))
      .forEach((r) => console.error(`      · lecteur inattendu : ${r}`));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     6. AUCUN REPLI LOCAL SUR UN PARCOURS MIGRÉ
     ══════════════════════════════════════════════════════════════════════════ */
  section('6. Une panne du Panel est une panne, pas un retour en arrière');
  {
    /**
     * LE MOTIF INTERDIT : `try { capacité } catch { Stripe local }`.
     *
     * C'est la façon la plus naturelle — et la plus dangereuse — de « rendre le
     * système robuste » : elle réactive silencieusement la clé du projet
     * exactement le jour où le Panel est indisponible, c'est-à-dire le jour où
     * personne ne regarde.
     *
     * On cherche donc, dans les services migrés, un `catch` suivi d'un appel au
     * provider local dans la même portée textuelle.
     */
    const MIGRES = [
      'services/contract.service.js',
      'services/contractTestTools.service.js',
      'services/payment.service.js',
      'services/subscription.service.js',
      'services/stripe/checkoutCapability.js',
      'services/stripe/customerCapability.js',
    ];

    for (const rel of MIGRES) {
      const code = codeSeul(lire(rel));
      const replis = [...code.matchAll(/catch\s*(\([^)]*\))?\s*\{([\s\S]{0,400}?)\}/g)]
        .filter((m) => /(provider|stripeProvider|getStripeProvider\(\))\s*\.\s*(create|retrieve|list|cancel|update)/.test(m[2]));
      check(`${rel} : aucun repli Stripe local dans un catch`, replis.length === 0);
      replis.forEach((m) => console.error(`      · ${m[0].slice(0, 120).replace(/\s+/g, ' ')}…`));
    }

    /** Et les gestes migrés passent bien par la capacité, sur les deux faces. */
    const contrat = codeSeul(lire('services/contract.service.js'));
    check('la résiliation demande la capacité (L6.2G)', /cancelSubscriptionViaPanel/.test(contrat));
    const paiement = codeSeul(lire('services/payment.service.js'));
    check('le paiement des frais demande la capacité (L6.2B)', /createCheckoutViaPanel|checkoutCapability/.test(paiement));
    const abonnement = codeSeul(lire('services/subscription.service.js'));
    check('la lecture d’abonnement demande la capacité (L6.2F)', /readSubscriptionViaPanel/.test(abonnement));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     7. PLUS AUCUN CHAMP DE SAISIE INUTILE
     ══════════════════════════════════════════════════════════════════════════ */
  section('7. Le catalogue ne propose plus de clé que personne ne lit');
  {
    const { INTEGRATED_API_CATALOG } = await import('../utils/integratedApiCatalog.js');
    const champs = INTEGRATED_API_CATALOG.STRIPE.fields.map((f) => f.key);

    /**
     * `publishableKey` n'était lue par AUCUN code : elle n'existait que comme
     * champ de saisie. Un endroit de plus où coller une clé Stripe, sans qu'un
     * seul geste n'en dépende.
     */
    check('publishableKey a disparu du catalogue', !champs.includes('publishableKey'));
    const lecteurs = RUNTIME.filter((f) => /publishableKey/.test(f.code));
    check('…et plus aucun fichier ne la nomme', lecteurs.length === 0);

    /**
     * L6.3 FINAL — LE CATALOGUE STRIPE N'A PLUS AUCUN CHAMP.
     *
     * `secretKey` était le dernier saisissable. La retirer n'était pas
     * cosmétique : tant qu'elle figurait ici, un opérateur pouvait la reposer
     * en base, et il ne manquait plus qu'un appelant pour reconstruire la
     * dépendance.
     *
     * `webhookSecret` n'y figure pas non plus — non parce qu'il aurait disparu,
     * mais parce qu'un catalogue décrit ce qu'un HUMAIN peut saisir, et
     * personne ne saisit celui-là : le Panel le livre, le provisionnement
     * l'écrit.
     */
    check('le catalogue Stripe ne déclare AUCUN champ', champs.length === 0);
    check('…et Stripe est déclaré sous autorité de la plateforme',
      INTEGRATED_API_CATALOG.STRIPE.authority === 'PANEL');
    check('…au même titre qu’Hostinger depuis L9.2',
      INTEGRATED_API_CATALOG.HOSTINGER.authority === 'PANEL');

    /**
     * LES DEUX SECRETS N'ONT PAS LA MÊME NATURE, et les confondre serait la
     * pire erreur de ce lot :
     *
     *   secretKey     permet d'APPELER Stripe    → doit disparaître à terme
     *   webhookSecret permet de VÉRIFIER une     → reste légitimement, tant que
     *                 signature entrante            Stripe appelle le projet
     */
    /**
     * LE `whsec_` VIT TOUJOURS — DANS LE COFFRE, PAS DANS LE CATALOGUE.
     *
     * C'est la distinction qui tient tout le lot : un secret de VÉRIFICATION
     * reste légitimement local tant que Stripe écrit directement au projet ;
     * une clé d'APPEL n'a plus aucune raison d'y être.
     */
    const provisionnement = codeSeul(lire('services/webhooks/panelWebhookProvisioning.js'));
    check('le secret de signature est écrit par le PROVISIONNEMENT, pas par une saisie',
      /credentials\.set\(\s*'webhookSecret'/.test(provisionnement));
    const serviceStripe = codeSeul(lire('services/stripe/stripe.service.js'));
    check('…et lu uniquement pour vérifier une signature entrante',
      /tryGetCredential\(\s*'STRIPE',\s*'webhookSecret'/.test(serviceStripe));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     8. L'HISTOIRE NE S'EFFACE PAS AVEC LES CLÉS
     ══════════════════════════════════════════════════════════════════════════ */
  section('8. Les références Stripe passées sont préservées');
  {
    /**
     * Le projet peut cesser de POSSÉDER Stripe tout en conservant la trace des
     * actes passés. Ces identifiants ne sont pas des credentials : ils sont la
     * mémoire comptable, et Finances (L10.3) s'en sert pour rattacher un revenu
     * à un contrat. Les supprimer « parce que Stripe s'en va » romprait cette
     * chaîne sans rien sécuriser.
     */
    const contrat = lire('models/Contract.model.js');
    for (const champ of ['customerId', 'subscriptionId', 'checkoutSessionId']) {
      check(`Contract conserve stripe.${champ}`, new RegExp(champ).test(contrat));
    }
    const paiement = lire('models/Payment.model.js');
    check('Payment conserve son identifiant d’idempotence', /idempotencyKey/.test(paiement));
    check('…et sa référence de PaymentIntent', /paymentIntentId/.test(paiement));
    const facture = lire('models/Invoice.model.js');
    check('Invoice conserve sa provenance Stripe', /stripe/i.test(facture));
    check('…et l’environnement d’origine', /environment/.test(facture));
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} catch (err) {
  console.error('STRIPE LOCAL SURFACE TEST CRASHED:', err);
  fail++;
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
}

process.exit(fail === 0 ? 0 : 1);
