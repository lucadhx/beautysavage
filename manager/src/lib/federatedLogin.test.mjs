/* LE PARCOURS DE CONNEXION L.Y SOLUTION, CÔTÉ INTERFACE — L12.B-UI.
 *
 * ══ CE QUE CETTE SUITE GARDE ════════════════════════════════════════════════
 *
 * Deux invariants que rien d'autre ne peut tenir :
 *
 *   · le manager ne COLLECTE JAMAIS le mot de passe du Panel. C'est l'objet
 *     même de la fédération, et cela se vérifie sur le code de l'écran, pas
 *     dans une intention ;
 *
 *   · la page de RETOUR reste PUBLIQUE. C'est le défaut qu'avait connu le lien
 *     de réinitialisation du Panel : une garde d'authentification y détruirait
 *     l'assertion transportée en renvoyant au login, sans jamais dire pourquoi.
 *
 * ══ POURQUOI DES CONTRÔLES STATIQUES ════════════════════════════════════════
 *
 * Le parcours réel traverse deux applications et un navigateur : il ne se joue
 * pas dans un test unitaire. Ce qu'on peut garder ici, ce sont les propriétés
 * STRUCTURELLES de l'écran — celles qu'une refonte casserait sans s'en rendre
 * compte. La recette navigateur, elle, éprouve le reste. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0;
let fail = 0;
const check = (name, ok) => {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.error(`  ✗ ${name}`);
  }
};
const section = (title) => console.log(`\n${title}`);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const app = read('App.tsx');
const api = read('lib/api.ts');
const federation = read('lib/federation.ts');
const bloc = read('components/FederatedLoginBlock.tsx');
const callback = read('pages/FederatedCallbackPage.tsx');
const login = read('pages/LoginPage.tsx');
const widget = read('components/TestAccountSwitcher.tsx');
const auth = read('context/AuthContext.tsx');
const types = read('types/index.ts');
const comptes = read('pages/dev/DevAccountsPage.tsx');
const profil = read('pages/ProfilePage.tsx');
const sidebar = read('components/layout/Sidebar.tsx');

/* ══════════════════════════════════════════════════════════════════════════
   1. LE MANAGER NE COLLECTE JAMAIS LE MOT DE PASSE DU PANEL.
   ══════════════════════════════════════════════════════════════════════════ */
section('1 · Aucun identifiant L.Y Solution n’est saisi ici');
{
  check('le bloc fédéré n’a AUCUN champ de saisie',
    !bloc.includes('<Input') && !bloc.includes('type="password"'));
  check('…ni de formulaire', !bloc.includes('<form'));
  check('…et il le dit à l’utilisateur',
    bloc.includes('Votre mot de passe reste sur le Panel'));

  check('la page de retour ne saisit rien non plus',
    !callback.includes('<Input') && !callback.includes('type="password"'));

  /**
   * Le seul mot de passe du fichier de connexion appartient au formulaire
   * LOCAL. On vérifie qu'il n'y en a qu'un — deux champs voudraient dire que
   * le bloc fédéré en a gagné un.
   */
  check('l’écran de connexion ne porte qu’UN champ de mot de passe (le local)',
    (login.match(/type="password"/g) || []).length === 1);

  /**
   * LE WIDGET DE RECETTE NON PLUS (L12.D).
   *
   * Il montre désormais les identités L.Y Solution : c'est exactement l'endroit
   * où quelqu'un serait tenté d'ajouter « et si on demandait juste le mot de
   * passe ? ». Aucun champ, aucun formulaire — la garde est structurelle.
   */
  check('le widget de recette ne saisit aucun identifiant',
    !widget.includes('<Input') && !widget.includes('type="password"') && !widget.includes('<form'));
}

/* ══════════════════════════════════════════════════════════════════════════
   2. LA PAGE DE RETOUR EST PUBLIQUE.
   ══════════════════════════════════════════════════════════════════════════ */
section('2 · Le retour n’est protégé par aucune garde');
{
  check('la route de retour existe',
    app.includes('path="/connexion/ly-solution/retour"'));

  /**
   * On isole la ligne de la route et l'on vérifie qu'aucune garde ne
   * l'entoure. Un `RequireAuth` ici renverrait l'utilisateur au login en
   * détruisant l'assertion qu'il transporte.
   */
  const ligne = app.split('\n').find((l) => l.includes('/connexion/ly-solution/retour')) ?? '';
  check('…sans RequireAuth ni RequireDev sur sa ligne',
    !ligne.includes('RequireAuth') && !ligne.includes('RequireDev'));

  const avantRoute = app.slice(0, app.indexOf('/connexion/ly-solution/retour'));
  const gardeOuverte = (avantRoute.match(/<RequireAuth>/g) || []).length
    > (avantRoute.match(/<\/RequireAuth>/g) || []).length;
  check('…et elle n’est pas imbriquée dans un bloc gardé', gardeOuverte === false);

  check('elle est déclarée à côté des autres routes publiques',
    app.indexOf('/connexion/ly-solution/retour') < app.indexOf('<RequireAuth>'));
}

/* ══════════════════════════════════════════════════════════════════════════
   3. LE SERVEUR DÉCIDE — LE NAVIGATEUR TRANSPORTE.
   ══════════════════════════════════════════════════════════════════════════ */
section('3 · Ni state ni identité ne sont fabriqués côté navigateur');
{
  /**
   * ══ LE DÉPART A DÉMÉNAGÉ, ET C'EST LE POINT DU CONTRÔLE ═══════════════════
   *
   * Deux écrans l'ouvrent désormais — le bloc du formulaire et le widget de
   * recette. Il vit donc dans `lib/federation.ts`, en UN exemplaire. On vérifie
   * les deux propriétés qui comptent : le parcours est unique, et personne ne
   * s'en est refait un à côté.
   */
  check('le state vient du serveur',
    federation.includes('parcours.state') && !federation.includes('crypto.randomUUID'));
  check('…et l’URL d’autorisation aussi',
    federation.includes('parcours.authorizeUrl'));
  check('le départ fédéré n’existe qu’en UN exemplaire',
    federation.includes('export async function beginFederatedLogin')
    && !bloc.includes('api.federationStart(') && !widget.includes('api.federationStart('));
  check('…et les deux écrans l’empruntent',
    bloc.includes('beginFederatedLogin(') && widget.includes('beginFederatedLogin('));

  /**
   * LE WIDGET NE CHOISIT PAS LE COMPTE PANEL, ET NE PEUT PAS LE PRÉTENDRE.
   *
   * L'assertion est émise pour la session ouverte CHEZ LE PANEL. Un paramètre
   * d'identité au départ serait un mensonge d'interface : il ne changerait rien
   * au jeton délivré, et ferait croire à un choix qui n'existe pas.
   */
  check('le départ n’accepte AUCUN identifiant de compte',
    !/beginFederatedLogin\([^)]*(email|panelUserId|account)/i.test(widget)
    && !/beginFederatedLogin\([^)]*(email|panelUserId|account)/i.test(bloc));

  /**
   * AUCUNE ADRESSE EN DUR. Le parcours doit survivre à un changement de
   * domaine du Panel sans redéploiement du manager.
   */
  for (const fichier of [bloc, callback, federation, widget]) {
    check('aucune adresse de Panel codée en dur',
      !/localhost:\d|panel\.ly-solution|https?:\/\/[a-z0-9.-]*panel/i.test(fichier));
  }

  check('l’assertion n’est jamais décodée par le navigateur',
    !callback.includes('atob(') && !callback.includes('jwtDecode') && !callback.includes('jwt_decode'));
  check('…elle est envoyée au backend, qui la consomme',
    callback.includes('api.federationCallback('));

  /**
   * L'assertion voyage dans le FRAGMENT : il n'est pas transmis au serveur,
   * donc il ne finit ni dans un journal d'accès ni dans un `Referer`.
   */
  check('l’assertion est lue dans le fragment, pas dans la query',
    callback.includes('window.location.hash') && !callback.includes('useSearchParams'));
  check('…et le fragment est effacé avant toute suite',
    callback.includes('window.history.replaceState'));
}

/* ══════════════════════════════════════════════════════════════════════════
   4. LE CTA N'APPARAÎT QUE S'IL PEUT ABOUTIR.
   ══════════════════════════════════════════════════════════════════════════ */
section('4 · Projet non appairé : aucun bouton actif');
{
  /**
   * On cherche l'APPEL, pas une mise en forme : `api.federationStatus()` et
   * `api
  .federationStatus()` sont le même geste, et un contrôle qui
   * dépend du passage à la ligne casse au premier reformatage.
   */
  check('la disponibilité est demandée au serveur',
    /api\s*\.\s*federationStatus\s*\(/.test(bloc));
  check('…et le bloc s’efface tant qu’elle n’est pas confirmée',
    bloc.includes('if (available !== true) return null;'));

  check('le client expose bien la route de statut',
    api.includes("'/auth/federated/panel'") && api.includes('federationStatus'));

  /**
   * LE LOGIN LOCAL NE DÉPEND DE RIEN. Le bloc fédéré est un composant à part,
   * monté APRÈS le formulaire : son échec ne peut pas empêcher une connexion
   * locale.
   */
  check('le formulaire local est indépendant du bloc fédéré',
    login.indexOf('handleSubmit(onSubmit)') < login.indexOf('<FederatedLoginBlock'));

  /**
   * PROJET NON APPAIRÉ — le widget le DIT, et n'offre aucun bouton fédéré.
   *
   * C'est la garde §12 du lot : la catégorie L.Y Solution s'annonce
   * indisponible, et la connexion LOCALE reste entièrement praticable. Un
   * bouton qui échoue à coup sûr est pire que pas de bouton.
   */
  check('le widget lit la disponibilité fédérée que le serveur publie',
    widget.includes('description.federation.available'));
  check('…et le dit franchement quand elle est absente',
    widget.includes('Projet non appairé au Panel'));
}

/* ══════════════════════════════════════════════════════════════════════════
   5. DEUX POPULATIONS, DISTINGUÉES PARTOUT.
   ══════════════════════════════════════════════════════════════════════════ */
section('5 · Une identité du Panel se lit comme telle');
{
  check('le type de principal se lit d’UNE seule façon',
    types.includes('export function principalTypeOf') && types.includes('export function isPanelPrincipal'));
  check('…et `_id` peut être nul pour une identité fédérée',
    /_id: string \| null/.test(types));

  check('la barre latérale signale la provenance',
    sidebar.includes('isPanelPrincipal(user)') && sidebar.includes('Accès L.Y Solution'));

  check('l’écran des comptes liste les accès L.Y Solution',
    comptes.includes('api.listExternalPrincipals()') && comptes.includes('Accès L.Y Solution'));

  /**
   * AUCUNE ACTION LOCALE SUR UNE IDENTITÉ DU PANEL. On vérifie la SECTION
   * externe, pas tout le fichier : la section locale, elle, doit garder ses
   * boutons.
   */
  /**
   * ══ LA DÉCOUPE DOIT S'ARRÊTER ══════════════════════════════════════════════
   *
   * Une première version prenait tout jusqu'à la fin du fichier — donc la
   * boîte de dialogue de suppression et la fenêtre d'édition des comptes
   * LOCAUX, qui vivent après. Le contrôle échouait en signalant des boutons
   * qui n'appartiennent pas à la section qu'il prétend inspecter.
   *
   * On borne donc à la fin de la section, marquée par la fenêtre modale qui la
   * suit. Un contrôle qui déborde ne mesure pas ce qu'il annonce.
   */
  /**
   * L'ANCRE EST LE BANDEAU DE SECTION, pas le premier « ACCÈS L.Y SOLUTION »
   * venu : ces mots apparaissent aussi dans un commentaire en tête de fichier,
   * et s'y accrocher faisait commencer la découpe AVANT les déclarations
   * d'état — donc y trouver `setEditing` et `setToDelete`, qui appartiennent
   * aux comptes locaux. Un contrôle mal ancré signale des coupables innocents.
   */
  const debutExterne = comptes.indexOf('══ ACCÈS L.Y SOLUTION');
  const finExterne = comptes.indexOf('<Modal', debutExterne);
  const sectionExterne = debutExterne >= 0 && finExterne > debutExterne
    ? comptes.slice(debutExterne, finExterne)
    : '';
  check('la section externe est bien bornée pour ce contrôle',
    sectionExterne.length > 400 && !sectionExterne.includes('<Modal'));
  check('…et ne propose ni suppression ni mot de passe',
    !sectionExterne.includes('setToDelete') && !sectionExterne.includes('KeyRound')
    && !sectionExterne.includes('Trash2') && !sectionExterne.includes('setEditing'));

  check('le profil n’offre aucun formulaire local à une identité fédérée',
    profil.includes('isPanelPrincipal(user)') && profil.includes('Compte L.Y Solution'));
}

/* ══════════════════════════════════════════════════════════════════════════
   6. RÉVOCATION — un refus fédéré n’est pas un bug réseau.
   ══════════════════════════════════════════════════════════════════════════ */
section('6 · La révocation est expliquée, pas subie');
{
  check('un refus explicite déconnecte, une panne non',
    auth.includes('err.status === 401 || err.status === 403') && auth.includes('setUnreachable(true)'));
  check('…et un DEV fédéré apprend POURQUOI',
    auth.includes('n’est plus actif'));
  check('la provenance est retenue avant la purge',
    auth.includes('etaitFedere'));
}

/* ══════════════════════════════════════════════════════════════════════════
   7. LES MESSAGES D'ERREUR.
   ══════════════════════════════════════════════════════════════════════════ */
section('7 · Les refus sont traduits sans rien révéler');
{
  for (const code of [
    'FEDERATED_STATE_INVALID',
    'FEDERATED_ASSERTION_REPLAY',
    'FEDERATED_PANEL_UNREACHABLE',
    'FEDERATED_PRINCIPAL_INACTIVE',
    'FEDERATION_PROJECT_ACCESS_DENIED',
    'FEDERATION_USER_DISABLED',
  ]) {
    check(`« ${code} » a un message`, federation.includes(code));
  }

  /**
   * LES MOTIFS CRYPTOGRAPHIQUES PARTAGENT UNE SEULE PHRASE. Distinguer
   * « mauvaise audience » de « signature invalide » renseignerait qui cherche
   * à comprendre ce qui a été détecté, sans aider l'utilisateur.
   */
  const neutre = 'Cette autorisation n’a pas pu être validée.';
  check('…et les motifs cryptographiques restent indistincts',
    (federation.match(new RegExp(neutre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length >= 4);
}

/* ══════════════════════════════════════════════════════════════════════════
   8. LA CONNEXION RAPIDE DE TEST N'EST PAS UN CONTOURNEMENT.
   ══════════════════════════════════════════════════════════════════════════ */
section('8 · `dev-login` reste cantonné à TEST');
{
  /**
   * Le widget n'est rendu que si le SERVEUR a répondu `enabled: true`, ce qu'il
   * ne fait qu'en TEST. On vérifie qu'il n'a pas de chemin qui l'afficherait
   * autrement — un `|| true`, un défaut optimiste, une variable de build.
   */
  check('le widget de connexion rapide dépend de la réponse serveur',
    widget.includes('setDescription(r.enabled ? r : null)'));
  check('…et retombe sur « rien » en cas de réponse explicite',
    widget.includes('setDescription(null)'));
  check('…sans aucun contournement par une variable de build',
    !widget.includes('import.meta.env.VITE_DEV_LOGIN')
    && !/enabled\s*\|\|\s*true/.test(widget));

  /**
   * ══ « ABSENT » ET NON « MASQUÉ » ══════════════════════════════════════════
   *
   * La différence n'est pas cosmétique : un `hidden` laisse les adresses des
   * comptes d'administration dans le DOM, donc dans le HTML servi, donc dans
   * une capture de page. Le composant rend `null` — il n'y a rien à masquer.
   */
  /**
   * `(?<![-\w])hidden(?![-\w])` et non `\bhidden\b` : `overflow-hidden` est une
   * classe de MISE EN PAGE parfaitement légitime, et `\b` matche entre le tiret
   * et le mot. Un contrôle qui confond les deux signale un coupable innocent.
   */
  check('hors TEST, le widget ne rend RIEN (aucun masquage CSS)',
    widget.includes('if (!description) return null;')
    && !/className="[^"]*(?<![-\w])hidden(?![-\w])/.test(widget));

  /**
   * LE WIDGET NE CONNAÎT QU'UN CHEMIN LOCAL, ET IL EST NOMMÉ.
   *
   * `api.devLogin` n'est appelé que depuis la branche des comptes LOCAUX. Un
   * appel dans la branche fédérée supposerait un `User` local pour une identité
   * du Panel — c'est-à-dire un mot de passe inventé.
   */
  const federee = widget.slice(widget.indexOf('const connexionFederee'));
  check('la branche fédérée n’appelle JAMAIS `dev-login`',
    !federee.includes('api.devLogin'));
}

/* ══════════════════════════════════════════════════════════════════════════
   9. `dev-login` — L'AUTRE CHEMIN VERS UNE SESSION DEV.
   ══════════════════════════════════════════════════════════════════════════ */
section('9 · La connexion sans mot de passe est fermée hors TEST');
{
  /**
   * ══ POURQUOI CE CONTRÔLE VIT ICI ══════════════════════════════════════════
   *
   * `POST /api/auth/dev-login` ouvre une session DEV SANS mot de passe. C'est
   * un outil de développement légitime, et c'est aussi le seul autre chemin
   * vers les droits que la fédération distribue avec tant de précautions. S'il
   * s'ouvrait un jour en production, tout le reste du lot deviendrait
   * décoratif.
   *
   * On lit le SERVICE, pas l'écran : la garde est là, et c'est elle qui compte.
   */
  const service = fs.readFileSync(
    path.resolve(root, '../../backend/src/services/auth.service.js'), 'utf8',
  );
  const env = fs.readFileSync(
    path.resolve(root, '../../backend/src/config/env.js'), 'utf8',
  );

  const bloc = service.slice(service.indexOf('export async function devLogin'));
  check('devLogin refuse hors TEST',
    bloc.includes('if (!config.isTest) throw ApiError.forbidden'));
  check('…AVANT toute lecture de compte',
    bloc.indexOf('config.isTest') < bloc.indexOf('User.findOne'));

  /**
   * LA LISTE EST FERMÉE DE LA MÊME FAÇON, ET AU MÊME MOMENT.
   *
   * Elle a déménagé dans son propre service, qui lit désormais l'autorité
   * canonique du projet. La garde y est la PREMIÈRE instruction : on ne rend
   * pas une liste vide après l'avoir lue, on refuse avant de la lire.
   */
  const listeService = fs.readFileSync(
    path.resolve(root, '../../backend/src/services/accounts/testLoginAccounts.service.js'), 'utf8',
  );
  const decrire = listeService.slice(listeService.indexOf('export async function describeTestLogin'));
  check('la liste des comptes de test est fermée de la même façon',
    decrire.includes('if (!config.isTest)'));
  check('…AVANT toute lecture de compte',
    decrire.indexOf('config.isTest') < decrire.indexOf('listProjectAccounts('));
  check('…et la liste n’a aucune source parallèle',
    listeService.includes('listProjectAccounts')
    && !listeService.includes('User.find') && !listeService.includes('ExternalPrincipal.find'));

  /**
   * `isTest` DÉRIVE DE L'ENVIRONNEMENT, pas d'un drapeau qu'on peut oublier de
   * poser. `ENV=PROD` ⇒ `isProd` ⇒ `isTest === false`. Il n'existe aucune
   * variable dédiée à désactiver cette porte — donc aucune à oublier.
   */
  check('isTest dérive de ENV, jamais d’un drapeau distinct',
    env.includes("const isProd = ENV === 'PROD';") && env.includes('isTest: !isProd'));

  /**
   * L'ÉCRAN N'A AUCUN CHEMIN PROPRE : il monte le widget sans condition, et
   * c'est le WIDGET qui s'efface tant que le serveur n'a pas répondu « TEST ».
   * La décision reste donc à un seul endroit.
   */
  check('l’écran monte le widget sans condition de son cru',
    login.includes('<TestAccountSwitcher') && !/testEnabled/.test(login));
}

/* ══════════════════════════════════════════════════════════════════════════
   10. LE WIDGET DE RECETTE MONTRE DEUX POPULATIONS, ET NE LES CONFOND PAS.
   ══════════════════════════════════════════════════════════════════════════ */
section('10 · Deux catégories, deux chemins d’entrée');
{
  check('les catégories portent le vocabulaire métier du parc',
    widget.includes('Comptes du projet') && widget.includes('Accès L.Y Solution'));

  check('la séparation se lit sur `source`, jamais sur la forme de l’objet',
    widget.includes("c.source === 'LOCAL'") && widget.includes("c.source === 'PANEL'"));

  /**
   * ══ AUCUN BOUTON QUI ÉCHOUE À COUP SÛR ════════════════════════════════════
   *
   * Les identités fédérées déjà connues sont affichées pour leur ÉTAT, pas
   * comme des commandes : le projet ne choisit pas le compte Panel, et un
   * bouton par ligne aurait promis un choix inexistant. On garde donc qu'aucun
   * `onClick` de connexion ne vit dans cette liste.
   */
  const debutListe = widget.indexOf('Identités déjà venues ici');
  const listeFederee = debutListe >= 0 ? widget.slice(debutListe) : '';
  check('la liste fédérée est bien bornée pour ce contrôle', listeFederee.length > 200);
  check('…et ne porte aucun bouton de connexion',
    !listeFederee.includes('connexionFederee') && !listeFederee.includes('connexionLocale'));

  check('un accès retiré est nommé, pas cliquable',
    widget.includes("blockedReason === 'PANEL_ACCESS_REVOKED'")
    && widget.includes('Accès non autorisé'));

  /**
   * LA HIÉRARCHIE DU PANEL NE S'AFFICHE NULLE PART. Le mot n'existe pas dans
   * l'écran, et le serveur ne peut pas l'envoyer : `assertProjectRole` le
   * ramène à `DEV`.
   */
  check('le mot SUPER_ADMIN n’apparaît pas dans le widget',
    !widget.includes('SUPER_ADMIN'));
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
