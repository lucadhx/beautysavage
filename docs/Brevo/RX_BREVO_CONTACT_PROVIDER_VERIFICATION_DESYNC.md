# RX-BREVO-CONTACT-PROVIDER-VERIFICATION-DESYNC

**Date :** 2026-07-21
**Statut :** ✅ **CERTIFIÉ E2E** — les deux e-mails réels confirmés reçus par l'utilisateur.

---

## 1. Cause racine (prouvée par la base)

Le test manuel et le formulaire lisent **la même notion (`verified`) mais un seul des
deux l'écrit**.

| | Écrit `IntegratedApi.modes.TEST.verified` ? | Lit `verified` ? |
|---|---|---|
| **Test manuel** `POST /email-configuration/test-send` | **NON** (avant ce correctif) — écrivait seulement `EmailConfiguration.modes.TEST.test.*` | non |
| **Bouton « Tester la connexion API »** `POST /integrated-apis/BREVO/modes/TEST/test` | OUI | non |
| **Formulaire** → `SEND_EMAIL` → `getEmailReadiness` | non | **OUI** — `isProviderVerified` |

État réel constaté en base au moment du bug :

```
BREVO.TEST  verified=false  lastTestStatus=null
```

Le test e-mail avait pourtant été **DELIVERED** et reçu. Mais comme ce parcours ne
touchait jamais `verified`, et que le bouton « Tester la connexion » (le seul qui
l'écrivait) n'avait jamais été cliqué, `verified` est resté `false`. Le formulaire,
lui, lit exactement ce drapeau → `PROVIDER_NOT_VERIFIED` → action `SEND_EMAIL`
classée **Abandonnée** (blocker non-retryable, 1/4).

Divergence exacte, en une phrase : **le test qui prouvait la clé n'écrivait pas la
preuve que le formulaire exigeait.**

---

## 2. Correctif — source de vérité unique

### a. `verified` n'a plus qu'UN écrivain, partagé

`markProviderVerified(provider, mode)` / `markProviderUnverified(...)` dans
`integratedApi.service.js` sont désormais les **seuls** à écrire `verified`.
Utilisés par :

- le bouton « Tester la connexion » (`testConnection`, contrôleur) ;
- **l'envoi de test e-mail** (`sendTestEmail`) — nouveau.

Justification (§4 du ticket) : un `POST /smtp/email` **accepté** (201 + messageId)
prouve l'authentification de la clé aussi sûrement qu'un `GET /account`. Laisser
`verified=false` après une acceptation Brevo était factuellement incohérent. Donc :

```
SEND_ACCEPTED  ⇒  markProviderVerified('BREVO', mode)
```

### b. Empreinte de clé — la vérification prouve qu'elle porte sur la clé ACTUELLE

Nouveau champ non sensible `verifiedFingerprint` (sha256 des credentials requis, en
plus de `verifiedAt`). `isProviderVerified` :

- empreinte **présente** → doit correspondre à la clé courante, sinon **périmé** ;
- empreinte **vide** (vérif. antérieure à ce champ) → on fait confiance au drapeau
  (**rétrocompatibilité** : STRIPE.TEST et YOUSIGN.TEST, déjà `verified=true` sans
  empreinte, ne sont pas régressés).

La clé n'est **jamais** stockée en clair ; l'empreinte n'est jamais sérialisée vers
le frontend (elle reste strictement côté serveur).

### c. Changement de clé invalide la preuve (§5)

Deux barrières cumulatives : `updateMode`/`deleteMode` remettent déjà
`verified=false` **et** effacent maintenant `verifiedAt`/`verifiedFingerprint` ; et
même si un chemin l'oubliait, l'empreinte ne correspondrait plus → non vérifié.

### d. Consolidation

`getProviderReadiness` et le gate d'activation PROD (`setActiveMode`) passent
désormais par `isProviderVerified` (au lieu d'une lecture brute du drapeau) : une
seule règle, partout.

---

## 3. Schéma des champs de vérification (avant / après)

```
modes.<MODE>.verified            Boolean   (inchangé)
modes.<MODE>.verifiedAt          Date      ← AJOUTÉ
modes.<MODE>.verifiedFingerprint String    ← AJOUTÉ (sha256, jamais sérialisé)
modes.<MODE>.lastTestedAt/Status/Message/Details  (inchangés)
```

Aucune migration nécessaire : les documents existants ont `verifiedAt=null` et
`verifiedFingerprint=''`, traités en rétrocompatibilité.

---

## 4. Reprise de l'action abandonnée (§7)

`submissionId 3479700e-1028-430e-8118-63de0390fd15`.

Mécanisme **déjà présent**, aucun code neuf : `POST /dev/domain-events/:eventId/retry`
→ `retryEventActions` remet les exécutions `DEAD_LETTER`/`FAILED` en `PENDING`
(attempts=0). L'idempotence est garantie par l'index unique `actionExecutionId` sur
`EmailDelivery` (`sendTemplate` renvoie `alreadySent` sans renvoyer). Les logs
montrent qu'aucun appel Brevo n'a eu lieu pour cette notification → le replay
enverra **exactement une fois**.

Le Manager doit être visité pour déclencher ce retry (bouton « Relancer » sur la
fiche événement), une fois le provider vérifié.

---

## 5. Tests automatisés (verts)

`src/scripts/email-configuration.test.js` — nouvelle section « Vérification du
provider — source de vérité unique » :

- avant test : `verified=false`, formulaire bloqué `PROVIDER_NOT_VERIFIED` ;
- envoi accepté → `verified=true` persisté, `verifiedAt` daté, empreinte 64 hex ;
- formulaire : plus aucun blocage `PROVIDER_NOT_VERIFIED` ;
- isolation : vérifier TEST ne vérifie pas PROD ;
- changement de clé → empreinte différente → périmé → non vérifié ;
- rétrocompat : `verified=true` sans empreinte reste vérifié.

Suites relancées, toutes vertes :

```
integrated-api        64/0
email-configuration  239/0   (+ nouvelle section)
brevo-operational     82/0
contact              262/0
domain-events        206/0
email-delivery       204/0
brevo                 63/0
brevo-webhook        147/0
```

> ⚠️ TESTS AUTOMATISÉS ≠ PREUVE DE RÉCEPTION.

---

## 6. Fichiers modifiés

- `backend/src/models/IntegratedApi.model.js` — `verifiedAt`, `verifiedFingerprint`.
- `backend/src/services/integratedApi.service.js` — `computeCredentialFingerprint`,
  `markProviderVerified`, `markProviderUnverified`, `isProviderVerified` (empreinte),
  `getProviderReadiness` (consolidation).
- `backend/src/controllers/integratedApi.controller.js` — `testConnection` via
  writers partagés, resets étendus, gate PROD via `isProviderVerified`.
- `backend/src/services/emailConfiguration.service.js` — `sendTestEmail` marque le
  provider vérifié après acceptation Brevo.
- `backend/src/scripts/email-configuration.test.js` — section de régression.

---

## 7. E2E réel exécuté (CLI) — le 2026-07-21

Le correctif ne flippe `verified` qu'au **prochain** test-send réussi. Un envoi réel
a donc été exécuté pour appliquer et prouver la correction en base réelle.

### Test A — envoi de test Manager (e-mail réel #1)

| | |
|---|---|
| `verified` AVANT | `false` (état du bug) |
| Expéditeur | `luca.duhoux@lycarz.com` (« Votre Site Web ») |
| Destinataire | `luca.duhoux@gmail.com` |
| messageId | `202607210928.95748401419@smtp-relay.mailin.fr` |
| deliveryId | `af362c5b-1071-4925-8c9a-e5591931b058` |
| Résultat envoi | ACCEPTED |
| **`verified` APRÈS** | **`true`** ← le correctif prend effet |
| **EmailDelivery** | **status=DELIVERED**, `deliveredAt=2026-07-21 11:28:32 CEST` (webhook) |

### Test B — notification de formulaire (e-mail réel #2, replay §7)

Demande existante `submissionId 3479700e-…`, event `b7076f9b-…`, exécution qui était
`DEAD_LETTER / PROVIDER_NOT_VERIFIED`.

| | |
|---|---|
| Replay | `retryEventActions` → exécution repassée puis traitée |
| Exécution | **SUCCEEDED**, attempts=1 |
| EmailDelivery liée | **1 seule** (idempotence `actionExecutionId` ✓) |
| Expéditeur | `luca.duhoux@lycarz.com` |
| Destinataire (entreprise) | `l***@lycarz.com` (résolveur `CONTACT_NOTIFICATION_RECIPIENTS`) |
| Reply-To | `luca.duhoux@gmail.com` (le visiteur — variable `contact.email`) |
| Contenu | Luca Duhoux · luca.duhoux@gmail.com · 0617490017 · INFORMATION · « Bonjour, j'aimerai savoir si je peux avoir un rdv Samedi 5 ? » |
| messageId | `202607210930.97108972039@smtp-relay.mailin.fr` |
| deliveryId | `796168b8-dfb5-4fc7-b09b-98ddfd2cfa67` |
| **EmailDelivery** | **status=DELIVERED**, `deliveredAt=2026-07-21 11:30:03 CEST` (webhook) |

### Confirmation humaine des boîtes — OBTENUE le 2026-07-21

L'utilisateur a confirmé la réception visuelle des deux messages :

- Gmail `luca.duhoux@gmail.com` : « Test de configuration email — Votre Site Web »,
  expéditeur `luca.duhoux@lycarz.com` — **REÇU**.
- Boîte entreprise `…@lycarz.com` : « Nouvelle demande de contact — Luca Duhoux »,
  **REÇU**, et le **Reply-To vise bien `luca.duhoux@gmail.com`** (le visiteur).

---

## Verdict

```
Cause racine identifiée       OUI — désync verified (écrit par un parcours, lu par l'autre)
Correctif appliqué            OUI — source de vérité unique + empreinte
Tests automatisés             239 réussis, 0 échoué (email-configuration) + suites voisines vertes
From authentifié              lycarz.com (plus de réécriture vers *.brevosend.com)
Test A (test Manager)         ACCEPTED -> DELIVERED (webhook) -> REÇU Gmail (humain)
Test B (notif formulaire)     ACCEPTED -> DELIVERED (webhook) -> REÇU entreprise (humain)
Idempotence du replay         CONFIRMÉE — 1 seule EmailDelivery, exécution SUCCEEDED
Reply-To visiteur             CONFIRMÉ
Verdict                       ✅ CERTIFIÉ E2E POUR LES BOÎTES TESTÉES
```

Certifié pour les deux boîtes testées (Gmail + entreprise lycarz.com), en mode
fournisseur TEST, à la date du 2026-07-21. La certification vaut pour ces boîtes et
cette configuration ; elle ne préjuge pas du mode PROD (compte/expéditeur distincts).
