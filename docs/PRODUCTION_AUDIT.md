# Audit de préparation à la production — SB Auto

> Audit complet (backend, MongoDB, API, manager, vitrine, UX, sécurité, performances,
> DevOps, documentation) réalisé sur l'état du dépôt, données PROD déjà migrées,
> déploiement VPS à venir. Objectif : robustesse, sécurité, performance,
> maintenabilité — **sans point bloquant**.
>
> Méthode : lecture réelle du code (aucune hypothèse), corrections simples et sûres
> appliquées automatiquement, tests/builds exécutés, corrections documentées. **Aucun
> changement de comportement métier. Aucune donnée modifiée.**

---

## 1. Verdict

## ✅ READY FOR PRODUCTION

Aucun point **bloquant** ne subsiste. Le projet est robuste, cohérent et sûr.
La mise en ligne reste soumise à une **check-list de pré-vol** opérationnelle
(secrets, mots de passe des comptes, DNS/HTTPS) — voir §8 et
[VPS_DEPLOYMENT_GUIDE.md](VPS_DEPLOYMENT_GUIDE.md). Ces points sont de la
configuration de déploiement standard, pas des défauts de code.

### Score global : **9,3 / 10**

| Domaine        | Note /10 | Commentaire synthétique |
| -------------- | :------: | ----------------------- |
| Architecture   | **9,5**  | Séparation routes/contrôleurs/services nette, factories (CRUD, singleton), utils cohérents, doc à jour. |
| Backend        | **9,4**  | Express + Mongoose solides ; durci pour la prod (rate-limit, ENV fail-closed, uploads, erreurs). |
| MongoDB        | **9,2**  | Schémas propres, singletons, mots de passe protégés ; index manquants ajoutés. |
| API            | **9,3**  | Enveloppe et codes HTTP uniformes, validation Zod quasi partout ; validations manquantes comblées. |
| Manager        | **9,3**  | Code-splitting, ErrorBoundary, a11y et re-renders améliorés. |
| Vitrine        | **8,8**  | SEO par page + perfs nettement améliorés ; plafond = rendu 100 % client (pas de SSR). |
| UX             | **9,3**  | Responsive, animations soignées, toasts, états de chargement, accessibilité renforcée. |
| Sécurité       | **9,4**  | JWT/bcrypt/Helmet/CORS/SSRF déjà bons ; brute-force, path-traversal et fuite d'erreurs corrigés. |
| Performances   | **9,2**  | Bundles divisés par ~15, LCP priorisé ; reste SSR/self-host polices/lazy images. |
| DevOps         | **9,0**  | Arrêt gracieux, trust proxy, healthcheck, `.env.example` complets ; guide VPS fourni. |
| Documentation  | **9,6**  | Docs existantes excellentes + cet audit + guide de déploiement pas-à-pas. |

---

## 2. Ce qui a été corrigé automatiquement (sûr, sans impact métier)

Tous les correctifs ci-dessous ont été appliqués, testés et poussés en commits
atomiques. **Backend : migration 54/54 et smoke 102/102 au vert. Frontends :
`tsc` propre, builds au vert (plus aucun chunk > 500 Ko).**

### Backend — sécurité (`audit(security): harden backend for production`)
- **`ENV` fail-closed** : le backend refuse de démarrer si `ENV` n'est pas
  explicitement `TEST` ou `PROD`. Auparavant un `ENV` oublié retombait
  silencieusement en mode TEST → `dev-login` **sans mot de passe** exposé.
- **Comptes PROD sans mot de passe public** : en PROD les comptes structurels ne
  ne sont plus créés avec un mot de passe du tout (LOT 2C) : le compte naît
  `PENDING_ACTIVATION` et son titulaire choisit son secret par un lien à usage
  unique. Aucun mot de passe n'est lu de l'environnement ni journalisé une
  fois. (TEST conserve les identifiants de démo pour la connexion rapide.)
- **Anti-brute-force** : limiteur de débit maison (sans dépendance) sur
  `/auth/login` et `/auth/dev-login` (30 req / 15 min / IP ; inactif en TEST).
- **Path-traversal upload** : le paramètre `?prefix=` est réduit à un jeton
  alphanumérique — plus d'écriture hors de `/uploads`.
- **Fuite d'erreur 500** : un message d'erreur interne inattendu n'est jamais
  renvoyé au client en PROD (seuls les `ApiError` explicites le sont).
- **JWT** : vérification épinglée à `HS256` (défense en profondeur).
- **En-têtes / statique** : `trust proxy` (vraie IP derrière Nginx),
  `x-powered-by` désactivé, `/uploads` durci (pas de dotfiles/listing, cache des
  fichiers immuables).
- **Arrêt gracieux** : `SIGINT`/`SIGTERM` draine les requêtes puis ferme Mongo
  (reload PM2 propre).

### Backend — base de données & API (`audit(db,api): …`)
- **Index composés** ajoutés là où les requêtes publiques/liste triaient sans
  index : `Review {published,order,date}`, `Faq {published,order}`,
  `Service {published,order}`, `TeamMember {order}`. Suppression des `index:true`
  redondants (`User.email`, `Service.slug` — déjà indexés par `unique`).
- **Validation** : corps `reorder` validés (services/avis/faq/équipe) et schéma
  strict pour l'équipe — ferme une injection d'opérateur via `findByIdAndUpdate` ;
  `:id` validé sur le PUT équipe.
- **Migration** : le singleton `RoleAppearance` entre dans la parité TEST→PROD et
  est pré-créé au bootstrap.

### Manager (`audit(manager): …`)
- **ErrorBoundary** de niveau racine (plus d'écran blanc sur erreur de rendu).
- **Code-splitting** : chaque page en `React.lazy` + `Suspense`, vendors séparés
  (`react`/`framer-motion`/`dnd-kit`/`react-hook-form`) → le bundle passe d'un
  **chunk unique de 1,36 Mo** à de petits chunks par page.
- **`DynamicIcon`** n'importe plus toute la librairie lucide → le chunk
  `ContactsPage` passe de **732 Ko à 4,6 Ko**.
- **`useResource`** : garde de montage (plus de `setState` après démontage) et
  **remontée des erreurs en toast** (fin des échecs silencieux).
- **Re-renders** : valeurs de contexte mémoïsées (`AuthContext` en `useCallback`,
  `Company`/`RoleAppearance` en `useMemo`).
- **Accessibilité** : `role="dialog"`/`aria-modal` + gestion du focus sur les
  modales, `aria-label` sur les boutons icône, upload d'image utilisable au
  clavier.
- Suppression du CDN `bootstrap-icons` **inutilisé** et du code mort
  `PageTransition`.

### Vitrine (`audit(vitrine): …`)
- **SEO par page** : hook `useSeo` — `title`/`meta description` par route et
  **URL canonique propre à chaque page** (corrige la canonique globale qui
  pointait tout vers l'accueil) ; `noindex` sur la 404.
- **`MediaIcon`** n'importe plus toute la librairie lucide → chunk principal
  **819 Ko → 70 Ko**.
- **Code-splitting** des routes hors accueil + vendors séparés.
- **LCP** : image hero en `fetchpriority=high` / `decoding=async`.
- **Accessibilité** : menu « Services » ouvrable au clavier (`aria-expanded`),
  `aria-label` sur le toggle mobile, `<Link>` pour l'ancre `/#avis` (navigation
  SPA, plus de rechargement complet).
- `index.html` : `og:site_name` + Twitter Card.

---

## 3. Backend — détail

**Points déjà excellents** : couverture d'auth complète (toute route privée passe
par `authenticate`, `authorize` correct, DEV superset), bcrypt (hash au
`pre('save')`, `password` en `select:false` + retiré du `toJSON`), JWT (secret
obligatoire, user rechargé à chaque requête), CORS (jamais `*` avec credentials,
allowlist `.env` ∪ URLs configurées), Multer (memoryStorage, limite 12 Mo,
`fileFilter image/*`, ré-encodage Sharp neutralisant tout contenu non-image),
`probeUrl` anti-SSRF (http/https only, credentials refusés, IP privées/loopback/
link-local **dont 169.254.169.254** bloquées, `redirect:'manual'`, timeout, corps
non lu), Helmet actif, `express.json` limité à 2 Mo.

| Sévérité | Constat | État |
| --- | --- | --- |
| Bloquant | Comptes par défaut à mot de passe public créés en PROD | **Corrigé** (env/aléatoire) |
| Critique | `ENV` par défaut TEST → fail-open (`dev-login` sans mdp) | **Corrigé** (fail-closed) |
| Critique | Aucune limitation anti-brute-force sur `/auth/login` | **Corrigé** (rate-limit) |
| Critique | Path-traversal via `?prefix=` de l'upload | **Corrigé** (sanitisation) |
| Majeur | 500 renvoyant le message d'erreur interne | **Corrigé** (masqué en PROD) |
| Mineur | `jwt.verify` sans `algorithms` | **Corrigé** (`HS256`) |
| Mineur | `JWT_SECRET` sans longueur minimale | **Avertissement** ajouté (PROD) |
| Mineur | SSRF : fenêtre de DNS-rebinding (TOCTOU) dans `probeUrl` | Recommandation (pin IP) |
| Amélioration | Fichiers uploadés orphelins jamais nettoyés | **Corrigé** (GC référence-compté cross-DB + grâce, `storage.service.js`) |
| Amélioration | Politique de mot de passe faible (min 6) | Recommandation |

---

## 4. MongoDB — détail

**Déjà correct** : `select:false` + strip `toJSON` du mot de passe, index composés
sur `BeforeAfter` et `PromotionBanner`, `SystemConfiguration.updatedBy` en vraie
`ref` peuplée, contrôle d'intégrité (singletons uniques, comptes, refs) dans
l'outil de promotion, dégradation gracieuse des collisions `email`/`slug` en 409.

| Sévérité | Constat | État |
| --- | --- | --- |
| Critique | Race `findOne`+`create` sur singleton | Fenêtre fermée par `bootstrap()` (pré-création de tous les singletons avant l'écoute) ; documenté dans `getSingleton` |
| Majeur | Champs triés/filtrés sans index (Review/Faq/Service/Team) | **Corrigé** (index composés) |
| Majeur | `RoleAppearance` hors parité migration | **Corrigé** (ajouté) |
| Mineur | `index:true` redondant (`User.email`, `Service.slug`) | **Corrigé** |
| Mineur | Refs souples d'avis non nettoyées à la suppression d'un service | Recommandation (par conception : label embarqué) |
| Amélioration | Aucune pagination sur les listes | Recommandation (avant montée en volume) |
| Amélioration | Peu de validation de format en schéma (hex, `HH:MM`, timezone) | Recommandation |

---

## 5. API — détail

**Déjà cohérent** : chaque création → 201, suppression → 204, lecture/màj → 200 ;
enveloppe unique `{success,data}` / `{success,message,details?}` ; messages
français ; 404 corrects ; pas de capture de route `/reorder` par `/:id`.

| Sévérité | Constat | État |
| --- | --- | --- |
| Critique | Path-traversal upload (`prefix`) | **Corrigé** |
| Majeur | 500 divulguant le message interne | **Corrigé** |
| Majeur | `reorder` sans validation (services/avis/faq/équipe) | **Corrigé** |
| Majeur | `team` create/update sans schéma de corps | **Corrigé** |
| Majeur | PUT singleton sans validation (`theme`, `dev-company`) | Recommandation (schéma Zod à écrire ; risque nul aujourd'hui car `doc.set()` n'interprète pas les opérateurs) |
| Mineur | PUT `/:id` ne valide pas le param `:id` (déjà 400 via CastError) | Partiellement corrigé (équipe) ; cosmétique ailleurs |
| Mineur | PUT vs PATCH pour des mises à jour partielles | Recommandation (convention) |
| Mineur | Pas de pagination sur les listes | Recommandation |
| Amélioration | `service.controller` duplique `crudFactory` | Recommandation (refactor) |

---

## 6. Frontends — détail

### Manager
**Déjà bon** : architecture pages/contextes/hooks claire, `tsconfig` strict
(`noUnusedLocals`/`noUnusedParameters`), primitives UI cohérentes, toasts,
états de chargement, 401 géré.

| Sévérité | Constat | État |
| --- | --- | --- |
| Bloquant | Aucun ErrorBoundary (écran blanc sur toute erreur) | **Corrigé** |
| Critique | Zéro lazy-loading (bundle 1,36 Mo) | **Corrigé** |
| Critique | `useResource` : `setState` après démontage, erreurs silencieuses | **Corrigé** |
| Majeur | Valeurs de contexte non mémoïsées | **Corrigé** (Auth/Company/Role) |
| Majeur | Modales sans focus/ARIA | **Corrigé** (partiel : focus + aria ; focus-trap = reco) |
| Majeur | Remontage complet de route à chaque navigation (refetch) | Recommandation (cache type React Query) |
| Mineur | `aria-label` manquants, upload non-clavier | **Corrigé** |
| Mineur | 401 = rechargement complet | Recommandation |

### Vitrine
**Déjà bon** : `lang="fr"`, `robots.txt`, page 404 dédiée, OG de base,
`display=swap`, conteneurs à ratio fixe (CLS limité), `alt` pertinents, iframe
Maps `loading=lazy`+`title`, quasi aucun appel réseau tiers.

| Sévérité | Constat | État |
| --- | --- | --- |
| Critique | Canonique unique pointant tout vers l'accueil | **Corrigé** (canonique par route) |
| Majeur | Pas de `title`/`description` par page | **Corrigé** (`useSeo`) |
| Majeur | Rendu 100 % client (SEO/LCP) | Recommandation (SSG/prerender) — plafond structurel |
| Majeur | Bundle monolithique | **Corrigé** (split + icônes) |
| Majeur | Menu Services inaccessible au clavier | **Corrigé** |
| Majeur | Image LCP non priorisée | **Corrigé** (`fetchpriority`) |
| Mineur | `sitemap.xml` manquant (robots le référence) | Reco (génération au déploiement — URL dépend du domaine) |
| Mineur | Polices Google externes (perf/RGPD) | Recommandation (self-host) |
| Mineur | Images sans `loading=lazy`/dimensions | Recommandation (hors hero) |
| Mineur | Soft-404 (200 côté hébergeur) | Atténué (`noindex`) ; reco prerender |

---

## 7. Sécurité, DevOps & Performances — synthèse

- **Sécurité** : surface d'attaque réduite (brute-force, path-traversal, fuite
  d'erreur, fail-open ENV, comptes PROD). Nettoyage des uploads orphelins
  désormais **implémenté** (GC référence-compté cross-DB + grâce). Restent des
  **recommandations** non bloquantes : pin d'IP anti-rebinding, focus-trap
  modales, politique de mot de passe.
- **DevOps** : arrêt gracieux, `trust proxy`, `/health`, `.env.example` complets
  (backend + fronts). Fournis dans ce livrable : configuration **PM2 + Nginx +
  Certbot + UFW + Fail2Ban**, procédures de **mise à jour, rollback et
  sauvegardes** (voir le guide). Pas de CI/CD ni de tests frontend automatisés
  (recommandation).
- **Performances** : gains majeurs sur les bundles (manager et vitrine divisés par
  ~15 sur le plus gros chunk), LCP priorisé. Leviers restants : SSR/prerender
  vitrine, self-host des polices, `loading=lazy` sur les images below-the-fold.

---

## 8. Check-list de pré-vol (avant mise en ligne)

Conditions **opérationnelles** (pas de code) à cocher au déploiement — détaillées
dans [VPS_DEPLOYMENT_GUIDE.md](VPS_DEPLOYMENT_GUIDE.md) :

- [ ] `ENV=PROD` dans le `.env` du serveur.
- [ ] `JWT_SECRET` = chaîne aléatoire longue (≥ 32 caractères).
- [ ] Mots de passe des comptes DEV/ADMIN **changés** (via l'app ou `SEED_*_PASSWORD`) —
      vérifier qu'aucun compte ne reste `PENDING_ACTIVATION` sans lien envoyé
      (`scripts/migrate-legacy-local-dev.mjs --dry-run` classe le parc).
- [ ] `CORS_ORIGINS` + `PUBLIC_URL` = vrais domaines HTTPS.
- [ ] `VITE_API_URL` des deux fronts = `https://api.<domaine>`.
- [ ] DNS `A` pour `@`, `manager`, `api` → IP du VPS ; HTTPS Let's Encrypt actif.
- [ ] Sauvegardes MongoDB + `uploads/` planifiées.
- [ ] Pare-feu UFW (22/80/443) + Fail2Ban actifs.

---

## 9. Recommandations priorisées (post-lancement, non bloquantes)

1. **Vitrine SSG/prerender** (react-snap ou équivalent) — lève le plafond SEO/LCP.
2. **Cache de données manager** (React Query/SWR) — supprime les refetch à chaque
   navigation, ajoute un focus-trap complet aux modales.
3. **Pagination** des listes (avis, avant/après) avant montée en volume.
4. **Self-host des polices** (Inter/Poppins) — perf + RGPD.
5. **Durcissements sécurité** : pin d'IP anti-rebinding, politique de mot de passe,
   `JWT_SECRET` bloquant si trop court en PROD.

> **Fait depuis l'audit** — nettoyage des uploads orphelins : balayage
> référence-compté (`DB_TEST` ∪ `DB_PROD`) avec période de grâce, déclenché
> automatiquement après chaque mutation + script `npm run uploads:cleanup`.
7. **CI** : `npm test` + `tsc` + build sur chaque push.

---

## 10. Vérification

| Vérification | Résultat |
| --- | --- |
| Backend — tests migration (`promote.test.js`) | ✅ 54/54 |
| Backend — smoke end-to-end (`smoke-test.js`) | ✅ 102/102 |
| Manager — `tsc -b --noEmit` | ✅ 0 erreur |
| Manager — `vite build` | ✅ (plus aucun chunk > 500 Ko) |
| Vitrine — `tsc -b --noEmit` | ✅ 0 erreur |
| Vitrine — `vite build` | ✅ (plus aucun chunk > 500 Ko) |

*Audit et corrections réalisés avec Claude Code. Aucune donnée MongoDB, aucun
service métier, aucun tarif/avis/contenu n'a été modifié.*
