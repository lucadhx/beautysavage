/**
 * ══ LE REDÉMARRAGE DU BACKEND N'EST PAS UN ÉCHEC DE DÉPLOIEMENT ═════════════
 *
 * L'incident : l'opérateur lance un déploiement, le backend local redémarre au
 * même instant, `POST /api/deployment/vps-session` meurt en `ECONNRESET`, et
 * l'écran affiche un bandeau ROUGE. Le service revenait pourtant deux secondes
 * plus tard : rien n'avait échoué, et l'on demandait à l'opérateur de chercher
 * une panne inexistante.
 *
 * Cette recette éprouve la règle qui sépare les deux mondes, et le fait qu'une
 * erreur MÉTIER ne soit jamais retardée par la patience accordée aux pannes.
 *
 * Runner autonome : aucun réseau, aucune base, aucune horloge réelle.
 */
let pass = 0;
let fail = 0;
const check = (nom, ok) => {
  if (ok) { pass += 1; console.log(`  ✓ ${nom}`); }
  else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (t) => console.log(`\n${t}`);

const { estIndisponibiliteTransitoire, malgreUnRedemarrage, RECULS_MS } =
  await import('./backendAvailability.ts');

/**
 * L'ERREUR DU CLIENT HTTP, REPRODUITE PAR SA FORME.
 *
 * On n'importe pas `api.ts` : il traverse l'alias `@/`, résolu par Vite et non
 * par Node. La classification ne juge de toute façon qu'une FORME — c'est ce
 * qui la rend éprouvable ici, et la section 7 vérifie que cette forme et la
 * convention réelle du client n'ont pas divergé.
 */
const OFFLINE_STATUS = 0;
class ApiError extends Error {
  constructor(status, message, details, code) {
    super(message);
    this.status = status;
    this.details = details;
    this.code = code;
  }
}

/** Le temps ne passe pas vraiment : la recette ne dure pas dix secondes. */
const pauses = [];
const patienter = async (ms) => { pauses.push(ms); };

/* ────────────────────────────────────────────────────────────────────────── */
section('1 · Ce qui est TRANSITOIRE — le serveur n’a rien tranché');
{
  const offline = new ApiError(OFFLINE_STATUS, 'Serveur injoignable.', undefined, 'BACKEND_INJOIGNABLE');
  check('ECONNRESET / fetch rompu (statut 0)', estIndisponibiliteTransitoire(offline) === true);
  check('502 passerelle sans amont',
    estIndisponibiliteTransitoire(new ApiError(502, 'bad gateway')) === true);
  check('503 service en cours de démarrage',
    estIndisponibiliteTransitoire(new ApiError(503, 'démarrage', undefined, 'SERVICE_STARTING')) === true);
  check('504 amont trop lent', estIndisponibiliteTransitoire(new ApiError(504, 'timeout')) === true);
  check('la base momentanément absente',
    estIndisponibiliteTransitoire(new ApiError(503, 'db', undefined, 'DATABASE_UNAVAILABLE')) === true);
  check('…et tout refus que le backend déclare LUI-MÊME rejouable',
    estIndisponibiliteTransitoire(new ApiError(503, 'x', { retryable: true }, 'AUTRE')) === true);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('2 · Ce qui est DÉFINITIF — le serveur a répondu, et il refuse');
{
  check('401 n’est JAMAIS transitoire — c’est la doctrine d’authentification',
    estIndisponibiliteTransitoire(new ApiError(401, 'non authentifié')) === false);
  check('403 non plus', estIndisponibiliteTransitoire(new ApiError(403, 'interdit')) === false);
  check('un mot de passe VPS refusé est une erreur MÉTIER',
    estIndisponibiliteTransitoire(new ApiError(400, 'auth SSH refusée', undefined, 'VPS_AUTH_FAILED')) === false);
  check('un VPS injoignable DEPUIS le serveur aussi',
    estIndisponibiliteTransitoire(new ApiError(400, 'hôte injoignable', undefined, 'VPS_CONNECTION_FAILED')) === false);
  check('une erreur interne franche n’est pas une indisponibilité',
    estIndisponibiliteTransitoire(new ApiError(500, 'bogue', undefined, 'BACKEND_ERROR')) === false);
  check('un objet qui n’est pas une ApiError ne l’est pas non plus',
    estIndisponibiliteTransitoire(new Error('boom')) === false);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('3 · Le backend revient — l’opération aboutit, sans rouge');
{
  pauses.length = 0;
  let appels = 0;
  const attentes = [];
  let retabli = 0;

  const session = await malgreUnRedemarrage(
    async () => {
      appels += 1;
      // Deux coupures — exactement la durée d'un redémarrage local — puis prêt.
      if (appels <= 2) throw new ApiError(OFFLINE_STATUS, 'ECONNRESET', undefined, 'BACKEND_INJOIGNABLE');
      return { sessionId: 'sess-1' };
    },
    { patienter, onAttente: (n) => attentes.push(n), onRetabli: () => { retabli += 1; } },
  );

  check('la session VPS est finalement obtenue', session.sessionId === 'sess-1');
  check('…après exactement deux nouvelles tentatives', appels === 3);
  check('l’attente a été ANNONCÉE, pas subie en silence', attentes.length === 2);
  check('…et le rétablissement signalé UNE seule fois', retabli === 1);
  check('les pauses suivent le recul déclaré, borné',
    pauses.join(',') === `${RECULS_MS[0]},${RECULS_MS[1]}`);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('4 · Le backend ne revient pas — on cesse, et on le DIT');
{
  pauses.length = 0;
  let appels = 0;
  let leve = null;
  try {
    await malgreUnRedemarrage(
      async () => {
        appels += 1;
        throw new ApiError(OFFLINE_STATUS, 'ECONNRESET', undefined, 'BACKEND_INJOIGNABLE');
      },
      { patienter },
    );
  } catch (err) { leve = err; }

  check('l’échec finit par être rendu', leve instanceof ApiError);
  check('…et c’est bien la DERNIÈRE erreur, pas une inventée', leve.code === 'BACKEND_INJOIGNABLE');
  check('la fenêtre est BORNÉE — aucune boucle infinie',
    appels === RECULS_MS.length + 1 && pauses.length === RECULS_MS.length);
  check('…et elle reste de l’ordre de la dizaine de secondes',
    pauses.reduce((a, b) => a + b, 0) <= 12_000);
  check('l’échec final EST classé transitoire — l’écran peut le dire autrement',
    estIndisponibiliteTransitoire(leve) === true);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('5 · Une erreur MÉTIER ne fait jamais patienter l’opérateur');
{
  pauses.length = 0;
  let appels = 0;
  let leve = null;
  try {
    await malgreUnRedemarrage(
      async () => {
        appels += 1;
        throw new ApiError(400, 'Mot de passe refusé par le serveur.', undefined, 'VPS_AUTH_FAILED');
      },
      { patienter },
    );
  } catch (err) { leve = err; }

  check('un mot de passe faux échoue IMMÉDIATEMENT', appels === 1 && pauses.length === 0);
  check('…en conservant son code métier', leve.code === 'VPS_AUTH_FAILED');
  check('…et il ne sera donc pas présenté comme une panne réseau',
    estIndisponibiliteTransitoire(leve) === false);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('6 · Le câblage réel de l’écran de déploiement');
{
  const fs = await import('node:fs/promises');
  const page = await fs.readFile(
    new URL('../pages/dev/DeploymentPage.tsx', import.meta.url), 'utf8',
  );
  const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  check('l’ouverture de session VPS traverse la reprise',
    /malgreUnRedemarrage\(\s*\(\)\s*=>\s*api\.deployment\.openVpsSession\(/.test(code));
  check('l’attente est annoncée en INFO, jamais en erreur',
    /onAttente:[\s\S]{0,200}toast\.info\(/.test(code));
  check('…et le rouge est réservé à la fenêtre ÉPUISÉE',
    /estIndisponibiliteTransitoire\(e\)\)\s*\{[\s\S]{0,200}toast\.error\(/.test(code));
  check('une erreur métier garde son message nommé',
    /describeServerFailure\(/.test(code) && /toast\.error\(verdict\.title\)/.test(code));

  /**
   * LE SECRET NE SURVIT À RIEN.
   *
   * Le mot de passe VPS ne doit exister que dans la fermeture de l'appel, le
   * temps des tentatives. Un stockage — même « pour retenter après le
   * redémarrage » — en ferait un secret durable sur le poste.
   */
  check('le mot de passe VPS n’est écrit dans AUCUN stockage',
    !/(local|session)Storage\.setItem\([^)]*(password|motDePasse)/i.test(code));
  check('…ni dans un journal', !/console\.(log|info|warn|error)\([^)]*password/i.test(code));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('7 · La convention « aucune réponse » n’a pas divergé');
{
  /**
   * `backendAvailability` redéclare `OFFLINE_STATUS` pour rester indépendant du
   * client HTTP. Deux déclarations, c'est une occasion de diverger : si le
   * client changeait sa convention, la classification cesserait silencieusement
   * de reconnaître un ECONNRESET — et le bandeau rouge reviendrait.
   */
  const fs = await import('node:fs/promises');
  const api = await fs.readFile(new URL('./api.ts', import.meta.url), 'utf8');
  const dispo = await fs.readFile(new URL('./backendAvailability.ts', import.meta.url), 'utf8');

  const valeurApi = /export const OFFLINE_STATUS\s*=\s*(\d+)/.exec(api)?.[1];
  const valeurLocale = /const OFFLINE_STATUS\s*=\s*(\d+)/.exec(dispo)?.[1];
  check(`le client HTTP déclare bien OFFLINE_STATUS (${valeurApi ?? '?'})`, valeurApi !== undefined);
  check('…et la classification emploie la MÊME valeur', valeurApi === valeurLocale);
  check('…celle utilisée par cette recette aussi', String(OFFLINE_STATUS) === valeurApi);

  check('le client HTTP marque toujours l’absence de réponse d’un code nommé',
    /'BACKEND_INJOIGNABLE'/.test(api));
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
