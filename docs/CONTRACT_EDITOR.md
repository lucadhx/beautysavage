# Éditeur de zones de signature (Contrats)

Interface DEV pour placer les zones de signature sur le PDF d'un contrat, dans le
Manager (`Contrats` → détail → « Configurer les signatures »). Composant :
[SignatureZoneEditor.tsx](../manager/src/components/contracts/SignatureZoneEditor.tsx).

À ce stade, l'éditeur construit **uniquement notre propre configuration** : rien
n'est envoyé à Yousign (branchement dans un lot ultérieur).

## 1. Interface

- **Document au centre** : rendu multi-pages via `pdfjs-dist` (chaque page dans un
  canvas), scroll vertical, zoom fixe lisible.
- **Sidebar à droite** — trois bandes : en-tête fixe (signataire à placer), liste
  défilante des zones (triée page → y → x), **pied fixe** (« Ajouter une zone »,
  « Enregistrer »). Les actions essentielles restent atteignables quelle que soit
  la longueur de la liste.
- **Zones** : rectangles colorés par signataire, avec libellé. Sélection
  synchronisée document ↔ sidebar.

## 2. Interactions

Ajouter (bouton « Zone » sur une page, ou « Ajouter une zone » dans le pied),
déplacer (glisser le rectangle), redimensionner (poignée en bas-droite),
sélectionner, supprimer. Cliquer le document hors zone désélectionne.

### Barre d'actions de la zone sélectionnée

Une zone sélectionnée affiche une petite barre flottante **juste au-dessus** de
son rectangle (en dessous si la zone touche le haut de la page) :

| Action | Effet |
|---|---|
| **Changer de signataire** | menu compact (couleur + nom), bascule immédiate du propriétaire ; la couleur et la sidebar suivent. Accessible clavier (`menuitemradio`, `Échap`). |
| **Dupliquer** | copie à l'identique — même page, mêmes dimensions, même signataire — avec un nouvel identifiant et un léger décalage ; la copie devient la zone sélectionnée. |
| **Supprimer** | retire la zone (doublon de la sidebar, à portée de curseur). |

La barre suit la zone (positionnée en ratios, comme elle), reste lisible à toute
taille, disparaît dès que rien n'est sélectionné, n'existe pas en lecture seule,
et n'est **jamais** rendue dans le PDF — c'est un artefact d'édition.

> **Implémentation** : la barre est rendue en *sœur* de la zone, jamais dedans.
> La zone capture le pointeur pour le déplacement ; un bouton imbriqué avalerait
> les clics. Même raison pour le libellé, masqué pendant la sélection : la barre
> occupe sa place.

En bordure de page, la copie se décale **dans l'autre sens** : coller au bord
produirait deux rectangles superposés, donc un clic sans effet visible.

Le nom d'une zone suit le rôle (« Signature Client ») **sauf s'il a été
personnalisé** — sinon le libellé mentirait après un changement de signataire.

### Modifications non enregistrées

L'éditeur signale « Modifications non enregistrées », demande confirmation avant
de fermer, et prévient sur fermeture d'onglet. Il annonce aussi les **zones
manquantes** (un signataire sans zone) : la contrainte est exigée à la validation
du contrat, autant la dire pendant l'édition — un changement de signataire peut
justement créer ce manque.

En mode **lecture seule** (`readOnly`, bouton « Voir »), toutes les interactions
sont désactivées — seul l'aperçu colorié + la légende s'affichent. Après
**validation** du contrat, la configuration devient définitivement en lecture seule.

### Opérations sur les zones

Duplication, clamp, changement de rôle et détection de modifications vivent dans
[lib/signatureZones.ts](../manager/src/lib/signatureZones.ts) — module **pur**
(ni DOM, ni réseau), testé par `npm test` (manager).

## 3. Modèle de données

Contrat : [Contract.model.js](../backend/src/models/Contract.model.js).

```
signatureConfiguration {
  version: number            // numéro de la version COURANTE (la dernière)
  locked: boolean            // true après validation du contrat (lecture seule)
  signers: [ { role, displayName, companyName, logo, email, color } ]  // snapshot
  zones:   [ Zone ]          // configuration courante
  versions: [ { version, zones, savedAt, savedBy } ]   // HISTORIQUE
}
```

Deux signataires en V1 : `DEVELOPER` (signe en 1ᵉʳ, violet) et `CLIENT` (bleu).

## 4. Zones & coordonnées

```
Zone {
  id: string                 // identifiant stable côté éditeur
  name: string
  signerRole: 'DEVELOPER' | 'CLIENT'
  page: number               // 1-indexé
  xRatio, yRatio: 0..1        // coin haut-gauche, en RATIO de la page
  widthRatio, heightRatio: 0..1
  type: 'SIGNATURE'
}
```

**Coordonnées NORMALISÉES en ratios** (0..1), indépendantes du zoom et des
dimensions d'écran. Le backend stocke aussi `document.pageSizes` (points PDF
@72 dpi) par page. La conversion des ratios vers les coordonnées absolues Yousign
(pixels) est **centralisée et testée** ailleurs
([yousignCoordinates.js](../backend/src/services/yousign/yousignCoordinates.js)) —
l'éditeur ne manipule que des ratios.

## 5. Versionning

**Chaque sauvegarde crée une version** : `setSignatureConfiguration` incrémente
`version`, remplace `zones` par la nouvelle configuration (le contrat garde donc
toujours **la dernière**), et pousse un snapshot `{version, zones, savedAt,
savedBy}` dans `versions[]` (historique borné aux 50 dernières). Permet l'audit
et un éventuel retour arrière ultérieur.

## 6. Validations

- **À la sauvegarde** (états intermédiaires autorisés) : géométrie uniquement —
  chaque zone dans les bornes de sa page, taille > 0, pas de dépassement de bord,
  page existante. On PEUT sauvegarder une configuration partielle (un seul
  signataire) pour continuer plus tard.
- **À la validation du contrat** (`POST /contracts/:id/validate`) : en plus, il
  faut **au moins une zone `DEVELOPER` ET au moins une zone `CLIENT`**, un PDF
  présent, et les emails des deux parties. La validation **verrouille** la
  configuration (`locked=true`) et fige le snapshot des signataires.

## 7. Endpoints

| Méthode | Route | Rôle |
|---|---|---|
| `POST` | `/api/contracts/:id/document` | Upload PDF (pipeline dédié) |
| `PUT` | `/api/contracts/:id/signature-configuration` | Sauver les zones (crée une version) |
| `POST` | `/api/contracts/:id/validate` | Valider + verrouiller |
| `GET` | `/api/contracts/:id/documents/original` | Télécharger le PDF (viewer) |

DEV uniquement. Voir aussi [CONTRACTS.md](./CONTRACTS.md).
