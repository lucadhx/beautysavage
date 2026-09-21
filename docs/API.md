# API — Karting di a Gravona

Base URL : `http://localhost:6070/api` (backend DEV canonique)

Réponses : `{ "success": true, "data": ... }` ou `{ "success": false, "message": "...", "details": [...] }`.

Auth : header `Authorization: Bearer <token>` (sauf `/public/*`, `/meta`, `/auth/login`).

## Public (vitrine — sans auth)

| Méthode | Endpoint                     | Description                                  |
| ------- | ---------------------------- | -------------------------------------------- |
| GET     | `/public/bootstrap`          | Tout le contenu public : `company`, `theme`, `siteStatus`, `developer`, **`chapters` (ENTIERS, volets compris)**, **`pages` (entrées seules, sans blocs)**, `network {backendUrl, websiteUrl}`, `legalDocuments` |
| GET     | `/public/chapters/:slug`     | Un chapitre par son slug — porte de secours, la vitrine lit le bootstrap |
| GET     | `/public/pages/:slug`        | Le CONTENU d'une page éditoriale — hors bootstrap, parce qu'il pèse |
| GET     | `/public/network-configuration` | Section réseau filtrée (`backendUrl`, `websiteUrl`) — jamais l'URL du manager |
| GET     | `/meta`                      | Catalogue médias, rôles, modes de tarif, **jours de la semaine, fuseau par défaut, limites promo** |

### Contact (public, sans auth)

| Méthode | Endpoint | Description |
| ------- | -------- | ----------- |
| POST | `/public/contact` | Dépose une demande de contact — **seule écriture publique** |

- **Entrée** : `{ name, email, phone?, reason, message, pageUrl?, clientSubmissionId?, website?, formStartedAt? }`.
  `reason` est un **code** (`INFORMATION`, `QUOTE`, `WEBSITE_ISSUE`,
  `SERVICE_QUESTION`, `OTHER`). `.strict()` : un champ inconnu → **400**.
- **Sortie** : `{ submissionId }` — **rien d'autre**. Ni état de l'e-mail, ni
  identifiant interne, ni destinataire.
- **201 même si la notification échoue** : la demande est enregistrée d'abord,
  l'e-mail est un effet secondaire. **Une demande enregistrée n'est jamais annulée
  par un échec de notification.**
- **Anti-abus** : honeypot (`website`), délai de saisie (`formStartedAt`), plafond
  global, rate limit par IP (5 / 15 min). Un rejet renvoie un **succès neutre**
  avec un `submissionId` qui ne correspond à rien.
- **Idempotence** : `clientSubmissionId` (UUID) — rejouer renvoie la demande
  existante, sans second e-mail.
- **Codes d'erreur** : `CONTACT_NAME_REQUIRED`, `CONTACT_EMAIL_INVALID`,
  `CONTACT_REASON_INVALID`, `CONTACT_MESSAGE_REQUIRED`,
  `CONTACT_MESSAGE_TOO_LONG`, `CONTACT_PAGE_URL_INVALID`, `CONTACT_RATE_LIMITED`.

Détails : [CONTACT_FORM.md](CONTACT_FORM.md).

## Auth

| Méthode | Endpoint          | Rôle  | Description                       |
| ------- | ----------------- | ----- | --------------------------------- |
| POST    | `/auth/login`         | —     | Connexion → `{ token, user }`     |
| GET     | `/auth/me`            | auth  | Utilisateur courant               |
| PATCH   | `/auth/password`      | auth  | Changer son mot de passe          |
| GET     | `/auth/test-accounts` | —     | Comptes + rôles (**TEST uniquement**, sinon `enabled:false`) |
| POST    | `/auth/dev-login`     | —     | Connexion instantanée sans mot de passe (**TEST uniquement**, 403 en PROD) |

## Entreprise / contenu (ADMIN + DEV)

| Méthode | Endpoint             | Rôle   | Description                       |
| ------- | -------------------- | ------ | --------------------------------- |
| GET/PUT | `/company`           | ADMIN  | Coordonnées, médias, logos        |
| GET     | `/chapters`          | auth   | Liste des chapitres               |
| GET     | `/chapters/:id`      | auth   | Détail d'un chapitre              |
| POST    | `/chapters`          | ADMIN  | Créer (slug dérivé du titre)      |
| PUT     | `/chapters/:id`      | ADMIN  | Mettre à jour — le slug ne bouge PAS |
| PATCH   | `/chapters/reorder`  | ADMIN  | Réordonner le menu (`navOrder`)   |
| DELETE  | `/chapters/:id`      | ADMIN  | Supprimer                         |
| PUT     | `/company`           | ADMIN  | Entreprise (+ horaires `businessHours` + `timezone`) |
| GET/PUT | `/theme/vitrine`     | ADMIN  | Thème du site (palette 4 couleurs)|
| GET     | `/site-status`       | auth   | Statut du site                    |
| GET     | `/dev-company`       | auth   | Infos entreprise dév. (page Support, lecture) |
| GET     | `/team`              | auth   | Personnes de l'entreprise dév. (page Support, lecture) |
| POST    | `/uploads/image?mediaType=` | auth | Upload image (multipart `file`) — `mediaType` **requis** |
| POST    | `/uploads/favicon`   | auth   | Upload favicon                    |
| DELETE  | `/uploads/image/:filename` | auth | Retirer un média (refusé s'il est encore référencé) |

> **Une seule autorité média** — le backend **déployé** du projet détient les
> fichiers ; toute autre instance (un poste de développement) **relaie** et
> n'écrit rien. Si le relais échoue, l'import échoue : se rabattre sur le disque
> local recréerait les deux vérités que l'autorité unique supprime. Un relais qui
> reçoit un **404** sur une route que cette version expose signale une autorité
> **plus ancienne que ce client** (`PROJECT_MEDIA_AUTHORITY_OUTDATED`) — il faut
> redéployer le backend, pas corriger la saisie.

> **Cycle de vie des fichiers** — un média que **plus aucune fiche ne rend** est
> retiré du disque, et son descripteur marqué supprimé (l'adresse répond alors
> **410**, jamais un 404 muet).
>
> Le relevé des références lit toutes les collections de `DB_TEST` ∪ `DB_PROD`,
> et reconnaît les **deux** façons dont une fiche désigne un média : le chemin
> `/uploads/<fichier>`, et la **clé d'objet nue** que porte un descripteur
> (`mediaDescriptorSchema` n'a délibérément pas de chemin). L'inventaire
> `ProjectMedia` est **exclu** du relevé — il DÉCRIT les objets, il ne les
> consomme pas ; l'y inclure faisait que chaque fichier se référençait lui-même,
> et le balayage ne supprimait donc jamais rien.
>
> Deux déclencheurs : après toute mutation réussie (débattu), et un **concierge**
> périodique (6 h) qui ne tourne que sur l'**autorité** — la plupart des mutations
> viennent d'un poste qui n'a pas les fichiers, et sans lui le serveur pouvait
> rester des semaines sans jamais regarder son dossier.
>
> Une période de grâce d'une heure protège les imports récents : le Manager envoie
> le fichier **avant** que la fiche ne soit enregistrée. Nettoyage manuel :
> `npm run uploads:cleanup` (dry-run) / `uploads:cleanup:apply`.
>
> Recette : `node src/scripts/project-media.test.js`, section « le balayage
> anti-orphelins ».

## Contenu du site (ADMIN + DEV)

| Méthode | Endpoint             | Rôle   | Description                       |
| ------- | -------------------- | ------ | --------------------------------- |
| CRUD    | `/chapters`          | ADMIN  | Le récit du site — volets, mise en page, phrase de clôture (+ `PATCH /reorder`) |
| CRUD    | `/pages`             | ADMIN  | Pages éditoriales à blocs (+ `PATCH /reorder`) |

`GET` est ouvert à tout compte authentifié ; **toute écriture est ADMIN**.
`PATCH /reorder` est déclaré AVANT `/:id` dans chaque routeur — sinon
« reorder » serait capturé comme un identifiant.

> **Les neuf référentiels du moteur karting ont été RETIRÉS**, pas désactivés :
> `/services`, `/pricing-ranges`, `/karts`, `/circuits`, `/reviews`, `/faqs`,
> `/before-after`, `/promotions` et `/live-timing` répondent 404. Voir
> [SIMPLIFICATION.md](SIMPLIFICATION.md).

## DEV uniquement

| Méthode | Endpoint                      | Description                          |
| ------- | ----------------------------- | ------------------------------------ |
| GET/PUT | `/theme/manager`              | Thème du back-office                 |
| POST    | `/site-status/suspend`        | Suspendre le site (motif optionnel)  |
| POST    | `/site-status/reactivate`     | Réactiver le site                    |
| PUT     | `/dev-company`                | Modifier l'entreprise dév. (lecture ouverte, cf. ci-dessus) |
| POST/PUT/DELETE | `/team`               | Gérer l'équipe dév. (lecture ouverte, cf. ci-dessus) |
| CRUD    | `/accounts`                   | Comptes ADMIN / DEV                  |
| GET     | `/system-configuration/network`      | Lire la config réseau (backend/manager/website + `updatedBy`) |
| PUT     | `/system-configuration/network`      | Modifier (URL normalisées, rafraîchit le cache CORS) |
| POST    | `/system-configuration/network/test` | Tester la joignabilité des 3 URL (SSRF-safe) |

CRUD = `GET /` (liste), `POST /`, `PUT /:id`, `DELETE /:id`.

### Demandes de contact (ADMIN + DEV)

| Méthode | Endpoint | Description |
| ------- | -------- | ----------- |
| GET | `/admin/contact-submissions` | Liste paginée (curseur) + compteurs + état de notification |
| GET | `/admin/contact-submissions/:submissionId` | Détail — **marque la 1ʳᵉ lecture** |
| PATCH | `/admin/contact-submissions/:submissionId/status` | `{ status }` — transition |
| PATCH | `/admin/contact-submissions/:submissionId/assignment` | `{ userId }` — `null` désassigne |

- **Ni `POST` ni `DELETE`** : une demande est un fait déposé par un visiteur ;
  `ARCHIVED` la sort du flux sans détruire.
- **Filtres** (`.strict()`) : `status`, `reason`, `search`, `from`, `to`,
  `limit` (≤ 100), `cursor`.
- **Pagination par curseur** (`submittedAt`), pas `skip` : une demande arrivant
  entre deux pages ne fait pas sauter de ligne.
- Le détail renvoie `allowedTransitions` : **le serveur décide**, le Manager ne
  recopie pas la table.
- Transition interdite → **400** `CONTACT_STATUS_TRANSITION_INVALID`.

Détails : [CONTACT_SUBMISSIONS.md](CONTACT_SUBMISSIONS.md).

### Templates e-mail (DEV)

| Méthode | Endpoint | Description |
| ------- | -------- | ----------- |
| GET | `/dev/email-templates` | Liste (sans le HTML) — ordre du **registre**, pas de la base |
| GET | `/dev/email-templates/registry` | Introspection du code (aucune valeur) |
| GET | `/dev/email-templates/:templateId` | Détail + variables + **validation calculée** |
| PUT | `/dev/email-templates/:templateId` | Éditer — **`expectedVersion` obligatoire** |
| POST | `/dev/email-templates/:templateId/preview` | Rendu avec données **fictives** — **n'envoie rien** |
| POST | `/dev/email-templates/:templateId/test-send` | Envoi **réel** (`{ recipientEmail }`) |
| GET | `/dev/email-templates/:templateId/readiness` | Prérequis d'envoi (blocages / avertissements) |
| GET | `/dev/email-templates/:templateId/deliveries` | Journal (50 derniers, adresses masquées) |
| GET | `/dev/email-templates/:templateId/versions` | Historique |
| GET | `/dev/email-templates/:templateId/versions/:version` | Une version + sa validité **aujourd'hui** |
| POST | `/dev/email-templates/:templateId/versions/:version/restore` | Restaurer → **crée une nouvelle version** |

- **Ni `POST /` ni `DELETE`** : les identifiants viennent du code. `templateId` est
  un `z.enum` du registre — un ID inventé renvoie **400**, pas 404.
- **`PUT` sans `expectedVersion`** → 400. **Version périmée** → **409** avec
  `details.code = VERSION_CONFLICT` et `details.currentVersion`.
- **`preview`** renvoie **200 même sur un template invalide** (`validation.valid:
  false`, `html: null`) : un 400 ferait clignoter l'éditeur à chaque frappe.
- **`test-send`** : refus **avant** tout appel Brevo si la readiness bloque —
  `400` avec `details.code` (ex. `EMAIL_SENDER_NOT_VERIFIED`). Succès :
  `« L'email a été accepté par Brevo pour envoi. »` — **jamais « délivré »**.

Détails : [EMAIL_TEMPLATES.md](EMAIL_TEMPLATES.md) ·
[EMAIL_DELIVERY.md](EMAIL_DELIVERY.md) ·
[EMAIL_TEMPLATE_EDITOR.md](EMAIL_TEMPLATE_EDITOR.md).

### Configuration réseau (V1)

- **URL = origines uniquement** (`https://api.domaine.com`), sans chemin/query/identifiants ; slash final normalisé. Protocoles `http`/`https` seulement.
- **Test SSRF-safe** : DNS résolu + refus des IP loopback/privées/link-local/metadata, timeout 5 s, HEAD→GET sans téléchargement du corps, aucune redirection suivie. En **TEST** `localhost`/loopback sont autorisés ; en **PROD** ils sont refusés.
- **CORS dynamique** : `CORS_ORIGINS` (.env) reste la liste de secours ; `managerUrl`/`websiteUrl` configurées sont ajoutées et rafraîchies après chaque sauvegarde (cache mémoire).
- **`VITE_API_URL`** (fronts) fournit l'URL backend **initiale** ; les valeurs du singleton servent aux liens applicatifs et à la résolution des médias. Aucun secret n'est stocké en base.

## Opérations base de données (CLI, hors HTTP)

La **promotion des données TEST → PROD** ne passe **pas** par l'API HTTP (copie
directe MongoDB, plus sûre et fidèle). Scripts backend dédiés :

| Commande | Effet |
| -------- | ----- |
| `npm run db:promote:audit` | Compare TEST/PROD (lecture seule). |
| `npm run db:promote:dry-run` | Simule la migration (aucune écriture). |
| `npm run db:promote -- --reset-prod` | Migration réelle (confirmation `PROMOTE TEST TO PROD`). |
| `npm run db:verify-prod` | Vérifie la parité TEST/PROD (lecture seule). |

TEST n'est jamais modifiée. Détails : [TEST_TO_PROD_MIGRATION.md](TEST_TO_PROD_MIGRATION.md).

## IntegratedAPI, contrats, facturation & webhooks

Modules ajoutés (voir docs dédiées) :

| Préfixe | Rôle | Doc |
| --- | --- | --- |
| `/api/deployment/runs/active` | DEV — découverte du run en cours (`active`) et du dernier terminé (`latest`) | [ARCHITECTURE.md](ARCHITECTURE.md#couche-déploiement--le-travail-appartient-au-backend) |
| `/api/deployment/runs/:id/observe` | DEV — observation NDJSON d'un run, lecture seule et reconnectable | [PROTOCOL.md](PROTOCOL.md#incident--déploiement) |
| `/api/panel-bridge` · `/api/project-bridge` | Appairage Panel (sortant) et surface appelée par le Panel (entrant) | [PANEL_BRIDGE.md](PANEL_BRIDGE.md) |
| `/healthz` · `/readyz` | Disponibilité : `STARTING` → `READY` → `DRAINING` | [PROTOCOL.md](PROTOCOL.md#démarrage-normal) |
| `/api/email-configuration` | DEV — nom d'expéditeur, adresse support, envoi de test | [EMAIL_CONFIGURATION.md](EMAIL_CONFIGURATION.md) |
| `/api/dev/domain-events` | DEV — journal des événements métier (**lecture seule**, + retry des échecs) | [DOMAIN_EVENTS.md](DOMAIN_EVENTS.md) |
| `/api/contracts` | DEV — cycle de vie contrat (PDF, zones, validation, signature) | [CONTRACTS.md](CONTRACTS.md) |
| `/api/my-contract` | ADMIN — parcours d'activation (signature, paiements, activation) | [CONTRACT_ACTIVATION_FLOW.md](CONTRACT_ACTIVATION_FLOW.md) |
| `/api/my-invoices` · `/api/invoices` | Factures (ADMIN / DEV) | [STRIPE_INTEGRATION.md](STRIPE_INTEGRATION.md) |
| `/api/webhooks/stripe` · `/api/webhooks/yousign` | Webhooks signés & idempotents (corps brut) | [WEBHOOKS.md](WEBHOOKS.md) |
| `/api/site-status` | Suspension technique + réconciliation contractuelle | [CONTRACT_ENFORCEMENT_ROLLOUT.md](CONTRACT_ENFORCEMENT_ROLLOUT.md) |

Réponse d'erreur structurée du prérequis d'intégrations (création de contrat) :
`{ code: "INTEGRATIONS_NOT_READY", missing: ["STRIPE","YOUSIGN"] }`.

## Signature Yousign (contrats)

Endpoints ajoutés pour le parcours de signature (voir [SIGNATURE.md](SIGNATURE.md)) :

| Méthode | Route | Rôle | Effet |
| --- | --- | --- | --- |
| POST | `/api/contracts/:id/start-dev-signature` | DEV | Crée la demande Yousign, renvoie le lien DEV |
| POST | `/api/contracts/:id/restart-signature` | DEV | Relance une signature en échec (FAILED→PENDING_DEV_SIGNATURE) |
| GET | `/api/contracts/:id/timeline` | DEV | Timeline (audit) du contrat |
| POST | `/api/contracts/:id/sync` | DEV | Réconcilie Yousign + Stripe (lecture seule chez le fournisseur, ne crée rien) |
| GET | `/api/my-contract/timeline` | ADMIN | Timeline du contrat de l'ADMIN |

Scripts : `npm run contracts:sync` (sync globale), `npm run yousign:test` (smoke
sandbox réel), `npm run test:yousign-flow` (test end-to-end mocké).

## Frais de lancement Stripe (paiement unique)

Voir [STRIPE_LAUNCH_FEE_FLOW.md](STRIPE_LAUNCH_FEE_FLOW.md).

| Méthode | Route | Rôle | Effet |
| --- | --- | --- | --- |
| POST | `/api/my-contract/create-launch-checkout` | ADMIN | Crée/réutilise la Checkout Session (gate backend, montant TTC verrouillé) |
| GET | `/api/my-contract/launch-fee-status` | ADMIN | Statut des frais (sans donnée Stripe sensible) |
| GET | `/api/contracts/:id/payments` | DEV | Journal des paiements du contrat |
| POST | `/api/contracts/:id/sync-payment` | DEV | Réconcilie les frais avec Stripe (aucun paiement créé) |

Gate refusé → `{ "success": false, "code": "LAUNCH_FEE_NOT_PAYABLE", "details": { "missing": [...] } }`
(codes : `CONTRACT_NOT_VALIDATED`, `CONTRACT_NOT_FULLY_SIGNED`,
`LAUNCH_FEE_NOT_CONFIGURED`, `LAUNCH_FEE_ALREADY_PAID`).

Scripts : `npm run payments:sync` (réconciliation globale),
`npm run stripe:test:launch-fee -- <contractId>` (sandbox TEST réel),
`npm run test:payments` (test mocké de bout en bout).

## Abonnement Stripe, activation & résiliation

Voir [STRIPE_SUBSCRIPTION_FLOW.md](STRIPE_SUBSCRIPTION_FLOW.md) et
[SITE_CONTRACT_ENTITLEMENT.md](SITE_CONTRACT_ENTITLEMENT.md).

| Méthode | Route | Rôle | Effet |
| --- | --- | --- | --- |
| POST | `/api/my-contract/create-subscription-checkout` | ADMIN | Crée/réutilise la souscription (Price immuable, gate backend) |
| GET | `/api/my-contract/subscription-status` | ADMIN | Statut abonnement (sans donnée Stripe sensible) |
| POST | `/api/my-contract/activate` | ADMIN | Activation finale du site (revérifiée, unicité) |
| POST | `/api/my-contract/cancel` | ADMIN | Résiliation en fin de période |
| POST | `/api/contracts/:id/cancel` | DEV | Résiliation en fin de période |
| POST | `/api/contracts/:id/sync-subscription` | DEV | Réconcilie l'abonnement + le site (aucun abonnement créé) |

Gate refusé → `{ "success": false, "code": "SUBSCRIPTION_NOT_PAYABLE", "details": { "missing": [...] } }`
(codes : `CONTRACT_NOT_FULLY_SIGNED`, `LAUNCH_FEE_NOT_PAID`,
`SUBSCRIPTION_NOT_CONFIGURED`, `SUBSCRIPTION_ALREADY_ACTIVE`).

Scripts : `npm run subscriptions:sync`, `npm run contracts:verify-entitlements`,
`npm run stripe:test:subscription -- <contractId>`, `npm run test:subscriptions`.

## Facturation Stripe (historique & PDF)

Voir [STRIPE_BILLING.md](STRIPE_BILLING.md). Miroir des factures Stripe (hosted
invoice + PDF) — aucune facture n'est créée par l'app.

| Méthode | Route | Rôle | Effet |
| --- | --- | --- | --- |
| GET | `/api/my-invoices` | ADMIN | Historique de ses contrats (paiements + factures) |
| GET | `/api/invoices` | DEV | Vue globale |
| GET | `/api/invoices/:id` | DEV / ADMIN (son contrat) | Détail d'une facture (liens hosted/PDF) |
| POST | `/api/contracts/:id/sync-invoices` | DEV | Backfill des factures Stripe du contrat |

Script : `npm run invoices:sync` (backfill global), `npm run test:billing`.
