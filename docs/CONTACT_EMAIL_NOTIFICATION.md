# Notification e-mail des administrateurs

Événement `contact.submitted`, action activée, résolveurs, état réel.

Voir aussi : [CONTACT_FORM.md](CONTACT_FORM.md) · [EMAIL_DELIVERY.md](EMAIL_DELIVERY.md) ·
[DOMAIN_EVENTS.md](DOMAIN_EVENTS.md).

---

## 1. La chaîne

```
POST /api/public/contact
  └─ ContactSubmission PERSISTÉE          ◄── à partir d'ici, rien ne l'annule
      └─ emitAndDispatch('contact.submitted')     best-effort
          └─ DomainEventDispatcher
              └─ notify-admins-contact-submitted  (ENABLED)
                  ├─ CONTACT_NOTIFICATION_RECIPIENTS → une exécution PAR destinataire
                  │     1. Company.contactNotificationRecipients (si non vide)
                  │     2. sinon, adresse support (expéditeur du mode actif)
                  │     3. sinon, RIEN → EMAIL_RECIPIENTS_NOT_FOUND (DEAD_LETTER, DEV)
                  └─ sendEmailHandler   (Reply-To = e-mail du visiteur)
                      └─ EmailDeliveryService  → readiness → Brevo → EmailDelivery
```

> **Une demande enregistrée n'est JAMAIS annulée par un échec de notification.**
> Chaque flèche après « PERSISTÉE » peut échouer sans conséquence sur la demande.

## Destinataires (doctrine)

- **Qui reçoit** : `Company.contactNotificationRecipients` (champ métier explicite,
  édité sur la page *Demandes de contact*, max 5). Ce n'est PAS de la
  configuration Brevo, ni les comptes ADMIN, ni l'expéditeur.
- **Fallback** : liste vide → l'adresse support (expéditeur du mode Brevo actif).
- **Aucune adresse du tout** : la demande reste enregistrée, la notification part
  en `EMAIL_RECIPIENTS_NOT_FOUND` (DEAD_LETTER, visible DEV) — jamais un faux succès.
- **Confidentialité** : une exécution — donc un e-mail INDIVIDUEL — par
  destinataire. Les destinataires ne voient jamais les adresses des autres.
- **Reply-To** : l'e-mail du visiteur. Répondre à la notification écrit
  directement au demandeur ; le `From` reste l'expéditeur configuré.

## Anti-abus (honeypot ≠ décision)

Le honeypot est un **signal**, pas un verdict. Un champ caché rempli par un
autofill de navigateur ne rejette plus la demande : il faut **au moins deux
signaux concordants** (honeypot, soumission trop rapide, excès d'URL) pour
qu'une soumission soit tenue pour un robot. Un signal isolé est **tracé**
(`ContactSubmission.antiAbuseSignals`, DEV) mais la demande est enregistrée
normalement, en NON LU. Le débit global reste un garde infrastructure qui bloque
seul. Le champ honeypot porte un nom non sémantique (`hpCheck`) que les
navigateurs n'autofillent pas.

---

## 2. L'événement

[`utils/domainEventRegistry.js`](../backend/src/utils/domainEventRegistry.js)

```jsonc
{
  "submissionId": "uuid",
  "contactName": "Jean Dupont",
  "contactEmailMasked": "j***@exemple.fr",   // MASQUÉE
  "reason": "QUOTE",
  "submittedAt": "2026-07-17T12:32:00.000Z",
  "source": "PUBLIC_WEBSITE",
  "pageUrl": "…",        // facultatif
  "companyId": "…"       // facultatif
}
```

`entityType: ContactSubmission` · `entityId: submissionId` ·
`retentionClass: OPERATIONAL`

### Ce que le payload ne porte PAS

| Absent | Pourquoi |
|---|---|
| **Le message** | Le journal des événements est **relu par des humains** et exposé par les routes DEV. Le message vit dans `ContactSubmission`, sa seule copie. |
| **L'adresse en clair** | Masquée. Le journal n'a pas à devenir une seconde réserve d'adresses. |
| Le téléphone | Aucun usage pour router l'action. |

Le **nom** y figure : sans e-mail en clair ni message, il rend le journal lisible
(« contact.submitted — Jean Dupont ») sans le transformer en fiche contact.

> `submissionId` **doublonne** `entityId`, volontairement : il rend le payload
> lisible seul dans l'interface DEV, là où `entityId` sert à l'indexation. Le
> résolveur, lui, s'appuie sur `entityId`.

### Idempotence

```
contact-submitted:<submissionId>
```

Unique par construction, **sans donnée personnelle**. Rejouer le dispatch d'une
même demande ne crée jamais un second événement, donc jamais un second e-mail.

### Émission best-effort — fenêtre de perte assumée

`emitAndDispatch` n'échoue **jamais** vers l'appelant (`emitSafe` avale et
journalise). Si le processus meurt **entre** l'écriture de la demande et
l'émission, la demande existe **sans notification**, et rien ne la rejoue.

C'est la limite de tout le dépôt (aucune transaction, `mongod` standalone
autorisé — cf. [DOMAIN_EVENTS.md §4](DOMAIN_EVENTS.md)). **C'est un trou de trace,
jamais une demande perdue** : elle reste visible dans le Manager, qui signale
alors « Aucune notification » plutôt que de laisser un blanc.

---

## 3. L'action

[`utils/domainEventActionRegistry.js`](../backend/src/utils/domainEventActionRegistry.js)

```js
'contact.submitted': [{
  actionId: 'notify-admins-contact-submitted',
  actionType: 'SEND_EMAIL',
  enabled: true,                      // ← ACTIVÉE (lot contact)
  templateId: 'CONTACT_ADMIN_NOTIFICATION',
  recipientResolver: 'ADMIN_EMAILS',
}]
```

> **Pas de champ `variableResolver`** : le résolveur est enregistré **par
> `templateId`** (`registerVariableResolver('CONTACT_ADMIN_NOTIFICATION', …)`).
> Un second champ portant la même valeur finirait par diverger.

### `ADMIN_EMAILS`

[`services/email/emailRecipientResolvers.js`](../backend/src/services/email/emailRecipientResolvers.js)

Tous les comptes `role: ADMIN`, e-mail présent et syntaxiquement valide,
**normalisé et dédupliqué sans tenir compte de la casse**. Une exécution **par
destinataire** : un échec sur l'un ne masque pas un succès sur l'autre, et un retry
ne renvoie pas à tout le monde.

> #### ⚠️ « Comptes inactifs » : la notion n'existe pas
>
> [`User.model.js`](../backend/src/models/User.model.js) ne porte ni `active`, ni
> `disabled`, ni `suspended` — un compte existe ou n'existe pas. **Aucun filtre
> n'est appliqué, et il ne faut pas en inventer un** : un champ `active` créé ici
> serait ignoré partout ailleurs (authentification comprise), ce qui ferait croire
> à une désactivation qui n'existe pas.
>
> `activeUserFilter()` est le **seul** point à modifier le jour où la notion
> apparaîtra.

### Aucun administrateur ⇒ ÉCHEC, pas un SKIP

```
EMAIL_RECIPIENTS_NOT_FOUND · non retryable · DEAD_LETTER immédiat
```

**Changement de comportement introduit par ce lot.** Une action **activée** dont
personne ne reçoit le résultat est un **problème**, pas une décision : `SKIPPED`
rendait l'événement `DISPATCHED` — « tout va bien » — alors que la notification
n'avait pas eu lieu.

**Non retryable** : aucun backoff de dix minutes ne crée un compte administrateur.
Le `DEAD_LETTER` rend le problème **visible tout de suite** dans
`/dev/evenements` ; un humain crée le compte, puis relance à la main.

> Un destinataire **disparu depuis la matérialisation** reste un `SKIP` : cas
> différent, traitement différent — le compte a été supprimé, il n'y a rien à
> réparer, et les autres destinataires ont leur propre exécution.

**La demande, elle, reste enregistrée.** Testé.

---

## 4. Le résolveur de variables

[`services/email/contactVariableResolver.js`](../backend/src/services/email/contactVariableResolver.js)

Il **charge la demande** plutôt que de lire l'événement — qui ne porte ni le
message ni l'adresse en clair. Effet de bord bienvenu : **un retry dix minutes
plus tard envoie ce que la demande contient**, pas une photographie prise à
l'émission.

| Variable | Source |
|---|---|
| `company.name` | Singleton `Company` |
| `contact.name` / `.email` | `ContactSubmission` |
| `contact.phone` | `ContactSubmission`, ou **« Non renseigné »** |
| `contact.reason` | **Libellé** (`contactReasonLabel`), pas le code |
| `contact.message` | Texte brut — **échappé par le renderer** (type `TEXT`) |
| `contact.submittedAt` | Type `DATETIME` → `17/07/2026 à 14:32` (Europe/Paris) |
| `contact.pageUrl` | `ContactSubmission` — **facultative**, voir ci-dessous |
| `manager.contactSubmissionUrl` | **`SystemConfiguration.network.managerUrl`** |

### `contact.pageUrl` — absente, pas vide

Une soumission peut n'avoir aucune page d'origine connue. Le résolveur
**n'émet alors pas la clé**, au lieu de produire une chaîne vide :

```js
...(submission.pageUrl ? { 'contact.pageUrl': submission.pageUrl } : {}),
```

Ce n'était pas le cas, et le défaut était réel : `''` traversait le rendu,
échouait la validation du type `URL`, et la notification finissait en
`DEAD_LETTER`. La donnée n'était pas invalide — elle était absente.

Le gabarit conditionne la ligne entière :

```html
{{#if contact.pageUrl}} … <a href="{{contact.pageUrl}}">…</a> … {{/if}}
```

Pas de libellé orphelin, pas de `href` vide. Une `pageUrl` **présente mais
malformée** reste, elle, un refus : c'est un défaut à corriger. Voir
[EMAIL_TEMPLATES.md](./EMAIL_TEMPLATES.md) § 3.

**Chaque clé est écrite à la main** : un accès générique exposerait un jour un
champ que personne n'avait prévu de publier.

**Aucune URL en dur** : le Manager change d'adresse entre dev, TEST et production.
Une URL codée produirait un lien mort dans un e-mail réel — et personne ne s'en
apercevrait avant qu'un administrateur ne clique. Si `managerUrl` n'est pas
configurée, le résolveur **échoue là où la cause est nommable**, plutôt que de
laisser le rendu se plaindre d'une « variable obligatoire absente ».

**« Non renseigné »** plutôt qu'un blanc : le template affiche la ligne quoi qu'il
arrive, et un vide se lit comme un bug d'affichage.

### Sécurité du message

Le message d'un **inconnu** entre dans un e-mail. Il est de type `TEXT`, donc
**échappé** : `<script>` s'affiche en texte, `{{contact.email}}` n'est pas
réinterprété (substitution en une passe). Voir
[EMAIL_RENDERING_SECURITY.md](EMAIL_RENDERING_SECURITY.md). **Testé de bout en
bout.**

---

## 5. État réel dans le Manager

[`services/contact/contactNotification.service.js`](../backend/src/services/contact/contactNotification.service.js)

La question « les administrateurs ont-ils été prévenus ? » n'a **pas de réponse
dans `ContactSubmission`** : la demande ne sait rien de sa notification — un échec
d'e-mail ne doit pas pouvoir salir la demande. La réponse se reconstruit :

```
ContactSubmission.submissionId
  └─ DomainEvent (entityId, type)
      └─ EventActionExecution[]   (une par admin)
          └─ EmailDelivery        (par actionExecutionId)
```

| Statut | Affiché | Signifie |
|---|---|---|
| `NONE` | « Aucune notification » | **L'émission a échoué** — la demande est là, personne n'a été prévenu |
| `PENDING` | « Envoi en cours » | Au moins une tentative prévue |
| `SENT` | **« Acceptée par Brevo »** | Brevo a accepté pour **tous** |
| `PARTIAL` | « Partiellement envoyée » | Ex. « 2 acceptées par Brevo, 1 en échec » |
| `FAILED` | « Échec » | Tout en échec terminal |
| `SKIPPED` | « Non envoyée » | Rien à envoyer |

> ### « Acceptée » n'est pas « reçue »
>
> **Aucun statut « Délivrée » n'est affiché**, et aucun code ne l'écrit : il
> n'existe pas de webhook Brevo dans ce lot. `SENT` signifie « Brevo a accepté » —
> le message peut encore rebondir. Voir [EMAIL_DELIVERY.md §2](EMAIL_DELIVERY.md).

`FAILED` **retryable** compte comme *en attente*, pas comme un échec : une
tentative est encore prévue, conclure serait mentir. Même règle que
`computeDispatchStatus` — les deux doivent dire la même chose.

`NONE` est traité comme un **avertissement** : un silence n'est pas un succès.

---

## 6. Ce qui peut échouer, et ce qui se passe alors

| Panne | Demande | Notification | Visible où |
|---|---|---|---|
| Journal indisponible | ✅ **enregistrée** | Aucune (`NONE`) | Manager : bandeau ambre |
| Aucun administrateur | ✅ **enregistrée** | `DEAD_LETTER` `EMAIL_RECIPIENTS_NOT_FOUND` | Manager + `/dev/evenements` |
| Expéditeur non vérifié | ✅ **enregistrée** | `DEAD_LETTER` `EMAIL_SENDER_NOT_VERIFIED` | idem |
| `managerUrl` absente | ✅ **enregistrée** | `DEAD_LETTER` (message explicite) | idem |
| Brevo 429 / 5xx | ✅ **enregistrée** | `FAILED` → retry (30 s, 2 min, 10 min) | idem |
| Brevo 401 / 400 / 402 | ✅ **enregistrée** | `DEAD_LETTER` | idem |
| Template désactivé | ✅ **enregistrée** | `DEAD_LETTER` `TEMPLATE_DISABLED` | idem |

**Dans TOUS les cas, le visiteur reçoit la même réponse** : `201` +
`submissionId`. Aucune de ces pannes ne lui est exposée — et aucune ne lui fait
perdre son message.

**Toutes ces lignes sont testées** (`npm run test:contact`).

---

## 7. Tests

`npm run test:contact` — **229 assertions**, fournisseur **simulé**.

Couvert : action activée, 1 admin, 3 admins (une exécution chacun), déduplication,
aucun admin, readiness bloquée, 429, `managerUrl` absente, résolveur (libellé,
« Non renseigné », lien Manager), XSS du visiteur échappé, injection de gabarit,
payload sans PII complète, échec d'émission sans rollback, idempotence.

> **Aucun e-mail réel n'a été envoyé.** Recette :
> [CONTACT_REAL_TEST_CHECKLIST.md](CONTACT_REAL_TEST_CHECKLIST.md).
