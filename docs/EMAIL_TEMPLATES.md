# Templates e-mail

Contenu des e-mails envoyés par la plateforme : registre code-first, variables,
persistance, versions.

Voir aussi : [EMAIL_RENDERING_SECURITY.md](EMAIL_RENDERING_SECURITY.md) (moteur et
sécurité), [EMAIL_DELIVERY.md](EMAIL_DELIVERY.md) (envoi et journal),
[EMAIL_TEMPLATE_EDITOR.md](EMAIL_TEMPLATE_EDITOR.md) (interface DEV).

---

## 1. La doctrine en une page

| Ce que détient le **CODE** | Ce que détient la **BASE** |
|---|---|
| `templateId` | `name` |
| la liste des variables autorisées | `description` |
| le type de chaque variable | `subject` |
| le caractère obligatoire | `html` |
| les valeurs par défaut | `enabled` |
| les données d'exemple | `version` |

**Pourquoi.** Un template est appelé par du code métier qui lui passe des valeurs
précises. Laisser le Manager créer un identifiant produirait un template que
personne n'appelle ; laisser le Manager déclarer une variable produirait un trou
à l'exécution. Les deux erreurs sont **silencieuses** — donc interdites par
construction, pas par convention.

**Trois règles absolues :**

1. **Le template ne connaît jamais le destinataire.** Aucun champ d'adresse
   n'existe dans le modèle, et il ne doit jamais en exister (§4).
2. **Les valeurs viennent du métier**, jamais du template. Aucune variable ne lit
   un objet arbitrairement (§3).
3. **Aucun JavaScript, aucune interpolation non contrôlée.** Le moteur n'évalue
   rien (voir [EMAIL_RENDERING_SECURITY.md](EMAIL_RENDERING_SECURITY.md)).

---

## 2. Le registre

[`backend/src/utils/emailTemplateRegistry.js`](../backend/src/utils/emailTemplateRegistry.js)

```js
{
  templateId: 'CONTACT_ADMIN_NOTIFICATION',
  defaultName: '…',
  defaultDescription: '…',
  defaultSubject: 'Nouvelle demande de contact — {{contact.name}}',
  defaultHtml: '<!DOCTYPE html>…',
  retentionClass: 'OPERATIONAL',
  variables: [
    { key: 'contact.email', label: 'E-mail du contact', description: '…',
      type: 'EMAIL', required: true },
  ],
  sampleVariables: { 'contact.email': 'jean.dupont@exemple.fr' },
}
```

`validateTemplateRegistry()` vérifie ce qu'un humain casse en éditant ce fichier :
clé dupliquée, type inventé, variable requise absente du HTML par défaut, donnée
d'exemple manquante, donnée d'exemple orpheline. Exécuté par les tests.

### Templates initiaux

| `templateId` | Rôle | Branché à un événement ? |
|---|---|---|
| `CONTACT_ADMIN_NOTIFICATION` | Prévient les ADMIN d'une demande de contact | ✅ **Oui** — `contact.submitted` |
| `CONTRACT_CANCELLATION_ADMIN_CONFIRMATION` | Confirme la résiliation au client | **Non** — lot résiliation |
| `CONTRACT_CANCELLATION_DEV_NOTIFICATION` | Prévient l'équipe d'une résiliation | **Non** — lot résiliation |
| `EMAIL_SENDER_VERIFICATION_TEST` | Prouve que la chaîne d'envoi fonctionne | **Non** — test manuel DEV |

> `CONTACT_ADMIN_NOTIFICATION` est **branché et actif** depuis le lot contact :
> son résolveur de variables est enregistré et son action est `enabled: true`.
> Voir [CONTACT_EMAIL_NOTIFICATION.md](CONTACT_EMAIL_NOTIFICATION.md).
>
> Les **deux templates de résiliation** existent, sont éditables et testables, mais
> leurs actions restent `enabled: false` : il leur manque leur résolveur de
> variables. Aucun e-mail de résiliation ne part.

---

## 3. Variables

### Types

| Type | Entrée attendue | Rendu | Échappé ? |
|---|---|---|---|
| `TEXT` | chaîne / nombre | tel quel | **oui** |
| `PHONE` | chaîne | tel quel | **oui** |
| `EMAIL` | adresse valide | tel quel | **oui** |
| `URL` | `http(s):` / `mailto:` / `tel:` | tel quel | **oui** |
| `DATE` | ISO / `Date` | `17/07/2026` | **oui** |
| `DATETIME` | ISO / `Date` | `17/07/2026 à 14:32` | **oui** |
| `MONEY` | **centimes** ou `{ amount, currency }` | `99,00 €` | **oui** |
| `BOOLEAN` | `true` / `false` | `Oui` / `Non` | **oui** |
| `SAFE_HTML` | HTML pré-validé | tel quel | **NON** |

**Tout est échappé sauf `SAFE_HTML`**, qui doit être déclaré explicitement dans le
registre. Une variable ne peut pas devenir du HTML par accident. Aucun template
initial n'utilise `SAFE_HTML` — et même ce type refuse les balises actives.

**`MONEY` est en centimes**, comme partout ailleurs
([`money.js`](../backend/src/utils/money.js)). La forme `{ amount, currency }`
permet de porter la devise avec le montant ; un entier nu vaut EUR.

**Dates en `Europe/Paris`.** L'heure d'été est gérée (14:00 en juillet, 13:00 en
janvier pour un même 12:00 UTC).

### Une variable FACULTATIVE ABSENTE n'est pas une valeur vide

C'est la distinction que ce lot a dû poser, et elle vient d'une panne réelle.

```text
formulaire de contact soumis depuis une page sans URL connue
  → resolveur : contact.pageUrl = ''
  → rendu     : la variable est de type URL
  → validation: '' n'est pas une URL
  → DEAD_LETTER : la notification n'est jamais partie
```

La donnée n'était pas invalide : elle était **absente**. Les transformer en
chaîne vide a fabriqué une valeur fausse, puis un refus légitime sur cette
valeur fausse.

**Règle, appliquée partout :**

| État | Ce que le résolveur produit | Ce que le rendu fait |
|---|---|---|
| valeur présente | la valeur | valide, formate, affiche |
| valeur **absente** | la clé n'est **pas émise** (ou `null`) | ignore le formatage, n'exige rien |
| valeur présente mais **invalide** | la valeur telle quelle | **refuse** — c'est une vraie erreur |

Le troisième cas doit rester un refus : une URL malformée est un défaut à
corriger, pas une absence à absorber.

Concrètement, un résolveur n'émet la clé que s'il a quelque chose à dire :

```js
...(submission.pageUrl ? { 'contact.pageUrl': submission.pageUrl } : {}),
```

### Les blocs conditionnels `{{#if …}}`

Ne pas exiger une variable absente ne suffit pas : sans elle, le gabarit
afficherait « Page : » suivi de rien, ou pire un `<a href="">` — un lien qui
ne mène nulle part et qu'on ne peut pas distinguer d'un lien cassé.

```html
{{#if contact.pageUrl}}
  <tr><td>Page</td><td><a href="{{contact.pageUrl}}">{{contact.pageUrl}}</a></td></tr>
{{/if}}
```

Le bloc entier disparaît quand la variable est absente : pas de ligne vide,
pas de libellé orphelin, pas de `href` vide, pas de `mailto:` cassé.

Ce qui est **volontairement absent** de cette syntaxe :

- pas de `{{#unless}}`, pas de `{{else}}`, pas de comparaison, pas
  d'expression. Un gabarit d'e-mail n'est pas un langage ;
- pas d'imbrication implicite non déclarée : la clé d'un bloc doit être une
  variable **déclarée au registre**, sinon la validation refuse ;
- pas de bloc déséquilibré : une ouverture sans fermeture est refusée à la
  validation, pas découverte à l'envoi.

Les **variables requises** sont vérifiées sur le contenu **hors blocs** : une
variable requise placée à l'intérieur d'un `{{#if}}` ne compterait pas comme
présente, puisqu'elle peut disparaître au rendu.

> Le Panel possède le contenu des gabarits qu'il diffuse. La même syntaxe,
> le même rendu et le même validateur existent donc des deux côtés, en
> miroir. Toute évolution doit être répercutée dans les deux dépôts.

### Résolution des valeurs

[`emailVariableResolvers.js`](../backend/src/services/email/emailVariableResolvers.js)

```js
registerVariableResolver('CONTACT_ADMIN_NOTIFICATION', async ({ event, recipient }) => ({
  'company.name': company.name,   // chaque clé est ÉCRITE À LA MAIN
  'contact.email': event.payloadSafe.email,
}));
```

**Aucun accès générique.** Il n'existe pas de `{{contract.anything}}` qui irait
chercher un champ dans un document Mongo. C'est verbeux, et c'est le but : un
accès générique exposerait un jour un champ que personne n'avait prévu de publier.

**Un résolveur absent est un refus explicite** (`UNKNOWN_RESOLVER`), jamais un
e-mail aux variables vides. Activer une action par mégarde échoue franchement.

> **Résolveurs enregistrés à ce jour** (`emailModule.js`) :
>
> | Template | Résolveur | Enregistré ? |
> |---|---|---|
> | `CONTACT_ADMIN_NOTIFICATION` | [`contactVariableResolver.js`](../backend/src/services/email/contactVariableResolver.js) | ✅ |
> | `CONTRACT_CANCELLATION_*` | — | ❌ *lot résiliation* |
> | `EMAIL_SENDER_VERIFICATION_TEST` | surcharge de démonstration | ✅ |
>
> La **surcharge** d'`EMAIL_SENDER_VERIFICATION_TEST` injecte le vrai expéditeur et
> le vrai mode : y afficher « Mode : TEST » sur un envoi parti en PROD ferait mentir
> le seul e-mail dont la raison d'être est de dire la vérité sur la configuration.

---

## 4. Le destinataire est séparé — et pourquoi

[`emailRecipientResolvers.js`](../backend/src/services/email/emailRecipientResolvers.js)

| Résolveur | Résout | Utilisable par un événement ? |
|---|---|---|
| `ADMIN_EMAILS` | tous les comptes `ADMIN` | oui |
| `DEV_EMAILS` | tous les comptes `DEV` | oui |
| `EXPLICIT_TEST_RECIPIENT` | l'adresse fournie | **non** — route DEV de test uniquement |

Un template est du **contenu**, éditable depuis le web. Un destinataire est une
**décision métier**. Les mélanger aurait deux conséquences :

1. une adresse deviendrait modifiable par quiconque édite un template — un e-mail
   pourrait être détourné sans toucher au code ;
2. l'adresse serait figée dans du contenu, alors qu'elle doit être **recalculée à
   chaque envoi** (un administrateur ajouté hier doit recevoir l'e-mail
   d'aujourd'hui).

`assertResolverAllowedForEvents()` interdit `EXPLICIT_TEST_RECIPIENT` aux actions :
sinon un événement porterait lui-même son destinataire.

**La résolution a lieu deux fois** : à la matérialisation (une exécution par
destinataire) et à l'exécution (retrouver l'adresse derrière la clé). Entre les
deux, la liste peut changer — un compte supprimé produit un `SKIPPED` explicite,
pas une erreur.

**Déduplication** sur l'adresse normalisée : deux comptes partageant une adresse
ne produisent qu'un envoi.

> ### Sur les « comptes inactifs »
>
> **Ce projet n'a pas cette notion.** [`User.model.js`](../backend/src/models/User.model.js)
> ne porte ni `active`, ni `disabled`, ni `suspended` — un compte existe ou n'existe
> pas. Aucun filtre n'est donc appliqué, et **il ne faut pas en inventer un** : un
> champ `active` créé ici serait ignoré partout ailleurs (authentification
> comprise), ce qui ferait croire à une désactivation qui n'existe pas.
> `activeUserFilter()` est le seul point à modifier le jour où la notion apparaîtra.

---

## 5. Persistance

### `EmailTemplate`

[`EmailTemplate.model.js`](../backend/src/models/EmailTemplate.model.js) — un
document par `templateId`. Mongoose borne les **tailles** ; la sécurité du HTML est
l'affaire du validator (un `match:` sur du HTML serait une passoire, et refuserait
sans dire pourquoi).

### Bootstrap — `ensureEmailTemplates()`

`$setOnInsert` **et rien d'autre**. Au second passage, l'opération n'écrit
strictement rien.

- ✅ crée les templates manquants ;
- ✅ **ne réécrit jamais** un template personnalisé ;
- ✅ **ne réinitialise jamais** une version ;
- ✅ sûr en concurrence (`upsert` atomique + index unique ; un `11000` est traité
  comme un succès : le document voulu existe) ;
- ✅ détecte les templates en base absents du registre — **sans les supprimer**.

> **Corollaire assumé** : une amélioration du HTML par défaut ne parvient **jamais**
> aux installations existantes. C'est le prix à payer pour ne jamais détruire le
> travail de quelqu'un. L'onglet Versions permet de comparer à la main.

> **Templates orphelins** : un `templateId` en base sans définition dans le code est
> journalisé en `warn`, **jamais supprimé, jamais servi, jamais exécuté**. Un
> identifiant peut disparaître par erreur de rebase autant que par décision.

### Versions

[`EmailTemplateVersion.model.js`](../backend/src/models/EmailTemplateVersion.model.js)
— **collection séparée**, et non un tableau dans le document comme
`signatureConfiguration.versions[]` : un template pèse jusqu'à 100 ko, cinquante
versions embarquées dépasseraient la limite de 16 Mo d'un document MongoDB.

| Règle | Détail |
|---|---|
| Une version par sauvegarde réussie | `origin: BOOTSTRAP \| EDIT \| RESTORE` |
| **Une restauration CRÉE une version** | restaurer v3 depuis v7 produit une **v8** |
| L'historique n'est jamais réécrit | v4–v7 existent toujours ; on peut revenir sur une restauration |
| Plafond : 50 versions | les **plus anciennes** sont purgées, jamais les récentes |
| Une version peut devenir irrestaurable | revalidée à la restauration : une variable retirée du code la condamne |

Index unique `(templateId, version)` : sans lui, deux sauvegardes concurrentes
écriraient deux contenus différents sous le même numéro.

### Version optimiste

Le `PUT` exige `expectedVersion`, et le filtre d'écriture porte dessus :

```js
EmailTemplate.findOneAndUpdate({ templateId, version: current.version }, …)
```

Si quelqu'un a enregistré entre-temps, le filtre ne matche pas et **l'écriture n'a
pas lieu** → `409 VERSION_CONFLICT` avec `currentVersion`. Sans cela, deux onglets
ouverts s'écraseraient en silence.

---

## 6. Fichiers

| Fichier | Rôle |
|---|---|
| [`utils/emailTemplateRegistry.js`](../backend/src/utils/emailTemplateRegistry.js) | **Registre canonique** |
| [`utils/emailTemplateConstants.js`](../backend/src/utils/emailTemplateConstants.js) | Types, codes, bornes, sécurité |
| [`models/EmailTemplate.model.js`](../backend/src/models/EmailTemplate.model.js) | Persistance |
| [`models/EmailTemplateVersion.model.js`](../backend/src/models/EmailTemplateVersion.model.js) | Historique |
| [`services/email/emailTemplate.service.js`](../backend/src/services/email/emailTemplate.service.js) | Bootstrap, CRUD, versions |
| [`services/email/emailVariableResolvers.js`](../backend/src/services/email/emailVariableResolvers.js) | Valeurs |
| [`services/email/emailRecipientResolvers.js`](../backend/src/services/email/emailRecipientResolvers.js) | Destinataires |

**Tests** : [`email-templates.test.js`](../backend/src/scripts/email-templates.test.js)
(`npm run test:email-templates` — 221 assertions).

---

## 7. Ajouter un template

1. **Déclarer** la définition dans `EMAIL_TEMPLATE_REGISTRY` (variables typées +
   `sampleVariables` pour chacune).
2. **Redémarrer** le backend : `ensureEmailTemplates()` le crée.
3. **Enregistrer un résolveur de variables** (`registerVariableResolver`) —
   sans lui, tout envoi est refusé.
4. **Déclarer l'action** dans `domainEventActionRegistry`, avec un
   `recipientResolver`.
5. **Activer** (`enabled: true`) seulement quand les trois précédents sont faits.
6. **Mettre à jour l'onglet Guide** — voir
   [EMAIL_TEMPLATE_EDITOR.md](EMAIL_TEMPLATE_EDITOR.md) §Règle de développement.
