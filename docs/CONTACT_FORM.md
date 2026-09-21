# Formulaire de contact public

Route publique, validation, anti-abus, idempotence, interface vitrine.

Voir aussi : [CONTACT_SUBMISSIONS.md](CONTACT_SUBMISSIONS.md) (stockage, Manager),
[CONTACT_EMAIL_NOTIFICATION.md](CONTACT_EMAIL_NOTIFICATION.md) (notification).

---

## 1. La doctrine en une ligne

> **La demande est enregistrée d'abord. La notification est un effet secondaire.**

**Une demande enregistrée n'est JAMAIS annulée par un échec de notification.** Un
visiteur a pris le temps d'écrire : perdre son message parce que Brevo répond 500,
parce qu'aucun administrateur n'existe ou parce que l'expéditeur n'est pas vérifié
serait absurde — il n'aurait aucun moyen de le savoir, et personne n'aurait rien.

L'ordre est donc : **persister → émettre → notifier**. Les deux dernières étapes
ne peuvent pas faire échouer la première.

---

## 2. Route

```
POST /api/public/contact
```

[`routes/public.routes.js`](../backend/src/routes/public.routes.js) — la **seule
écriture publique** du dépôt.

### Entrée

```jsonc
{
  "name": "Jean Dupont",
  "email": "jean@exemple.fr",
  "phone": "06 12 34 56 78",          // facultatif
  "reason": "QUOTE",                   // CODE, jamais un libellé
  "message": "Bonjour, …",
  "pageUrl": "https://exemple.fr/contact",   // facultatif, http(s) uniquement
  "clientSubmissionId": "uuid-v4",     // idempotence (§5)
  "website": "",                       // honeypot (§4)
  "formStartedAt": "2026-07-17T…"      // anti-abus (§4)
}
```

### Sortie — volontairement minimale

```json
{ "success": true, "data": { "submissionId": "uuid" } }
```

**Rien d'autre.** Ni état de l'e-mail, ni identifiant interne, ni destinataire, ni
erreur Brevo, ni détail du dispatcher.

Deux raisons : chaque détail renvoyé à un inconnu est un renseignement gratuit sur
nos systèmes ; et le visiteur n'a pas à savoir si un e-mail est parti — ce qui le
concerne, c'est que sa demande est enregistrée, et elle l'est.

> **Le succès ne dépend pas de la notification.** `201` signifie « votre demande
> existe ». Si l'e-mail échoue, la réponse est **identique** — l'échec est visible
> dans le Manager, pas chez le visiteur.

---

## 3. Validation

[`validators/contact.validator.js`](../backend/src/validators/contact.validator.js)

| Règle | Code |
|---|---|
| Nom non vide, ≤ 120 | `CONTACT_NAME_REQUIRED` / `CONTACT_NAME_TOO_LONG` |
| E-mail valide, ≤ 254 | `CONTACT_EMAIL_INVALID` |
| Téléphone facultatif, normalisé | `CONTACT_PHONE_INVALID` |
| Motif dans la liste | `CONTACT_REASON_INVALID` |
| Message non vide, ≤ 4000 | `CONTACT_MESSAGE_REQUIRED` / `CONTACT_MESSAGE_TOO_LONG` |
| `pageUrl` en http(s) | `CONTACT_PAGE_URL_INVALID` |
| Débit | `CONTACT_RATE_LIMITED` |

**Les codes sont un contrat** : le frontend s'appuie sur eux pour placer le message
sous le bon champ, sans jamais parser une phrase française.

**`.strict()`** : un champ inconnu est **refusé**, pas ignoré. Sur une route
publique c'est une garde réelle — un robot qui poste `{ status: 'RESOLVED' }` ou
`{ submissionId: '…' }` se heurte à un mur.

### Motifs — un CODE, jamais un libellé

```js
INFORMATION · QUOTE · WEBSITE_ISSUE · SERVICE_QUESTION · OTHER
```

Hardcodés dans [`utils/contactConstants.js`](../backend/src/utils/contactConstants.js),
**non configurables** dans ce lot. Le libellé est de l'affichage : il se retraduit
et se reformule. Le code est une donnée : il sert à filtrer, à router, et il
traversera un jour une migration. Stocker « Demande de devis » rendrait toute
évolution du libellé destructrice pour l'historique.

Le libellé est produit **au moment de l'e-mail** (`contactReasonLabel`), jamais
stocké.

### Nettoyage

- `trim` + espaces normalisés sur le nom ;
- e-mail en minuscules ;
- téléphone réduit aux chiffres et `+` (on ne **valide** pas le format
  international : libphonenumber pèserait 150 ko pour un champ facultatif que
  personne ne recompose — un humain rappelle) ;
- message : **retours à la ligne conservés** (ils portent la mise en forme voulue),
  espaces horizontaux normalisés, lignes vides en excès réduites.

**Aucune interprétation HTML.** Le message est stocké en **texte brut** ;
l'échappement est l'affaire du renderer (type `TEXT`) au moment de l'e-mail. Voir
[EMAIL_RENDERING_SECURITY.md](EMAIL_RENDERING_SECURITY.md).

> La borne de longueur s'applique **avant** le nettoyage : sans cela, un mégaoctet
> d'espaces serait normalisé en une ligne et passerait la limite d'après-nettoyage.

---

## 4. Anti-abus

[`services/contact/contactAbuse.js`](../backend/src/services/contact/contactAbuse.js)
— module **pur**, donc testable.

### ⚠️ Ce n'est pas un système anti-spam

**C'est un filtre à faible coût contre les robots génériques**, ceux qui
remplissent tous les champs et soumettent instantanément. **Un spammeur déterminé
le franchit en quelques minutes** : il lui suffit de laisser le honeypot vide et
d'attendre trois secondes.

C'est assumé. Un CAPTCHA coûterait un tiers, une dépendance externe, des données
envoyées à Google, et une barrière réelle pour les utilisateurs de lecteurs
d'écran. Pour un formulaire de contact de garage, le rapport n'y est pas. Si le
volume devient un problème, c'est **à ce moment-là** qu'on paiera ce prix.

### Les règles

| Règle | Seuil | Réglage |
|---|---|---|
| **Honeypot** (`website`) | toute valeur non vide (après `trim`) | Un espace parasite ne rejette pas |
| **Délai de saisie** (`formStartedAt`) | < 2 s ⇒ suspect | **Absent ⇒ accepté** |
| **URL dans le message** | > 4 ⇒ automatisé | Seuil haut exprès |
| **Débit global** | 30 / minute, toutes origines | Dernier rempart d'une attaque distribuée |
| **Débit par IP** | 5 / 15 min | `rateLimit` — voir l'encadré |

**Chaque seuil est réglé du côté permissif** : un faux positif ici coûte un client,
**en silence**. C'est pourquoi un horodatage absent ou illisible est accepté, un
onglet ouvert depuis deux jours aussi, et quatre liens passent encore.

> #### `rateLimit` est INACTIF hors production
>
> [`middlewares/rateLimit.js`](../backend/src/middlewares/rateLimit.js) se
> désactive quand `config.isTest` (qui vaut `!isProd`). Deux conséquences :
>
> 1. **il ne protège rien en développement** ;
> 2. **la suite automatisée ne peut pas l'exercer** — aucun test n'assère un 429.
>
> C'est le comportement de **toutes** les routes limitées du dépôt, pas une
> exception introduite ici. C'est précisément pour cela que les règles qui doivent
> être *vérifiables* vivent dans le module pur : elles sont actives partout et
> testées.

### Réponse neutre

Un rejet renvoie un **succès ordinaire** (`201`) avec un `submissionId` crédible
qui **ne correspond à rien**. Rien n'est créé : ni demande, ni événement, ni e-mail.

**Pourquoi.** Dire « rejeté » à un robot lui apprend exactement quoi corriger : il
retirerait le honeypot au premier essai, attendrait trois secondes au second.

**Le prix, assumé** : un humain victime d'un faux positif croirait sa demande
envoyée. D'où les seuils permissifs, et d'où la **journalisation** de chaque rejet
— un pic de `TOO_FAST` signalerait un seuil mal réglé.

### Observabilité DEV — le rejet n'est plus invisible

La réponse neutre cache le rejet au visiteur ; en **recette**, elle le cachait aussi
au testeur (« succès vitrine, mais rien en base, aucune erreur »). Chaque décision
est désormais tracée pour l'espace DEV
([`contactDiagnostics.js`](../backend/src/services/contact/contactDiagnostics.js),
`GET /api/dev/contact-diagnostics`, panneau DEV de la page « Demandes de contact ») :

- `ACCEPTED` / `DUPLICATE` / `REJECTED_AS_SPAM` (+ motif : `HONEYPOT`, `TOO_FAST`,
  `TOO_MANY_URLS`, `GLOBAL_RATE`), e-mail **masqué**, **jamais le message**. Anneau
  en mémoire, borné (perdu au redémarrage — c'est un outil de recette, pas une archive).
- **Cause fréquente en recette** : l'**autofill** du navigateur remplit le honeypot
  `website` (→ `HONEYPOT`), ou des **essais répétés** épuisent le débit global
  (`GLOBAL_RATE`). Le panneau DEV le montre immédiatement.
- **Distingue aussi le « mauvais backend »** : si la vitrine POST sur une autre
  instance, AUCUNE entrée n'apparaît côté Manager — signe que ce n'est pas l'anti-abus
  mais une URL/instance différente.

> La persistance d'une `ContactSubmission` est **indépendante de Brevo** : sans clé,
> sans expéditeur, sur un 401/429/500 Brevo ou sans administrateur, la demande est
> **enregistrée, visible dans le Manager**, et l'échec de notification est **observable**
> (exécution `DEAD_LETTER` avec un code explicite, aucune fausse livraison `SENT`).
> Seul un rejet **anti-abus** ne crée rien — et il est désormais visible en DEV.

---

## 5. Idempotence

`clientSubmissionId` (UUID) + **index unique PARTIEL** sur
[`ContactSubmission`](../backend/src/models/ContactSubmission.model.js).

```js
{ unique: true, partialFilterExpression: { clientSubmissionId: { $type: 'string' } } }
```

**Partiel, pas `sparse`** : `sparse` ignore les documents dont le champ est
*absent*, mais pas ceux où il vaut `null` — que le schéma pose par défaut. Une
seconde soumission sans clé violerait un index sparse unique.

| Cas | Comportement |
|---|---|
| Même clé rejouée | La demande existante est renvoyée. **Aucun second événement, aucun second e-mail.** |
| Deux clics **simultanés** | L'index tranche (`11000`) ; le perdant renvoie le gagnant. C'est MongoDB qui décide, pas une lecture-puis-écriture qui perdrait la course. |
| Sans clé | Chaque envoi est une demande distincte — comportement voulu. |

**Côté vitrine** : la clé est générée **une fois par formulaire**, pas par
tentative. La regénérer à chaque envoi supprimerait la protection **précisément
quand elle sert** (retry après coupure).

> Le contenu du message **n'est jamais** une clé : deux demandes identiques d'un
> même visiteur sont deux faits distincts.

---

## 6. Interface vitrine

[`components/ContactForm.tsx`](../vitrine/src/components/ContactForm.tsx) ·
logique : [`lib/contactForm.ts`](../vitrine/src/lib/contactForm.ts)

Le formulaire rejoint [`ContactPage.tsx`](../vitrine/src/pages/ContactPage.tsx),
qui n'était qu'informative. Il est **premier dans le DOM** : c'est l'action, le
reste est de l'information — et cela le rend premier en lecture clavier comme sur
mobile.

> **Composant autonome, par nécessité** : `vitrine/src/components/ui.tsx` porte des
> modifications non commitées et n'est pas touché. Le formulaire n'utilise que les
> tokens `--v-*` déjà en place.

### Ce qui est garanti

| Exigence | Comment |
|---|---|
| Labels réels | `<label htmlFor>` — jamais un placeholder en guise d'étiquette |
| Validation inline | Sur `blur` uniquement : « nom requis » dès la première lettre serait faux |
| Chargement | Bouton en « Envoi en cours… », champs désactivés |
| **Double clic** | `if (pending) return` — le garde le plus simple et le plus efficace |
| Succès | Écran dédié + `role="status"` |
| Erreur | `role="alert"`, message sous le champ concerné |
| **Reset** | **Uniquement après succès** |
| **Saisies conservées** | **Rien n'est vidé sur erreur** — le pire moment pour perdre un message est celui où le réseau coupe |
| Téléphone | `type="tel"` + `inputMode="tel"` → pavé numérique |
| E-mail | `type="email"` + `inputMode="email"` → clavier avec `@` |
| Compteur | Affiché **seulement** au-delà de 75 % — « 3972 restants » sur trois mots est du bruit |
| Clavier | Tout est atteignable ; le honeypot ne l'est pas (`tabIndex={-1}`) |

### Le honeypot côté client

```tsx
<div aria-hidden="true" className="absolute left-[-9999px] …">
  <label htmlFor="contact-website">Ne remplissez pas ce champ</label>
  <input id="contact-website" name="website" tabIndex={-1} autoComplete="off" … />
</div>
```

- `aria-hidden` + `tabIndex={-1}` → **invisible aux lecteurs d'écran et à la
  tabulation** : un humain ne peut pas le remplir ;
- `autoComplete="off"` → le navigateur ne le remplit pas tout seul (ce qui
  rejetterait un vrai visiteur) ;
- **hors écran plutôt que `display: none`** : c'est le premier attribut que regarde
  un robot un peu sérieux ;
- **nommé `website`**, jamais « honeypot » : le nom circule dans le HTML public.

### Message de succès

> Votre demande a bien été envoyée. Nous reviendrons vers vous rapidement.

**Ne mentionne ni e-mail, ni administrateur, ni Brevo.** Deux raisons : le visiteur
n'a pas à connaître notre infrastructure, et l'e-mail peut parfaitement avoir
échoué alors que sa demande est bien enregistrée. Ce qu'on lui dit est vrai.

---

## 7. Tests

| Suite | Assertions | Commande |
|---|---|---|
| Backend | **229** | `npm run test:contact` |
| Vitrine (pur) | **68** | `npm test` dans `vitrine/` |

**Le fournisseur Brevo est SIMULÉ. Aucun e-mail réel n'est envoyé.**

Non couvert automatiquement (voir
[CONTACT_REAL_TEST_CHECKLIST.md](CONTACT_REAL_TEST_CHECKLIST.md)) : le rendu réel
du formulaire, le responsive, la navigation clavier effective, le rate limit (§4),
et l'envoi réel vers Brevo.
