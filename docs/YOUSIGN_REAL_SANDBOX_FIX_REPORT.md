> **RAPPORT HISTORIQUE — architecture supprimée.**
>
> Ce rapport corrige un téléversement multipart effectué DEPUIS ce projet vers
> l'API d'un prestataire. Ce chemin n'existe plus : le document part en une
> seule capacité, et le multipart vit côté plateforme — quand il vit encore.
>
> Autorité courante : **[SIGNATURE.md](SIGNATURE.md)**.

# Rapport — correction de l'upload Yousign (recette sandbox réelle)

**Date** : 2026-07-16 · **Mode Yousign** : TEST (sandbox) · **Base** : `https://api-sandbox.yousign.app/v3`

Aucune clé API ni secret de webhook ne figure dans ce rapport.

## 1. Erreur initiale

Depuis le Manager DEV, clic sur **Signer** :

```
POST /api/contracts/6a58befc28707cfacc7bfea6/start-dev-signature
  -> Yousign 400 sur /signature_requests/cd4c7120-…/documents
     « You have some invalid params in your payload. »

yousign.provider.js:46 → yousign.service.js:69 → contract.service.js:340
                       → contract.dev.controller.js:75
```

La demande de signature était créée ; **l'ajout du document échouait**.

## 2. Payload fautif

Le multipart émis était, à un champ près, correct :

| Champ | Émis | Attendu | Verdict |
|---|---|---|---|
| `file` | Blob binaire, `application/pdf` | binaire | ✅ |
| Content-Type | non forcé (boundary par `fetch`) | boundary auto | ✅ |
| base64 | jamais | interdit | ✅ |
| PDF source | lu sur le disque local | — | ✅ |
| `parse_anchors` | absent | optionnel, défaut `false` | ✅ |
| **`nature`** | **`signable`** | **`signable_document`** | ❌ |

Aucune des hypothèses habituelles n'était en cause : ni chemin de fichier, ni URL
téléchargée, ni base64, ni JSON, ni boundary manquante, ni PDF vide. **Un seul mot.**

## 3. Cause racine

`nature: 'signable'` n'existe pas dans l'API Yousign v3. L'enum est
`signable_document | attachment`.

L'erreur ne vient pas d'une inattention de code mais **de la documentation
interne du dépôt**. `docs/yousign/api/documents.md`, mis à jour le 2026-06-27,
affirmait :

> **`nature`** : `signable | attachment | sealed` (confirmé).

Le code a fidèlement suivi une doc fausse, et le mot « confirmé » a dissuadé de
revérifier. Le fichier est corrigé, avec la réponse littérale de la sandbox à
l'appui.

**Pourquoi les tests ne l'ont pas vu** : ils vérifiaient l'*ordre* des appels
(`create → upload → addSigner ×2 → addField ×2 → activate`), jamais le *contenu*
du payload d'upload. Le stub acceptait tout. La suite était verte, la sandbox
refusait.

## 4. Format multipart attendu

`POST /signature_requests/{id}/documents` — `multipart/form-data` :

| Champ | Type | Requis | Valeur |
|---|---|---|---|
| `file` | binaire | oui | PDF (1.6+ pour un document signable), ≤ 50 Mo |
| `nature` | string | oui | `signable_document` \| `attachment` |
| `parse_anchors` | bool | non | défaut `false` — Smart Anchors |
| `name`, `password`, `insert_after_id`, `excluded_signers`, `excluded_approvers` | — | non | non utilisés ici |

Base64 explicitement refusé par Yousign. Le Content-Type ne doit **pas** être posé
à la main : `fetch` génère la boundary.

`parse_anchors` reste **omis** : le placement se fait par coordonnées
(`mapZoneToField`), pas par ancres textuelles.

## 5. Correction

- `DOCUMENT_NATURE` (`yousign.provider.js`) fige l'enum officiel, commenté avec le
  symptôme exact pour qu'un futur « signable » ne repasse pas.
- `uploadDocumentToSignatureRequest()` centralise l'upload.
- `buildDocumentUploadForm()` construit le multipart : fonction **pure** (ni
  réseau, ni credentials), donc le payload réel est inspectable en test.
- `toSafePdfFilename()` assainit le nom (chemin retiré, extension forcée).
- `resolveContractDocumentFile()` lit le PDF depuis le **stockage local** du
  contrat — jamais via une URL localhost/ngrok/publique : le binaire est déjà là,
  un aller HTTP n'ajouterait qu'un point de panne — et le valide **avant** tout
  appel externe (présent, non vide, magic `%PDF`, anti path-traversal).

## 6. Diagnostic enrichi

Yousign renvoyait déjà l'information utile ; elle était jetée. `YousignApiError`
extrait `status`, `type`, `detail`, `invalid_params[]`, request id :

```
Yousign rejet — YOUSIGN_DOCUMENT_UPLOAD_FAILED
  HTTP 400 /signature_requests/{id}/documents
  type: parameters_not_valid
  detail: You have some invalid params in your payload.
  field: nature
  reason: Value must be in ["attachment", "signable_document"].
```

`toSafeLog()` ne transporte que des métadonnées d'API : jamais de clé, de secret
webhook, de contenu PDF. Le frontend reçoit un message français nommant le champ
fautif et un code technique stable : `YOUSIGN_DOCUMENT_UPLOAD_FAILED`,
`_SIGNER_CREATION_FAILED`, `_FIELD_CREATION_FAILED`, `_ACTIVATION_FAILED`,
`_REQUEST_CREATION_FAILED`.

Ce diagnostic a prouvé son utilité pendant la recette même : il a fait apparaître
en clair une limitation de compte inattendue (§8) qu'un 400 muet aurait rendue
incompréhensible.

## 7. Nettoyage des demandes partielles

L'incident laissait la demande créée alors que l'upload échouait, sans que le
contrat en garde trace (`signatureRequestId` jamais persisté) : **un brouillon
orphelin par tentative**.

La préparation est désormais tout-ou-rien : toute erreur survenant après la
création supprime le brouillon (`DELETE /signature_requests/{id}` → 204). Le
nettoyage est best-effort et **ne masque jamais l'erreur d'origine** (il est
journalisé). L'appelant ne reçoit donc jamais un `signatureRequestId` à moitié
préparé : le retry repart d'une demande neuve — idempotent.

Les deux orphelins réels laissés par l'incident ont été supprimés de la sandbox :
`04b91c09-…` et `cd4c7120-…` (celui de la trace ci-dessus).

## 8. Résultat de la recette réelle

**Reproduction de l'erreur** (sandbox réelle, PDF 1 page) :

| `nature` | HTTP | Réponse |
|---|---|---|
| `signable` | **400** | `{"type":"parameters_not_valid", "invalid_params":[{"name":"nature","reason":"Value must be in [\"attachment\", \"signable_document\"]."}]}` |
| `signable_document` | **201** | document créé (`nature: signable_document`, `total_pages: 1`) |

**Parcours complet via le code applicatif** (provider réel, pas le stub) :

| # | Étape | Résultat |
|---|---|---|
| 1 | `POST /signature_requests` | ✅ 201 — brouillon créé |
| 2 | `POST /documents` (multipart) | ✅ **201** — `nature=signable_document`, `total_pages=1`, `total_anchors=0` |
| 3 | `POST /signers` (DEV) | ✅ 201 |
| 4 | `POST /signers` (CLIENT) | ✅ 201 |
| 5 | `POST /fields` (DEV) | ✅ 201 — `x=60 y=84 w=149 h=51` (converti depuis les ratios) |
| 5b | `POST /fields` (CLIENT) | ✅ 201 |
| 6 | `POST /activate` | ⛔ **bloqué — limitation de compte sandbox** (ci-dessous) |
| 7 | `DELETE` (nettoyage) | ✅ 204 |

**L'upload du PDF est donc réellement validé** : c'était l'objet de l'incident, il
est corrigé et vérifié sur l'API réelle, pas sur un mock.

### Limitation sandbox constatée à l'activation

```
HTTP 400 — In sandbox mode, the recipient email must belong to your
           organization. Contact support to remove this limitation.
```

Cette restriction est **propre au compte sandbox**, pas au code : elle exige que
**tous** les emails de signataires appartiennent au domaine de l'organisation
Yousign. Elle est apparue avec des adresses de test hors domaine ; les étapes 1→5b
étaient déjà toutes passées.

Deux façons de lever le blocage, au choix :
- demander à Yousign (support) la levée de la limitation sur le compte sandbox ;
- ou, pour une recette de bout en bout immédiate, configurer les deux signataires
  (fiches Entreprise) avec des adresses du domaine de l'organisation —
  `Company.signer.email` est aujourd'hui une adresse Gmail, donc hors domaine.

Une fois l'activation possible, le lien de signature DEV et l'affichage de la
demande dans l'interface Yousign Sandbox restent à confirmer : **ces deux points
n'ont pas pu être vérifiés** et ne sont pas déclarés faits.

## 9. Statuts HTTP côté backend

| Situation | Avant | Après |
|---|---|---|
| Upload refusé par Yousign | 500 (message opaque) | **502** + `code: YOUSIGN_DOCUMENT_UPLOAD_FAILED` + champ fautif |
| PDF absent / vide / non-PDF | 400 tardif de Yousign | **400** local, explicite, avant tout appel externe |
| Yousign injoignable | 500 | **502** « Yousign est injoignable » |
| Parcours nominal | — | **200** (`{ contract, signatureLink }`) |

## 10. Autres livrables de la mission

- **Éditeur** : barre d'actions flottante sur la zone sélectionnée (changer de
  signataire, dupliquer, supprimer), « Ajouter une zone » et « Enregistrer »
  rendus toujours visibles (sidebar en-tête/liste/pied), état « modifications non
  enregistrées » + confirmation avant fermeture. Voir [CONTRACT_EDITOR.md](./CONTRACT_EDITOR.md).
- **Suivi horizontal** : `ContractProgressTracker`, même composant et même calcul
  (`deriveContractProgress`) pour le DEV et l'ADMIN, étapes dérivées des états
  réels. Voir [CONTRACT_ACTIVATION_FLOW.md](./CONTRACT_ACTIVATION_FLOW.md).
- **Outils de synchronisation** : regroupés dans « Diagnostic et synchronisation »
  (replié, hors des CTA), avec explication, statut courant et résultat du dernier
  passage. Ce sont des outils de réconciliation : ils **ne créent rien** — vérifié
  par test (aucun `createCheckoutSession` / `createSubscription` / `createCustomer`
  / `createProduct` / `createPrice`, lectures Stripe uniquement).

## 11. Tests

| Suite | Avant | Après |
|---|---|---|
| `npm run test:yousign` | 34 | **79** |
| `npm run test:payments` | 55 | **69** |
| Backend complet (`npm test`) | 696 | **710** |
| Manager (`npm test`) | — | **111** (57 suivi + 54 zones) |

Couverture ajoutée : multipart réellement construit (nature, binaire, MIME, nom,
taille, anti-base64, `parse_anchors`), PDF vide/invalide refusé localement,
extraction du corps d'erreur **réel** de la sandbox, absence de secret dans les
logs, corps non-JSON, panne réseau, nettoyage d'une demande partielle,
préservation de l'erreur d'origine si le nettoyage échoue, retry idempotent,
duplication/clamp/changement de signataire, 13 scénarios de suivi, identité
DEV/ADMIN, innocuité des boutons de synchronisation.

Le manager n'avait aucun runner : les modules purs (`contractProgress.ts`,
`signatureZones.ts`) sont testés par des scripts Node autonomes (`npm test`,
via le stripping de types natif de Node) — même idiome que le backend, **aucune
dépendance ajoutée**.

## 12. Builds

- Backend `npm test` — **exit 0**, 710 vérifications, 0 échec.
- Manager `npm test` — **exit 0**, 111 vérifications, 0 échec.
- Manager `tsc -b --noEmit` — **exit 0**.
- Manager `npm run build` — **succès**.

## 13. Commits

Poussés sur `origin/main` :

| Hash | Commit |
|---|---|
| `7493c2b` | `fix(yousign): send contract PDF as valid multipart document` |
| `7da2b07` | `fix(yousign): expose safe validation details and clean partial requests` |
| `a8cbea6` | `test(yousign): cover real document upload payload` |
| `669c877` | `feat(contract-editor): add zone quick actions and sticky controls` |
| `6b3ad61` | `feat(manager): add animated horizontal contract progress` |
| `9de8180` | `ux(contracts): move Stripe sync actions into technical tools` |
| `1bedcd6` | `docs(yousign): document sandbox upload correction` |

**Hash final** : `1bedcd65cceeea247df1697f08aeeb5e6cf808ea`
**Push** : confirmé sur `origin/main` (branche à jour, aucun écart avec le distant).
