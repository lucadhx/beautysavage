# R10.5C — Yousign : audit exhaustif et architecture cible

**Date** : 2026-08-14
**Branche** : `wip/r10-5ab-email-centralisation`
**État** : audit livré (§24 étape 8). **Migration NON entreprise** — voir §9.

> §21 fait d'une migration Yousign partielle un `BLOCKED`. Cet audit est donc
> délibérément livré **sans** cutover : commencer sans pouvoir finir produirait
> le verdict bloqué avec, en plus, une surface à moitié migrée.

---

## 1. Compteurs mesurés (baseline)

```
YOUSIGN_LOCAL_SDK_RUNTIME_IMPORTS      5
YOUSIGN_LOCAL_BUSINESS_CALLS           8
YOUSIGN_LOCAL_PROVIDER_METHODS        11
YOUSIGN_LOCAL_API_ENDPOINT_REFERENCES  9
YOUSIGN_LOCAL_CALL_SECRET_READS        4   (apiKey ×1, baseUrl ×3)
YOUSIGN_LOCAL_WEBHOOK_VERIF_READS      1   (webhookSecret — à conserver, cf. §6)
YOUSIGN_LOCAL_CREDENTIAL_FIELDS        2   (apiKey, webhookSecret)
YOUSIGN_LOCAL_CREDENTIAL_UI_INPUTS     2   (formulaire générique du catalogue)
YOUSIGN_LOCAL_FALLBACKS                3   (stub ×1, deriveYousignBaseUrl ×2)
YOUSIGN_WEBHOOK_PATHS (projet)         2   (POST /webhooks/yousign, GET …/health)
YOUSIGN_PANEL_CAPABILITIES_DECLARED    2
YOUSIGN_PANEL_CAPABILITIES_SERVED      0
```

**Distinction impérative (§4)** : `apiKey` est une **clé d'APPEL** — elle doit
disparaître du projet. `webhookSecret` est un **secret de VÉRIFICATION** — il ne
sert qu'à authentifier un message entrant, et sa conservation se discute
séparément (§6).

---

## 2. Surface locale

| Fichier | Lignes | Rôle |
|---|---|---|
| `services/yousign/yousign.provider.js` | 189 | client HTTP v3 ; lit `apiKey` + `baseUrl` |
| `services/yousign/yousign.service.js` | 340 | orchestration, statuts, vérification webhook |
| `services/yousign/yousign.stub.js` | 100 | provider simulé (`SIGNATURE_PROVIDER=stub`) |
| `services/yousign/yousignCoordinates.js` | 109 | zones → champs (Smart Anchors) |
| `services/yousign/yousign.errors.js` | 156 | erreurs typées |

**Importateurs métier (5)** : `contract.service.js`, `contractWebhook.service.js`,
`reconciliation.service.js`, `contractTestTools.service.js`,
`controllers/webhook.controller.js`.

**Les 11 verbes du provider** : `createSignatureRequest`,
`uploadDocumentToSignatureRequest`, `uploadDocument` (déprécié), `addSigner`,
`addField`, `activate`, `getSignatureRequest`, `getSigner`,
`cancelSignatureRequest`, `deleteSignatureRequest`, `downloadSignedDocument`.

---

## 3. Actes métier réels

C'est la liste qui doit fonder les capacités — **pas** un verbe par endpoint.

| Acte métier | Appel actuel | Credential | R/W | Idempotence aujourd'hui | Ownership | Cible |
|---|---|---|---|---|---|---|
| **Ouvrir la signature d'un contrat** | `createSignatureRequest` + `uploadDocument` + `addSigner` ×2 + `addField` ×N + `activate` | apiKey | **W** | garde locale `if (contract.yousign.signatureRequestId) throw` ; nettoyage du brouillon si une étape échoue | contrat local | `signature.request.open` |
| Lire le lien de signature ADMIN | `getSigner` | apiKey | R | rejouable | contrat local | `signature.signer.retrieve` |
| Lire l'état d'une demande | `getSignatureRequest` | apiKey | R | rejouable | contrat local | `signature.request.retrieve` |
| Récupérer le PDF signé | `downloadSignedDocument` | apiKey | R (binaire) | rejouable | contrat local | `signature.document.download` |
| Annuler / supprimer | `cancelSignatureRequest`, `deleteSignatureRequest` | apiKey | W | — (nettoyage interne) | contrat local | `signature.request.cancel` |
| Vérifier un webhook | HMAC SHA-256 | **webhookSecret** | — | idempotence par `externalEventId` | §5 | reste local **ou** bascule §6 |

**Décision de conception** : l'ouverture reste **UN acte**, pas six capacités.
Le découper exposerait au projet un brouillon Yousign à demi préparé, et c'est
exactement l'état que `attemptSignatureRequest` s'échine aujourd'hui à ne jamais
rendre observable (tout-ou-rien, avec suppression du brouillon en cas d'échec).
Six capacités déplaceraient cette orchestration — et sa fenêtre d'incohérence —
du côté du projet.

---

## 4. Ownership : le point le plus faible

**Aujourd'hui**, le webhook retrouve le contrat ainsi :

```js
Contract.findOne({ 'yousign.signatureRequestId': srId })   // srId vient du PAYLOAD
```

Ce n'est **pas** un oracle exploitable : `signatureRequestId` a été écrit par
nous à la création, donc un identifiant forgé ne matche aucun contrat. La
protection est réelle.

Mais c'est la **seule** autorité, et elle est une metadata fournisseur — ce que
§C interdit dès qu'une filiation plus forte existe. Elle existe :

```
projet (bridgeToken)  →  contrat possédé  →  binding Panel  →  ressource Yousign
```

**Cible** : le Panel tient un `PanelSignatureBinding` (projectId, contractId,
signatureRequestId, environment), créé **avant** l'appel fournisseur. Toute
capacité résout l'ownership sur ce binding **avant** d'ouvrir le coffre — même
ordre que la passerelle applique déjà pour la politique commerciale.

Conséquences à prouver : projet A ne peut pas lire la demande de B ; un
`signatureRequestId` inventé est refusé **sans contact fournisseur** ; TEST et
PROD ne partagent aucun binding.

---

## 5. Idempotence, par écriture

| Écriture | Deux appels identiques = ? | Stratégie |
|---|---|---|
| Ouvrir la signature | **rejeu** — un contrat n'a qu'une demande | demande durable créée AVANT l'appel (le binding), `operationId` dérivé du `contractId` : deux clics convergent sur la même demande |
| Annuler | rejeu | `SAFE_RETRY` — annuler deux fois est sans effet |

L'ouverture est `UNKNOWN_ON_TIMEOUT` : Yousign n'offre pas de clé
d'idempotence. Le registre d'opérations du Panel **est** la garantie de
non-doublon — sans lui, deux clics créent deux demandes de signature, donc deux
sollicitations d'un signataire réel.

Le nettoyage tout-ou-rien actuel doit être **conservé côté Panel** : c'est lui
qui garantit qu'un échec de préparation ne laisse pas de brouillon orphelin.

---

## 6. Webhook — les dix questions de §8

1. **Qui provisionne ?** Le Panel a déjà `webhookRegistry.YOUSIGN` +
   `providerWebhookAdapters.yousignWebhookAdapter`. Le projet, lui, expose
   `POST /webhooks/yousign`.
2. **Où pointe l'endpoint ?** Aujourd'hui vers le PROJET.
3. **Qui possède le secret ?** Le projet (`webhookSecret` local).
4. **Rendu à la création seulement ?** Oui côté Yousign.
5. **Stocké où ?** Coffre local du projet.
6. **Traverse-t-il le pont ?** Non aujourd'hui.
7. **Rotation ?** Non gérée.
8. **Offline ?** Un webhook reçu pendant que le projet est éteint est **perdu** —
   Yousign réessaie, mais rien ne garantit la convergence.
9. **Corrélation ?** `signatureRequestId` du payload (§4).
10. **Isolation inter-projets ?** Par le secret propre à chaque projet.

**Deux architectures possibles, et le choix n'est pas neutre :**

- **(a) Endpoint Panel** (préféré par §5) : `Yousign → Panel → ownership → fait
  normalisé → Bridge → projet`. Un projet offline ne perd plus rien : le Panel
  garde le fait et le rejoue. Coût : le Panel doit provisionner un endpoint par
  environnement et router vers le bon projet — mécanique déjà en place pour
  Brevo (`emailDeliveryDispatch`).
- **(b) Endpoint projet conservé** : le `webhookSecret` reste local et légitime
  (`YOUSIGN_WEBHOOK_VERIFICATION_SECRET_READERS = 1`). Plus simple, mais §8
  « offline sans convergence » reste ouvert — c'est une condition STOP.

**Recommandation : (a)**, pour la même raison que Brevo l'a adoptée en L8.4 —
après cutover les webhooks suivent le COMPTE, donc le Panel ; les laisser
arriver au projet créerait deux chemins de retour.

---

## 7. Documents privés — déjà conforme

Constat rassurant, contre-intuitif au vu de §9 :

- le PDF signé est écrit dans `config.paths.contractStorage/<contractId>/`,
  **jamais** dans `/uploads` ;
- le nom est un UUID (`signed-<uuid>.pdf`), non devinable ;
- l'accès passe par `GET /:id/documents/signed` **derrière `authenticate`** ;
- un `signedChecksum` est persisté.

**Aucun second stockage n'est à inventer.** Ce que la migration doit préserver :
que le binaire transite Panel → projet sans devenir public, et que l'empreinte
soit vérifiée à l'arrivée.

---

## 8. Ce que la migration devra produire

**Capacités Panel** (5, servies) : `signature.request.open`,
`signature.request.retrieve`, `signature.signer.retrieve`,
`signature.document.download`, `signature.request.cancel`.

Le registre en déclare 2 aujourd'hui (`signature.request.create`,
`signature.document.download`), `migrated: false`, sans schémas ni adaptateur.
`signature.request.create` doit être **renommée** `…open` : elle ne crée pas,
elle ouvre — création + document + signataires + champs + activation.

**Effets** (table L1.75, déjà correcte) : `LEGAL_WRITE` pour l'ouverture (donc
refusée en PREOPENING), `READ_ONLY` pour les lectures. `cancel` est à trancher :
`LEGAL_WRITE` (elle défait un engagement pris devant un tiers) plutôt que
`REVERSIBLE_EXTERNAL_WRITE`.

**À supprimer côté projet après cutover** : les 5 importateurs, les 11 verbes,
`apiKey` du catalogue, le stub, `deriveYousignBaseUrl`,
`assertProviderReady('YOUSIGN')`.

**À conserver** : `yousignCoordinates.js` (les zones sont une donnée MÉTIER du
contrat, pas un détail fournisseur), les statuts internes, `contract.yousign.*`
comme projection.

---

## 9. Pourquoi la migration n'est pas entreprise ici

Le périmètre mesuré ci-dessus représente, à lui seul, davantage que R10.5A+B
réunis : 5 capacités avec schémas et adaptateurs, un modèle de binding, la
résolution d'ownership avant coffre, le registre d'idempotence, la
ré-architecture webhook (§6a), le transit du binaire signé, le diagnostic
centralisé, la purge des credentials, et les 36 scénarios E2E de §15 — dans les
deux dépôts.

§21 interdit de la livrer en morceaux. La commencer sans pouvoir la finir
produirait le verdict `BLOCKED` **et** une surface à moitié migrée : le pire des
deux états.

---

## 10. Verdict

```
R10.5 GLOBAL EMAIL + YOUSIGN CONTROL PLANE: BLOCKED
GO DEPLOYMENT TEST: NO
```

**Cause racine** : R10.5C non entrepris.
`YOUSIGN_LOCAL_BUSINESS_CALLS = 8`, `YOUSIGN_LOCAL_CALL_SECRET_READS = 4`,
`YOUSIGN_LOCAL_CREDENTIAL_UI_INPUTS = 2`, `YOUSIGN_LOCAL_FALLBACKS = 3`.

**R10.5A et R10.5B sont, eux, entièrement clos et verts** — voir le rapport de
lot. Les compteurs Brevo/From sont tous à zéro, et les suites complètes des deux
dépôts passent.
