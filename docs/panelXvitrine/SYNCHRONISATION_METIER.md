# Synchronisation métier projet → Panel

> Identité et contrat, remontés automatiquement — contrat ≥ 1.4.x.

## 1. Source de vérité

Le projet est propriétaire de ses données ; le Panel n'en détient qu'une
**projection**, faite pour être affichée, cherchée et agrégée.

| Donnée | Source |
|---|---|
| Nom commercial, slogan, logo, favicon, contacts | `Company` |
| URLs site / Manager / backend | `SystemConfiguration.network` |
| Contrat courant | `Contract` |

Le Panel ne modifie jamais ces collections. Un écran qui y écrirait ferait
diverger les deux systèmes en silence.

## 2. Déclencheurs automatiques

| Modèle | Champs surveillés | Entité émise |
|---|---|---|
| `Company` | `name`, `tagline`, `logos`, `media` | `PROJECT_PRESENTATION` |
| `SystemConfiguration` | `network` | `PROJECT_PRESENTATION` |
| `Contract` | `status`, `reference`, `activation`, `pricing`, `archived` | `CONTRACT` |

Les hooks vivent dans les **fichiers de modèle** (`pre`/`post` `save`) : posés
après `mongoose.model()`, ils ne seraient jamais rejoués. Les chemins modifiés
sont capturés **avant** l'écriture — Mongoose les efface ensuite. Les modèles
ne connaissent pas le pont : ils annoncent (`utils/syncNotifier.js`), le pont
écoute.

Ordre garanti : **validation → écriture métier réussie → mise en file → envoi**.
Une panne du Panel n'empêche jamais une sauvegarde dans le Manager.

## 3. Délai attendu

Une rafale de sauvegardes est **regroupée sur 500 ms** — un formulaire qui écrit
trois champs n'émet qu'une photographie, celle de l'état final. L'envoi est
ensuite tenté immédiatement.

**Mesuré de bout en bout : ~800 ms** entre la sauvegarde dans le Manager et la
projection visible côté Panel. L'écran des projets se rafraîchit seul toutes les
**7 secondes** (et au retour sur la fenêtre), en se taisant quand l'onglet est
caché.

## 4. Outbox durable

`PanelOutboxEntry` — une entrée par écriture, avec son statut
(`PENDING`/`SENDING`/`ACKNOWLEDGED`/`REJECTED`), son nombre de tentatives et sa
prochaine échéance. Rétention : les entrées acquittées s'effacent seules après
7 jours (index TTL).

Garantie : **au moins une fois**. Une écriture peut être livrée deux fois — un
accusé perdu, une reprise — et c'est le Panel qui déduplique sur `writeId`.
Promettre « exactement une fois » entre deux systèmes serait faux.

Le `writeId` est **déterministe**, dérivé de `(entityType, entityId,
modifiedAt)` : réémettre un état déjà en file ne crée rien.

### Transaction locale — ce que nous ne faisons pas

Le projet n'utilise **aucune transaction Mongo** (`startSession` /
`withTransaction` n'apparaissent nulle part). Nous n'en simulons pas une :
l'écriture métier a lieu d'abord, la mise en file ensuite. Si cette dernière
échoue, la **réconciliation au démarrage** rejoue l'état courant — la file étant
idempotente, rien n'est dupliqué.

## 5. Reprise

- **Au démarrage** : les entrées `SENDING` orphelines sont libérées, puis
  l'identité et le contrat courants sont reprojetés (réparation d'un trou
  éventuel).
- **Après un échec de transport** : l'écriture repart en file avec un délai
  croissant borné — **15 s, 1 min, 5 min, 15 min, 1 h**. Le premier palier est
  court : une coupure du Panel dure souvent quelques secondes.
- **En marche** : le cycle de synchronisation existant vide la file. Aucun
  minuteur supplémentaire n'a été créé.

## 6. Accusés

`APPLIED` · `DUPLICATE` · `IGNORED` (perdante LWW) → l'écriture sort de la file.
`REJECTED` → elle en sort aussi, avec son motif : une écriture invalide ne doit
jamais boucher la file. Un payload non conforme au schéma du Panel est refusé
avec le code `ENTITY_PAYLOAD_INVALID`, **sans écriture partielle**.

## 7. Action manuelle de secours

« Rafraîchir le Manifest » reste disponible dans l'espace Développeur du Panel.
Ce **n'est plus le parcours normal** : il ne sert qu'à réconcilier après un
incident, ou à vérifier ce que le projet publie.

## 8. Ajouter un type métier (INVOICE, PAYMENT, EVENT, MEETING, TEAM_MEMBER)

Le cœur de la synchronisation est générique. Pour un nouveau type :

1. l'ajouter à `SYNC_ENTITY_TYPES` (les deux miroirs + les deux specs) ;
2. côté Panel, écrire un schéma de payload strict et un projecteur dans
   `services/sync/projectors.js`, puis l'inscrire dans `PROJECTORS` et
   `APPLIED_ENTITY_TYPES` ;
3. côté projet, construire la projection et l'annoncer depuis le modèle
   concerné.

Rien à toucher dans le moteur : déduplication, LWW, anti-écho, accusés et
journal sont déjà écrits, une fois pour toutes.
