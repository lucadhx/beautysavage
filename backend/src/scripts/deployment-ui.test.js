// INTERFACE DE DÉPLOIEMENT DU MANAGER — ce que l'écran propose, et ce qu'il refuse.
//
// ══ POURQUOI UN TEST QUI LIT DU CODE SOURCE ═════════════════════════════════
//
// Ces vérifications portent sur des PROMESSES d'interface : « aucun
// `confirm()` natif », « la suppression est désactivée tant que la destination
// n'est pas vidée », « l'environnement ne se choisit plus au déploiement ».
// Un test qui monterait les composants vérifierait qu'ils s'affichent ; ce
// qu'on veut prouver, c'est qu'une porte est FERMÉE — et une porte fermée ne
// se voit pas au rendu, elle se lit dans le code.
//
// Ce sont les mêmes règles que le backend applique. L'écran ne les REDÉCIDE
// pas : il lit `canDeploy`, `canDeprovision`, `canDelete`. Une seconde table
// de règles finirait par diverger de la première, et c'est l'interface qui
// aurait tort.
import { strict as assert } from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import fs2 from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ici = path.dirname(fileURLToPath(import.meta.url));
const MANAGER = path.resolve(ici, '../../../manager/src');

const lire = (relatif) => fs.readFile(path.join(MANAGER, relatif), 'utf8');

/**
 * LE CODE SANS SES COMMENTAIRES.
 *
 * Une assertion « aucun `confirm()` » trouvait le mot dans le commentaire qui
 * EXPLIQUE pourquoi il a disparu : le test échouait sur sa propre
 * justification. On ne vérifie donc que ce qui s'exécute.
 */
const sansCommentaires = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

let ok = 0;
let ko = 0;
const check = (libelle, condition) => {
  if (condition) { ok += 1; console.log(`  ✓ ${libelle}`); }
  else { ko += 1; console.log(`  ✗ ${libelle}`); }
};
const section = (titre) => console.log(`\n${titre}`);

const carte = await lire('pages/dev/deployment/TargetCard.tsx');
const grille = await lire('pages/dev/deployment/TargetsGrid.tsx');
const modale = await lire('pages/dev/deployment/RemovalDialog.tsx');
const assistant = await lire('pages/dev/deployment/DeployAssistant.tsx');
const client = await lire('lib/api.ts');

/* ══════════════════════════════════════════════════════════════════════════ */
section('AUCUN `confirm()` NATIF — nulle part dans le module de déploiement');
{
  // Un `confirm()` pose une question sans montrer de réponse : ni le port, ni
  // le service, ni la taille, ni le nombre de médias qui vont disparaître.
  const executables = [
    ['la carte', carte], ['la grille', grille],
    ['la modale', modale], ['l’assistant', assistant],
  ].map(([nom, source]) => [nom, sansCommentaires(source)]);

  for (const [nom, source] of executables) {
    check(`${nom} n’appelle aucun confirm() du navigateur`,
      !/(?<![\w.])confirm\s*\(/.test(source));
  }
  check('…ni aucun alert()', !executables.some(([, s]) => /(?<![\w.])alert\s*\(/.test(s)));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LES ACTIONS VIENNENT DU BACKEND, l’écran ne les redécide pas');
{
  check('« Retirer » suit `canDeprovision`', /disabled=\{!target\.canDeprovision\}/.test(carte));
  check('« Supprimer » suit `canDelete`', /disabled=\{!target\.canDelete\}/.test(carte));
  check('« Déployer » suit `canDeploy`', /disabled=\{!target\.canDeploy\}/.test(carte));

  check('la carte n’invente aucune règle sur l’état',
    !/lifecycleStatus\s*===\s*'ACTIVE'\s*&&/.test(carte));

  check('le bouton Supprimer reste VISIBLE, même inactif',
    /Supprimer/.test(carte) && !/canDelete\s*&&\s*\(/.test(carte));
  check('…et explique pourquoi il ne l’est pas',
    /Disponible seulement une fois la destination videe|vidée/.test(carte));

  check('« Redéployer » remplace « Déployer » sur une destination vidée',
    /lifecycleStatus === 'EMPTY' \? 'Red/.test(carte));
  check('« Reprendre le retrait » apparaît après un échec',
    /DEPROVISION_FAILED[\s\S]{0,200}Reprendre/.test(carte));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LES CINQ ÉTATS SONT NOMMÉS À L’ÉCRAN');
{
  for (const etat of ['ACTIVE', 'DEPROVISIONING', 'EMPTY', 'DEPROVISION_FAILED', 'DELETED']) {
    check(`l’état ${etat} a un libellé`, new RegExp(`${etat}:\\s*\\{`).test(carte));
  }
  check('l’environnement est un badge distinct', /EnvironmentChip/.test(carte));
  check('…et PROD se distingue visuellement', /environment === 'PROD' \?/.test(carte));
  check('le cycle de vie est distinct de l’état de déploiement',
    /LifecycleChip/.test(carte) && /StateChip/.test(carte));
  check('le code métier de l’erreur est affiché, pas seulement « échec »',
    /lastError\.code/.test(carte));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LE PARCOURS DE RETRAIT — inventaire, puis nom d’hôte, puis exécution');
{
  check('la modale lit d’abord l’état RÉEL du serveur', /inspectTarget/.test(modale));
  check('…et l’affiche : service PM2', /pm2Name/.test(modale));
  check('…dossier', /siteRoot/.test(modale));
  check('…taille', /inv\?\.size/.test(modale) || /inv\.size/.test(modale));
  check('…nombre de fichiers', /inv\.files/.test(modale));
  check('…médias', /inv\.uploads/.test(modale));
  check('…données persistantes', /persistentFiles/.test(modale));
  check('…et liens symboliques sortants', /outboundSymlinks/.test(modale));

  check('la saisie EXACTE du nom d’hôte est exigée',
    /hostname\.trim\(\)\.toLowerCase\(\) === target\.host\.toLowerCase\(\)/.test(modale));
  check('…et le bouton reste inerte sans elle', /!hostOk/.test(modale));
  /**
   * UN CLIC, UN RUN. Dès qu'un run existe — celui qu'on vient de lancer, ou
   * celui qu'on vient de retrouver après une coupure — le bouton ne peut plus
   * repartir. C'est ce qui interdit une seconde suppression.
   */
  check('…et il ne peut plus repartir si un run existe déjà',
    /disabled=\{busy \|\| Boolean\(runId\) \|\| reconnexion/.test(modale));

  check('la perte des données persistantes se confirme SÉPARÉMENT',
    /perteNonConfirmee/.test(modale) && /dropData/.test(modale));
  check('un lien sortant BLOQUE le retrait', /bloqueParSymlinks/.test(modale));
  check('l’irréversibilité est annoncée', /irréversible/.test(modale));

  check('l’exécution passe par le flux NDJSON', /deprovision\/stream/.test(modale));
  // La checklist ne recopie plus le plan du moteur : elle le REÇOIT. Une
  // liste tenue à la main ici avait déjà divergé des libellés réels, ce qui
  // obligeait à traduire mentalement au moment le plus délicat.
  check('…le plan des étapes vient du SERVEUR',
    /deprovision\.started/.test(modale) && /evt\.steps/.test(modale));
  check('…avec un repli local si le backend est antérieur',
    /PLAN_DE_SECOURS/.test(modale));
  check('…et les étapes s’affichent en direct',
    /evt\.type === 'step'/.test(modale) && /setEtapes/.test(modale));
  check('une étape en cours est visiblement en cours', /animate-pulse/.test(modale));
  check('le rapport final vient du RUN, il n’est pas reconstruit ici',
    /evt\.report/.test(modale) && /setRapport/.test(modale));
  check('…et il se copie', /Copier le rapport/.test(modale));
  for (const etape of [
    'deprovision.lock', 'deprovision.services.stop', 'deprovision.port.release',
    'deprovision.nginx.remove', 'deprovision.quarantine', 'deprovision.files.remove',
    'deprovision.verify', 'deprovision.finalize',
  ]) {
    check(`l’étape « ${etape} » est annoncée`, modale.includes(etape));
  }
  check('une reprise est proposée après un échec', /Reprendre le retrait/.test(modale));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('SUPPRESSION — jamais directe, toujours confirmée par le nom d’hôte');
{
  check('la grille n’appelle plus deleteTarget sans confirmation',
    !/deleteTarget\(t\.id\)\s*;/.test(grille));
  check('le client exige le nom d’hôte',
    /deleteTarget: \(id: string, confirmHostname: string\)/.test(client));
  check('…et passe par POST /delete, pas DELETE',
    /targets\/\$\{id\}\/delete`, \{ method: 'POST'/.test(client));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('ENVIRONNEMENT — choisi à la création, jamais au déploiement');
{
  check('l’assistant de déploiement n’a plus de sélecteur d’environnement',
    !/setEnv\(/.test(assistant));
  check('…il ne porte plus `env` dans le corps envoyé',
    !/sessionId: session\.sessionId, env \}/.test(assistant));
  check('…et il se contente de MONTRER l’environnement de la destination',
    /target\.environment === 'PROD' \? 'PRODUCTION'/.test(assistant));

  check('une mise en ligne PROD exige une confirmation nominative',
    /confirmProd/.test(assistant) && /PRODUCTION<\/strong> sur/.test(assistant));
  check('…qui NOMME le domaine visé', /\{target\.host\}<\/code>/.test(assistant));
  check('…et bloque le bouton tant qu’elle manque',
    /step === 2 && target\?\.environment === 'PROD'\) return confirmProd/.test(assistant));

  check('la création exige l’environnement, SANS valeur par défaut',
    /useState<'TEST' \| 'PROD' \| ''>\(''\)/.test(grille));
  check('…et refuse d’enregistrer sans lui',
    /environment !== 'TEST' && environment !== 'PROD'/.test(grille));
  check('…il est annoncé comme immuable', /Immuable après création/.test(grille));
  check('le client typé l’exige aussi', /environment: 'TEST' \| 'PROD';/.test(client));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('RESPONSIVE — la modale de destruction n’est jamais coupée');
{
  // 320 / 375 : plein écran ancré en bas, défilement interne. Au-delà : carte
  // centrée. Une modale qui déborde cache justement ce qu'il faut lire.
  check('la modale défile au lieu de déborder', /overflow-y-auto/.test(modale));
  check('…elle occupe toute la largeur sur mobile', /w-full/.test(modale));
  check('…et se borne au-delà', /sm:max-w-lg/.test(modale));
  check('…ancrée en bas sur mobile, centrée ensuite',
    /items-end[\s\S]{0,80}sm:items-center/.test(modale));
  check('les actions passent à la ligne plutôt que de se chevaucher',
    /flex-wrap/.test(modale) && /flex-wrap/.test(carte));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('RETRAIT — la fenêtre ne doit JAMAIS être un cul-de-sac');
/* ══════════════════════════════════════════════════════════════════════════ */
/*
 * ══ LE DÉFAUT REPRODUIT ════════════════════════════════════════════════════
 *
 * Depuis « Mes sites », cliquer sur « Retirer le déploiement » ouvrait une
 * fenêtre où AUCUNE action n'était atteignable. Trois gardes s'enchaînaient :
 *
 *   · le bouton d'inventaire exigeait un `sessionId` ;
 *   · le bouton de retrait exigeait un `inspection` ;
 *   · et la seule façon d'ouvrir une session était l'assistant de
 *     DÉPLOIEMENT, inaccessible depuis cet écran.
 *
 * La fenêtre affichait donc « ouvrez d'abord une session serveur » sans offrir
 * le moindre moyen de le faire. Le backend, lui, autorisait l'opération.
 *
 * On verrouille ici la CHAÎNE ENTIÈRE : de l'ouverture de la fenêtre au
 * bouton destructeur, chaque maillon doit être joignable.
 */
{
  const page = await lire('pages/dev/DeploymentPage.tsx');
  const grille = await lire('pages/dev/deployment/TargetsGrid.tsx');

  // ── 1. La fenêtre sait ouvrir une session elle-même ─────────────────────
  check('la fenêtre de retrait accepte une capacité de connexion',
    /onConnect\?:/.test(modale));
  check('…et rend un vrai formulaire quand aucune session n’existe',
    /sessionRequise && !sessionId/.test(modale) && /onConnect \? \(/.test(modale));
  check('…avec les trois champs nécessaires',
    /value=\{sshHost\}/.test(modale)
    && /value=\{sshUser\}/.test(modale)
    && /value=\{sshPass\}/.test(modale));
  check('…préremplis depuis la destination, pas ressaisis',
    /target\.sshHost/.test(modale) && /target\.sshUser/.test(modale));
  check('le mot de passe est effacé dès la session ouverte',
    /if \(ok\) setSshPass\(''\)/.test(modale));
  check('…et n’est jamais conservé dans un état durable',
    !/localStorage[\s\S]{0,60}sshPass/.test(modale));

  // ── 2. La capacité descend réellement jusqu'à la fenêtre ────────────────
  check('la page de déploiement fournit la capacité', /onConnect=\{connect\}/.test(page));
  check('…la grille la transmet', /onConnect=\{onConnect\}/.test(grille));
  check('…et c’est la MÊME que celle de l’assistant : un seul chemin d’auth',
    (page.match(/connect=\{connect\}|onConnect=\{connect\}/g) || []).length >= 1
    && !/openVpsSession/.test(modale));

  // ── 3. L'inventaire ne demande pas un clic de plus ──────────────────────
  check('l’inventaire part dès qu’une session existe',
    /if \(!sessionRequise \|\| !sessionId\) return;/.test(modale)
    && /void inspecter\(\)/.test(modale));
  // StrictMode exécute chaque effet DEUX fois. Sans verrou posé AVANT
  // l'attente, deux inventaires concurrents ouvraient deux connexions SSH
  // simultanées avec les mêmes identifiants — et un serveur qui limite les
  // sessions naissantes en refusait une sur deux. La panne semblait aléatoire
  // alors qu'on la fabriquait.
  check('…une seule fois, verrou posé avant l’attente',
    /inventaireLance/.test(modale)
    && /inventaireLance\.current === sessionId/.test(modale));

  // ── 4. Le bouton destructeur existe et reste gardé ──────────────────────
  check('le bouton « Retirer le déploiement » existe',
    /Retirer le déploiement.*: 'Supprimer la destination'/.test(modale)
    || /mode === 'deprovision' \? 'Retirer le déploiement'/.test(modale));
  check('…il reste inerte sans inventaire, hostname, ou confirmations',
    /!hostOk \|\| bloqueParSymlinks/.test(modale) && /perteNonConfirmee/.test(modale));
  check('…un lien symbolique sortant le bloque',
    /bloqueParSymlinks/.test(modale) && /outboundSymlinks/.test(modale));
  check('…des données persistantes non confirmées le bloquent',
    /perteNonConfirmee = mode === 'deprovision' && \(inv\?\.persistentFiles \?\? 0\) > 0 && !dropData/.test(modale));
  check('…et le nom d’hôte doit être saisi exactement',
    /hostname\.trim\(\)\.toLowerCase\(\) === target\.host\.toLowerCase\(\)/.test(modale));

  // ── 5. Retirer n'est pas supprimer ──────────────────────────────────────
  check('« Retirer » et « Supprimer » restent deux gestes distincts',
    modale.includes('Retirer le déploiement') && modale.includes('Supprimer la destination'));
  check('la carte suit les gardes du backend, elle ne les redécide pas',
    /disabled=\{!target\.canDeprovision\}/.test(carte)
    && /disabled=\{!target\.canDelete\}/.test(carte));

  // ── 6. Une seule exécution ──────────────────────────────────────────────
  check('le retrait passe par le flux dédié',
    /deployment\/deprovision\/stream/.test(modale));
  check('…et le bouton se verrouille pendant l’exécution',
    /disabled=\{busy/.test(modale));
  check('…la confirmation disparaît dès que les étapes arrivent',
    /etapes\.length === 0/.test(modale));

  // ── 7. La destination héritée est lisible ───────────────────────────────
  check('une version absente est présentée comme héritée, pas comme un vide',
    /versionUnknown/.test(carte) && /héritée|heritee/.test(carte));
}

/* ══════════════════════════════════════════════════════════════════════════ */

/* ────────────────────────────────────────────────────────────────────────── */
section('LE RUN SURVIT AU FLUX — reconnexion, jamais seconde opération');
{
  const modale = await lire('pages/dev/deployment/RemovalDialog.tsx');

  /**
   * ══ CE QUE LE NAVIGATEUR DOIT SAVOIR RETROUVER ═══════════════════════════
   *
   * Une suppression réussie fait disparaître la destination pendant que le
   * flux est encore ouvert. Si le canal se rompt à cet instant, le travail est
   * FAIT et l'écran n'a plus aucune source : ni la fiche, ni le flux. Le run
   * est la seule qui survive — encore faut-il en avoir retenu l'identifiant.
   */
  check('l’identifiant du run est mémorisé hors du composant',
    /sessionStorage\.setItem/.test(modale) && /memoriserRun/.test(modale));
  check('…dès son annonce par le flux', /delete\.run'[\s\S]{0,160}memoriserRun/.test(modale));
  check('…et retrouvé au montage suivant', /runMemorise\(target\.id, mode\)/.test(modale));
  check('la reprise RELIT le run — elle n’en lance pas un second',
    /api\.deployment\.getRun\(/.test(modale) && !/relancer|redemarrer/i.test(modale));
  check('…l’état se reconstruit depuis ses étapes persistées',
    /run\.steps \?\? \[\]/.test(modale));
  check('…et le verdict depuis son rapport', /run\.structuredReport/.test(modale));
  check('un run terminal positif donne SUCCÈS, même sans destination',
    /run\.status === 'ok'[\s\S]{0,60}setTermine\('ok'\)/.test(modale));
  check('l’attente est BORNÉE, jamais une roue infinie',
    /tentatives < 60/.test(modale));
  check('la reconnexion ne s’affiche pas comme une erreur',
    /Reconnexion au suivi/.test(modale));
  check('…et l’oubli du run se fait une fois le verdict connu',
    /oublierRun\(target\.id, mode\)/.test(modale));
}

section('APRÈS UN SUCCÈS, L’ÉCRAN NE LIT PLUS CE QUI N’EXISTE PLUS');
{
  /**
   * ══ LE CAS NORMAL QUE L'INTERFACE DOIT SAVOIR TRAVERSER ══════════════════
   *
   * Une suppression réussie fait disparaître la destination pendant que
   * l'écran l'affiche encore. Ce n'est pas une exception : entre l'évènement
   * terminal et le rafraîchissement de la liste, le navigateur détient
   * forcément des références vers un objet qui n'existe plus.
   *
   * L'écran doit donc converger vers « supprimée » sans jamais dépendre de la
   * ressource supprimée, ni d'un rafraîchissement réseau.
   */
  const modale = await lire('pages/dev/deployment/RemovalDialog.tsx');
  const grille = await lire('pages/dev/deployment/TargetsGrid.tsx');
  const bordure = await lire('components/ErrorBoundary.tsx');
  const controleur = await fs2.readFile(
    new URL('../controllers/deployment.controller.js', import.meta.url), 'utf8');

  // ── 1. Le verdict serveur se suffit ────────────────────────────────────
  check('le verdict de suppression porte un INSTANTANÉ de ce qui a disparu',
    /deletedTargetSnapshot/.test(controleur));
  check('…et il voyage dans l’évènement terminal, pas seulement dans le rapport',
    /type: 'delete\.succeeded'[\s\S]{0,400}deletedTargetSnapshot/.test(controleur));
  check('…avec de quoi se raconter sans relire la fiche',
    /deletedTargetSnapshot: \{[\s\S]{0,300}host:/.test(controleur));

  // ── 2. L'écran consomme cet instantané ─────────────────────────────────
  check('la fenêtre retient l’instantané reçu', /setSupprimee/.test(modale));
  check('…et affiche son succès à partir de lui',
    /supprimee\?\.host \?\? target\.host/.test(modale));
  check('aucun rechargement de la destination supprimée n’est tenté',
    !/getTarget\(|inspectTarget\([^)]*\)[\s\S]{0,80}termine/.test(modale));

  // ── 3. Le succès ne se ferme plus tout seul ────────────────────────────
  check('le succès NOTIFIE le parent sans démonter la fenêtre',
    /onDone\(/.test(modale) && /onClosed/.test(modale));
  check('…et c’est l’opérateur qui ferme, une fois le verdict lu',
    /\(onClosed \?\? onCancel\)\(\)/.test(modale));
  check('le parent ne démonte plus la fenêtre depuis onDone',
    !/onDone=\{async \(message\) => \{\s*setRemoving\(null\)/.test(grille));
  check('…il expose une fermeture explicite', /onClosed=\{\(\) => setRemoving\(null\)\}/.test(grille));

  // ── 4. Un rafraîchissement raté ne défait pas une suppression réussie ──
  check('le rechargement de la liste est SECONDAIRE : son échec est rattrapé',
    /try \{\s*await reload\(\);\s*\} catch/.test(grille));
  check('…et il le dit sans transformer le succès en panne',
    /n’a pas pu être actualisée/.test(grille));

  // ── 5. L'écran de secours dit enfin ce qu'il a attrapé ─────────────────
  check('l’ErrorBoundary retient l’erreur réelle', /error: Error \| null/.test(bordure));
  check('…et la pile de composants', /componentStack/.test(bordure));
  check('…il la montre', /Détail technique/.test(bordure));
  check('…et permet de la copier', /handleCopy/.test(bordure));
  check('le filet reste un filet : rien n’est avalé',
    /console\.error\('\[ErrorBoundary\]'/.test(bordure));
}

console.log(`\n${ok} réussis, ${ko} échoués`);
assert.equal(ko, 0, `${ko} vérification(s) en échec.`);
