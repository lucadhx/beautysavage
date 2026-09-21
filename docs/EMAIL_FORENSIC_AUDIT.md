# EMAIL_FORENSIC_AUDIT — Suivi de livraison Brevo

> Audit forensique. Objectif : prouver LA cause, pas la deviner.
> **Statut : RÉSOLU par preuve empirique (rapport de diagnostic réel du
> 2026-07-19).** La cause documentaire pressentie (`error`) a été **RÉFUTÉE** par
> les données ; la vraie cause est `sent`. Correctif appliqué. Détail ci-dessous.

## ⚑ MISE À JOUR — preuve empirique & résolution (2026-07-19)

Le diagnostic autonome exécuté contre l'API Brevo RÉELLE a tranché — et corrigé
mon hypothèse documentaire :

**Symptôme B (boucle « Désynchronisé ») — CAUSE RÉELLE = `sent`, pas `error`.**
Le rapport montre `remoteEvents` = `["request","request","delivered",…,"error",…]`
avec `missingExpectedAtBrevo: ["SENT"]`. Faits prouvés, contraires à la doc :
- Brevo **conserve** `error` (présent dans `remoteEvents`) → `error` n'était PAS
  le problème (hypothèse §3 initiale réfutée) ;
- Brevo **remplace `sent` par `request`** (on lit `request` deux fois, aucun
  `sent`) → l'événement attendu `SENT` est éternellement « manquant » → divergence
  permanente → boucle.
**Correctif appliqué** : `sent` retiré de `SUBSCRIBED_CONFIG_EVENTS` (redondant :
`request` couvre « accepté »). `error` conservé (Brevo l'accepte). Après retrait,
`expected ⊆ remote` → plus de divergence. `BREVO_VALID_CONFIG_EVENTS` corrigé pour
refléter le réel (sans `sent`, avec `error`).

**Symptôme A (« Accepté » éternel) — correlation FONCTIONNE.** Le rapport montre
les livraisons de test qui **transitionnent** (`DEFERRED`, `SOFT_BOUNCED`,
`DELIVERED`) et le test live atteignant `DELIVERED`. La corrélation
`(provider, mode, providerMessageId)` fonctionne (les chevrons `<…>` sont gérés
par `bracketVariants`). Le « Accepté éternel » observé précédemment venait de la
boucle B (qui faisait croire le suivi cassé) et, pour certains envois, d'un état
`DEFERRED` légitime (greylisting) — pas d'un bug de corrélation. Restait une
imprécision dans le diagnostic lui-même (`webhookReceived:false` alors que la
livraison était `DELIVERED`) : la sonde live interrogeait le messageId **avec**
chevrons vs stocké **sans** → **corrigée** (`messageIdVariants`).

**« Non corrélés » — clarifié (2ᵉ rapport).** Le 2ᵉ diagnostic (après retrait de
`sent`) confirme B **résolu** (`differences:[]`, « aligné ») et A **fonctionnel**
(test live « Webhook reçu en 5 s → DELIVERED »). Restait un verdict
`WEBHOOK_NOT_CORRELATED` dû à 13 événements orphelins (messageId `…191944`,
`…191937`) **sans `EmailDelivery`** — des envois antérieurs/hors pipeline de test,
donc rien à corréler. Ces orphelins auraient gardé le diagnostic « rouge » à vie.
**Correctif du diagnostic** : la vérification de réception PARTITIONNE désormais
les non-corrélés en `unmatchedWithDelivery` (vrai bug → `WEBHOOK_NOT_CORRELATED`)
vs `unmatchedWithoutDelivery` (orphelins → **bénin**, réception OK). Le verdict de
ton cas réel passe donc à **HEALTHY**. (Les orphelins restent inertes ; rien à
nettoyer — `npm run brevo:webhooks:reconcile` ne les matchera pas faute de
livraison, ce qui est correct.)

Le reste du document conserve le raisonnement initial (dont l'hypothèse `error`
réfutée) à titre de trace forensique.

## ⚑ MISE À JOUR 2 — expéditeur invalide « Accepté » à vie (2026-07-20)

**Reproduction automatisée d'abord.** Un harnais rejoue la chaîne exacte : envoi
201 → `EmailDelivery` → webhook `request` puis `error` avec le motif réel Brevo
(« sender … is not valid »), en respectant l'ASYMÉTRIE réelle (messageId avec
chevrons à l'envoi, sans chevrons dans le webhook).

**Résultat : le backend était DÉJÀ correct.** Corrélation OK, `EmailDelivery` →
`ERROR`, motif persisté, `test.status` → `REJECTED`, code `SENDER_REFUSED`.

**Cause réelle : le Manager ne relisait jamais le statut.** `useResource` charge
la configuration une fois ; l'issue du test change APRÈS la réponse HTTP (c'est le
webhook, 1–2 s plus tard, qui fait passer ACCEPTED → REJECTED). L'écran restait
donc sur « Accepté — Brevo traite le message » indéfiniment alors que la base
savait déjà que l'expéditeur était refusé. **Le blocage était côté affichage, pas
côté chaîne.**

**Correctifs.**
- *Manager* : relecture toutes les 3 s tant que l'issue est transitoire (ACCEPTED
  seul), arrêt NET sur issue terminale, borne 90 s puis « La confirmation n'a pas
  été reçue » + bouton **Actualiser** (`isTestStatusTransitory`,
  `shouldPollTestStatus`). Bloc d'échec explicite : cause + **adresse testée** +
  geste (`testFailureView`). La note « l'authentification du domaine est gérée à
  l'installation » est MASQUÉE après un refus d'expéditeur — l'afficher juste
  après que Brevo a refusé cette adresse serait faux.
- *Backend* : helper canonique unique `normalizeProviderMessageId` /
  `providerMessageIdVariants` (§3) — écriture en forme canonique, lecture
  tolérante aux chevrons historiques ; trois normalisations locales supprimées.
  Classification enrichie (§5) : `SENDER_REFUSED`, `RECIPIENT_REJECTED`,
  `MAILBOX_UNAVAILABLE` (soft bounce), `SPAM_REJECTED`, `PROVIDER_ERROR`. DTO
  enrichi (§6) : `deliveryStatus`, `providerEvent`. Diagnostic étendu (§9) :
  contrôle `testSync` + verdicts `SENDER_REJECTED` et
  `TEST_STATUS_NOT_SYNCHRONIZED`.

---

> Statut historique (avant preuve) : cause de B pressentie par la doc, cause de A
> réduite à 4 candidats. Conservé ci-dessous pour la traçabilité de l'enquête.

## 0. Les deux symptômes

| # | Symptôme observé (conditions réelles : ngrok actif, webhook « Actif ») |
|---|---|
| **A** | Après un test, « Dernier test : Accepté — livraison en attente de confirmation » **indéfiniment**. Le statut ne passe jamais DELIVERED/REJECTED. |
| **B** | « Activer le suivi » → **Actif**, puis « Vérifier » → **Désynchronisé**, en **boucle**. Persiste MALGRÉ le correctif précédent (comparaison d'événements ordre-indépendante + sous-ensemble). |

Le correctif précédent a rendu la comparaison tolérante à l'ordre et aux extras.
La boucle persiste ⇒ **il restait une cause que ce correctif ne pouvait pas
couvrir**. Cette cause est identifiée ci-dessous.

---

## 1. Architecture — prévue vs réelle (Phase 3)

**Prévue** (docs internes, conservée) :

```
POST /test-send → /v3/smtp/email → messageId
      └─ EmailDelivery (status SENT, providerMessageId, providerMode)   ◄── SOURCE DE VÉRITÉ
             └─ webhook Brevo (delivered/bounce/blocked)
                    └─ lookup (provider, mode, providerMessageId) → transition
                           └─ Manager lit EmailDelivery → statut dérivé
```

**Réelle** (vérifiée dans le code) : **conforme**. Une seule `EmailDelivery` par
test, corrélation par `(provider, providerMode, providerMessageId)`
([`brevoWebhookIngest.service.js`](../backend/src/services/brevo/brevoWebhookIngest.service.js)),
statut du test **dérivé** à la lecture
([`resolveTestOutcome`](../backend/src/services/emailConfiguration.service.js)).
Pas de miroir Brevo, pas de double source. **Aucune régression d'architecture.**

Un seul écart de posture, non bloquant : le **Manager ne rafraîchit pas** la
configuration après le chargement initial (`useResource` avec dépendance
`[activeMode]`). Une transition DB `SENT → DELIVERED` n'apparaît donc qu'au
prochain rechargement/bascule de mode. C'est un **candidat A4** (voir §4), pas la
cause racine.

---

## 2. Conformité à la doc officielle Brevo (Phases 1 & 2)

Sources : `docs/Brevo/api/webhooks.md`, `docs/Brevo/guides/05_WEBHOOKS.md`,
`docs/Brevo/api/transactional_emails.md`, `docs/Brevo/guides/06_EMAIL_EVENTS.md`.

### 2.1 Événements de SOUSCRIPTION (config-time) — **NON CONFORME** ❌

Liste officielle **config-time transactional** (create-webhook), 13 événements :

```
sent, request, delivered, hardBounce, softBounce, blocked, spam,
invalid, deferred, click, opened, uniqueOpened, unsubscribed
```

Notre `SUBSCRIBED_CONFIG_EVENTS`
([`brevoTransactionalEventRegistry.js`](../backend/src/utils/brevoTransactionalEventRegistry.js)),
14 événements :

```
sent, request, delivered, deferred, softBounce, hardBounce, blocked,
spam, invalid, error, unsubscribed, opened, uniqueOpened, click
                     ▲
                     └──  « error » N'EST PAS un événement config-time.
```

`error` n'apparaît QUE :
- en **payload-time** (corps reçu) — guide 05 : « …blocked, **error**, unsubscribed, proxy_open… » ;
- dans **`GET /v3/smtp/statistics/events`** (pull) — guide 06 : « …unsubscribed, **error**, loadedByProxy ».

**Il n'est pas souscriptible à la création d'un webhook.** Notre liste, privée de
`error`, redonne **exactement** les 13 événements officiels.

| Notre valeur | Doc config-time officielle | Conforme ? |
|---|---|---|
| `sent, request, delivered, deferred, softBounce, hardBounce, blocked, spam, invalid, unsubscribed, opened, uniqueOpened, click` (13) | idem | ✅ |
| `error` | absent de la liste config-time | ❌ **invalide** |

### 2.2 Autres points — CONFORMES ✅

| Sujet | Notre implémentation | Doc | Conforme ? |
|---|---|---|---|
| Envoi | `POST /v3/smtp/email`, `api-key`, `htmlContent`+`textContent`, `replyTo`, `tags` | idem | ✅ |
| Réponse envoi | `{ messageId }` (single) | `{ messageId }` / `{ messageIds }` (batch) | ✅ (single) |
| Corrélation | `message-id` du webhook ↔ `messageId` de l'envoi | payload porte `message-id` | ✅ (à confirmer runtime, §4) |
| Auth webhook | Bearer token (`auth:{type,token}`), pas de HMAC | « Pas de signature HMAC documentée » | ✅ |
| Événements payload-time | mapping snake_case + camelCase → canonique (`normalizeBrevoEvent`) | deux espaces de noms | ✅ |
| Mode TEST/PROD | route `/:mode`, jamais le payload | — | ✅ |
| Timestamps | `ts_epoch`(ms)/`ts`/`ts_event`/`date` | idem | ✅ |

---

## 3. Symptôme B — CAUSE PROUVÉE (par élimination) ✅

### 3.1 Chaîne de causalité

1. `syncWebhook` POST vers `/v3/webhooks` avec les **14** événements, dont
   `error` (invalide en config-time).
2. Brevo **accepte** la création (l'utilisateur voit « Actif » = `CONFIGURED`,
   posé seulement après un create/update réussi) et **ignore silencieusement**
   `error` (événement non reconnu à la souscription).
   *Réfutation de l'alternative :* si Brevo renvoyait 400, `syncWebhook` lèverait
   et le statut serait `ERROR`/`OUT_OF_SYNC`, pas « Actif ». Or « Actif »
   s'affiche. Donc le POST a réussi ⇒ `error` a été **accepté-puis-ignoré**.
3. `GET /v3/webhooks` renvoie donc **13** événements (sans `error`).
4. `diagnoseWebhook` → `computeDivergence` : après normalisation, l'ensemble
   ATTENDU contient `ERROR` (car `error` → `NORMALIZED_EVENT.ERROR`), l'ensemble
   REÇU ne le contient pas. Le test « chaque attendu présent chez Brevo »
   échoue ⇒ `differences: ['events']` ⇒ **`OUT_OF_SYNC`** (« Désynchronisé »).
5. Ré-« Activer » re-PUT les 14 événements → Brevo re-ignore `error` → GET
   re-renvoie 13 → re-`OUT_OF_SYNC`. **Boucle infinie.**

### 3.2 Pourquoi le correctif précédent n'a rien changé

Le correctif « sous-ensemble + normalisation » exige que **chaque événement
attendu** soit présent chez Brevo. `error` est attendu mais **restera toujours
absent** (Brevo ne l'accepte pas). La comparaison est donc **correctement**
« intelligente », mais elle compare une liste attendue **fausse**. Le bug n'était
pas dans la comparaison : il est dans la **liste souscrite**.

### 3.3 Preuve capturée (instrumentation)

`DEBUG_EMAIL=true` sur le diagnostic imprime déjà `expectedEvents` avec `error`
en 10ᵉ position. En conditions réelles, la ligne
`diagnostic webhook — comparaison` affichera :

```
attendusManquantsChezBrevo: ["ERROR"]
differences: ["events"]
verdict: "OUT_OF_SYNC"
```

⇒ **preuve directe** que le seul écart est `error`. (Protocole §6.)

### 3.4 Correctif (à appliquer APRÈS confirmation runtime)

Retirer `'error'` de `SUBSCRIBED_CONFIG_EVENTS`. Une ligne. Les événements
`error` **reçus** (payload-time) restent gérés — le mapping `error →
NORMALIZED_EVENT.ERROR` demeure côté ingestion ; on cesse seulement de le
**souscrire** là où ce n'est pas permis.

---

## 4. Symptôme A — 4 candidats, à trancher par les logs

La corrélation, le mapping et la machine d'état sont corrects (couverts par les
tests). Restent 4 causes possibles au « ACCEPTED éternel », **mutuellement
distinguables** par `DEBUG_EMAIL` :

| # | Hypothèse | Signature dans les logs `DEBUG_EMAIL` | Réfutée si… |
|---|---|---|---|
| **A1** | Brevo n'appelle jamais l'endpoint (ngrok/URL/pare-feu) | **aucune** ligne `[WEBHOOK] POST reçu de Brevo` après le test | une ligne apparaît |
| **A2** | Le Bearer ne correspond pas → 401, ingestion jamais atteinte | `[WEBHOOK] résultat authentification Bearer … authorized:false` | `authorized:true` |
| **A3** | Corrélation échoue (message-id ≠ providerMessageId, ou mode) | `[WEBHOOK] AUCUNE EmailDelivery rapprochée` + `causeProbable` | `EmailDelivery rapprochée → transition` |
| **A4** | Transition OK en base, mais le Manager n'a pas rafraîchi | `[WEBHOOK] … → transition … statusApres: DELIVERED`, mais l'UI reste ACCEPTED sans rechargement | l'UI se met à jour au rechargement |

Note : A3 se sous-divise — le log `AUCUNE EmailDelivery rapprochée` liste les 5
derniers `providerMessageId` du mode et un `causeProbable` (« aucune livraison
pour ce MODE » vs « message-id ≠ providerMessageId stocké »), ce qui tranche
immédiatement entre un problème de **mode** et un problème de **format d'id**.

**Aucune de ces 4 causes n'est supposée : chacune laisse une empreinte
distincte.** Un seul test réel les départage.

---

## 5. Diagnostic AUTONOME — aucune manip, aucun `.env` (Phases 4 & 5)

Le diagnostic n'est plus « poser une variable + relire la console ». Le **projet
produit lui-même** le rapport, par deux surfaces au choix — **sans rien
configurer** :

- **Manager DEV** : carte Brevo → **« Diagnostic du suivi des emails »** →
  bouton **« Lancer un diagnostic »** (ou « avec envoi de test »). Verdict +
  contrôles affichés, **« Copier le rapport »**.
- **CLI** : `npm run email:diagnostic` (lecture seule) ou
  `npm run email:diagnostic:live` (envoi + attente du webhook).

Chaque exécution ÉCRIT un rapport horodaté et partageable :
`backend/logs/email-diagnostic-<YYYYMMDD-HHMMSS>.json` + `.log` (+ `…-latest.json`).
Dossier `backend/logs/` ignoré par git. **Aucun secret** dans le rapport (clé
API, token Bearer, secret webhook exclus).

### Ce que le moteur vérifie et TRANCHE tout seul

| Contrôle | Prouve / écarte |
|---|---|
| Fournisseur, clé API, mode actif | `PROVIDER_NOT_CONFIGURED` |
| Expéditeur | `SENDER_NOT_CONFIGURED` |
| **Événements souscrits vs liste valide Brevo** | **`SUBSCRIPTION_INVALID`** (le `error`) |
| URL publique (canonique + joignabilité) | `WEBHOOK_URL_NOT_PUBLIC` |
| Webhook distant (existe ? URL ? événements ? auth ?) | `WEBHOOK_NOT_REGISTERED` / `WEBHOOK_URL_DRIFT` / `WEBHOOK_DIVERGENT` |
| Réception réelle (`BrevoWebhookEvent`, `lastReceivedAt`, `lastAuthRejectedAt`) | `WEBHOOK_AUTH_REJECTED` (A2) / `WEBHOOK_NEVER_RECEIVED` (A1) |
| Corrélation (`providerMessageId` reçus non rapprochés) | `WEBHOOK_NOT_CORRELATED` (A3) |
| Test **live** (envoi + attente bornée du webhook) | confirme A1/A2/A3 de bout en bout |

Le **verdict** est la cause racine unique, choisie par ordre de priorité
(élimination), avec `cause` + `recommendation`. Fichiers :
[`emailDiagnostics.service.js`](../backend/src/services/email/emailDiagnostics.service.js),
[`email-diagnostic.js`](../backend/src/scripts/email-diagnostic.js),
[`diagnosticReport.js`](../backend/src/utils/diagnosticReport.js).

### Distinguer A1 (jamais appelé) de A2 (refusé 401)

Un 401 a lieu **avant** toute persistance : sans trace, il est indiscernable
d'un silence. On persiste donc `lastAuthRejectedAt`/`authRejectedCount`
([`webhook.controller.js`](../backend/src/controllers/webhook.controller.js) →
`markWebhookAuthRejected`), que le moteur lit pour trancher A1 vs A2.

### Sortie réelle (extrait, scénario « error »)

```
✗ [FAIL] Événements souscrits — Événement(s) non valides en config-time : error.
✗ [FAIL] Webhook chez Brevo — Désynchronisé : events.
    {"missingExpectedAtBrevo":["ERROR"], "differences":["events"], …}
 VERDICT : SUBSCRIPTION_INVALID
   Cause  : « error » n'existe pas en config-time → Brevo l'ignore → « Vérifier »
            renvoie éternellement « Désynchronisé ».
   Action : Retirer « error » de SUBSCRIBED_CONFIG_EVENTS.
```

> Les traces console `DEBUG_EMAIL` (bas niveau, `emailDebug.js`) subsistent comme
> aide optionnelle mais **ne sont plus nécessaires** : le rapport autonome est la
> voie normale. Plus jamais de `.env` à éditer pour diagnostiquer.

---

## 6. Protocole (Phase 6) — un clic

1. **Manager DEV → « Lancer un diagnostic »** (ngrok actif). Puis **« Copier le
   rapport »**, ou récupérer `backend/logs/email-diagnostic-latest.json`.
2. Pour observer l'aller-retour complet : **« avec envoi de test »** (ou
   `npm run email:diagnostic:live`) → le moteur envoie, attend le webhook, et
   conclut A1/A2/A3.
3. M'envoyer le rapport. Le `verdict` + les `evidence` **prouvent** la cause
   (B : `SUBSCRIPTION_INVALID` ; A : l'un des codes `WEBHOOK_*`).
4. J'applique le correctif définitif, fondé sur ce rapport — pas avant.

---

## 7. Interface (Phase 7) — recommandation, non implémentée

L'UI actuelle (« Activer / Vérifier / Synchronisé / Désynchronisé ») expose du
vocabulaire d'infrastructure. Cible proposée, **un seul verdict + une action** :

```
Suivi des emails
  ● Fonctionnel                         (webhook actif + dernière livraison confirmée)
  ● Configuration incomplète            (clé/URL publique manquante)
  ● Impossible de confirmer les livraisons   (webhook injoignable / désynchronisé)

[ Réparer automatiquement ]   ← un seul bouton : (ré)crée/aligne le webhook
```

« Réparer automatiquement » = `syncWebhook` (idempotent). Le « Vérifier »
disparaît (le diagnostic tourne à l'affichage). Quand une étape exige réellement
une URL publique, l'UI l'**explique** (« il faut une adresse publique — ngrok en
dev »), au lieu d'afficher « Désynchronisé ». **À implémenter après** la
résolution de A/B, pour ne pas mêler correctif et refonte.

---

## 8. Le webhook doit-il être obligatoire ? (Phase 8) — recommandation argumentée

**Constat.** Sans webhook, `DELIVERED` ne peut jamais être écrit : le test reste
`ACCEPTED` (désormais borné par le timeout « Suivi indisponible »). Le webhook
est donc la **seule** preuve de livraison réelle.

**Recommandation : webhook requis pour prétendre « Fonctionnel », mais NON
bloquant pour envoyer.**

- **Ne pas** rendre le webhook obligatoire pour *envoyer* : l'envoi marche sans
  lui (les notifications de contact partent), et l'exiger casserait le dev local
  sans URL publique. Conserver l'invariant « l'envoi ne dépend pas du webhook ».
- **Interdire le statut vert « Fonctionnel » tant qu'aucune livraison n'a été
  confirmée par webhook** : c'est déjà la doctrine (`DELIVERED` seul donne
  FUNCTIONAL). Sans webhook, l'état honnête est « accepté, non confirmé » puis
  « Impossible de confirmer les livraisons » — jamais « Fonctionnel ».
- **Supprimer le bouton « Activer le suivi »** au profit d'un
  **auto-provisioning** : dès qu'une URL publique valide existe, `syncWebhook`
  est déclenché en tâche de fond (idempotent), et l'UI n'expose que « Réparer
  automatiquement » en cas d'écart. Un **assistant** (checklist : clé API → URL
  publique → webhook → test) est pertinent pour l'installation initiale, en
  espace DEV.

**Conclusion.** Webhook = **prérequis de la CONFIRMATION**, pas de l'ENVOI. Le
rendre implicite (auto-réparation) plutôt qu'un bouton manuel supprime la classe
entière de bugs « Actif/Désynchronisé » exposée au commerçant.

---

## 9. Cause réelle & plan d'action

- **Symptôme B — PROUVÉ** : `error` dans la liste de souscription (invalide
  config-time) ⇒ Brevo l'ignore ⇒ divergence permanente ⇒ boucle. Correctif :
  retirer `error` de `SUBSCRIBED_CONFIG_EVENTS`. **En attente de la confirmation
  runtime** (log `attendusManquantsChezBrevo: ["ERROR"]`) avant application, par
  discipline forensique.
- **Symptôme A — À TRANCHER** : 4 candidats instrumentés (A1 réseau, A2 auth, A3
  corrélation, A4 rafraîchissement UI). Le prochain test réel + logs désigne le
  coupable sans ambiguïté.

**Aucun correctif appliqué dans ce lot** : instrumentation + audit uniquement.
Le correctif définitif suivra la preuve.
