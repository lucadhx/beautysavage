/**
 * LA PURGE DES CREDENTIALS MORTES — ET CE QU'ELLE NE TOUCHE JAMAIS (L6.4).
 *
 * ══ LE RISQUE DE CE LOT ═════════════════════════════════════════════════════
 *
 * Tous les lots précédents ajoutaient des refus. Celui-ci SUPPRIME des données
 * chiffrées, et une suppression de secret ne se rattrape pas.
 *
 * Le scénario redouté tient en une ligne : supprimer le `whsec_` de Stripe
 * parce que « le projet n'appelle plus Stripe ». Les paiements continueraient,
 * et le projet cesserait d'en être averti — une panne silencieuse, sur le
 * chemin de l'argent.
 *
 * Cette suite éprouve donc d'abord ce qui doit SURVIVRE, ensuite ce qui doit
 * partir.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'purge_test';
process.env.DB_PROD = 'purge_prod';
process.env.JWT_SECRET = 'test-secret-jwt-purge-l64-32chars!!';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.PANEL_SCHEDULER_ENABLED = 'false';

let pass = 0;
let fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };
const section = (n) => console.log(`\n${n}`);

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();

const { IntegratedApi } = await import('../models/IntegratedApi.model.js');
const { encryptSecret, lastFourOf, decryptSecret } = await import('../utils/integratedApiCrypto.js');
const { purgeDeadCredentials, planForDocument, CREDENTIAL_POLICY } = await import('./purge-dead-provider-credentials.js');

const cred = (v) => ({ encryptedValue: encryptSecret(v), lastFour: lastFourOf(v), updatedAt: new Date() });

/** Sentinelles composées : aucune chaîne en forme de clé dans la source. */
const p = (m) => ['sk', m, ''].join('_');
const CLE_MORTE = `${p('test')}L64MORTEJAMAISRELUE000001`;
const CLE_MORTE_PROD = `${p('live')}L64MORTEPRODJAMAISRELUE02`;
const WHSEC_VIVANT = 'whsec_L64_VIVANT_verification_0001';
const WHSEC_VIVANT_PROD = 'whsec_L64_VIVANT_verification_PROD';

async function semer() {
  await IntegratedApi.deleteMany({});
  await IntegratedApi.create([
    {
      provider: 'STRIPE', displayName: 'Stripe', enabled: true, activeMode: 'TEST',
      modes: {
        /** LE CAS QUI COMPTE : une clé morte ET un secret vivant, côte à côte. */
        TEST: {
          credentials: new Map([
            ['secretKey', cred(CLE_MORTE)],
            ['publishableKey', cred('pk_test_L64MORTE0001')],
            ['webhookSecret', cred(WHSEC_VIVANT)],
          ]),
        },
        PROD: {
          credentials: new Map([
            ['secretKey', cred(CLE_MORTE_PROD)],
            ['webhookSecret', cred(WHSEC_VIVANT_PROD)],
          ]),
        },
      },
    },
    {
      provider: 'HOSTINGER', displayName: 'Hostinger', enabled: true, activeMode: 'TEST',
      modes: {
        TEST: { credentials: new Map([['apiToken', cred('HOSTINGER_L64_MORT_0001')]]) },
        PROD: { credentials: new Map() },
      },
    },
    {
      provider: 'YOUSIGN', displayName: 'Yousign', enabled: true, activeMode: 'TEST',
      modes: {
        TEST: {
          credentials: new Map([
            ['apiKey', cred('ys_L64_ACTIF_0001')],
            ['webhookSecret', cred('ys_whsec_L64_ACTIF')],
          ]),
        },
        PROD: { credentials: new Map() },
      },
    },
    {
      provider: 'BREVO', displayName: 'Brevo', enabled: true, activeMode: 'TEST',
      modes: {
        TEST: {
          credentials: new Map([
            ['apiKey', cred('xkeysib-L64_ACTIF_0001')],
            ['webhookSecret', cred('brevo_whsec_L64_ACTIF')],
            ['webhookSecretPrevious', cred('brevo_whsec_L64_ANCIEN')],
          ]),
        },
        PROD: { credentials: new Map() },
      },
    },
  ]);
}

const champs = async (provider, mode) => {
  const doc = await IntegratedApi.findOne({ provider }).lean();
  return Object.keys(doc?.modes?.[mode]?.credentials ?? {});
};

try {
  /* ══════════════════════════════════════════════════════════════════════════ */
  section('1. La politique est une TABLE fermée, relisible');
  {
    /**
     * Un champ absent des deux listes n'est pas supprimé « par défaut ». C'est
     * l'inverse d'un « tout sauf ce qu'on garde », qui effacerait un champ
     * qu'on aurait simplement oublié de reconnaître.
     */
    check('Stripe garde son secret de VÉRIFICATION',
      CREDENTIAL_POLICY.STRIPE.keep.includes('webhookSecret'));
    check('…et ses clés d’APPEL sont déclarées mortes',
      CREDENTIAL_POLICY.STRIPE.dead.includes('secretKey')
      && CREDENTIAL_POLICY.STRIPE.dead.includes('publishableKey'));
    check('Hostinger n’a AUCUN secret à garder', CREDENTIAL_POLICY.HOSTINGER.keep.length === 0);
    /**
     * R11 — BREVO A REJOINT LES MORTS, ET IL ETAIT LE DERNIER.
     *
     * Il etait « le seul fournisseur encore local », et cette assertion exigeait
     * qu'il ne perde rien. Sa cle ne servait plus qu'a maintenir un webhook
     * local que Brevo n'appelait plus : les evenements de livraison suivent le
     * COMPTE, celui du Panel, qui les reprojette par le pont.
     *
     * Les trois champs meurent ensemble — `webhookSecretPrevious` compris, car
     * la fenetre de rotation qu'il couvrait protege une rotation qui ne peut
     * plus avoir lieu, l'endpoint ayant disparu.
     */
    check('Brevo : les TROIS champs sont declares morts',
      ['apiKey', 'webhookSecret', 'webhookSecretPrevious']
        .every((f) => CREDENTIAL_POLICY.BREVO.dead.includes(f)));
    check('…et il ne reste rien a garder', CREDENTIAL_POLICY.BREVO.keep.length === 0);
    check('STRIPE est desormais le SEUL a conserver un secret',
      Object.entries(CREDENTIAL_POLICY).filter(([, v]) => v.keep.length > 0)
        .map(([k]) => k).join(',') === 'STRIPE');

    /**
     * YOUSIGN A REJOINT LES MORTS (R10.5C) — les DEUX champs, y compris le
     * secret de webhook.
     *
     * C'est la seule entrée de la table où un `webhookSecret` est déclaré
     * mort, et c'est ce qui la rend intéressante à relire : la règle n'a
     * jamais été « le fournisseur est passé sous autorité Panel » — Stripe
     * l'est aussi et garde le sien. La règle est « plus personne ne lit ce
     * champ, et plus rien ne PEUT le lire » : la route qui s'en servait a
     * été supprimée.
     */
    check('Yousign : la clé d’appel est déclarée morte',
      CREDENTIAL_POLICY.YOUSIGN.dead.includes('apiKey'));
    check('…et son secret de webhook aussi, la route ayant disparu',
      CREDENTIAL_POLICY.YOUSIGN.dead.includes('webhookSecret'));
    check('…et il ne reste rien à garder', CREDENTIAL_POLICY.YOUSIGN.keep.length === 0);

    /** Aucun champ ne peut figurer dans les deux listes à la fois. */
    const ambigus = Object.entries(CREDENTIAL_POLICY)
      .filter(([, v]) => v.keep.some((k) => v.dead.includes(k)));
    check('aucun champ n’est à la fois gardé et mort', ambigus.length === 0);
  }

  /* ══════════════════════════════════════════════════════════════════════════ */
  section('2. DRY-RUN — il voit tout, il ne touche à rien');
  {
    await semer();
    const avant = JSON.stringify(await IntegratedApi.find({}).lean());

    const r = await purgeDeadCredentials({ apply: false, model: IntegratedApi });
    check('le dry-run se déclare comme tel', r.mode === 'DRY_RUN');
    check('il a vu les quatre fournisseurs', r.scanned === 4);
    /**
     * Stripe TEST (secretKey + publishableKey), Stripe PROD (secretKey),
     * Hostinger TEST (apiToken), Yousign TEST (apiKey + webhookSecret).
     *
     * Le nombre est écrit en dur volontairement : c'est lui qui force à
     * relire la table le jour où un champ change de camp, plutôt que de
     * laisser une purge s'élargir en silence.
     */
    check('…et repéré les NEUF clés mortes', r.fieldsRemoved === 9);
    check('…sur les quatre documents', r.documentsUpdated === 4);
    /*
     * Il ne reste que DEUX secrets actifs dans tout le parc : les deux
     * `webhookSecret` de Stripe. Le nombre est ecrit en dur volontairement —
     * c'est lui qui force a relire la table le jour ou un champ change de camp.
     */
    check('…tout en comptant les secrets ACTIFS épargnés', r.skippedActiveSecrets === 2);
    check('aucun champ inconnu dans un parc sain', r.unknown.length === 0);

    const apres = JSON.stringify(await IntegratedApi.find({}).lean());
    check('LA BASE EST STRICTEMENT INCHANGÉE', avant === apres);
  }

  /* ══════════════════════════════════════════════════════════════════════════ */
  section('3. APPLY — les mortes partent, les vivantes restent');
  {
    const r = await purgeDeadCredentials({ apply: true, model: IntegratedApi });
    check('l’apply se déclare comme tel', r.mode === 'APPLY');
    check('neuf champs retirés', r.fieldsRemoved === 9);
    check('quatre documents modifiés', r.documentsUpdated === 4);

    const stripeTest = await champs('STRIPE', 'TEST');
    check('Stripe TEST : secretKey SUPPRIMÉE', !stripeTest.includes('secretKey'));
    check('…publishableKey SUPPRIMÉE', !stripeTest.includes('publishableKey'));
    check('…webhookSecret CONSERVÉ', stripeTest.includes('webhookSecret'));

    const stripeProd = await champs('STRIPE', 'PROD');
    check('Stripe PROD : secretKey SUPPRIMÉE', !stripeProd.includes('secretKey'));
    check('…webhookSecret CONSERVÉ', stripeProd.includes('webhookSecret'));

    check('Hostinger TEST : apiToken SUPPRIMÉ', !(await champs('HOSTINGER', 'TEST')).includes('apiToken'));

    /**
     * LE CONTRÔLE QUI COMPTE VRAIMENT : le secret survivant n'a pas seulement
     * survécu par son NOM — sa VALEUR est intacte. Un `$unset` mal ciblé ou un
     * remplacement de document l'aurait réécrit sans qu'aucun nom ne change.
     */
    const doc = await IntegratedApi.findOne({ provider: 'STRIPE' }).lean();
    check('…et sa VALEUR est exactement celle d’avant',
      decryptSecret(doc.modes.TEST.credentials.webhookSecret.encryptedValue) === WHSEC_VIVANT);
    check('…y compris en PROD',
      decryptSecret(doc.modes.PROD.credentials.webhookSecret.encryptedValue) === WHSEC_VIVANT_PROD);

    /**
     * YOUSIGN EST VIDÉ — et rien ne subsiste « au cas où ».
     *
     * Un secret conservé par prudence est un secret que plus personne ne
     * surveille : il ne tourne plus, il ne sert plus, et il reste
     * exploitable. C'est le pire des deux mondes.
     */
    const ys = await champs('YOUSIGN', 'TEST');
    check('Yousign : clé d’appel SUPPRIMÉE', !ys.includes('apiKey'));
    check('…secret de webhook SUPPRIMÉ aussi', !ys.includes('webhookSecret'));

    /**
     * ET BREVO, LE DERNIER À PARTIR — c'est la preuve §32 du lot.
     *
     * Les trois champs disparaissent du DOCUMENT, pas seulement du catalogue.
     * Un champ retiré du contrat mais laissé en base resterait un secret au
     * repos : lisible par toute sauvegarde, tout accès Mongo, tout export.
     */
    const brevo = await champs('BREVO', 'TEST');
    check('Brevo : clé d’appel SUPPRIMÉE', !brevo.includes('apiKey'));
    check('…secret de webhook SUPPRIMÉ', !brevo.includes('webhookSecret'));
    check('…et la fenêtre de rotation avec', !brevo.includes('webhookSecretPrevious'));
    check('…il ne reste STRICTEMENT aucun credential Brevo', brevo.length === 0);
  }

  /* ══════════════════════════════════════════════════════════════════════════ */
  section('4. IDEMPOTENCE — le second passage ne trouve plus rien');
  {
    const r = await purgeDeadCredentials({ apply: true, model: IntegratedApi });
    check('documentsUpdated = 0', r.documentsUpdated === 0);
    check('fieldsRemoved = 0', r.fieldsRemoved === 0);
    check('…et toujours aucun inconnu', r.unknown.length === 0);
    /*
     * Les deux `webhookSecret` de Stripe sont toujours la, et toujours comptes :
     * l'idempotence ne doit pas se confondre avec « plus rien a voir ». Un
     * second passage qui cesserait de VOIR les secrets vivants serait un
     * passage qui ne les protege plus.
     */
    check('les secrets actifs sont toujours comptés', r.skippedActiveSecrets === 2);
  }

  /* ══════════════════════════════════════════════════════════════════════════ */
  section('5. UNKNOWN — on ne devine JAMAIS');
  {
    /**
     * Un champ qu'aucune liste ne nomme. Il peut être mort, il peut être vital :
     * personne ne le sait, donc on n'y touche pas. C'est la STOP CONDITION du
     * lot, exprimée dans le code plutôt que dans une consigne.
     */
    const doc = await IntegratedApi.findOne({ provider: 'STRIPE' });
    doc.modes.TEST.credentials.set('mysteriousLegacyKey', cred('valeur_dont_personne_ne_sait_rien'));
    doc.markModified('modes.TEST.credentials');
    await doc.save();

    const r = await purgeDeadCredentials({ apply: true, model: IntegratedApi });
    check('l’inconnu est SIGNALÉ', r.unknown.length === 1);
    check('…nommément', r.unknown[0].field === 'mysteriousLegacyKey');
    check('…avec sa raison', r.unknown[0].reason === 'FIELD_NOT_IN_POLICY');
    check('…et il n’est PAS supprimé',
      (await champs('STRIPE', 'TEST')).includes('mysteriousLegacyKey'));
    check('aucun autre champ n’a bougé pour autant', r.fieldsRemoved === 0);

    /** Un fournisseur entier absent de la table est traité pareil. */
    await IntegratedApi.create({
      provider: 'YOUSIGN', displayName: 'x', enabled: true,
    }).catch(() => null); // l'unicité refuse : on éprouve la branche autrement
    const plan = planForDocument({
      provider: 'FOURNISSEUR_INCONNU',
      modes: { TEST: { credentials: { unTruc: {} } }, PROD: { credentials: {} } },
    });
    check('un fournisseur hors table → tout est INCONNU', plan.inconnus.length === 1);
    check('…et rien n’est proposé à la suppression', plan.aRetirer.length === 0);
    check('…avec la bonne raison', plan.inconnus[0].reason === 'PROVIDER_NOT_IN_POLICY');

    // On retire le champ mystère pour la suite.
    const d2 = await IntegratedApi.findOne({ provider: 'STRIPE' });
    d2.modes.TEST.credentials.delete('mysteriousLegacyKey');
    d2.markModified('modes.TEST.credentials');
    await d2.save();
  }

  /* ══════════════════════════════════════════════════════════════════════════ */
  section('6. LES MONDES sont nettoyés séparément');
  {
    await semer();
    /** Seul PROD porte une clé morte : TEST ne doit pas être touché. */
    const doc = await IntegratedApi.findOne({ provider: 'STRIPE' });
    doc.modes.TEST.credentials.delete('secretKey');
    doc.modes.TEST.credentials.delete('publishableKey');
    doc.markModified('modes.TEST.credentials');
    await doc.save();

    const r = await purgeDeadCredentials({ apply: true, model: IntegratedApi });
    check('seule la clé PROD restait à retirer',
      r.providers.STRIPE.fieldsRemoved === 1);
    check('TEST garde son secret de vérification',
      (await champs('STRIPE', 'TEST')).includes('webhookSecret'));
    check('PROD aussi', (await champs('STRIPE', 'PROD')).includes('webhookSecret'));
    check('…et PROD a perdu sa clé d’appel',
      !(await champs('STRIPE', 'PROD')).includes('secretKey'));
  }

  /* ══════════════════════════════════════════════════════════════════════════ */
  section('7. Formes historiques : rien ne casse, rien ne s’invente');
  {
    /** Un mode sans `credentials` du tout — document partiellement migré. */
    const plan = planForDocument({ provider: 'STRIPE', modes: { TEST: {}, PROD: null } });
    check('un mode sans credentials ne produit rien', plan.aRetirer.length === 0 && plan.inconnus.length === 0);

    /** Un document sans `modes` — forme antérieure au découpage par monde. */
    const plan2 = planForDocument({ provider: 'HOSTINGER' });
    check('un document sans modes ne produit rien', plan2.aRetirer.length === 0);

    /** La Map mongoose et l'objet `.lean()` sont lus pareil. */
    const plan3 = planForDocument({
      provider: 'STRIPE',
      modes: { TEST: { credentials: new Map([['secretKey', {}]]) }, PROD: {} },
    });
    check('la Map mongoose est lue comme l’objet brut',
      plan3.aRetirer.length === 1 && plan3.aRetirer[0].field === 'secretKey');
  }

  /* ══════════════════════════════════════════════════════════════════════════ */
  section('8. Le webhook Stripe reste VÉRIFIABLE après la purge');
  {
    /**
     * La preuve finale, et la seule qui compte pour l'exploitation : après
     * suppression des clés mortes, une signature Stripe est toujours acceptée.
     *
     * On passe par le VRAI vérificateur du projet, pas par une comparaison de
     * chaînes — c'est lui qui lit le coffre.
     */
    await semer();
    await purgeDeadCredentials({ apply: true, model: IntegratedApi });

    const crypto = await import('node:crypto');
    const { verifyStripeWebhookAnyMode } = await import('../services/stripe/stripe.service.js');

    const corps = Buffer.from(JSON.stringify({ id: 'evt_l64', type: 'checkout.session.completed' }));
    const t = Math.floor(Date.now() / 1000);
    const v1 = crypto.createHmac('sha256', WHSEC_VIVANT).update(`${t}.${corps}`).digest('hex');

    const verdict = await verifyStripeWebhookAnyMode(corps, `t=${t},v1=${v1}`);
    check('un événement signé du secret survivant est ACCEPTÉ', verdict?.verified === true);

    const faux = crypto.createHmac('sha256', 'whsec_ce_nest_pas_le_bon_0001').update(`${t}.${corps}`).digest('hex');
    const refus = await verifyStripeWebhookAnyMode(corps, `t=${t},v1=${faux}`);
    check('…et une signature étrangère reste REFUSÉE', refus?.verified !== true);
  }

  /* ══════════════════════════════════════════════════════════════════════════ */
  section('9. Aucun secret n’apparaît dans le rapport');
  {
    await semer();
    const r = await purgeDeadCredentials({ apply: false, model: IntegratedApi });
    const brut = JSON.stringify(r);
    check('aucune clé d’appel', !brut.includes(CLE_MORTE) && !brut.includes(CLE_MORTE_PROD));
    check('aucun secret de vérification', !brut.includes(WHSEC_VIVANT));
    check('aucune valeur chiffrée', !brut.includes('encryptedValue'));
    check('…seulement des comptes et des noms de fournisseurs',
      brut.includes('fieldsRemoved') && brut.includes('STRIPE'));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     10. LES INVARIANTS DÉFINITIFS — nominatifs, jamais un compteur global
     ══════════════════════════════════════════════════════════════════════════ */
  section('10. Garde-fous : par fournisseur et par rôle');
  {
    /**
     * ══ POURQUOI PAS UN COMPTEUR GLOBAL ═══════════════════════════════════
     *
     * « zéro secret mort » se satisferait d'une base vide, et rougirait pour un
     * fournisseur légitime qui ajoute une clé. Les assertions ci-dessous
     * nomment donc le FOURNISSEUR et le RÔLE : elles disent ce qui doit être
     * absent, et surtout ce qui doit RESTER.
     */
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const SRC = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

    const codeSeul = (t) => t
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1 ');

    const runtime = [];
    (function marcher(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const complet = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!['node_modules', 'scripts', 'uploads', 'dist'].includes(e.name)) marcher(complet);
        } else if (e.name.endsWith('.js')) {
          runtime.push({
            rel: path.relative(SRC, complet).split(String.fromCharCode(92)).join('/'),
            code: codeSeul(fs.readFileSync(complet, 'utf8')),
          });
        }
      }
    })(SRC);

    /** Les fichiers qui lisent `(provider, champ)` — la seule forme d'accès. */
    const lecteurs = (provider, champ) => runtime.filter((f) =>
      new RegExp(`['"]${provider}['"]\\s*,\\s*['"]${champ}['"]`).test(f.code));

    // STRIPE_LOCAL_CALL_CREDENTIALS = 0
    for (const mort of ['secretKey', 'publishableKey']) {
      const l = lecteurs('STRIPE', mort);
      check(`STRIPE.${mort} : AUCUN lecteur runtime`, l.length === 0);
      l.forEach((f) => console.error(`      · ${f.rel}`));
    }

    // HOSTINGER_LOCAL_CALL_CREDENTIALS = 0
    const hostinger = lecteurs('HOSTINGER', 'apiToken');
    check('HOSTINGER.apiToken : AUCUN lecteur runtime', hostinger.length === 0);
    hostinger.forEach((f) => console.error(`      · ${f.rel}`));

    /**
     * STRIPE_WEBHOOK_VERIFICATION_SECRET_READERS >= 1 — L'INVARIANT INVERSE.
     *
     * Celui-ci rougit si le secret de vérification perd son dernier lecteur :
     * ce serait le signe qu'on vient de rendre le projet sourd aux paiements,
     * ce qu'aucun compteur « zéro secret » n'aurait détecté.
     */
    const verificateurs = lecteurs('STRIPE', 'webhookSecret');
    check('STRIPE.webhookSecret : au moins un lecteur SUBSISTE', verificateurs.length >= 1);
    check('…et c’est bien la vérification de signature',
      verificateurs.some((f) => f.rel === 'services/stripe/stripe.service.js'));

    /** Le fournisseur encore local garde ses lecteurs. */
    check('BREVO.apiKey a toujours ses lecteurs', lecteurs('BREVO', 'apiKey').length >= 1);

    /**
     * YOUSIGN_LOCAL_CALL_SECRET_READERS = 0 (R10.5C).
     *
     * Cette ligne affirmait l'inverse. Elle avait raison tant que le projet
     * appelait Yousign ; elle est devenue la garde de la migration.
     *
     * Le secret de webhook meurt AVEC la clé d'appel, ce qui n'est pas le cas
     * de Stripe juste au-dessus : là-bas l'événement arrive encore ici, donc
     * le secret est conservé. Ici la route a été supprimée — aucun événement
     * ne se présente plus à une porte qui n'existe pas, et un secret que rien
     * ne peut lire est un secret que personne ne pensera à faire tourner.
     */
    check('YOUSIGN.apiKey : AUCUN lecteur runtime', lecteurs('YOUSIGN', 'apiKey').length === 0);
    lecteurs('YOUSIGN', 'apiKey').forEach((f) => console.error(`      · ${f.rel}`));
    check('YOUSIGN.webhookSecret : AUCUN lecteur non plus',
      lecteurs('YOUSIGN', 'webhookSecret').length === 0);
    lecteurs('YOUSIGN', 'webhookSecret').forEach((f) => console.error(`      · ${f.rel}`));

    // PANEL_AUTHORITY_LOCAL_CALL_SECRET_FIELDS = 0
    const { INTEGRATED_API_CATALOG } = await import('../utils/integratedApiCatalog.js');
    for (const [code, def] of Object.entries(INTEGRATED_API_CATALOG)) {
      if (def.authority !== 'PANEL') continue;
      check(`${code} (autorité PANEL) ne déclare AUCUN champ`, (def.fields ?? []).length === 0);
    }

    /** La dépendance morte est partie — plus aucun importeur ne la réclame. */
    const pkg = JSON.parse(fs.readFileSync(path.join(SRC, '..', 'package.json'), 'utf8'));
    check('la dépendance « stripe » a été retirée',
      !pkg.dependencies?.stripe && !pkg.devDependencies?.stripe);
    const importeurs = runtime.filter((f) => /from\s+['"]stripe['"]|require\(\s*['"]stripe['"]\s*\)/.test(f.code));
    check('…et plus aucun fichier runtime ne l’importe', importeurs.length === 0);
  }


  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} catch (err) {
  console.error('DEAD CREDENTIALS PURGE TEST CRASHED:', err);
  fail += 1;
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} finally {
  await disconnectDatabase().catch(() => {});
  await mongod.stop();
  process.exit(fail === 0 ? 0 : 1);
}
