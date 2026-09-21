> **RAPPORT HISTORIQUE — architecture supprimée.**
>
> Ce document décrit l'intégration DIRECTE d'un prestataire de signature depuis
> ce projet : clé locale, appels HTTP, adaptateur maison. Rien de tout cela
> n'existe plus — la signature passe par les capacités génériques de la
> plateforme, et ce projet ne détient aucune credential.
>
> Il est conservé parce qu'il explique des décisions dont on hérite (le choix
> des ratios plutôt que des pixels, l'ordre DEV puis client). L'autorité
> courante est **[SIGNATURE.md](SIGNATURE.md)**.

# Intégration Yousign (signature électronique)

Adaptateur fin ([services/yousign/](../backend/src/services/yousign/)) — aucun
appel Yousign depuis les contrôleurs. API v3. Le MODE Yousign (`activeMode`,
TEST=sandbox / PROD=prod) est **indépendant de l'ENV applicatif** — sélectionné
par un DEV dans le Manager.

## 1. Authentification & environnements

- Header `Authorization: Bearer {apiKey}` — clé résolue via le coffre-fort
  IntegratedAPI (`getCredential('YOUSIGN','apiKey')`).
- Base URL **dérivée de l'environnement** (jamais stockée) :
  `https://api-sandbox.yousign.app/v3` (mode TEST) / `https://api.yousign.app/v3` (mode PROD). La base est dérivée du **mode Yousign actif**, pas de l'ENV applicatif.
- Une clé appartient à **sandbox OU prod**, jamais les deux.

## 2. Flux de signature

Orchestration `createContractSignatureRequest` :
`POST /signature_requests` (draft, `delivery_mode:none`, `ordered_signers:true`)
→ `POST .../documents` (multipart, **`nature:signable_document`**) → `POST .../signers`
(**DEV créé en 1er, ADMIN en 2ᵉ**) → `POST .../documents/:docId/fields` (une par
zone) → `POST .../activate`.

### Upload du document — multipart

| Champ | Valeur | Note |
|---|---|---|
| `file` | PDF **binaire** (Blob, `application/pdf`) | base64 **refusé** par Yousign |
| `nature` | **`signable_document`** | enum : `signable_document` \| `attachment` |
| `parse_anchors` | **omis** (défaut `false`) | placement par coordonnées, pas par Smart Anchors |

Le `Content-Type` n'est **jamais** posé à la main : `fetch` génère la boundary.
Le PDF est lu depuis le **stockage local** du contrat (`resolveContractDocumentFile`),
jamais re-téléchargé via une URL — et validé avant tout appel (présent, non vide,
magic `%PDF`).

> ⚠️ **`nature: 'signable'` n'existe pas** et provoque un `400
> parameters_not_valid`. C'est l'incident du 2026-07-16 :
> [YOUSIGN_REAL_SANDBOX_FIX_REPORT.md](./YOUSIGN_REAL_SANDBOX_FIX_REPORT.md).
> La valeur est figée dans `DOCUMENT_NATURE` et couverte par un test qui inspecte
> le multipart réellement construit.

### Préparation tout-ou-rien

Si une étape échoue après la création de la demande, le **brouillon est supprimé**
chez Yousign avant que l'erreur ne remonte : pas de demande orpheline, et le
contrat ne conserve jamais un `signatureRequestId` à moitié préparé — le retry
repart d'une demande neuve (idempotent). Le nettoyage est best-effort et ne masque
jamais l'erreur d'origine.

### Retour de fin de signature (`redirect_urls`)

`redirect_urls` est posé **au niveau du signataire** (`success` / `error` /
`decline`), ce qui ramène chaque partie chez elle : le DEV sur sa liste, le
client sur son parcours. **Facultatif** : sans `managerUrl` configurée
(`SystemConfiguration.network`), le champ est omis et le signataire reste chez
Yousign.

**Un abonnement en Trial les refuse** (« The redirect urls cannot be defined when
the subscription is in trial. »). Ce refus — et lui seul — déclenche **une**
reprise sans redirections, payload par ailleurs identique : un contrat ne peut
pas être bloqué parce que le plan ne sait pas rediriger. Tout autre refus remonte
normalement. Aucune configuration : le comportement est dicté par la réponse de
Yousign. Voir
[YOUSIGN_TRIAL_REDIRECT_FALLBACK.md](./YOUSIGN_TRIAL_REDIRECT_FALLBACK.md).

`yousign.autoReturn` enregistre ce que Yousign a **accepté** : l'écran ne promet
le retour automatique que s'il aura lieu. Dans les deux cas, la signature est
confirmée par le **webhook** — seul le trajet de retour change.

### Diagnostic des erreurs

`YousignApiError` extrait `status`, `type`, `detail`, `invalid_params[]` et le
request id. Le frontend reçoit un message français nommant le champ fautif et un
**code technique stable** : `YOUSIGN_DOCUMENT_UPLOAD_FAILED`,
`_SIGNER_CREATION_FAILED`, `_FIELD_CREATION_FAILED`, `_ACTIVATION_FAILED`,
`_REQUEST_CREATION_FAILED`. Les logs ne contiennent que des métadonnées d'API —
jamais de clé, de secret webhook, ni de contenu de document.

**Ordre imposé DEV → ADMIN** : `ordered_signers:true` + création DEV avant ADMIN.
Le lien de signature ADMIN n'est disponible qu'après signature DEV.

### Identité des signataires — toujours le snapshot

`buildSignerPayload(snapshot, party)` lit **exclusivement**
`Contract.signersSnapshot`, figé à la validation du contrat. Les fiches
Entreprise (`Company.signer`, `DevCompany.signer`) ne sont **jamais** consultées
ici : elles ont pu changer depuis, et un contrat parti en signature doit rester
figé dans le temps.

`first_name` / `last_name` proviennent directement du snapshot. Un snapshot absent
ou partiel fait échouer la création de la demande avec un message explicite,
plutôt que d'envoyer une identité vide que Yousign rejetterait de façon opaque
(cas des contrats validés avant cette fonctionnalité).

> **Supprimé** : l'heuristique `splitName()`, qui découpait un *nom d'entreprise*
> en prénom/nom (« SB Auto » → `first_name:"SB"`, `last_name:"Auto"` ; « Studio »
> → les deux à « Studio »). Yousign reçoit désormais une vraie personne.

Configuration, validation et immuabilité : [CONTRACT_SIGNERS.md](./CONTRACT_SIGNERS.md).

## 3. Coordonnées — ⚠️ à valider en sandbox

[services/yousign/yousignCoordinates.js](../backend/src/services/yousign/yousignCoordinates.js) —
conversion **centralisée et testée** des zones (ratios normalisés 0–1) vers les
champs Yousign (**pixels**).

La doc Yousign confirme l'unité (pixels) mais **ne documente pas** le coin
d'origine (haut-gauche vs bas-gauche) ni la base d'indexation des pages. La
conversion est donc **paramétrable** (`YOUSIGN_COORDINATE_CONFIG` :
`origin`, `pageIndexBase`) avec pour hypothèses par défaut : `origin:'top-left'`,
`pageIndexBase:1`, 1 px = 1 point PDF (@72 dpi).

**Action requise avant PROD** : envoyer une demande sandbox sur un PDF de
dimensions connues et vérifier visuellement le placement ; ajuster `origin`/
`pageIndexBase` si nécessaire. Alternative recommandée par Yousign : les
**Smart Anchors** (texte-repère dans le PDF) — non implémentée en V1.

Tailles de signature bornées (85–2000 × 37–1000 px) : la conversion clampe.

## 4. Webhooks

Endpoint `POST /api/webhooks/yousign` (voir [WEBHOOKS.md](./WEBHOOKS.md)).
- Authenticité : header `x-yousign-signature-256` = `sha256=` +
  HMAC-SHA256(**corps brut**, `webhookSecret`), comparaison à temps constant.
- ACK rapide (< 1 s recommandé) ; idempotence via `event_id`.
- Événements traités : `signer.done` (DEV → `INACTIVE` ; ADMIN → adminSignedAt),
  `signature_request.done` (statut DONE + récupération du PDF signé),
  `signature_request.declined|expired|canceled`.

**La signature n'est JAMAIS validée par une redirection navigateur** — seul le
webhook signé (ou la réconciliation) fait foi.

## 5. Statuts

Mapping externe → interne (`mapRequestStatus`) : draft→DRAFT, ongoing/approval→
ONGOING, done→DONE, declined/rejected→DECLINED, expired→EXPIRED,
canceled/deleted→CANCELED.

## 6. PDF signé

À `signature_request.done`, le PDF signé est téléchargé
(`GET .../documents/:docId/download`) et stocké **séparément** de l'original
(immuable). Si le téléchargement échoue, la **réconciliation** le récupère.

## 7. Tests & sandbox

`npm run test:yousign` (121 — coordonnées, validation de zones, HMAC, statuts,
ordre DEV→ADMIN via provider simulé, multipart d'upload et payload signataire
réellement construits, **repli Trial sur refus des redirections**)
+ `npm run test:yousign-flow` (parcours complet).
Provider simulé : `SIGNATURE_PROVIDER=stub`.
Vérification sandbox réelle (connexion, lecture seule) : `npm run integrated-api:test:yousign`.
Smoke sandbox complet (crée/supprime une demande) : `npm run yousign:test`.

## 8. Parcours de signature complet

Le parcours DEV→ADMIN de bout en bout (création de la demande, signatures,
webhooks, récupération auto du PDF signé, timeline, synchronisation, gestion des
erreurs, relance) est décrit dans
[YOUSIGN_SIGNATURE_FLOW.md](./YOUSIGN_SIGNATURE_FLOW.md).
