# Convention des médias publics du projet

> Logo et favicon publiés au Panel via le manifeste — contrat ≥ 1.4.x.

Le Panel affiche le logo d'un projet client sans jamais en détenir le fichier.
Cette convention dit **où** le média se configure, **quel format** est accepté,
**comment** l'URL absolue est fabriquée, et surtout **ce qui se passe lors d'une
duplication** — l'endroit où une URL mal formée se propage en silence.

---

## 1. Source

| Média | Emplacement |
|---|---|
| Logo métier | `Company.logos.header` |
| Favicon | `Company.logos.favicon` |

Ces deux valeurs se saisissent dans le **Manager**, écran *Entreprise*. Le
projet en reste propriétaire : le Panel n'écrit jamais dedans.

---

## 2. Format accepté

Deux formes, et deux seulement :

- **URL HTTPS absolue** — ex. `https://cdn.exemple.com/logo.png` ;
- **chemin local public** commençant par `/uploads/` — ex. `/uploads/company/logo.png`.

Toute autre valeur (chemin relatif sans barre initiale, URL `http://`, adresse
locale) est **ignorée** : le manifeste omet le champ plutôt que de publier un
lien mort.

---

## 3. Résolution

Un chemin `/uploads/...` n'a de sens que rapporté à l'origine qui le sert. Le
projet le résout donc contre **l'URL publique de son propre backend**
(`SystemConfiguration.network.backendUrl`) :

```
/uploads/company/logo.png
  + https://api.mon-projet.exemple.com
  = https://api.mon-projet.exemple.com/uploads/company/logo.png
```

Règles appliquées par le résolveur unique
`resolvePublicAssetUrl()` (`backend/src/services/networkConfig.service.js`) :

1. le manifeste publie **toujours une URL absolue**, jamais un chemin ;
2. une URL non joignable publiquement (HTTP simple, `localhost`, `.local`,
   `127.0.0.1`) n'est **pas publiée** — l'absence est préférable à un lien mort ;
3. le Panel **ne copie pas le fichier** : il pointe l'URL distante ;
4. le projet reste responsable de rendre cette URL accessible.

En développement local, aucun média n'est publié : c'est attendu, le backend
n'y est pas joignable publiquement.

---

## 4. Duplication

C'est le point sensible. Un projet dupliqué hérite de la configuration du
projet source.

- **Ne jamais recopier une URL absolue pointant vers le projet source.** Le
  duplicata continuerait d'afficher le logo hébergé par l'original —
  durablement, sans que rien ne le signale, et il tomberait le jour où le
  projet source est arrêté.
- **Conserver de préférence un chemin relatif `/uploads/...`.** Il se résout
  automatiquement avec le domaine backend du nouveau projet.
- Les **fichiers d'upload** doivent être présents dans le stockage du duplicata :
  un chemin correct qui ne pointe aucun fichier donne une image cassée.
- La **configuration `Company` du duplicata doit être vérifiée** avant mise en
  production : nom, slogan, logo, favicon.

---

## 5. Revente et mode standalone

- Un repreneur continue de servir ces médias avec **son propre backend** :
  aucune dépendance à L.Y Solution.
- Le Panel **n'est pas requis** pour afficher le logo — la vitrine et le Manager
  le servent directement.
- Changer le domaine backend change **automatiquement** l'URL publique résolue,
  à condition que le logo soit stocké en chemin relatif. Une URL absolue, elle,
  survit au changement de domaine et devient fausse.

---

## 6. Ce que le Panel en fait

Le manifeste transporte `presentation.logoUrl` et `presentation.faviconUrl`.
Le Panel les affiche tels quels. En leur absence, il affiche un **avatar
d'initiales** construit à partir du nom du projet — jamais une image
manquante, jamais un logo inventé.
