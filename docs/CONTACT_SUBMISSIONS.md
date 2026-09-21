# Demandes de contact — stockage et gestion

Modèle, statuts, API Manager, confidentialité, rétention.

Voir aussi : [CONTACT_FORM.md](CONTACT_FORM.md) (dépôt),
[CONTACT_EMAIL_NOTIFICATION.md](CONTACT_EMAIL_NOTIFICATION.md) (notification).

---

## 1. Modèle

[`models/ContactSubmission.model.js`](../backend/src/models/ContactSubmission.model.js)

```jsonc
{
  "submissionId": "uuid",              // identifiant PUBLIC, celui des URL
  "clientSubmissionId": "uuid|null",   // idempotence (index unique partiel)
  "companyId": "ObjectId|null",
  "source": "PUBLIC_WEBSITE",
  "contact": { "name": "…", "email": "…", "phone": "…" },
  "reason": "QUOTE",                   // CODE
  "message": "…",                      // TEXTE BRUT — seule copie
  "pageUrl": "…", "referrerUrl": "…",
  "status": "NEW",
  "assignedToUserId": "ObjectId|null",
  "metadataSafe": { "userAgentFamily": "Chrome", "locale": "fr" },
  "submittedAt": "…", "firstViewedAt": "…|null", "resolvedAt": "…|null"
}
```

> **Aucun modèle générique n'existait** à étendre : l'audit a vérifié que le dépôt
> n'a ni « demandes », ni « devis », ni « leads » (les occurrences de `quote`
> concernent le **mode tarifaire** des services). D'où une collection dédiée.

### C'est la SEULE copie du message

Le `DomainEvent` n'en porte pas (§[CONTACT_EMAIL_NOTIFICATION](CONTACT_EMAIL_NOTIFICATION.md)),
`EmailDelivery` n'en porte pas (le journal ne conserve pas le HTML rendu). Le
contenu du message n'existe **qu'ici**.

C'est voulu : **une donnée personnelle doit avoir un seul domicile**, celui où l'on
pense à aller la chercher le jour d'une demande d'effacement.

### Ce qui n'est PAS collecté

| Non collecté | Pourquoi |
|---|---|
| **IP** (même hachée) | Un formulaire de contact n'en a besoin ni pour répondre, ni pour qualifier. L'anti-abus non plus : il travaille sur le **geste** (honeypot, délai) et sur un compteur en mémoire, pas sur l'identification. Collecter « au cas où » créerait une donnée à protéger, documenter et purger — en échange de rien. |
| Cookies, jetons | Sans objet sur une route publique |
| Empreinte de navigateur | Aucun usage |
| **User-Agent complet** | **Quasi-identifiant.** Seule la FAMILLE est gardée (« Chrome ») — assez pour diagnostiquer un bug d'affichage, pas pour identifier |
| En-têtes bruts, payload | Aucun usage |

`referrerUrl` est lu dans l'**en-tête**, jamais demandé au client : il n'a pas à
pouvoir le choisir.

### Index

| Index | Usage |
|---|---|
| `clientSubmissionId` **unique partiel** | Idempotence — voir [CONTACT_FORM.md §5](CONTACT_FORM.md) |
| `status + submittedAt` | Liste filtrée |
| `submittedAt` | Liste + pagination par curseur |
| `contact.email + submittedAt` | Regrouper les demandes d'une même personne |
| `reason + submittedAt` | Filtre par motif |

---

## 2. Statuts et transitions

```
NEW ──┬─► IN_PROGRESS ──┬─► RESOLVED ──┬─► IN_PROGRESS   (réouverture)
      │                 │              └─► ARCHIVED
      ├─► RESOLVED      └─► ARCHIVED
      └─► ARCHIVED

ARCHIVED ──► NEW   (remise dans le flux)
```

Une **table**, pas un moteur de workflow. Le besoin est de refuser l'absurde
(« archivée » → « en cours » sans repasser par la case départ), pas de modéliser
un processus. Une table de quatre entrées se lit d'un coup d'œil ; un moteur
configurable demanderait une interface, une validation, et finirait par être
configuré une seule fois.

**Le backend est l'autorité.** Une transition interdite est refusée même si
l'interface la proposait — un `curl` ne s'embarrasse pas de l'interface. Les
transitions permises sont **renvoyées par le serveur** (`allowedTransitions`) : le
Manager ne recopie pas la table, il ne peut donc pas la laisser diverger.

`from === to` est **refusé** : un no-op n'est pas une transition.

### Les dates suivent le statut

| Date | Règle |
|---|---|
| `firstViewedAt` | Posée à la **première** ouverture, par une écriture **conditionnelle** (`firstViewedAt: null` dans le filtre) : deux administrateurs qui ouvrent en même temps ne peuvent pas se voler la date. **Jamais réécrite** — c'est un fait. |
| `resolvedAt` | Posée en entrant dans `RESOLVED`, **effacée en en sortant**. Une date de résolution laissée sur une demande rouverte affirmerait qu'elle est réglée. |

---

## 3. API Manager

Toutes : **ADMIN et DEV**
([`routes/contactSubmission.routes.js`](../backend/src/routes/contactSubmission.routes.js)).

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/admin/contact-submissions` | Liste paginée + compteurs + état de notification |
| GET | `/api/admin/contact-submissions/:submissionId` | Détail (**marque la 1ʳᵉ lecture**) |
| PATCH | `/api/admin/contact-submissions/:submissionId/status` | Transition |
| PATCH | `/api/admin/contact-submissions/:submissionId/assignment` | `{ userId }` — `null` désassigne |

**Ni `POST`, ni `DELETE`.** Une demande est un fait déposé par un visiteur : elle
ne se fabrique pas depuis le back-office. Et la rétention est une décision métier
qui n'a pas été prise (§5) — `ARCHIVED` la sort du flux sans détruire.

**`PATCH` et non `PUT`** : on modifie *un* aspect. Le contenu déposé par le
visiteur n'est éditable par personne.

> **Pourquoi le DEV y accède aussi** : il est le seul à pouvoir diagnostiquer une
> notification en échec. L'ADMIN est le destinataire naturel — ce sont ses clients
> qui écrivent.
>
> Le RBAC vit **au montage, une fois**. Aucun composant Manager ne le rejoue : un
> contrôle dupliqué dans une vue finit par diverger, et n'a de toute façon jamais
> protégé quoi que ce soit.

### Filtres

`status` · `reason` · `search` · `from` · `to` · `limit` · `cursor` — en
`.strict()` : un filtre inconnu est un 400.

`search` porte sur le nom, l'e-mail et le message. **La saisie est échappée**
(`escapeRegex`) : sans cela, `a(` ferait planter la requête et `.*` ramènerait
tout.

### Pagination par CURSEUR

`?cursor=<submittedAt ISO>`, pas `skip`. Une demande arrivant pendant la
consultation décalerait tout et ferait **sauter une ligne** d'une page à l'autre.
Le curseur est immunisé contre l'insertion.

`limit` est borné **côté serveur** (100 max) : `?limit=99999` ramènerait la base.
La borne est appliquée **à deux endroits** — le validator donne une erreur
lisible, le service garantit qu'aucun appelant (script, test) ne la contourne en
sautant la validation.

### État de notification

Joint à **chaque ligne** de la liste, calculé **en lot** (3 requêtes quelle que
soit la taille de la page). Une requête par ligne (N+1) rendrait la liste
inutilisable dès quelques dizaines de demandes.

Voir [CONTACT_EMAIL_NOTIFICATION.md §4](CONTACT_EMAIL_NOTIFICATION.md).

---

## 4. Interface Manager

[`pages/ContactSubmissionsPage.tsx`](../manager/src/pages/ContactSubmissionsPage.tsx) ·
logique : [`lib/contactSubmissions.ts`](../manager/src/lib/contactSubmissions.ts)

Route `/demandes-contact`, section principale du menu — montée **sans**
`RequireDev` : l'ADMIN est le destinataire, l'exclure n'aurait aucun sens.

### Ce que l'interface fait

- liste filtrable (statut, motif, recherche débattue à 350 ms), tri par date
  décroissante, chargement incrémental par curseur ;
- **une demande jamais ouverte se repère sans lire** (pastille) ;
- **une notification en échec saute aux yeux depuis la liste** — c'est là qu'un
  administrateur regarde ;
- détail : message complet, coordonnées, page d'origine, suivi, notification ;
- transitions **fournies par le serveur** ;
- « M'assigner » / retirer ;
- **répondre par `mailto:`**, sujet pré-rempli avec le libellé du motif.

### Ce que l'interface ne fait PAS — et pourquoi

**Ce n'est pas un CRM.** Ni conversation, ni pièce jointe, ni réponse depuis le
Manager : ces fonctions demandent un fil, un stockage et une identité d'expéditeur
par utilisateur. Tant que le besoin n'est pas exprimé, `mailto:` fait le travail
avec l'outil que l'ADMIN utilise déjà.

**Aucun bouton « renvoyer l'e-mail » côté ADMIN.** Le renvoi manuel reste dans
`/dev/evenements`, où le DEV a le contexte (tentatives, erreur, backoff). Un
bouton ici donnerait à l'ADMIN un levier qu'il ne peut pas interpréter.

Le message est rendu en `whitespace-pre-line` : les retours à la ligne du visiteur
sont conservés, **rien n'est interprété** (React échappe — un `<script>` s'affiche
tel quel).

---

## 5. Confidentialité et rétention

| Donnée | Où | Traitement |
|---|---|---|
| Message | `ContactSubmission` **uniquement** | Jamais dans l'événement, jamais dans le journal d'envoi |
| E-mail complet | `ContactSubmission` | **Masqué** dans `DomainEvent` et `EmailDelivery` |
| Nom | `ContactSubmission` + `DomainEvent.payloadSafe` | Le nom seul, sans e-mail en clair, rend le journal lisible sans le transformer en fiche contact |
| Adresse dans les **logs** | — | **Jamais en clair** : `maskEmail` partout |

**Accès** : ADMIN + DEV, authentifié. **Aucune lecture publique.**

### ⚠️ Rétention : documentée, PAS automatique

```js
CONTACT_RETENTION = { class: 'CONTACT_SUBMISSION', recommendedDays: 365, automatic: false }
```

**Aucun index TTL n'est posé, et c'est délibéré.** Une demande de contact est une
**donnée métier** (un prospect, une réclamation), pas un log. La supprimer
automatiquement au bout de N mois est une **décision métier qui n'a pas été
prise** — un TTL aveugle effacerait des demandes qu'on voulait garder.

La durée ci-dessus est une **recommandation** (alignée sur `RETENTION_DAYS.
OPERATIONAL` des événements) pour le jour où la politique sera décidée. La purge
sera alors un **script explicite**, comme pour les événements.

---

## 6. Fichiers et tests

| Fichier | Rôle |
|---|---|
| [`utils/contactConstants.js`](../backend/src/utils/contactConstants.js) | Motifs, statuts, transitions, codes, bornes, rétention |
| [`models/ContactSubmission.model.js`](../backend/src/models/ContactSubmission.model.js) | Persistance |
| [`services/contact/contactSubmission.service.js`](../backend/src/services/contact/contactSubmission.service.js) | Création, liste, statut, assignation |
| [`services/contact/contactNotification.service.js`](../backend/src/services/contact/contactNotification.service.js) | État de notification |
| [`controllers/contactSubmission.controller.js`](../backend/src/controllers/contactSubmission.controller.js) | Manager |
| [`lib/contactSubmissions.ts`](../manager/src/lib/contactSubmissions.ts) | Logique Manager (pure) |

**Tests** : `npm run test:contact` (229) · `manager/ npm test` (79 pour ce module).
