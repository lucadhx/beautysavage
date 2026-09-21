/* LES INVARIANTS DE CONTENU — une seule règle, partout la même.
 *
 * ══ CE QUE CETTE RECETTE FIGE ═══════════════════════════════════════════════
 *
 * Le défaut d'origine n'était pas une limite mal choisie : c'était TROIS
 * limites pour une seule règle. La graine semait quatre chiffres clés, le
 * validateur en refusait plus de trois, l'écran cachait son bouton au
 * troisième. Le propriétaire ouvrait un écran déjà invalide et l'apprenait au
 * clic sur « Enregistrer » — dans un message anglais rendu par zod.
 *
 * Quatre familles d'assertions, une par maillon :
 *
 *   1. LA GRAINE EST ACCEPTABLE       — ce que le produit livre passe ses
 *                                       propres validateurs. Une graine
 *                                       invalide n'est pas un cas limite,
 *                                       c'est un produit cassé à la livraison.
 *   2. LE SERVEUR FAIT AUTORITÉ       — contourner l'écran ne contourne rien :
 *                                       cardinalités et longueurs sont refusées
 *                                       au-delà, sur les DEUX surfaces
 *                                       éditables de l'accueil.
 *   3. LES REFUS PARLENT FRANÇAIS     — y compris ceux qu'aucun développeur
 *                                       n'a rédigés (contraintes zod nues,
 *                                       longueurs mongoose).
 *   4. CE QUI PASSE EST PERSISTÉ      — un enregistrement à la limite exacte
 *                                       est relu à l'identique. Le refus ne
 *                                       doit pas se payer d'une coupe.
 *
 * Runner autonome. Lancement : node src/scripts/content-limits.test.js */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'test_base';
process.env.DB_PROD = 'prod_base';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.PORT = '4177';
process.env.CORS_ORIGINS = 'http://localhost:6061';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}
function section(n) { console.log(`\n${n}`); }

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
const { bootstrap } = await import('../config/bootstrap.js');
await connectDatabase();
await bootstrap();
await (await import('./helpers/serviceReady.helper.js')).markTestServiceReady();
await (await import('./helpers/testAccounts.helper.js')).seedTestAccounts();

const { createApp } = await import('../app.js');
const app = createApp();
const server = app.listen(4177);

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`http://localhost:4177${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch { /* corps non-JSON */ }
  return { status: res.status, json: j };
}

const token = (await api('POST', '/api/auth/login', {
  body: { email: 'admin@mail.com', password: '123admin' },
})).json?.data?.token;

const { KEY_FIGURE_LIMITS, HOME_CONTENT_LIMITS } = await import('../utils/contentLimits.js');
const { companyUpdateSchema } = await import('../validators/company.validator.js');
const { homeContentUpdateSchema } = await import('../validators/homeContent.validator.js');
const { Company } = await import('../models/Company.model.js');
const { HomeContent } = await import('../models/HomeContent.model.js');

/** Une chaîne de longueur exacte — pour éprouver la borne, pas ses environs. */
const chaine = (n) => 'x'.repeat(n);

/** Vrai si le texte ne contient aucun mot anglais des messages par défaut. */
const ANGLAIS = /\b(String|Array|Number|must contain|at most|at least|Invalid|Required|is longer than|maximum allowed length|Path|character\(s\)|element\(s\))\b/;

/* ══════════════════════════════════════════════════════════════════════════
   1. LA GRAINE EST ACCEPTABLE PAR SES PROPRES VALIDATEURS
   ══════════════════════════════════════════════════════════════════════════ */
section('1. Ce que le produit sème, il l’accepte');

{
  /*
    On rejoue les DEUX graines du projet à travers les validateurs de
    production. C'est exactement le contrôle qui manquait : la graine des
    chiffres clés en écrivait quatre là où le validateur en refusait plus de
    trois, avec des libellés de 54 caractères là où il en tolérait 40.
  */
  /*
    ON LIT LES FICHIERS, ON NE LES IMPORTE PAS.

    Ces migrations sont des SCRIPTS : leur code de plus haut niveau se connecte
    à la base, journalise une simulation et se déconnecte. Les importer depuis
    une recette ferait tomber la connexion sous les assertions suivantes — ce
    qui s'est produit, et se lisait comme un backend en train de s'arrêter.

    Les deux littéraux ne dépendent de rien : on les extrait et on les évalue.
  */
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');

  const litteral = (fichier, nom) => {
    const src = readFileSync(fileURLToPath(new URL(fichier, import.meta.url)), 'utf8');
    const debut = src.indexOf(`const ${nom} = {`);
    if (debut < 0) throw new Error(`${nom} introuvable dans ${fichier}`);
    const ouvrant = src.indexOf('{', debut);
    let profondeur = 0;
    for (let i = ouvrant; i < src.length; i += 1) {
      if (src[i] === '{') profondeur += 1;
      else if (src[i] === '}') {
        profondeur -= 1;
        // eslint-disable-next-line no-eval
        if (profondeur === 0) return (0, eval)(`(${src.slice(ouvrant, i + 1)})`);
      }
    }
    throw new Error(`littéral ${nom} non refermé`);
  };

  const identite = litteral('./migrations/2026-08-26-init-ly-solution-content.js', 'IDENTITE');
  const accueil = litteral('./migrations/2026-08-27-accueil-conversion-et-qui-sommes-nous.js', 'ACCUEIL');

  const semeChiffres = companyUpdateSchema.body.safeParse({ keyFigures: identite.keyFigures });
  check(
    `la graine sème ${identite.keyFigures.length} chiffres clés et le validateur les accepte`,
    semeChiffres.success,
    semeChiffres.success ? '' : JSON.stringify(semeChiffres.error.errors?.[0]),
  );

  const semeAccueil = homeContentUpdateSchema.body.safeParse(accueil);
  check(
    'la graine de l’accueil passe intégralement son validateur',
    semeAccueil.success,
    semeAccueil.success ? '' : JSON.stringify(semeAccueil.error.errors?.slice(0, 3)),
  );

  /*
    Et la graine tient DANS les limites, pas seulement « pas au-delà » : une
    graine qui frôle le plafond signale une limite mal posée, qu'une phrase de
    plus fera basculer.
  */
  const plusLongLibelle = Math.max(...identite.keyFigures.map((f) => (f.label ?? '').length));
  check(
    `le plus long libellé semé (${plusLongLibelle}) laisse de la marge sous ${KEY_FIGURE_LIMITS.labelMax}`,
    plusLongLibelle <= KEY_FIGURE_LIMITS.labelMax * 0.9,
    `${plusLongLibelle} / ${KEY_FIGURE_LIMITS.labelMax}`,
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   2. LE SERVEUR FAIT AUTORITÉ — contourner l'écran ne contourne rien
   ══════════════════════════════════════════════════════════════════════════ */
section('2. Le serveur refuse ce que l’écran ne laisse pas composer');

const chiffre = (i) => ({ value: `M${i}`, label: `Explication ${i}`, icon: 'Sparkles', order: i * 10 });

{
  const base = (await api('GET', '/api/company', { token })).json?.data;
  check('la fiche entreprise est lisible', Boolean(base));

  const auMax = await api('PUT', '/api/company', {
    token,
    body: { ...base, keyFigures: Array.from({ length: KEY_FIGURE_LIMITS.maxItems }, (_, i) => chiffre(i + 1)) },
  });
  check(
    `${KEY_FIGURE_LIMITS.maxItems} chiffres clés sont ACCEPTÉS (c’est le nombre que la vitrine dessine)`,
    auMax.status === 200,
    `statut=${auMax.status} · ${auMax.json?.message ?? ''}`,
  );

  const troisSeulement = await api('PUT', '/api/company', {
    token,
    body: { ...base, keyFigures: [chiffre(1), chiffre(2), chiffre(3)] },
  });
  check(
    'trois sont acceptés aussi — la limite est un plafond, pas une obligation',
    troisSeulement.status === 200,
  );

  const trop = await api('PUT', '/api/company', {
    token,
    body: { ...base, keyFigures: Array.from({ length: KEY_FIGURE_LIMITS.maxItems + 1 }, (_, i) => chiffre(i + 1)) },
  });
  check(
    `${KEY_FIGURE_LIMITS.maxItems + 1} chiffres clés sont REFUSÉS — pas écrêtés en silence`,
    trop.status === 400,
    `statut=${trop.status}`,
  );

  const apresRefus = (await api('GET', '/api/company', { token })).json?.data;
  check(
    '…et le refus n’a rien écrit : la fiche garde ses trois chiffres',
    (apresRefus?.keyFigures ?? []).length === 3,
    `relu=${(apresRefus?.keyFigures ?? []).length}`,
  );

  const libelleLimite = await api('PUT', '/api/company', {
    token,
    body: { ...base, keyFigures: [{ ...chiffre(1), label: chaine(KEY_FIGURE_LIMITS.labelMax) }] },
  });
  check(
    `un libellé de ${KEY_FIGURE_LIMITS.labelMax} caractères — la borne EXACTE — passe`,
    libelleLimite.status === 200,
    `statut=${libelleLimite.status} · ${libelleLimite.json?.message ?? ''}`,
  );

  const libelleTropLong = await api('PUT', '/api/company', {
    token,
    body: { ...base, keyFigures: [{ ...chiffre(1), label: chaine(KEY_FIGURE_LIMITS.labelMax + 1) }] },
  });
  check(
    'un caractère de plus est refusé',
    libelleTropLong.status === 400,
    `statut=${libelleTropLong.status}`,
  );
}

section('3. L’accueil aussi — la route qui n’avait AUCUN validateur');

{
  const base = (await api('GET', '/api/home-content', { token })).json?.data;
  check('le contenu d’accueil est lisible', Boolean(base));

  const menu = (n) => Array.from({ length: n }, (_, i) => `Entrée ${i + 1}`);

  const auMax = await api('PUT', '/api/home-content', {
    token,
    body: { ...base, showcase: { ...base.showcase, navItems: menu(HOME_CONTENT_LIMITS.showcase.navItems.maxItems) } },
  });
  check(
    `${HOME_CONTENT_LIMITS.showcase.navItems.maxItems} entrées de menu passent`,
    auMax.status === 200,
    `statut=${auMax.status} · ${auMax.json?.message ?? ''}`,
  );

  const trop = await api('PUT', '/api/home-content', {
    token,
    body: { ...base, showcase: { ...base.showcase, navItems: menu(HOME_CONTENT_LIMITS.showcase.navItems.maxItems + 1) } },
  });
  check(
    'une entrée de trop est REFUSÉE — la vitrine la coupait sans un mot',
    trop.status === 400,
    `statut=${trop.status}`,
  );

  const carte = (i) => ({ title: `Tuile ${i}`, text: 'Une ligne', order: i * 10 });
  const tropDeTuiles = await api('PUT', '/api/home-content', {
    token,
    body: {
      ...base,
      showcase: {
        ...base.showcase,
        cards: Array.from({ length: HOME_CONTENT_LIMITS.showcase.cards.maxItems + 1 }, (_, i) => carte(i + 1)),
      },
    },
  });
  check(
    'une tuile de maquette de trop est refusée',
    tropDeTuiles.status === 400,
    `statut=${tropDeTuiles.status}`,
  );

  const engagement = (i) => ({ icon: 'Check', title: `Engagement ${i}`, text: 'Une ligne', order: i * 10 });
  const tropEngagements = await api('PUT', '/api/home-content', {
    token,
    body: {
      ...base,
      trust: {
        ...base.trust,
        items: Array.from({ length: HOME_CONTENT_LIMITS.trust.items.maxItems + 1 }, (_, i) => engagement(i + 1)),
      },
    },
  });
  check(
    'un engagement de trop est refusé',
    tropEngagements.status === 400,
    `statut=${tropEngagements.status}`,
  );

  const titreTropLong = await api('PUT', '/api/home-content', {
    token,
    body: { ...base, hero: { ...base.hero, title: chaine(HOME_CONTENT_LIMITS.hero.titleMax + 1) } },
  });
  check(
    'un titre de bannière trop long est refusé',
    titreTropLong.status === 400,
    `statut=${titreTropLong.status}`,
  );

  /* ── CE QUI PASSE EST PERSISTÉ, ET RELU À L'IDENTIQUE ─────────────────── */
  const exact = chaine(HOME_CONTENT_LIMITS.hero.titleMax);
  const ecrit = await api('PUT', '/api/home-content', {
    token,
    body: { ...base, hero: { ...base.hero, title: exact } },
  });
  check('un titre à la borne exacte est accepté', ecrit.status === 200);

  const relu = (await api('GET', '/api/home-content', { token })).json?.data;
  check(
    '…et relu SANS coupe : le refus ne se paie pas d’un écrêtage',
    relu?.hero?.title === exact,
    `relu=${relu?.hero?.title?.length} attendu=${exact.length}`,
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   4. AUCUN REFUS NE PARLE ANGLAIS
   ══════════════════════════════════════════════════════════════════════════ */
section('4. Les refus sont rédigés en français — même ceux que personne n’a rédigés');

{
  const base = (await api('GET', '/api/company', { token })).json?.data;

  const refus = await api('PUT', '/api/company', {
    token,
    body: { ...base, keyFigures: [{ ...chiffre(1), label: chaine(KEY_FIGURE_LIMITS.labelMax + 1) }] },
  });
  check(
    'le message d’un dépassement de longueur n’est pas en anglais',
    typeof refus.json?.message === 'string' && !ANGLAIS.test(refus.json.message),
    `message = ${refus.json?.message}`,
  );
  check(
    '…et le détail par champ non plus',
    (refus.json?.details ?? []).every((d) => !ANGLAIS.test(d.message ?? '')),
    JSON.stringify(refus.json?.details),
  );

  /*
    UNE CONTRAINTE SANS MESSAGE RÉDIGÉ — le cas qui produisait
    « String must contain at most 40 character(s) ». `icon` n'a jamais reçu de
    phrase : c'est la carte globale qui doit répondre.
  */
  const refusIcone = await api('PUT', '/api/company', {
    token,
    body: { ...base, keyFigures: [{ ...chiffre(1), icon: chaine(KEY_FIGURE_LIMITS.iconMax + 1) }] },
  });
  check(
    'une contrainte SANS message rédigé répond quand même en français',
    refusIcone.status === 400
      && typeof refusIcone.json?.message === 'string'
      && !ANGLAIS.test(refusIcone.json.message),
    `message = ${refusIcone.json?.message}`,
  );

  const refusType = await api('PUT', '/api/company', {
    token,
    body: { ...base, keyFigures: [{ value: 42 }] },
  });
  check(
    'un type invalide est refusé, en français',
    refusType.status === 400 && !ANGLAIS.test(refusType.json?.message ?? ''),
    `message = ${refusType.json?.message}`,
  );

  const refusVide = await api('PUT', '/api/company', {
    token,
    body: { ...base, keyFigures: [{ value: '' }] },
  });
  check(
    'un chiffre sans valeur est refusé, en français',
    refusVide.status === 400 && !ANGLAIS.test(refusVide.json?.message ?? ''),
    `message = ${refusVide.json?.message}`,
  );

  /* ── MONGOOSE AUSSI ──────────────────────────────────────────────────── */
  const mongooseFr = await (async () => {
    const doc = await Company.findOne();
    doc.set({ keyFigures: [{ value: '', label: 'x' }] });
    try {
      await doc.validate();
      return null;
    } catch (err) {
      return Object.values(err.errors ?? {})[0]?.message ?? '';
    }
  })();
  check(
    'un refus mongoose (champ obligatoire) est rendu en français',
    typeof mongooseFr === 'string' && mongooseFr.length > 0 && !ANGLAIS.test(mongooseFr),
    `message = ${mongooseFr}`,
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   5. L'AUTORITÉ EST UNIQUE — aucun nombre n'est réécrit ailleurs
   ══════════════════════════════════════════════════════════════════════════ */
section('5. Les limites ne sont écrites qu’à un seul endroit');

{
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const lire = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

  const validateurCompany = lire('../validators/company.validator.js');
  const validateurAccueil = lire('../validators/homeContent.validator.js');

  check(
    'le validateur « entreprise » lit l’autorité au lieu de recopier ses nombres',
    /KEY_FIGURE_LIMITS/.test(validateurCompany)
      && !/\.max\(\s*\d+\s*[,)]/.test(validateurCompany.replace(/\/\*[\s\S]*?\*\//g, '')),
    'un littéral numérique subsiste dans une contrainte',
  );
  check(
    'le validateur « accueil » lit l’autorité au lieu de recopier ses nombres',
    /HOME_CONTENT_LIMITS/.test(validateurAccueil)
      && !/\.max\(\s*\d+\s*[,)]/.test(validateurAccueil.replace(/\/\*[\s\S]*?\*\//g, '')),
    'un littéral numérique subsiste dans une contrainte',
  );

  check(
    'la route de l’accueil est bien gardée par son validateur',
    /validate\(homeContentUpdateSchema\)/.test(lire('../routes/homeContent.routes.js')),
  );

  const doc = await HomeContent.findOne();
  check('le singleton d’accueil existe après amorçage', Boolean(doc));
}

/* ══════════════════════════════════════════════════════════════════════════
   6. MANAGER → VITRINE — la chaîne entière, pas un maillon
   ══════════════════════════════════════════════════════════════════════════

   C'est le parcours que le défaut d'origine cassait, et le seul qui prouve
   quelque chose : valider l'API seule, ou le formulaire seul, ne dit rien de
   ce que le visiteur verra. On écrit par la surface du Manager, on relit par
   la surface PUBLIQUE — celle que la vitrine appelle au premier rendu.        */
section('6. Ce que le Manager enregistre, la vitrine le reçoit');

{
  const base = (await api('GET', '/api/company', { token })).json?.data;

  /* Le cas EXACT du défaut : quatre principes, avec des libellés en phrase. */
  const principes = [
    { value: 'Identité', label: 'Ce qui vous distingue, avant ce qui vous ressemble.', icon: 'Fingerprint', order: 10 },
    { value: 'Expérience', label: 'Des parcours dessinés autour de vos usages réels.', icon: 'Compass', order: 20 },
    { value: 'Technologie', label: 'Une architecture tenue, sans dette laissée derrière.', icon: 'Cpu', order: 30 },
    { value: 'Maîtrise', label: 'Ce que nous concevons pour vous reste piloté par vous.', icon: 'KeyRound', order: 40 },
  ];

  const ecrit = await api('PUT', '/api/company', { token, body: { ...base, keyFigures: principes } });
  check(
    'le Manager enregistre les quatre principes livrés par la graine',
    ecrit.status === 200,
    `statut=${ecrit.status} · ${ecrit.json?.message ?? ''}`,
  );

  /*
    LA SURFACE PUBLIQUE, SANS JETON — c'est bien celle de la vitrine que l'on
    interroge, pas une relecture privilégiée.
  */
  const publique = await api('GET', '/api/public/bootstrap');
  const rendus = publique.json?.data?.company?.keyFigures ?? [];

  check('la vitrine les reçoit tous les quatre', rendus.length === 4, `reçus=${rendus.length}`);
  check(
    '…dans l’ordre, et sans un caractère perdu',
    rendus.map((f) => `${f.value}|${f.label}`).join('~')
      === principes.map((f) => `${f.value}|${f.label}`).join('~'),
    JSON.stringify(rendus.map((f) => f.label?.length)),
  );

  /*
    ET DEPUIS LA BASE. Le document est relu sans passer par le moindre cache de
    processus : c'est la seule façon de distinguer « persisté » de « encore en
    mémoire ».
  */
  const enBase = await Company.findOne().lean();
  check(
    'la base porte bien les quatre principes',
    (enBase?.keyFigures ?? []).length === 4,
    `base=${(enBase?.keyFigures ?? []).length}`,
  );
  check(
    '…avec leurs libellés entiers',
    (enBase?.keyFigures ?? []).every((f, i) => f.label === principes[i].label),
  );
}

console.log(`\n${pass} réussis, ${fail} échoués`);
server.close();
await disconnectDatabase();
await mongod.stop();
process.exit(fail > 0 ? 1 : 0);
