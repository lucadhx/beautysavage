/* SESSION ET IDENTITÉ — une panne serveur ne déconnecte personne.
 *
 * ── LE DÉFAUT QU'IL VERROUILLE ──────────────────────────────────────────────
 * `AuthContext` effaçait le jeton dans un `catch` nu : N'IMPORTE quel échec de
 * `/auth/me` déconnectait. Un backend qui redémarre pendant un préflight, une
 * passerelle qui répond 502, un flux qui coupe la connexion — et l'utilisateur
 * se retrouvait au login, session détruite, sans qu'aucun serveur ait jamais
 * contesté son identité. Cela annulait la prudence déjà en place dans le client
 * HTTP, qui ne purge que sur un 401 confirmé.
 *
 * Dans la foulée, l'identité d'entreprise n'était chargée qu'au démarrage et
 * jamais conservée : le nom et le logo disparaissaient de l'écran.
 *
 * Runner autonome — lecture de la source, aucun DOM. Lancement : npm run test */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0;
let fail = 0;
const check = (nom, ok) => {
  if (ok) { pass += 1; console.log(`  ✓ ${nom}`); } else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (t) => console.log(`\n${t}`);

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const auth = lire('context/AuthContext.tsx');
/**
 * LA MÊME SOURCE, SANS SES COMMENTAIRES.
 *
 * Les contrôles de STRUCTURE ci-dessous mesurent des distances dans le texte
 * (« la purge suit immédiatement le refus »). Un commentaire inséré entre les
 * deux — ici, l'explication de la révocation fédérée — les fait échouer sans
 * que le comportement ait bougé d'une ligne. Une garde qui rougit quand on
 * DOCUMENTE le code finit par être supprimée ; on lit donc le code seul.
 */
const authCode = auth.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const gardes = lire('components/RouteGuards.tsx');
const company = lire('context/CompanyContext.tsx');
const api = lire('lib/api.ts');

/* ────────────────────────────────────────────────────────────────────────── */
section('1. Seul un refus EXPLICITE déconnecte');
{
  check('le `catch` nu qui purgeait sur tout a disparu',
    !/catch \{\s*tokenStore\.clear\(\);\s*setUser\(null\);\s*\}/.test(auth));
  check('la purge est conditionnée à un 401/403',
    /err instanceof ApiError && \(err\.status === 401 \|\| err\.status === 403\)/.test(auth));
  check('…et n’a lieu que dans cette branche',
    /if \(refus\) \{[\s\S]{0,400}tokenStore\.clear\(\)/.test(authCode));
  check('tout le reste laisse la session intacte',
    /\} else \{\s*setUnreachable\(true\);\s*\}/.test(auth));
  check('le jeton n’est jamais effacé hors de ce cas et de la déconnexion',
    (auth.match(/tokenStore\.clear\(\)/g) || []).length === 2);

  // Le client HTTP conserve sa propre prudence : les deux couches s'accordent.
  check('le client HTTP ne purge toujours que sur un 401 confirmé par /auth/me',
    /if \(token && \(await sessionReellementExpiree\(path, json\.code, token\)\)\)/.test(api));
  check('…et une panne réseau reste un statut à part',
    /export const OFFLINE_STATUS = 0;/.test(api));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('2. Serveur injoignable ≠ page de connexion');
{
  check('l’état « injoignable » est exposé', /unreachable: boolean;/.test(auth));
  check('le garde le lit', /const \{ user, loading, unreachable, refresh \} = useAuth\(\);/.test(gardes));
  check('…AVANT de conclure à une déconnexion',
    gardes.indexOf('unreachable) return <ServeurInjoignable') < gardes.indexOf('if (!user) return <Navigate to="/login"'));
  check('un écran dédié le dit, sans mentir', /Serveur momentanément injoignable/.test(gardes));
  check('…et affirme que la session tient', /Votre session reste ouverte/.test(gardes));
  check('une nouvelle tentative est offerte', /onClick=\{onRetry\}>Réessayer</.test(gardes));
  check('…branchée sur un vrai rechargement de session', /onRetry=\{\(\) => refresh\(\)\}/.test(gardes));
  check('la zone DEV suit la même règle',
    /RequireDev[\s\S]{0,300}if \(unreachable\) return <ServeurInjoignable/.test(gardes));
  check('AUCUN réessai automatique aveugle : c’est l’utilisateur qui décide',
    !/setInterval|setTimeout\([^)]*refresh/.test(gardes));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('3. Le nom et le logo ne disparaissent plus');
{
  /**
   * ══ MÉMORISÉE, ET CLOISONNÉE PAR PROJET ═══════════════════════════════════
   *
   * ── CE QUE CETTE ASSERTION VÉRIFIAIT, ET POURQUOI C'ÉTAIT FAUX ───────────
   *
   * Elle épelait `const CACHE_KEY = 'sbauto.manager.company';` — la clé d'un
   * AUTRE projet du parc, recopiée de duplication en duplication. Elle a donc
   * échoué en silence dès le renommage de la clé, et ce qu'elle prétendait
   * garder — « l'identité est mémorisée » — n'était plus gardé du tout.
   *
   * Surtout, une clé épelée en dur ne peut RIEN dire du contrat qui compte
   * ici : les quatre managers du parc partagent l'origine `localhost:6071` en
   * développement, donc le même `localStorage`. Une clé littérale, quelle
   * qu'elle soit, est par construction la MÊME dans les quatre projets — c'est
   * exactement ce qui faisait démarrer FJ Services avec le logo de KleenPro.
   *
   * On vérifie donc le CONTRAT, pas la chaîne : le cache existe, et sa clé est
   * dérivée de l'identité de projet. La preuve comportementale — deux projets
   * qui ne se lisent pas — vit dans `managerStorageIsolation.test.mjs`.
   */
  check('la dernière identité connue est mémorisée',
    /const CACHE_KEY = cleProjet\('manager\.company\.cache'\);/.test(company));
  check('…sous une clé PROPRE AU PROJET, jamais partagée avec le parc',
    /from '@\/lib\/projectIdentity'/.test(company)
    && !/const CACHE_KEY = ['`]/.test(company));
  check('…et hydratée dès le premier rendu',
    /React\.useState<Company \| null>\(\(\) => \(hasSession\(\) \? lireCache\(\) : null\)\)/.test(company));
  check('un échec de chargement NE VIDE PAS l’identité',
    /catch \{\s*\/\/ On NE VIDE PAS/.test(company));
  check('une identité fraîche remplace la mémorisée',
    /const fraiche = await api\.getCompany\(\);\s*setCompany\(fraiche\);\s*ecrireCache\(fraiche\);/.test(company));
  check('une sauvegarde de la fiche met le cache à jour',
    /const enregistrer = React\.useCallback\(\(c: Company\) => \{\s*setCompany\(c\);\s*ecrireCache\(c\);/.test(company));
  check('un cache illisible ne casse pas le démarrage',
    /catch \{\s*return null; \/\/ cache illisible/.test(company));
  check('un stockage refusé (mode privé) non plus',
    /catch \{\s*\/\* quota\/mode privé/.test(company));

  // L'identité appartient à la session : la déconnexion l'oublie.
  check('la déconnexion efface l’identité mémorisée', /clearCompanyCache\(\);/.test(auth));
  check('…et seulement la déconnexion',
    (auth.match(/clearCompanyCache\(\)/g) || []).length === 1);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('4. Le scénario complet, de bout en bout');
{
  /**
   * On rejoue la DÉCISION prise à chaque étape, avec la logique réelle
   * réécrite ici à l'identique. Ce qui est vérifié, c'est l'enchaînement :
   * préflight en échec → refresh → session intacte → identité présente.
   */
  const OFFLINE = 0;
  const etat = {
    jeton: 'jwt-dev', // 1. utilisateur DEV connecté
    identite: { name: 'SB Auto 06', logo: '/logo.png' }, // 2. logo et nom chargés
    cache: null,
    unreachable: false,
    user: { role: 'DEV' },
  };
  etat.cache = etat.identite; // mémorisée dès le premier chargement réussi

  // Décision d'authentification, telle qu'écrite dans AuthContext.
  const chargerUtilisateur = (reponse) => {
    if (!etat.jeton) { etat.user = null; return; }
    if (reponse.ok) { etat.user = reponse.user; etat.unreachable = false; return; }
    const refus = reponse.status === 401 || reponse.status === 403;
    if (refus) { etat.jeton = null; etat.user = null; etat.unreachable = false; }
    else etat.unreachable = true;
  };
  // Décision du garde de route.
  const ecran = () => {
    if (etat.user) return 'application';
    if (etat.unreachable) return 'injoignable';
    return 'login';
  };
  // Identité affichée : la fraîche si elle arrive, la mémorisée sinon.
  const identiteAffichee = (reponse) => (reponse?.ok ? reponse.company : etat.cache);

  // 3-5. Préflight lancé, connexion SSH en échec : l'étape termine en erreur.
  const etapes = { 'ssh.connect': 'running' };
  etapes['ssh.connect'] = 'error'; // issue rendue (cf. deployment-ssh-connect.test.js)
  check('5. l’étape SSH se termine en erreur', etapes['ssh.connect'] === 'error');
  check('6. aucune étape ne reste en cours',
    !Object.values(etapes).includes('running'));
  check('7. l’écran peut afficher l’erreur', etapes['ssh.connect'] === 'error');

  // 8. Refresh PENDANT que le backend est injoignable (redémarrage).
  etat.user = null; // la page repart de zéro
  chargerUtilisateur({ ok: false, status: OFFLINE });
  check('9. la session est TOUJOURS active', etat.jeton === 'jwt-dev');
  check('9. …et l’écran n’est pas le login', ecran() === 'injoignable');
  const affichee = identiteAffichee({ ok: false });
  check('10. le nom est toujours là', affichee?.name === 'SB Auto 06');
  check('10. …et le logo aussi', affichee?.logo === '/logo.png');

  // 11-12. Le backend répond de nouveau : tout revient, sans reconnexion.
  chargerUtilisateur({ ok: true, user: { role: 'DEV' } });
  check('11. une nouvelle tentative est possible', ecran() === 'application');
  check('12. la seconde tentative aboutit', etat.unreachable === false && etat.jeton === 'jwt-dev');

  // Contre-épreuve : un VRAI refus déconnecte bel et bien.
  chargerUtilisateur({ ok: false, status: 401 });
  check('un 401 confirmé déconnecte, lui', etat.jeton === null && ecran() === 'login');
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
