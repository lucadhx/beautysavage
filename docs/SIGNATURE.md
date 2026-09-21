# Signature électronique des contrats

**Autorité** : la plateforme (Panel L.Y Solution). Ce projet ne détient aucune
credential de signature, ne connaît aucun hôte de fournisseur, et n'appelle
personne directement.

Ce document remplace [YOUSIGN_INTEGRATION.md](YOUSIGN_INTEGRATION.md) et
[YOUSIGN_SIGNATURE_FLOW.md](YOUSIGN_SIGNATURE_FLOW.md), conservés comme
rapports historiques.

---

## 1. Ce que ce projet sait, et ce qu'il ignore

| Il sait | Il ignore |
|---|---|
| où signer sur un contrat (zones, en ratios) | qui exécute la signature |
| qui signe (instantané contractuel des parties) | l'hôte d'API du prestataire |
| ce qu'un état de demande veut dire pour le contrat | la clé d'appel, le secret de webhook |
| quelles pièces archiver (contrat signé, preuve d'audit) | l'adresse pré-signée d'un fichier |

C'est cette ignorance qui a rendu le changement de prestataire **invisible
depuis ici** : il n'y avait rien à remplacer. Le lot de bascule n'a touché à
aucun appel réseau de ce projet, pour la bonne raison qu'il n'en a aucun.

## 2. Les six actes, tous servis par le Panel

Le projet appelle des **capacités génériques**. Aucune ne porte le nom d'un
fournisseur — c'est l'invariant qui rend la prochaine bascule possible.

| Capacité | Ce que le projet en fait |
|---|---|
| `signature.request.open` | ouvre la demande, en UN appel (document + signataires + zones) |
| `signature.request.retrieve` | relit l'état, pour la réconciliation |
| `signature.signer.retrieve` | obtient le lien d'un signataire, à la demande |
| `signature.document.download` | archive le contrat signé à l'achèvement |
| `signature.certificate.download` | archive la **preuve d'audit**, à part |
| `signature.request.cancel` | retire une demande, en la consignant |

Le service local (`services/signature/signature.service.js`) ne contient ni
`fetch`, ni clé, ni URL de prestataire — un test le vérifie par l'absence
(`scripts/signature.test.js`).

## 3. Le bloc de signature d'un contrat

`contract.signature` porte les faits. `contract.yousign` est **conservé en
lecture** pour les contrats d'avant la bascule ; il n'est plus écrit.

```
signature.provider        QUI a servi l'acte — inscrit, jamais déduit
signature.requestId       identifiant de la demande chez le prestataire
signature.documentId
signature.devSignerId     poignées opaques, dérivées — jamais une adresse
signature.clientSignerId
signature.status          NONE | ONGOING | DONE | DECLINED | EXPIRED | CANCELED
signature.devSignedAt     dates juridiques : jamais repoussées par un rejeu
signature.clientSignedAt
signature.autoReturn      le signataire sera-t-il ramené ? un FAIT, pas un réglage
```

Tout accès passe par `services/signature/signatureRecord.js` —
`signatureOf(contract)` lit l'un ou l'autre bloc, `setSignatureField` écrit
dans le bon. Lire un bloc en dur est le défaut que ce module existe pour
empêcher, et qui a coûté deux régressions silencieuses pendant la bascule.

**Pourquoi `provider` est inscrit et non déduit** : les deux prestataires
coexisteront en base pendant des années. C'est ce champ qui dira où chercher
une demande de 2025 — et une déduction se serait trompée le jour où un
troisième arrive.

La migration `scripts/migrate-signature-block.js` recopie l'ancien bloc dans
le neuf. Elle est **facultative** pour fonctionner, et n'efface rien.

## 4. Les zones : des ratios, jamais des pixels

L'éditeur du Manager enregistre `xRatio / yRatio / widthRatio / heightRatio`,
**depuis le coin supérieur gauche** de la page, plus `page` (1-indexée) et
`signerRole`. La conversion vers les points du document vit à un seul endroit :
`services/signature/signatureCoordinates.js`.

Ce qui était une hypothèse est devenu une mesure — quatre fois, par des chemins
indépendants (widgets incrustés, enregistrement brut, DOM du client de
signature, position de l'encre dans le PDF signé) :

- origine = **coin supérieur gauche**, comme l'éditeur ;
- pages = **1-indexées**, des deux côtés ;
- unité = le **point PDF** (@72 dpi), pas un pixel d'aperçu.

Écart mesuré de bout en bout — du ratio de l'éditeur à l'encre sur le papier :
**0,41 point**, soit 0,14 mm, l'arrondi à l'entier de la conversion.

## 5. Le parcours

```
DRAFT ──validate──► PENDING_DEV_SIGNATURE
                          │ start-dev-signature  (ouvre la demande, UN appel)
                          ▼
                    le DEV signe  ─── fait projeté ──► INACTIVE
                          │
                          ▼
                    le CLIENT signe ── fait projeté ──► (achèvement)
                          ▼
                    contrat signé + preuve d'audit archivés
```

**L'ordre est imposé par le prestataire**, et c'est mesuré : le client peut
LIRE le document avant son tour, il ne peut pas le signer — le pavé de
signature ne s'ouvre pas. Le cycle de vie en dépend : le contrat passe en
`INACTIVE` sur la signature du développeur, puis s'ouvre au client.

**Une seule adresse de retour**, pour tout le document, sans paramètre ajouté.
`SignatureReturnPage` lit la session pour renvoyer chacun chez soi. Revenir ne
prouve pas qu'on a signé — seul le webhook fait foi, et l'écran de destination
l'attend déjà.

## 6. Les faits de signature arrivent par le pont

Il n'y a **aucune route de webhook de signature dans ce projet**. Le
prestataire appelle le Panel, qui vérifie la signature du corps, normalise
l'événement, et projette un FAIT par le pont :

| Fait | Ce qu'il change |
|---|---|
| `SIGNATURE_SIGNER_SIGNED` | attribue la signature à une partie, date incluse |
| `SIGNATURE_COMPLETED` | clôt la demande, déclenche l'archivage des pièces |
| `SIGNATURE_FAILED` | refus, expiration ou annulation → `FAILED` |

L'applicateur (`services/signature/signatureEvent.applier.js`) est
**idempotent sans journal d'événements** : c'est l'ÉTAT qui porte la mémoire.
Un rejeu n'est pas une progression — il n'écrit rien, et surtout il ne repousse
pas une date de signature, qui est un fait juridique.

## 7. Deux pièces, jamais confondues

À l'achèvement, le dossier reçoit :

| Pièce | Ce qu'elle est | Où |
|---|---|---|
| **contrat signé** | l'engagement | `document.signedFilename` |
| **preuve d'audit** | qui a signé, quand, depuis où | `document.certificateFilename` |

Elles sont séparées chez le prestataire et le restent ici. Les fusionner
rendrait impossible de produire l'une sans l'autre, et l'opération est
irréversible.

La récupération est **non bloquante** et chacune a son propre déclencheur : le
contrat peut être arrivé et pas le certificat, ou l'inverse. Un contrat signé
avant la bascule n'a pas de preuve de ce côté-ci — c'est un fait historique,
pas une panne, et l'écran n'affiche alors pas le bouton.

## 8. Ce que ce projet REFUSE localement, et pourquoi

| Refus | Motif |
|---|---|
| document > 10 Mio | il voyage en base64 ; refuser plus loin coûte le transport |
| aucune zone configurée | la plateforme refuserait, avec un message plus lointain |
| instantané de signataire incomplet | une identité vide ne s'invente pas |
| zone hors page | l'éditeur l'interdit déjà ; on ne l'envoie pas quand même |

Ces refus sont une **politesse pour l'appelant**, jamais une seconde autorité.
Si les deux divergent, le Panel gagne, et le message vient de lui.

## 9. Diagnostic

- « la signature répond-elle ? » →
  `integrations/signature/signatureControlPlaneDiagnostic.js`, entrée
  `SIGNATURE` de la table de readiness. La question ne nomme aucun prestataire :
  elle porte sur la **capacité**.
- catalogue : l'entrée s'appelle `SIGNATURE`, `authority: PANEL`, **zéro champ
  à saisir**. C'est la forme qui empêche le Manager d'afficher un formulaire.
- réconciliation : `npm run contracts:sync` relit les demandes ouvertes et
  rattrape les pièces manquantes.

## 10. Le prestataire actuel

**OpenSign**, depuis août 2026. Le nom ne figure nulle part dans le code de ce
projet — il est ici pour l'exploitant, pas pour le programme.

La bascule, ses mesures et ses recettes réelles sont documentées côté
plateforme : `Panel/docs/integrated-api/OPENSIGN_MIGRATION_CAMPAIGN.md`.
