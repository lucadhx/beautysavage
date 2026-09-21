# Rapport final — SB Auto (template SaaS)

## 1. Fonctionnalités réalisées

### Backend (API)
- Architecture en couches (config / models / services / controllers / middlewares / validators / routes / utils) — aucune logique métier dans les routes.
- **Système dual-DB** piloté par `ENV` (TEST/PROD) — bascule sans autre modification.
- Authentification **JWT**, mots de passe hachés (bcrypt), rôles **DEV** (superset) et **ADMIN**.
- **Seed automatique idempotent** au 1er lancement : comptes DEV/ADMIN + documents singleton (les données de démonstration sont réservées à **TEST** — jamais injectées en PROD).
- Modèles : Company (médias + logos + image d'accueil + texte d'intro + clients satisfaits + **horaires `businessHours` & `timezone`**), Service (catégories **avec description, galeries ≤ 50, packs → prestations incluses + options → badges → tarifs, prestations complémentaires et suppléments**), Review, **Faq**, **BeforeAfter** (avant/après), **PromotionBanner** (bannières programmées), Theme (palette réduite 4 couleurs), ManagerTheme, SiteStatus, DevCompany, TeamMember.
- Tarifs : mode **prix fixe** ou **sur devis**, tarif de base + compléments (écarts calculés) + **options payantes** (nom, prix, description).
- **Durée facultative** des packs et prestations complémentaires (`duration`, en minutes). `default: null` — et non `0` comme les autres champs numériques — pour que « non renseignée » existe : rien ne s'affiche alors, ni au manager ni sur la vitrine, et les documents antérieurs restent silencieux sans migration. Le validateur Zod des services étant `.passthrough()` et le contrôleur sans liste blanche, **Mongoose est la seule couche de validation** : la persistance et l'exposition via `/public/bootstrap` sont donc couvertes par des assertions de bout en bout du smoke test. Voir [RX_UX_POLISH_MANAGER_02.md](RX_UX_POLISH_MANAGER_02.md).
- **Seeds de démo (si vide, TEST uniquement)** : 20 avis 5★ (~1 an → ~2 semaines), 5 questions FAQ, et répartition des prestations complémentaires & suppléments dans les catégories existantes (matching par mots-clés). En PROD, aucun seed de démo (garde `!config.isProd`). Migration auto `prestations` → `packs` (idempotente, TEST comme PROD).
- **Promotion des données TEST → PROD** : moteur dédié (`scripts/lib/promotion-core.js`) indépendant de `ENV`, connexions source/destination distinctes (TEST en lecture seule), copie BSON fidèle (`_id`/relations/timestamps/hash préservés) + index, empreintes SHA-256 déterministes (parité PROD↔TEST + preuve que TEST reste inchangée), contrôles d'intégrité/singletons/comptes, scans URLs `localhost`/`ngrok`, secrets (chemin seul) et uploads (manifest). Modes `--audit`/`--dry-run`/`--apply` (+`--reset-prod`), confirmation explicite, sauvegarde PROD, rapports JSON+MD sans secret. Voir [TEST_TO_PROD_MIGRATION.md](TEST_TO_PROD_MIGRATION.md).
- **Connexion rapide en TEST** : liste des comptes + connexion instantanée sans mot de passe (strictement désactivée en PROD).
- Upload **Multer + Sharp** (WebP + favicon PNG), validation **Zod**, gestion d'erreurs centralisée.
- **Cycle de vie des médias** : balayage anti-orphelins référence-compté (`DB_TEST` ∪ `DB_PROD`, période de grâce) déclenché après chaque mutation + script `npm run uploads:cleanup` — aucun fichier upload ne s'accumule.
- Endpoint public unique `/public/bootstrap` pour la vitrine, gestion de la **suspension**.
- **Avant/Après**, **horaires+fuseau** et **bannières promo** : modèles, endpoints, validation Zod, sélection unique testée et calcul « ouvert/fermé » (fuseau).
- **Configuration système (`network`, DEV only)** : singleton `SystemConfiguration` (URL publiques backend/manager/vitrine), normalisation d'origine partagée (`normalizeAppUrl`), **test de joignabilité SSRF-safe** (`urlProbe` : DNS + refus IP privées/loopback/metadata, timeout, HEAD→GET sans corps, aucune redirection suivie), **CORS dynamique** (origines `.env` de secours ∪ URL configurées, cache mémoire rafraîchi à chaud). Aucun secret en base.
- **Intégrations, contrats & paiements** : coffre-fort IntegratedAPI (secrets chiffrés, mode par fournisseur indépendant de `ENV`), module Contrats (machine à états, PDF + zones de signature), **signature électronique** de bout en bout (DEV→client, PDF signé et preuve d'audit archivés automatiquement), **frais de lancement Stripe** (Checkout unique) et **abonnement Stripe** (Checkout mensuel, Product/Price immuables, activation finale explicite, résiliation en fin de période, fin effective → suspension automatique du site, politique impayé PAST_DUE, réconciliation, entitlement technique/contractuel). Voir [STRIPE_LAUNCH_FEE_FLOW.md](STRIPE_LAUNCH_FEE_FLOW.md), [STRIPE_SUBSCRIPTION_FLOW.md](STRIPE_SUBSCRIPTION_FLOW.md), [SITE_CONTRACT_ENTITLEMENT.md](SITE_CONTRACT_ENTITLEMENT.md) et [SIGNATURE.md](SIGNATURE.md).
- **Facturation** : le type d'une facture est dérivé de `billing_reason` (Stripe), pas du champ `subscription` — retiré de l'API en `2025-03-31.basil`. Le bug typait toute facture d'abonnement en « Frais de lancement » et, plus grave, empêchait l'enregistrement des paiements de cycle et les passages en `PAST_DUE`. Version d'API désormais **épinglée**. Rattachement manuel d'une facture Stripe (DEV) depuis son lien. Voir [RX_POLISH_CONTRACTS_BILLING_01.md](RX_POLISH_CONTRACTS_BILLING_01.md).
- **Outils de recette (ENV=TEST uniquement)** : « Résilier immédiatement » et « Réinitialiser la recette », refusés en PROD par le service (403) et non par l'interface.
- **Abonnement Yousign en Trial** : il refuse les `redirect_urls` (« The redirect urls cannot be defined when the subscription is in trial. ») et faisait échouer la création **entière** de la demande — donc le contrat, pour un simple confort de navigation. Ce refus **précis** déclenche désormais une reprise sans redirections, payload par ailleurs identique ; tout autre refus continue de remonter. Aucun réglage, aucun ENV : le comportement est dicté par la réponse de Yousign, et le jour où l'abonnement autorise les redirections la 1ʳᵉ tentative passe sans toucher au code. Aucune demande orpheline (la tentative refusée nettoyait déjà son brouillon). Voir [YOUSIGN_TRIAL_REDIRECT_FALLBACK.md](YOUSIGN_TRIAL_REDIRECT_FALLBACK.md).
- **Recette Sandbox Yousign RÉELLE effectuée le 2026-07-16** (plus seulement des mocks) : elle a révélé et corrigé un `400` bloquant à l'upload du document (`nature: 'signable'` au lieu de `signable_document` — une doc interne fausse que le code avait suivie). Création de la demande, **upload du PDF**, signataires et champs sont désormais validés sur l'API réelle. L'**activation** reste bloquée par une limitation du compte sandbox (« the recipient email must belong to your organization ») : à lever auprès du support Yousign, ou en utilisant des adresses du domaine de l'organisation. Rapport complet : [YOUSIGN_REAL_SANDBOX_FIX_REPORT.md](YOUSIGN_REAL_SANDBOX_FIX_REPORT.md).
- Suites de tests sur MongoDB in-memory — **100 % au vert** : suite complète `npm test` (**806 assertions** : migration, IntegratedAPI, contrats (dont la **création sans pré-remplissage**, via le service), **signataires + snapshot**, Yousign (dont le **multipart d'upload** et le **payload signataire réellement construits**, `redirect_urls` compris, et le **repli Trial** : refus reconnu sous ses trois formes, cinq refus qui ne doivent PAS le déclencher, aucune demande orpheline), Stripe, **frais de lancement**, **abonnement**, cycle de vie, smoke — dont la **durée des prestations**, persistance et exposition publique). Côté manager, `npm test` (**308 assertions** réparties en 7 modules purs : suivi d'avancement, zones de signature, facturation, préparation guidée, machine à états d'enregistrement, durées, **franchissement d'étape et arrêt du sondage**) — scripts Node autonomes, sans dépendance ajoutée.

### Manager (back-office)
- React + TS + Vite + Tailwind, **thème du manager** piloté par variables CSS (modifiable par DEV, en direct).
- Auth (contexte), routing protégé, **menu filtré par rôle**, sidebar moderne + drawer mobile.
- **Bannière orange fixe** de suspension + page Statut (suspendre/réactiver — DEV only).
- Page de connexion : formulaire + **widget de connexion rapide** (visible uniquement en TEST) listant les comptes avec badges de rôle, connexion en un clic.
- Pages : Dashboard (**+ réalisations, horaires, bannière active/prochaine**), Entreprise (identité + texte d'intro, **logos** avec simulations Header & Favicon, **image d'accueil (hero)** avec simulation, **configurateur d'horaires + fuseau**), **Avant / Après** (dnd, double upload, aperçu slider), **Bannières promo** (statuts, compteurs de caractères, couleurs, programmation, timer, avertissement de chevauchement, aperçu desktop/mobile), Services (**arbre hiérarchique** service › catégorie › **pack**, replié par défaut, icônes édition/suppression ouvrant des **modales dédiées** ; catégorie = description + galerie **drag & drop** ≤ 50 + **modales dédiées pour prestations complémentaires & suppléments** (mode « à partir de »/« sur devis ») ; pack = prestations incluses, **options payantes**, **badge color-picker**, tarifs à écarts auto), Tarifs (synthèse), Avis (CRUD + **date éditable** + **photos jointes** (galerie multi-upload, affichées en carrousel sur la vitrine) + **configurateur « X+ clients satisfaits » avec preview live**), **FAQ (CRUD + réorganisation drag & drop)**, Contacts (édition des coordonnées & réseaux), Thème du site (**palette réduite 4 couleurs + aperçu sombre en direct**), Statut, Mon profil (changement de mot de passe), **Support › Information** (entreprise développeur + personnes, en lecture).
- Pages DEV : Entreprise développeur (références texte/lien), Équipe, Comptes (CRUD), Thème manager, suspension du site, **Configuration système › Réseau** (3 champs URL avec normalisation/aperçu en direct, avertissements de cohérence, boutons Test/Enregistrer/Réinitialiser, cartes de résultat par URL, encart d'aide ngrok, historique de dernière modification).
- Lien applicatif « Voir la vitrine » (Dashboard) et résolution des médias basés sur la config réseau (`resolveMediaUrl`, `useNetworkConfiguration`), sans basculer dynamiquement la base API (prévisibilité).
- Framer Motion (transitions, chargements), toasts Sonner, responsive + **drawer mobile**, validation React Hook Form + Zod.
- **Pattern d'édition flottant** (`FloatingSaveWidget`) : bouton d'enregistrement toujours visible, aux 4 états uniformes (✓ Enregistré / Enregistrer / Enregistrement… / ✓ Enregistré), sur les pages pleine page et le configurateur de signature — plus besoin de remonter le formulaire. Les pages n'utilisant pas react-hook-form, la ressource chargée **est** le brouillon : `useFloatingSave` tient la copie de référence qui manquait pour calculer un état « modifié ». Invariant testé exhaustivement : « ✓ Enregistré » ne peut pas s'afficher sur un formulaire modifié.
- **Parcours de contrat guidé** : chaque étape (signature, frais, abonnement, activation) est un **écran** — illustration, titre, explication, montants, action — et non plus un bouton qui change de libellé sous une carte figée. Le DEV devient **partie au contrat** après validation (« Signer », puis « Vous avez signé — le client poursuit »), le technique passant sous « Voir les détails ». Retour **automatique** après Stripe/Yousign (vérification serveur, puis animation de l'étape franchie), aucun rafraîchissement manuel. Viewer de zones **multipage** (clic / flèches / balayage) et boutons **dockés au bas de la frame** (`sticky`). Voir [RX_CONTRACT_UX_POLISH_03.md](RX_CONTRACT_UX_POLISH_03.md).
- **Configurateur de signature** : « Ajouter » et « Enregistrer » deviennent des boutons flottants ancrés au-dessus du document (donc insensibles au défilement) ; le signataire se choisit dans une popover **au moment de créer la zone** (fin du mode « signataire actif », invisible depuis le document et source de zones du mauvais rôle) ; la zone naît au centre de ce qui est **réellement à l'écran** sur la page regardée.
- **Toggle lisible** : l'état OFF s'appuie sur des tokens dédiés **indépendants du thème** (une palette claire le rendait invisible), avec bordure, contraste AA, focus clavier et libellé accessible. Garde-fou `prefers-reduced-motion` global : seuls 3 composants framer-motion l'honoraient, toutes les transitions CSS l'ignoraient.
- Édition des services réorganisée en sections titrées (`FieldGroup`) et contrôle segmenté partagé (`SegmentedControl`, vrai `radiogroup`) — deux implémentations divergentes auparavant.

### Vitrine (site public premium)
- **Thème sombre premium (noir / bleu / blanc)** appliqué depuis l'API via une palette de **4 couleurs**, le reste étant dérivé en CSS (`color-mix`) — **aucune couleur codée en dur**, favicon + titre dynamiques.
- Loader animé, **page de suspension** unique respectant le thème.
- Accueil : **hero épuré et minimaliste** (image de fond configurable, titre + slogan uniquement, description éditable dessous), statistiques (dont **« X+ clients satisfaits »**), **carrousel 3D des services**, **carrousel 3D des avis en boucle infinie** (cards uniformes, **logo Google**, texte long flouté/fondu + **« voir plus »** en modal), **FAQ gérée depuis le manager**, CTA, footer premium.
- Menu **Services déroulant** (desktop) + **drawer mobile animé** (entrée/sortie item par item, sous-menu Services animé).
- Page service : **onglets de catégories** (pleine largeur, flèche accent) → **carrousel de packs** (cards verticales : prestations incluses, options, tarifs, badges), puis sections distinctes **« Prestations complémentaires »** (grille illustrée) et **« Suppléments »** (pastilles) — chacune « à partir de X€ » ou « sur devis » ; + **galerie lightbox**.
- **Durée indicative** (⏱ 2h30, 45 min) affichée à côté du tarif des packs et sous le nom des prestations complémentaires — **uniquement si renseignée**, silence total sinon.
- **Avant / Après** (`/avant-apres`) : page premium avec slider comparatif interactif (souris/tactile/clavier) par réalisation.
- **Bannière promotionnelle active** fixe sous le header (couleurs configurées, compte à rebours, CTA, fermeture en session, décalage sans saut).
- Contact : boutons rapides (Appel / WhatsApp / Mail / Itinéraire) **centrés**, coordonnées, **horaires + statut « ouvert/fermé » en direct**, **carte Google Maps** intégrée ; footer avec pastille de statut.
- Composants réutilisables : **Coverflow** (carrousel 3D), Lightbox, GoogleLogo.
- SEO (meta, OpenGraph), robots.txt, 404, animations au scroll, responsive complet.

## 2. Choix d'architecture

- **Monorepo à trois apps** : découplage net API / admin / public, déployables séparément.
- **Contenu Service imbriqué** (catégories → packs / prestations complémentaires / suppléments) : une seule requête par page, cohérence transactionnelle, édition « tout le document » simple et robuste.
- **Singletons** (Company, Theme, SiteStatus…) via find-or-create : configuration unique et prévisible.
- **Thématisation par variables CSS** côté vitrine ET manager : personnalisation totale sans recompilation.
- **Factories** (`crudFactory`, `singletonFactory`) : DRY, ajout d'une ressource en quelques lignes.
- **Upload découplé** : les fichiers sont envoyés séparément et l'URL est stockée dans la structure — pas de multipart imbriqué complexe.

## 3. Améliorations futures possibles

- Code-splitting / lazy-loading des routes et import ciblé des icônes Lucide (réduire le bundle).
- Réorganisation drag & drop des services / catégories / prestations (backend déjà prêt via `reorder`).
- Section « Avant / Après » avec slider, module de prise de rendez-vous en ligne.
- Génération dynamique du `sitemap.xml`, cache HTTP / ISR, tests d'intégration frontend (Playwright).
- Rate-limiting, refresh tokens, journalisation d'audit des actions DEV.
- Internationalisation (i18n) et mode sombre pour la vitrine.
- Étendre `SystemConfiguration` (nouvelles sections : intégrations, options d'affichage…) et, si besoin, bascule dynamique de la base API (hors V1, gardée volontairement statique).

## 4. Commandes de lancement

```bash
# 1) Installer les dépendances
cd backend && cp .env.example .env && npm install && cd ..   # MONGODB_URI / DB_* / JWT_SECRET
cd manager && npm install && cd ..
cd vitrine && npm install && cd ..

# 2) Démarrage DEV canonique — UNE seule commande (racine du repo)
npm run dev     # backend http://localhost:6070 · manager :6071 · vitrine :6062
```

Autres scripts : `npm run seed` (backend, ré-applique le seed), `npm test` (migration + smoke),
`npm run db:promote:audit` / `db:promote:dry-run` / `db:promote` / `db:verify-prod`
(promotion TEST→PROD, voir [TEST_TO_PROD_MIGRATION.md](TEST_TO_PROD_MIGRATION.md)),
`npm run build` (chaque front).

## 5. Structure des dossiers

```
backend/  → src/{config,models,services,controllers,middlewares,validators,routes,utils,scripts}
manager/  → src/{lib,types,context,hooks,components/{ui,layout,fields,services},config,pages}
vitrine/  → src/{lib,context,components,pages}
docs/     → ARCHITECTURE.md, API.md, RAPPORT.md, DUPLICATION.md, TEST_TO_PROD_MIGRATION.md
```

## 6. Comptes de test

Le produit ne crée plus aucun compte à mot de passe connu (LOT 2C). Sur une base
vierge, il lit `FIRST_DEV_EMAIL` dans le `.env`, crée UN compte DEV **sans mot
de passe** et lui envoie un lien d'activation à usage unique — le développeur
choisit son secret sur `/activer-mon-compte`.

Les suites de recette, elles, posent leur propre décor dans une base éphémère
(`backend/src/scripts/helpers/testAccounts.helper.js`). Ces identifiants ne
sortent jamais de `scripts/`, et le scan de sécurité
(`legacy-credential-scan.test.js`) le vérifie à chaque exécution.
