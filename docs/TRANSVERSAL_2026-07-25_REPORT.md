# Chantier transversal 2026-07-25 — duplication, MongoDB, typographie, contrats, signature, mot de passe oublié, réservation

> Branche `feat/unified-production-baseline`, base `6e1cad6` (chantier webhooks
> uniformisés, préservé intégralement). Aucun worktree, aucune version
> parallèle, aucun `push --force`.

## 1. URL canonique du dépôt GitHub (`PROJECT_GITHUB_REPOSITORY_URL`)

- **Variable** : `PROJECT_GITHUB_REPOSITORY_URL` — forme canonique
  `https://github.com/<owner>/<repo>.git` (celle du remote réel et du guide
  VPS). Documentée dans `backend/.env.example`, exposée `config.githubRepositoryUrl`
  (facultative sur les instances existantes, jamais de défaut inventé).
- **Validation centralisée** : `backend/src/utils/githubRepositoryUrl.js`
  (`validateGithubRepositoryUrl` / `normalizeGithubRepositoryUrl`) — HTTPS
  github.com uniquement, owner+repo obligatoires, credentials/token refusés et
  JAMAIS réfléchis dans les messages, normalisation espaces/slash/`.git`.
  Miroir front : `manager/src/lib/githubRepositoryUrl.ts`.
- **Duplication** : champ OBLIGATOIRE du wizard (étape Projet — aide, exemple,
  validation en direct, normalisation affichée, récapitulatif). C'est l'URL du
  dépôt CIBLE de la copie — celle du dépôt source n'est JAMAIS recopiée
  (`rewriteEnv` remplace toute valeur héritée). Écriture ATOMIQUE (tmp+rename)
  puis VÉRIFICATION post-duplication : clé présente exactement une fois, valeur
  normalisée, `.env` lisible. Rapport : `githubRepositoryUrl` + `envCheck`.
- Pas de création de dépôt GitHub ni de token : hors périmètre, aucune
  fonctionnalité canonique existante.

## 2. MongoDB — audit et initialisation canonique

**Le moteur créait-il déjà les bases ?** OUI — mais via un marqueur artificiel
(`_deployment_marker`, upsert si base absente). **Maintenant** :
`initializeDatabase` / `initializeDuplicatedProjectDatabases` (idempotentes) :
index Mongoose RÉELS de tous les modèles connus (collections matérialisées par
le mécanisme même de l'application), singleton `SystemConfiguration`
(`$setOnInsert`, défauts canoniques), suppression du marqueur historique,
vérification réelle de la présence, fermeture propre.

**L'URI suffit-elle ?** OUI : dans un cluster existant, l'URI + les droits
d'écriture du database user suffisent — une base logique naît à la première
écriture. **Aucune clé Atlas Administration API ajoutée** ; elle ne serait
requise QUE pour administrer cluster/projet/database users/network access —
hors périmètre. Erreurs structurées : `MONGO_CONNECTION_FAILED`,
`MONGO_AUTHENTICATION_FAILED`, `MONGO_DATABASE_INITIALIZATION_FAILED`,
`MONGO_INDEX_INITIALIZATION_FAILED`, `MONGO_DATABASE_NAME_INVALID` — URI
toujours masquée (`maskMongoUri`).

## 3. Typographie de la vitrine

- `theme.typography.{headingFont,bodyFont}` : IDS d'un **catalogue allowlist**
  de 12 polices (`backend/src/utils/fontCatalog.js`, enum Mongoose — jamais une
  famille CSS libre). Défauts = rendu historique exact (Poppins/Inter) : les
  thèmes antérieurs ne changent pas (défauts appliqués à la lecture, zéro
  migration).
- Manager : carte « Typographie » (`FontField` custom — chaque police rendue
  dans sa propre police, clavier, clic extérieur, listbox accessible) + aperçu
  vitrine mis à jour immédiatement sans sauvegarde.
- Vitrine : `--font-heading`/`--font-body` appliquées globalement (body,
  h1-h4, Tailwind, hero) ; UN `<link>` Google Fonts reconstruit depuis le
  catalogue (URL jamais arbitraire, `display=swap`, fallbacks : pas de flash
  bloquant ; Inter/Poppins préchargées). Ajout d'une police = une entrée dans
  les trois catalogues (backend = autorité).

## 4. Contrats — mise en service + abonnement mensuel/annuel

- Modèle canonique conservé : `pricing.launchFee` (frais de mise en service,
  paiement unique) + `pricing.subscription` avec **`interval: MONTH | YEAR`**.
  MENSUEL : montant débité chaque mois. ANNUEL : montant TOTAL débité EN UNE
  FOIS pour douze mois — jamais stocké divisé.
- `monthlyEquivalentCents()` : équivalent mensuel PUREMENT INFORMATIF
  (centimes entiers, arrondi explicite ; 76800/12 = 6400). AUCUNE remise
  automatique nulle part.
- Stripe : `setup fee` en mode payment (inchangé) + subscription
  `interval=month|year` ; Price immuable — cache et idempotence invalidés par
  version+périodicité+montant ; métadonnées contrat conservées ; webhooks
  inchangés. Résiliation : `cancel_at_period_end` (mensuel comme annuel) —
  droits maintenus jusqu'à la fin de la période réglée, statut
  `CANCEL_AT_PERIOD_END`, date de fin visible, pas de remboursement
  automatique.
- Previews ADMIN/DEV : « Facturé en une fois : X € TTC par an — équivalent :
  Y € TTC/mois » (annuel) / « Facturé : X € TTC chaque mois » (mensuel).

## 5. Signature facultative

- `signatureRequirement: REQUIRED | NOT_REQUIRED` (défaut REQUIRED — contrats
  antérieurs inchangés). Décision EXPLICITE dans la configuration du contrat
  (radio + confirmation + libellé « déjà signé ou aucune signature
  supplémentaire requise »).
- NOT_REQUIRED : validation sans zones ni signataires, `DRAFT → INACTIVE`
  direct, PDF uploadé conservé, AUCUN appel ni credential Yousign
  (`startDevSignature` → `SIGNATURE_NOT_REQUIRED`), paiements gardés par
  `signatureSatisfied` (jamais bloqués sur un statut Yousign inexistant),
  étapes signature ABSENTES de la guideline/du parcours/du « Étape X sur N »
  (jamais affichées comme « ignorées »).
- Invariants : bascule vers NOT_REQUIRED REFUSÉE si une procédure Yousign
  existe (`SIGNATURE_REQUEST_ACTIVE` — pas de données orphelines) ; parcours
  REQUIRED (Yousign) strictement inchangé (42 ✓ non-régression).

## 6. Mot de passe oublié

- `POST /api/auth/forgot-password` (public, rate-limité, réponse TOUJOURS
  générique — zéro énumération) ; `POST /api/auth/reset-password`.
- Token 32 octets aléatoires ; base = SEUL le hash SHA-256
  (`User.passwordReset`, `select:false`, absent de `toJSON`, jamais loggé) ;
  expiration configurable (`PASSWORD_RESET_TTL_MINUTES`, déf. 60) ; usage
  unique ; nouvelle demande = invalidation de l'ancienne ; bcrypt via le
  `pre('save')` canonique.
- E-mail : template `PASSWORD_RESET_REQUEST` (registre code-first, bouton,
  validité, consigne d'ignorer, URL de secours, jamais de mot de passe),
  envoyé par le système transactionnel canonique ; URL construite depuis
  `SystemConfiguration.network.managerUrl` (TEST/PROD corrects, jamais de
  localhost codé en dur ; non configurée → réponse générique, zéro envoi).
- Manager : « Mot de passe oublié ? » sur la connexion + pages publiques
  `/mot-de-passe-oublie` et `/reinitialiser-mot-de-passe` (états invalide/
  expiré/déjà utilisé/succès, re-demande, retour connexion).
- Limite documentée : sessions JWT stateless — pas de révocation des tokens
  déjà émis (expiration naturelle 7 j).

## 7. Liens de réservation

- `bookingUrl` facultatif (`null` par défaut, compat sans migration) sur les
  PACKS et PRESTATIONS COMPLÉMENTAIRES (le schéma partagé le rend disponible
  aux suppléments, non exposé dans l'UI). Validateur partagé
  (`backend/src/utils/bookingUrl.js`) : HTTPS uniquement,
  `javascript:`/`data:`/`file:`/credentials/injection refusés, longueur max,
  query params des liens signés PRÉSERVÉS tels quels.
- Manager : champ « Réservation » (éditeur de pack + chaque prestation) —
  validation immédiate, aperçu du bouton, ouvrir, supprimer.
- Vitrine : bouton « Réserver » UNIQUEMENT quand l'URL existe (jamais vide ni
  désactivé) — accent + police du thème, `target="_blank"
  rel="noopener noreferrer"`, aria-label signalant le service externe, URL
  brute jamais affichée. Pas de nouveau système analytics (aucun n'existe).

## 8. Migrations et compatibilité

Toutes par DÉFAUTS de schéma appliqués à la lecture (aucun script requis) :
`signatureRequirement` → REQUIRED ; `interval` → MONTH ; `typography` →
Poppins/Inter ; `bookingUrl` → null ; `PROJECT_GITHUB_REPOSITORY_URL` absente
tolérée (obligatoire en duplication uniquement).

## 9. RBAC

Aucun droit élargi : thème ADMIN, services ADMIN, contrats/duplication DEV,
conditions commerciales et mode de signature DEV (routes contrats existantes),
mot de passe oublié public rate-limité. Vérifié par les suites existantes
(401/403) + nouvelles.

## 10. Tests (résultats réels)

| Suite | Résultat |
|---|---|
| duplication (URL GitHub + init Mongo) | 65 ✓ |
| auth-password-reset | 25 ✓ |
| booking-url | 18 ✓ |
| theme-typography | 12 ✓ |
| contract-billing-signature | 31 ✓ |
| email-templates (5 templates) | 222 ✓ |
| email-delivery (5 templates) | 204 ✓ |
| Non-régression contrats (7 suites) | 44+45+42+64+69+73+46 ✓ |
| fontCatalog (manager) | 10 ✓ |
| Chaîne backend complète (`npm test`) | EXIT=0, zéro échec |
| Chaîne manager (`npm test` : tsc + suites) | verte |
| Vitrine (`npm test`) | 68 ✓ |
| Builds production vitrine / manager | ✓ 6.00s / ✓ 9.11s |

## 11. Recette réelle (2026-07-25)

La pile dev de l'utilisateur occupait déjà 6070/6071/6062 (jamais tuée —
règle absolue). Recette sur backend éphémère `PORT=6170 node src/server.js`
(même code, même base TEST) :

- `GET /health` → 200 `{status:'ok', env:'TEST'}` ; bootstrap propre
  (templates e-mail réconciliés — 5, zéro orphelin ; webhooks Brevo/Stripe/
  Yousign gérés comme au chantier précédent).
- `GET /api/public/bootstrap` → `theme.typography = {headingFont:'poppins',
  bodyFont:'inter'}` (rendu historique préservé).
- `POST /api/auth/forgot-password` (e-mail inconnu) → 200 générique « Si un
  compte correspond… » — zéro énumération, zéro envoi.

La pile utilisateur (ancien code) reflétera ce chantier à son prochain
redémarrage `npm run dev`.
