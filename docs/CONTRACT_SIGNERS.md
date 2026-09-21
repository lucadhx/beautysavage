# Signataires contractuels — configuration & snapshot

Un contrat engage **deux personnes physiques**, une par entreprise. Ces
personnes sont une **donnée métier configurée**, jamais une déduction : ni le
compte connecté, ni un contact public d'entreprise ne disent qui a le pouvoir de
signer.

Deux garanties portent tout le reste :

1. **Rien d'implicite** — un contrat ne part pas en signature tant que les deux
   parties ne sont pas explicitement identifiées (prénom, nom, email).
2. **Rien de rétroactif** — à la validation, l'identité des deux parties est
   **copiée** dans le contrat. Modifier la configuration ensuite n'a aucun
   effet sur les contrats déjà validés.
3. **Rien de local** — depuis le chantier « entreprise cliente », l'autorité
   est le **Panel** pour les DEUX parties. Ce projet lit ; il n'écrit plus.

## 1. Configuration — DEUX autorités, toutes deux dans le Panel

| Partie | Autorité | Reçu par | Lu ici dans |
|---|---|---|---|
| `developer` | `PanelCompany.signer` (entreprise développeur) | projection `DEV_COMPANY`, diffusée à **tout le parc** | `getPublishedDeveloperIdentity()` |
| `client` | `PanelClientCompany.contractualSigner` | projection `CLIENT_COMPANY`, **nominative** | `getClientContractualSigner()` |

### Ce qui a changé, et pourquoi

Les deux signataires étaient auparavant édités **dans ce projet** :
`DevCompany.signer` sur la page « Entreprise développeur », `Company.signer`
sur la page « Entreprise ». Deux conséquences, et les deux se sont produites :

- un même client possédant deux sites pouvait déclarer deux signataires
  différents pour la même personne morale, et rien ne disait lequel engageait
  réellement la société ;
- le **client** choisissait l'identité qui signe le contrat que L.Y Solution
  lui présente. Un signataire n'est pas une préférence d'affichage : c'est la
  personne physique qui **engage une société**.

```text
AVANT                                  MAINTENANT
Company.signer      <- édité ici       PanelClientCompany.contractualSigner
DevCompany.signer   <- édité ici                   |  projection CLIENT_COMPANY
                                                   v
                                       lecture LOCALE, jamais écriture
```

`Company.signer` **survit en base**, figé et inerte : le contrôleur retire
silencieusement le champ des requêtes d'écriture, et plus rien ne le lit.
Il n'est pas supprimé pour ne pas détruire une donnée historique — mais
aucune décision ne s'appuie dessus. La `SignerSection` du manager et les
validateurs `signer.validator.js` / `devCompany.validator.js` ont disparu.

### La lecture est LOCALE

On lit la dernière identité **reçue**, persistée ici par le pont. Préparer un
contrat n'interroge donc jamais le Panel : une panne du Panel ne bloque pas la
signature, elle fige ce que l'on sait déjà. Voir
[PANEL_BRIDGE.md](./PANEL_BRIDGE.md) § 7 quinquies.

### Aucun repli sur la fiche locale

Si le Panel n'a rien publié, on **refuse**. Mieux vaut un contrat qui ne part
pas qu'un contrat signé au nom d'une entreprise dont l'autorité n'a jamais
entendu parler.

| Absence | Code | Effet |
|---|---|---|
| aucune entreprise développeur publiée | `DEVELOPER_IDENTITY_NOT_PUBLISHED` | refus, HTTP 400 |
| aucune entreprise cliente rattachée | `CLIENT_COMPANY_NOT_LINKED` | refus, HTTP 400 |
| signataire client absent ou incomplet | `CLIENT_SIGNER_NOT_CONFIGURED` | refus, HTTP 400 |

Le message d'erreur ne dit **jamais** « configurez-le ici » : la personne qui
lit cet écran n'a pas le pouvoir de le faire. Il renvoie vers le contact
L.Y Solution — voir [CLIENT_COMPANY.md](./CLIENT_COMPANY.md).

### Forme du signataire

```js
{ firstName, lastName, jobTitle, email }   // ou null = non configuré
```

`firstName`, `lastName`, `email` sont **requis** — définis une seule fois dans
[utils/signer.js](../backend/src/utils/signer.js) (`SIGNER_REQUIRED_FIELDS`).
**`jobTitle` est facultatif** : la fonction est une mention de courtoisie
portée au contrat, elle ne conditionne pas la capacité à signer.

### Ce que le signataire n'est PAS

- **Pas un compte utilisateur.** Un compte DEV/ADMIN sert à se connecter. Le
  gérant qui signe n'a pas forcément de compte, et l'employé qui clique
  n'engage pas l'entreprise.
- **Pas le média public `Company.media[key='email']`.** Ce champ est un
  contact d'affichage vitrine, gouverné par un `enabled`. L'ancien code y
  lisait l'email du signataire client : décocher « afficher » cassait alors la
  validation d'un contrat. Les deux notions sont séparées depuis, et la
  séparation est couverte par un test.
- **Pas modifiable par le client.** C'est désormais vrai par construction, et
  non par convention.
## 2. Validation du contrat

[contract.service.js](../backend/src/services/contract.service.js) →
`validateContract` → `freezeSigners`.

Chaque partie est contrôlée séparément, et **« non configuré » ≠ « incomplet »** :
ce sont deux actions différentes pour l'utilisateur.

| Cas | Message (HTTP 400) | `details` |
|---|---|---|
| `signer === null` | `Le signataire de l'entreprise cliente n'est pas configuré.` | `{ party, missing: [3 champs], code }` |
| champs manquants | `Le signataire de l'entreprise développeur est incomplet : nom et email.` | `{ party, missing: ['lastName','email'] }` |
| email non valide | `… est incomplet : email.` | `{ party, missing: ['email'] }` |

> L'ancien message générique **`Email manquant pour les signataires.`** n'existe
> plus : il ne disait ni quelle partie, ni quoi corriger, ni où.

Côté client, « non configuré » et « aucune entreprise rattachée » restent eux
aussi **deux refus distincts** : le premier se corrige en remplissant une
fiche, le second en rattachant un projet à une entreprise. Les confondre
enverrait un opérateur du Panel chercher un champ dans un écran vide.

Le contrat reste en `DRAFT` tant que le contrôle échoue — voir
[CONTRACTS.md](./CONTRACTS.md) pour la machine à états.

## 3. Le snapshot

À la validation, `Contract.signersSnapshot` est figé :

```js
signersSnapshot: {
  developer: { firstName, lastName, jobTitle, email, companyName },
  client:    { firstName, lastName, jobTitle, email, companyName },
}
```

`companyName` est capturé au même instant : le contrat conserve donc le nom que
l'entreprise portait **le jour de la signature**, même après un changement de
dénomination.

Pour la partie `client`, ce nom est la **raison sociale** publiée par le Panel
(`PanelClientCompany.legalName`), jamais l'enseigne ni le nom du site : c'est
la personne morale qui s'engage.

**Après validation, le snapshot est la seule source de vérité.** Les fiches
Entreprise redeviennent ce qu'elles sont : la configuration des *prochains*
contrats.

```
Panel ──(projection)──▶ config locale ──(copie à la validation)──▶ signersSnapshot
                              │                                          │
                        remplacée à                                 FIGÉ, jamais relu
                     chaque publication                          depuis la configuration
```

Le contrat porte aussi `signatureConfiguration.signers[]`. Ne pas s'y tromper :
c'est la vue **éditeur** (couleur de zone, logo, libellé) et le rattachement aux
identifiants Yousign. Elle est **dérivée du snapshot** et ne porte aucune identité
qui n'y soit déjà figée. Voir [CONTRACT_EDITOR.md](./CONTRACT_EDITOR.md).

## 4. Yousign

[yousign.service.js](../backend/src/services/yousign/yousign.service.js) →
`buildSignerPayload(snapshot, party)`.

L'intégration lit **exclusivement** `contract.signersSnapshot`. Ni les fiches
locales, ni les projections reçues du Panel ne sont consultées au moment de la
signature — elles ont pu changer depuis la validation.

Un cran plus haut, la **demande** de signature est elle-même refusée si
l'entreprise cliente n'est pas prête à signer (§1). Ce refus vit côté Panel,
au point d'usage de la capacité : la garde locale explique, elle ne protège
pas seule.

`first_name` / `last_name` viennent directement du snapshot. L'ancienne heuristique
`splitName()`, qui découpait un nom d'entreprise en deux (« SB Auto » →
`first_name: "SB"`, `last_name: "Auto"` ; « Studio » → `first_name` **et**
`last_name` = « Studio »), a disparu : Yousign reçoit désormais une vraie identité.

Un snapshot absent ou partiel fait échouer la création de la demande avec un
message explicite, plutôt que d'envoyer une identité vide que Yousign rejetterait
de façon opaque. Ce cas ne concerne que les contrats validés **avant** cette
fonctionnalité. Détail du parcours : [SIGNATURE.md](./SIGNATURE.md).

## 5. Migration

`migrateCompanySigners()` dans
[config/bootstrap.js](../backend/src/config/bootstrap.js), exécutée à **chaque
démarrage** (le projet n'a pas de runner de migrations : voir
[ARCHITECTURE.md](./ARCHITECTURE.md)).

```js
updateMany({ signer: { $exists: false } }, { $set: { signer: null } })
```

- **Idempotente par construction** : le filtre `$exists: false` ne matche plus
  rien après le premier passage. Un signataire déjà configuré n'est jamais
  écrasé — c'est couvert par un test.
- **Conservée bien que le champ soit devenu inerte** : elle garantit que la
  forme du document reste lisible, et la retirer réintroduirait des documents
  où le champ est *absent* plutôt que *nul*. Elle ne réactive rien.

### Reprise de l'existant vers le Panel

Un signataire client déjà configuré localement n'est **pas** automatiquement
promu en autorité : rien ne garantit qu'il est encore celui qui engage la
société. La reprise est un geste **explicite** dans le Panel, fiche par fiche,
et seulement lorsque la valeur locale est manifestement la bonne. Le reste est
ressaisi.

**Contrats existants** : `signersSnapshot` reste tel quel. Un contrat déjà
validé garde sa valeur légale et sa signature. S'il n'est pas encore parti en
signature, il faut que le Panel publie l'entreprise cliente, puis créer un
nouveau contrat.

## 6. UI

Il n'y a **plus de formulaire de signataire** dans ce manager. Les deux
identités sont en lecture seule :

| Écran | Ce qu'il montre | Ce qu'il ne fait pas |
|---|---|---|
| « Entreprise développeur » (DEV) | le signataire développeur publié par le Panel | l'éditer |
| « Mon entreprise » (ADMIN) | l'entreprise cliente et son signataire contractuel | l'éditer |
| « Mon contrat » | un blocage explicite si l'entreprise cliente manque | proposer de la configurer |

Le composant `SignerSection` et le miroir de règles `manager/src/lib/signer.ts`
ont été **supprimés**. Un miroir de validation sans formulaire à valider est un
piège : il survit à la disparition de l'écran et invite à le recréer.

Le message affiché quand une identité manque ne dit jamais « configurez-la
ici ». Il renvoie vers l'adresse de contact publiée par le Panel — voir
[CLIENT_COMPANY.md](./CLIENT_COMPANY.md).
## 7. Tests

[contract-signers.test.js](../backend/src/scripts/contract-signers.test.js) —
`npm run test:signers` (64 vérifications) :

- validation impossible sans signataire DEV, puis sans signataire CLIENT ;
- « non configuré » et « incomplet » produisent des messages distincts ;
- validation possible alors que le média email public est vide/désactivé
  (preuve du découplage) ;
- snapshot correctement créé (les 5 champs, les 2 parties) ;
- snapshot immuable : modifier les fiches ne change pas un contrat validé, et un
  nouveau contrat prend bien les nouvelles valeurs ;
- l'intégration de signature envoie l'identité du snapshot, dans l'ordre
  DEV → CLIENT ;
- migration : `null` posé au boot, idempotence, signataire existant préservé ;
- `PUT /api/company` **retire** silencieusement `signer` et enregistre le
  reste — preuve que l'écriture locale a bien disparu sans casser la page.

[client-company.test.js](../backend/src/scripts/client-company.test.js) —
`npm run test:client-company` : l'autorité du signataire, la disponibilité de
signature, et le refus quand l'entreprise cliente manque.
