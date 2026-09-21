# Fabriquer un projet client — checklist

> À garder ouverte pendant toute la fabrication. Le raisonnement, les commandes
> et le dépannage sont dans [PROJECT_DUPLICATION_GUIDE.md](PROJECT_DUPLICATION_GUIDE.md) ;
> ceci n'en est que la trace.
>
> **Une case ne se coche pas sur une intention : elle se coche sur une preuve.**
> La colonne « comment le prouver » n'est pas décorative — c'est elle qui
> distingue une fabrication vérifiée d'une fabrication espérée.

Projet : ………………………  ·  Slug : ………………………  ·  Date : …………………

---

## 1 · Avant de commencer

- [ ] Nom, slug, bases TEST et PROD arrêtés
- [ ] Domaines TEST arrêtés (site · manager · api)
- [ ] Dépôt GitHub créé et **accessible en écriture depuis cette machine**
      → `git ls-remote <dépôt>` répond sans `403`
- [ ] Adresse du premier développeur (vous)
- [ ] Adresse du premier administrateur (le client) + mot de passe choisi
- [ ] Données client rassemblées (logo, favicon, bannière, fiche)
- [ ] MongoDB joignable · `VPS_PASS` présent dans le plan de contrôle
- [ ] **Capacité Mongo vérifiée** → `npm run mongo:capacity --prefix backend`
      sort en `0` et annonce au moins un projet de marge
      *(la limite du cluster n'est pas lisible depuis le driver : elle se lit
      dans la console Atlas et se déclare dans `MONGO_COLLECTION_ALLOWANCE`)*
- [ ] Un compte DEV peut déclarer un projet sur le Panel

## 2 · Duplication

- [ ] `npm run duplicate:policy` relu — je sais ce qui sera copié
- [ ] `npm run duplicate -- …` terminé sans erreur
- [ ] Les 10 phases sont `ok` — dont **`cleanliness`**
- [ ] `backend/storage` vide → `find backend/storage -type f | wc -l` = `0`
- [ ] `backend/uploads` vide · `backend/logs` vide
- [ ] `.claude`, `.agents`, `one-off/` absents du clone
- [ ] `PROJECT_SLUG` / `PROJECT_ID` = ceux du clone
- [ ] Noms de paquets et lockfiles = ceux du clone
- [ ] Titres d'onglet (`manager/index.html`, `vitrine/index.html`) = ceux du clone
- [ ] Liste « À PERSONNALISER » notée quelque part

## 3 · Bases

- [ ] `<projet>_test` créée
- [ ] `<projet>_prod` créée et **vierge**
- [ ] Aucune collection métier héritée
      → contrats, paiements, factures, entreprises clientes à `0`

## 4 · Configuration

- [ ] `ENV=TEST`
- [ ] `PANEL_URL` = adresse de l'**API** du Panel
- [ ] `PUBLIC_BACKEND_URL` = adresse d'API du projet
- [ ] Secrets régénérés (`JWT_SECRET`, `INTEGRATED_API_ENCRYPTION_KEY` ≠ source)

## 5 · Déclaration au Panel

- [ ] Projet déclaré avec **son URL d'API**
- [ ] **Environnement du PROJET choisi à la déclaration** — `TEST` ou `PROD`
      *(il est ÉPINGLÉ sur la fiche à l'appairage et n'y bouge plus)*
- [ ] Je sais que **l'environnement du Panel peut différer** : un projet `PROD`
      se pilote depuis un Panel `TEST`, et consomme quand même les fournisseurs
      `PROD` (guide §11)
- [ ] Une fiche par monde : la recette et la production sont **deux** fiches,
      deux codes, deux jetons
- [ ] Code d'appairage obtenu et collé dans le `.env`

## 6 · Réseau — AVANT le déploiement

- [ ] Les trois URL publiques écrites par le moteur
- [ ] Projet redémarré
- [ ] Sur le Panel : `descriptor.primaryDomain` = le domaine du projet,
      **et non `localhost`**

## 7 · Appairage

- [ ] Démarrage réussi
- [ ] `pairing = PAIRED` · `liveness = ONLINE`
- [ ] `runtime.environment` correct
- [ ] `contractVersion` identique à celle du Panel
- [ ] outbox `0` · rejets `0` · parked `0` · aucun runtime rival
- [ ] Usages e-mail déclarés — codes, empreintes, réconciliation sans `unknown`
      ni `forbidden`
- [ ] **`PANEL_PAIRING_CODE` retiré du `.env`**

## 8 · Données client

- [ ] Migration d'import écrite, avec `:dry-run`
- [ ] Simulation relue
- [ ] Import appliqué
- [ ] **Rejoué : aucun doublon** (idempotence)
- [ ] Redémarrage → **aucune mutation client**
- [ ] Médias importés par l'autorité média (jamais un chemin en dur)

## 9 · Déploiement TEST

- [ ] Destination créée (site · manager · api · serveur · racine)
- [ ] `--preflight` passé
- [ ] Déploiement terminé, toutes étapes vertes
- [ ] `DNS : automatique (capacité Panel)` — **pas `manuel`**
- [ ] `media.publish` annonce des médias **publiés**
- [ ] Journal du run : `env` = celui de la destination

## 10 · Premier compte

- [ ] Lien d'activation reçu
      → sinon : `localdevactivations.emailStatus`, puis `/activation/resend`
- [ ] Mot de passe posé, compte DEV **actif**
- [ ] Compte ADMIN du client fonctionnel
- [ ] Identifiants remis au client par un canal sûr

## 11 · Recette publique

- [ ] site `200`
- [ ] manager `200`
- [ ] `api/health` `200`, bon `env`
- [ ] `api/version` annonce **le slug du clone**
- [ ] Connexion locale (ADMIN) — OK
- [ ] **Connexion fédérée « Se connecter avec L.Y Solution » — OK**
- [ ] Logo, favicon, hero servis en `200` et `PUBLISHED`
- [ ] Catalogue rendu : services, tarifs, gammes, « sur devis »
- [ ] Page service : la **description n'est PAS dans la bannière**, et se lit
      juste au-dessus de « Prestations »
- [ ] Pied de page : l'année du copyright est **calculée**, pas figée
      *(`vitrine` : `npm test` couvre 2026 → 2026 et 2027 → 2027)*
- [ ] Aucun `ObjectId`, `undefined`, `NaN` à l'écran
- [ ] Aucun débordement horizontal en 390 / 768 / 1440
- [ ] **Aucune identité de la source** nulle part

## 12 · Fournisseurs

- [ ] `activeMode` = **environnement du PROJET**, pour les quatre —
      jamais celui du Panel
- [ ] Sur le Panel, la fiche annonce le bon `environment` (et non celui du
      plan de contrôle qui la sert)
- [ ] **Aucun credential local** dans `integratedapis`
- [ ] Webhook Stripe : endpoint garanti, secret de vérification rapatrié

## 13 · Dépôt

- [ ] Historique propre, remote correct
- [ ] Poussé — `HEAD = origin/<branche>`
- [ ] Arbre propre
- [ ] Aucun `.env`, upload, PDF, dump, `node_modules`, `dist`, journal

## 14 · Clôture

- [ ] Aucun correctif de code posé dans le clone
      → **si cette case ne peut pas être cochée : corriger la FABRIQUE, jeter le
      clone, recommencer**
- [ ] Scripts et fichiers temporaires supprimés
- [ ] Processus locaux arrêtés
- [ ] `docs/PROJECT.md` du nouveau projet écrit
- [ ] Entreprise cliente : rattachée, ou absence assumée et documentée
      (facturation et signature restent bloquées — c'est correct)
