# Sécurité du rendu des e-mails

Moteur de rendu, échappement, validation HTML. Le document à lire avant de
toucher à
[`emailTemplateRenderer.js`](../backend/src/services/email/emailTemplateRenderer.js)
ou
[`emailTemplateValidator.js`](../backend/src/services/email/emailTemplateValidator.js).

---

## 1. Le modèle de menace

Un template e-mail est **édité depuis une interface web** et **rendu avec des
données fournies par des inconnus** (le message d'un visiteur, son nom, son
téléphone). Trois attaques à empêcher :

| # | Attaque | Défense |
|---|---|---|
| 1 | **XSS stocké** — un template contient `<script>` | Le validator REFUSE le template (§4) |
| 2 | **XSS par variable** — un visiteur écrit `<script>` dans son message | Échappement par défaut (§3) |
| 3 | **Injection de gabarit** — une valeur contient `{{autre.cle}}` pour faire afficher une variable interdite | Substitution en UNE PASSE (§2) |

À quoi s'ajoutent : la pollution de prototype (§2), l'injection d'en-têtes (§3) et
l'obfuscation d'URL (§4).

> **Le destinataire n'est pas la seule victime possible.** Aucun client e-mail
> sérieux n'exécute JavaScript — Gmail, Outlook et Apple Mail le suppriment. Un
> script dans un template ne servirait donc à rien *chez le destinataire*. Il
> servirait **dans le Manager**, où le contenu transite et où d'autres personnes le
> voient. L'interdiction protège l'application autant que l'e-mail.

---

## 2. Le moteur n'évalue rien

```js
// La SEULE opération du moteur.
text.replace(PLACEHOLDER_RE, (raw, key) => resolve(key));
```

Il n'y a **ni `eval`, ni `new Function`, ni expression, ni condition, ni boucle,
ni helper, ni accès dynamique**. Vérifié par un test qui relit le source du
renderer.

C'est volontairement pauvre. Un moteur qui évalue est un moteur qu'on finit par
détourner : le pire scénario n'est pas qu'il manque une boucle, c'est qu'un
template devienne exécutable.

> **Les conditions et les boucles ne font pas partie de ce lot.** Si le besoin
> apparaît, la bonne réponse est presque toujours un **second template** ou une
> variable pré-calculée par le résolveur — pas un moteur plus puissant.

### Les trois propriétés qui tiennent la sécurité

#### a. UNE SEULE PASSE

La substitution est un unique `String.replace`. Une valeur qui **contient**
`{{autre.cle}}` n'est **jamais réinterprétée**.

```
Template : <p>{{email.senderName}}</p>
Valeur   : email.senderName = "{{email.senderAddress}}"
Rendu    : <p>{{email.senderAddress}}</p>     ← texte, PAS résolu
```

Sans cette propriété, le message d'un visiteur pourrait faire afficher une
variable qu'il n'a pas le droit de lire. **Testé.**

#### b. UNE `Map`, JAMAIS UN OBJET

`map.get('__proto__')` renvoie `undefined` ; `obj['__proto__']` renvoie un objet
natif. Une `Map` n'a pas de chaîne de prototype à remonter, donc rien à polluer.

L'entrée est normalisée par `Object.entries` (propriétés **propres** uniquement) :
une valeur héritée ne peut pas se faufiler.

Défense en profondeur : `PLACEHOLDER_RE` ne matche déjà pas `__proto__` (un
segment doit commencer par une **lettre**), et `constructor` — qui matche — n'est
dans aucune liste de variables autorisées, donc refusé. **Testé** dans les trois
cas.

#### c. ÉCHAPPEMENT PAR DÉFAUT

Toute valeur est échappée **sauf** `SAFE_HTML`, qui doit être déclaré
explicitement dans le registre. On ne peut pas produire du HTML par accident.

### Syntaxe acceptée

```js
/\{\{\s*([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*)\s*\}\}/g
```

| Écrit | Résultat |
|---|---|
| `{{company.name}}` | ✅ résolu |
| `{{ company.name }}` | ✅ résolu (espaces tolérés) |
| `{{objet["cle"]}}` | ❌ `INVALID_PLACEHOLDER` |
| `{{__proto__}}` | ❌ `INVALID_PLACEHOLDER` |
| `{{constructor}}` | ❌ `UNKNOWN_VARIABLE` |
| `{{this}}` | ❌ `UNKNOWN_VARIABLE` |
| `{{formater(x)}}` | ❌ `INVALID_PLACEHOLDER` |
| `{{#if x}}` / `{{#each x}}` | ❌ `INVALID_PLACEHOLDER` |

> **Une syntaxe interdite est SIGNALÉE, pas ignorée.** `extractInvalidPlaceholders`
> repère tout `{{ … }}` que la regex a refusé. Sans lui, le DEV croirait avoir
> écrit une variable et le destinataire lirait des accolades.

---

## 3. Échappement

### En contexte HTML — les cinq caractères

```js
& → &amp;    < → &lt;    > → &gt;    " → &quot;    ' → &#39;
```

**Cinq, pas trois.** `"` et `'` sont indispensables dès qu'une valeur atterrit
dans un attribut (`href="{{manager.contractUrl}}"`) : ne traiter que `& < >`
laisserait `" onmouseover="…` s'échapper de l'attribut.

### Dans le SUJET — pas d'échappement, mais pas de CRLF

Le sujet est un **en-tête**, pas du HTML. L'échapper afficherait « Jean &amp;
Marie » chez le destinataire.

En revanche les retours à la ligne sont retirés : `\r\n` dans un en-tête est le
vecteur historique d'**injection d'en-têtes SMTP**.

```
Valeur : "TEST\r\nBcc: pirate@exemple.fr"
Sujet  : "TEST Bcc: pirate@exemple.fr"       ← une seule ligne, aucun en-tête injecté
```

> Brevo reçoit du JSON et ne construit pas l'en-tête par concaténation. On ne
> s'appuie pas sur l'implémentation d'un tiers pour une garantie de sécurité.

### Validation par type

Une valeur qui ne correspond pas à son type **bloque l'envoi** :

| Type | Refusé |
|---|---|
| `EMAIL` | ce qui n'est pas une adresse |
| `URL` | `javascript:`, ou l'absence de `http(s):`/`mailto:`/`tel:` |
| `DATE`/`DATETIME` | date illisible |
| `MONEY` | valeur non numérique |
| `BOOLEAN` | autre chose qu'un booléen |
| `TEXT` | un objet |

Rendre « Invalid Date » ou « [object Object] » dans un e-mail client serait pire
qu'un échec.

### `SAFE_HTML` n'est pas une porte dérobée

Le seul type non échappé reste soumis au refus des balises actives, des
gestionnaires inline et des URL interdites. « HTML dont on accepte les balises »
n'est pas « HTML de confiance ». **Testé.**

---

## 4. Le validator REJETTE, il ne nettoie pas

Aucune tentative d'assainissement : un template dangereux est **refusé**, avec la
raison et la ligne.

**Pourquoi.** Nettoyer silencieusement produirait un contenu que son auteur n'a pas
écrit et ne peut pas relire. Et surtout : **une passe de nettoyage ratée est une
faille, là qu'un refus raté n'est qu'un faux positif.**

> **Conséquence assumée** : l'analyse est faite **au motif**, pas par un parseur
> HTML (il n'y en a pas dans ce projet, et en ajouter un pour valider ce que l'on
> refuse de toute façon serait disproportionné). Elle est donc volontairement trop
> stricte par endroits — `<script` dans un commentaire HTML est refusé. Le DEV
> réécrit sa ligne, personne n'est exposé.
>
> C'est aussi pourquoi l'aperçu du Manager conserve une **seconde barrière**
> (`iframe sandbox=""`) : si un contournement échappait au motif, il n'aurait
> toujours nulle part où s'exécuter. Voir
> [EMAIL_TEMPLATE_EDITOR.md](EMAIL_TEMPLATE_EDITOR.md).

### Balises interdites

| Balise | Raison |
|---|---|
| `script` | contenu actif |
| `iframe`, `frame`, `frameset`, `object`, `embed`, `applet` | contenu embarqué |
| `svg`, `math` | peuvent contenir du script ; vecteurs de mXSS |
| `base` | réécrirait la résolution de toutes les URL relatives |
| `link` | ressource externe (aucun client e-mail sérieux ne la charge) |
| `form`, `input`, `button`, `select`, `textarea` | hameçonnage ; neutralisées par les clients |
| `noscript`, `template`, `portal` | sans objet en e-mail |

### `<style>` est AUTORISÉE

C'est le seul moyen d'avoir des `@media`, donc un e-mail responsive. CSS n'exécute
pas de JavaScript dans un client moderne (`expression()` est mort avec IE).

La valeur des attributs est tout de même inspectée : `style="background:url(javascript:…)"`
est refusé.

### Attributs interdits

- **Tout `on*`** — refusé **par motif** (`/^on[a-z]+$/i`), pas par liste : les
  énumérer serait une liste à trous. `onwhatever` est refusé aussi.
- `srcdoc`, `formaction`, `xlink:href`, `http-equiv` (meta refresh), `ping`.

### URL

**Interdits** : `javascript:`, `vbscript:`, `file:`, `about:`, `blob:`, et `data:`
sauf `data:image/(png|jpe?g|gif|webp);base64,`.

> `data:text/html` est un contournement direct de l'interdiction d'`iframe`.

**Les URL sont normalisées AVANT l'analyse du schéma** — c'est le point qui rend
l'interdiction réelle :

```
href="java&#115;cript:alert(1)"    → décodage entité décimale → REFUSÉ
href="&#x6a;avascript:alert(1)"    → décodage entité hexa     → REFUSÉ
href="  javascript:alert(1)"       → espaces retirés          → REFUSÉ
href="java\tscript:alert(1)"       → contrôles retirés        → REFUSÉ
```

Le navigateur décode l'entité ; un `includes('javascript:')` naïf, non. **Le
décodage doit précéder la décision.** Tous ces cas sont testés.

### Bornes

| Borne | Valeur | Raison |
|---|---|---|
| Sujet | 300 caractères | — |
| HTML | **100 000 caractères** | Gmail tronque au-delà d'environ 102 ko et affiche « [Message tronqué] ». Un template plus gros serait accepté ici puis **mutilé chez le destinataire** — pire qu'un refus franc. |
| Nom | 120 | — |
| Description | 400 | — |

### Retour

```json
{
  "valid": false,
  "errors": [
    { "code": "FORBIDDEN_TAG", "message": "Balise interdite : <script>…", "line": 12 },
    { "code": "UNKNOWN_VARIABLE", "message": "Variable inconnue : « x.y ».", "variable": "x.y" }
  ]
}
```

**Le Manager ne parse jamais la sécurité lui-même** : il reçoit cette liste, déjà
calculée. Une règle appliquée à deux endroits finit par diverger — et un contrôle
côté client n'est de toute façon pas une protection.

---

## 5. Le template est revalidé À CHAQUE RENDU

Pas seulement à la sauvegarde. Le registre a pu changer depuis : **un template
valide hier peut être invalide aujourd'hui sans que personne ne l'ait touché**
(variable retirée du code).

Un placeholder valide mais absent du registre produit `UNRESOLVED_PLACEHOLDER` :
on refuse plutôt que d'envoyer un e-mail où le destinataire lirait
`{{contact.oldField}}`.

Une variable **facultative** non fournie vaut la chaîne vide — jamais `{{cle}}`
laissé en clair.

---

## 6. Couverture

[`email-templates.test.js`](../backend/src/scripts/email-templates.test.js) — 221
assertions, dont :

- XSS échappé (`<script>`, `"` sortie d'attribut, `'`, `&`) ;
- injection de gabarit (valeur contenant `{{x}}` non réinterprétée) ;
- pollution de prototype (`__proto__`, `constructor`) + `Object.prototype` intact ;
- `javascript:` obfusqué par entités décimales/hexa, espaces, contrôles ;
- toutes les balises et tous les attributs interdits ;
- `<style>`/`<table>`/`<img>`/`data:image` acceptés ;
- injection d'en-tête par CRLF dans le sujet ;
- `SAFE_HTML` refusant script/iframe/onclick/javascript: ;
- absence d'`eval`/`new Function` dans le source du renderer.
