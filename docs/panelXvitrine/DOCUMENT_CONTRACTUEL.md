# Document contractuel — emplacement, cycle de vie, accès

> Référence unique. Toute autre documentation renvoie ici plutôt que de
> recopier ces règles : un chemin de stockage décrit à deux endroits finit
> toujours par être faux à l'un des deux.

## 1. Emplacement logique

Un contrat porte **au plus deux fichiers**, jamais confondus :

| Rôle | Champ | Écrit par |
|---|---|---|
| Original déposé | `document.originalFilename` | l'import du PDF dans le Manager |
| Exemplaire signé | `document.signedFilename` | la récupération après signature |

Le signé **n'écrase jamais** l'original. Un contrat signé dont on a perdu
l'original serait invérifiable.

## 2. Emplacement physique

```
<racine backend>/storage/contracts/<contractId>/<uuid>.pdf
```

- `config.paths.contractStorage` est la **seule** source de ce chemin. Aucun
  module ne recompose une variante.
- Le nom de fichier est un **UUID**, pas le nom déposé par l'utilisateur : un
  nom devinable rendrait le stockage énumérable.
- Ce dossier n'est **jamais servi statiquement**. `uploads/` l'est ; `storage/`
  ne l'est pas, et c'est toute la différence entre un logo et un contrat.
- Chaque fichier a son empreinte **SHA-256** en base (`originalChecksum`,
  `signedChecksum`) : un fichier remplacé sur le disque se voit.

### Persistance entre deux déploiements

Le moteur de déploiement **délie** ce dossier de la release :

```
ln -sfn <sharedRoot>/storage  <release>/backend/storage
```

`backend/storage` est donc un lien vers un dossier partagé qui **survit à
toutes les releases**. Déployer n'efface aucun contrat, et un retour arrière
n'en fait pas réapparaître d'anciens. Rien dans ce chemin ne mentionne un
domaine ni un nom de projet : un duplicata écrit dans **son** `sharedRoot`, et
n'hérite jamais des documents du projet modèle.

## 3. Chemin local ≠ URL publique

C'est la confusion la plus coûteuse, alors elle est tranchée ici :

| | Chemin local | Accès |
|---|---|---|
| Quoi | `/…/storage/contracts/<id>/<uuid>.pdf` | `GET /api/contracts/:id/document` |
| Qui le voit | le backend, personne d'autre | un utilisateur authentifié |
| Stabilité | change d'hébergement, de release, de serveur | stable |

**Un chemin disque ne sort jamais d'une API.** Il n'a de sens que pour le
processus qui monte ce disque, et il devient faux au premier changement
d'hébergement.

## 4. Génération, signature, remplacement

1. **Dépôt** — le PDF est validé (magic bytes `%PDF`, chargement `pdf-lib`,
   refus des PDF chiffrés, bornes de taille et de pages), puis stocké.
2. **Zones de signature** — chaque sauvegarde crée une **version** dans
   `signatureConfiguration.versions`. La version courante est
   `signatureConfiguration.version`.
3. **Signature** — Yousign ; le statut vit dans `yousign.status`, les dates de
   signature dans `yousign.devSignedAt` / `adminSignedAt`.
4. **Récupération du signé** — écrit `signedFilename` et `signedFetchedAt`.
5. **Remplacement** — redéposer un original sur un contrat non verrouillé
   remplace le fichier et son empreinte. Un contrat verrouillé refuse.

> Le versionnement porte aujourd'hui sur les **zones de signature**, pas sur le
> fichier : il n'existe qu'un original et qu'un signé. C'est une limite
> assumée, pas un oubli — l'historique de fichiers viendra avec un besoin réel.

## 5. Accès depuis le Panel

Le fichier **ne transite jamais** par la synchronisation. La projection
`CONTRACT` porte des **métadonnées** :

```
document: { available, kind, filename, pageCount, checksum, version,
            signatureStatus, signedAt, generatedAt, downloadPath }
```

`downloadPath` est une **route du projet** — `/api/project-bridge/v1/contracts/
<contractId>/document` — authentifiée par le jeton de pont. Le Panel la relaie
à l'utilisateur ; il ne stocke aucun document contractuel.

Transporter le PDF dans le payload ferait grossir la file de plusieurs
mégaoctets par écriture, pour une donnée dont le Panel n'est pas propriétaire.

## 6. Sauvegarde et restauration

Sauvegarder un projet, c'est sauvegarder **deux choses solidaires** : la base
(qui porte les noms de fichiers et les empreintes) et `<sharedRoot>/storage`
(qui porte les fichiers). L'une sans l'autre ne restaure rien : une base sans
fichiers pointe vers le vide, des fichiers sans base sont des UUID anonymes.

## 7. Sans Panel

Le stockage, la signature et le téléchargement fonctionnent **entièrement sans
Panel**. Le pont n'ajoute qu'une lecture à distance. Un projet dépairé garde
ses contrats, ses fichiers et son écran de gestion — c'est la règle
d'autonomie, et elle vaut ici comme ailleurs.
