# CONTRÔLE QUALITÉ — VITRINE · ADDENDUM « SEO SERVI »

## 1. Statut de ce document

Cet addendum complète le *Contrôle qualité — Vitrine* (`Controle qualité
vitrine.pdf`), il ne le remplace pas. Il précise son **§12 — SEO** et sa
**checklist du §25**, sur un point que le référentiel énonçait sans le
qualifier.

Il est **universel** : aucun de ses articles ne dépend d'un métier, d'un client
ou d'un projet.

---

## 2. L'incident qui a rendu cet addendum nécessaire

Le 31 août 2026, Google Search Console a refusé le plan du site de
`ly-solution.com` :

> Le sitemap peut être lu, mais contient des erreurs.
> **Le sitemap est un fichier HTML.**

Le référentiel exigeait « un sitemap » et « un robots.txt ». Les deux
existaient. Le site fonctionnait, aucune page n'était en erreur, aucune suite de
tests n'échouait, et le déploiement s'était terminé sans une seule alerte.

Ce qui manquait n'était pas le fichier : c'était **la réponse HTTP**.

Le plan était servi sous `/api/public/sitemap.xml`. À l'adresse que tout le
monde essaie et que Search Console reçoit — `/sitemap.xml` — nginx ne trouvait
aucun fichier et appliquait le repli d'application à page unique
(`try_files $uri $uri/ /index.html`). Le moteur recevait donc la **page
d'accueil**, en `text/html`, avec un code **200**.

Un 200 qui ment est pire qu'un 404. Sur un 404, le moteur revient. Sur ce 200,
il conclut que le plan du site *est* une page HTML, et il s'arrête là.

### La leçon, en une phrase

> Une exigence SEO ne porte jamais sur l'existence d'un fichier ou d'une route.
> Elle porte sur la **réponse HTTP que le serveur déployé rend réellement** à
> l'adresse publique concernée.

C'est la même famille de défaut que le type MIME des modules `.mjs` : il
n'existe qu'une fois la configuration serveur et l'application assemblées, et
aucune relecture de code ne peut le voir.

---

## 3. Article 12.bis — Le plan du site est SERVI, pas seulement écrit

### 12.bis.1 Adresse canonique

Le plan du site doit être servi à **`/<domaine>/sitemap.xml`**, à la racine de
l'hôte public.

Une autre adresse peut exister en plus (une route d'API, un plan segmenté), mais
elle ne dispense jamais de celle-ci : c'est celle qui est soumise aux moteurs,
celle que les robots essaient sans qu'on la leur donne, et celle que
`robots.txt` doit annoncer.

### 12.bis.2 Le repli d'application ne doit pas l'atteindre

Toute vitrine servie comme application à page unique possède un repli qui rend
`index.html` pour ce qu'il ne connaît pas. Les adresses de **protocole** —
`/sitemap.xml`, `/robots.txt` — doivent donc être **retirées de ce repli par une
règle serveur de priorité supérieure**, jamais laissées à sa merci.

Sous nginx, c'est une correspondance exacte :

```nginx
location = /sitemap.xml { proxy_pass http://127.0.0.1:<port>/sitemap.xml; }
```

Le signe `=` n'est pas décoratif : il donne à la règle une priorité absolue, en
amont de tout préfixe. Un `location /sitemap.xml` sans `=` fonctionne par
accident, et cesse de fonctionner au premier préfixe plus long ajouté à côté.

### 12.bis.3 Ce que la réponse doit valoir

À `GET https://<domaine>/sitemap.xml`, le site déployé doit rendre :

| Point de contrôle | Exigence |
|---|---|
| Code HTTP | `200` |
| `Content-Type` | un type XML (`application/xml` ou `text/xml`) |
| Premier octet du corps | une déclaration XML ou `<urlset>` / `<sitemapindex>` |
| Validité | XML bien formé, conforme au schéma `sitemaps.org/schemas/sitemap/0.9` |
| Adresses | **absolues**, en `https://`, sur le domaine canonique |

Un `200` porteur de HTML est un **défaut bloquant**, au même titre qu'une page
en erreur. Un `404` est préférable : il est honnête.

### 12.bis.4 L'hôte du plan ne vient jamais de la requête

Les adresses du plan doivent être construites à partir de la **configuration
réseau du projet**, jamais de l'en-tête `Host` reçu. Un `Host` falsifié ferait
sinon publier, sous le domaine du client, un plan de site pointant ailleurs.

Sans URL publique configurée, répondre `404` — jamais un plan à adresses
relatives, qu'aucun moteur n'exploite.

### 12.bis.5 Ce que le plan contient, et ce qu'il tait

**Il contient** les adresses publiques et indexables : l'accueil, les pages et
chapitres **réellement publiés**, les pages de conversion, les documents légaux
effectivement servis.

**Il ne contient jamais** : le Manager, le Panel, l'API, une page
d'administration ou de connexion, une page technique, une démonstration client,
un sous-domaine de démonstration, une page portant `noindex`, ni aucune adresse
non canonique.

### 12.bis.6 Un plan dérivé, jamais figé

Sur un projet dont les pages se créent depuis le Manager sans redéploiement, un
fichier statique posé dans `public/` est faux dès la première page ajoutée. Le
plan doit être **dérivé du contenu publié** au moment de la requête.

---

## 4. Article 12.ter — `robots.txt`

1. Il répond `200` en `text/plain`. Un `200` porteur de HTML est le même défaut
   que ci-dessus, et pour la même raison.
2. Il déclare le plan du site par une **URL absolue** :
   `Sitemap: https://<domaine>/sitemap.xml`. La spécification n'autorise pas de
   chemin relatif sur cette ligne.
3. L'adresse annoncée doit être celle qui **répond** — vérifiée, pas supposée.
4. Il n'interdit aucune page que le site veut voir indexée.
5. Il porte **un seul** en-tête `Content-Type`. Sur un hôte privé où le
   fichier est synthétisé par le serveur, poser le type avec `add_header
   Content-Type` **ne remplace pas** celui que la réponse a déjà : il en ajoute
   un second, et nginx émet `text/plain, text/plain; charset=utf-8`. Deux
   valeurs jointes par une virgule ne sont pas un type de contenu. Utiliser
   `default_type` (et `charset`), jamais `add_header`, pour cet usage.

---

## 5. Article 12.quater — Un seul hôte est public

C'est la précision que le §12 n'apportait pas : il parlait de « pages
techniques », alors que l'infrastructure L.Y Solution expose des **hôtes**
entiers qui ne doivent jamais paraître dans un moteur — Managers, Panel, API,
sites de démonstration.

### 5.1 L'absence du plan ne protège de rien

**Un plan de site est une invitation, pas une clôture.** Un moteur découvre une
adresse par un lien entrant, une barre d'adresse, un référent — et surtout par
les **journaux de transparence des certificats**, où chaque sous-domaine est
publié en clair quelques minutes après l'émission de son certificat.

Ne jamais tenir l'absence d'un hôte dans le `sitemap.xml` pour une protection
contre son indexation.

### 5.2 L'interdiction est portée par la réponse

Tout hôte non destiné au public doit rendre, **sur toutes ses réponses HTML** :

```
X-Robots-Tag: noindex, nofollow
```

et servir son propre `robots.txt` :

```
User-agent: *
Disallow: /
```

Les deux, pas l'un des deux : `robots.txt` demande de ne pas *explorer*, ce qui
n'empêche pas d'*indexer* une adresse connue par ailleurs ; `X-Robots-Tag`
interdit d'indexer, mais n'est lu que si la page est explorée.

### 5.3 Sans rien casser

Cette interdiction n'ajoute qu'un en-tête et un fichier de trois lignes. Elle ne
change ni l'authentification, ni le routage, ni le fonctionnement d'un Manager,
d'un Panel ou d'une API. Une non-indexation obtenue en dégradant un service est
un échec, pas une mise en conformité.

### 5.4 Où cela se décide

Dans le **générateur de configuration serveur du moteur de déploiement**, à
partir du rôle déclaré par le profil du projet — jamais à la main, hôte par
hôte, sur un serveur. Une règle posée à la main ne survit pas au déploiement
suivant, et ne protège que le projet où quelqu'un a pensé à la poser.

---

## 6. Article 12.quinquies — La preuve est la réponse de production

Un contrôle SEO qui ne touche que le code local ne prouve rien : dans
l'incident ci-dessus, le code était correct, les tests étaient verts, et la
réponse servie était fausse.

Avant de déclarer un déploiement terminé, il faut donc **interroger le site en
ligne** et constater, pour l'hôte public :

- `GET /` → `200`, HTML, sans `noindex` ;
- `GET /sitemap.xml` → `200`, type XML, corps XML valide, adresses absolues et
  canoniques, chacune répondant `200` et indexable ;
- `GET /robots.txt` → `200`, `text/plain`, ligne `Sitemap:` absolue et exacte ;

et pour **chaque autre hôte servi** :

- `X-Robots-Tag: noindex` présent ;
- `GET /robots.txt` → `Disallow: /` ;
- le service continue de fonctionner normalement.

### 6.1 Cette vérification appartient au pipeline

Un contrôle qu'un humain doit penser à faire finira par ne pas être fait. La
vérification ci-dessus est donc une **étape du déploiement** : le pipeline
interroge `/sitemap.xml` et `/robots.txt` sur les hôtes publics après la mise en
ligne, et **refuse le déploiement** si le plan répond `200` avec du HTML ou avec
un type non XML.

Un plan absent (`404`) reste toléré : tous les projets du parc n'en publient
pas, et en refuser le déploiement les bloquerait tous pour une exigence qu'ils
n'ont jamais prise. C'est le **200 menteur** qui est interdit.

### 6.2 C'est une ÉTAPE NOMMÉE, et son journal figure au rapport

Un contrôle fondu dans une étape plus large n'existe qu'à moitié : il ne
rassure pas quand il passe, et ne se fait pas remarquer quand il refuse. Le
contrôle SEO doit donc :

1. **porter son propre nom dans la checklist de déploiement** — « Contrôle
   SEO » — au même titre que « Activation HTTPS » ou « Démarrage des
   services » ;
2. **écrire son journal dans le rapport copiable** : pour chaque adresse
   interrogée, l'URL exacte, le code HTTP, le type de contenu et le début du
   corps reçu.

Un rapport qui se contenterait d'annoncer « SEO : ok » ne prouve rien : il
faudrait rouvrir un terminal et refaire les requêtes pour savoir ce qui a été
lu. Le verdict doit être une **preuve**, pas une affirmation.

Et cela vaut **surtout en cas d'échec** : c'est quand un contrôle refuse qu'on
veut voir ce qu'il a lu. Le détail d'une étape en échec doit atteindre le
rapport aussi sûrement que celui d'une étape réussie.

Implémentation de référence :
`backend/src/deployment-engine/health.js` → `checkSeoEndpoints()`, appelée par
l'étape `seo` de `pipeline.js`, déclarée `seo.verify` dans `steps.js`, et
rendue au rapport par `report/markdown.js`.
Non-régression : `backend/src/scripts/seo-endpoints.test.js`.

---

## 7. Ajouts à la checklist obligatoire (§25)

À cocher avant toute livraison ou redéploiement significatif :

- [ ] `https://<domaine>/sitemap.xml` répond **200 en XML** en production, et le
      corps a été **lu**, pas supposé.
- [ ] Les adresses du plan sont absolues, canoniques, et répondent toutes `200`.
- [ ] Le plan ne cite aucun hôte ou chemin privé, technique ou de démonstration.
- [ ] `https://<domaine>/robots.txt` répond **200 en text/plain** et annonce le
      plan par une **URL absolue** qui répond.
- [ ] Chaque autre hôte servi par le projet porte `X-Robots-Tag: noindex,
      nofollow` **et** un `robots.txt` en `Disallow: /`.
- [ ] Ces hôtes fonctionnent toujours normalement après cette mise en
      conformité.
- [ ] La redirection `http://` → `https://` répond `301`.
- [ ] Le comportement de `www.` est décidé : redirection `301` vers le domaine
      canonique, ou absence assumée d'enregistrement DNS.
- [ ] Le déploiement comporte une étape **« Contrôle SEO »** nommée et
      visible, et le **rapport copiable** en porte le journal complet.

---

## 8. Règle de généralisation

Cet addendum est **générique**. Tout nouveau projet Vitrine, toute duplication
et tout Manager déployé par le moteur en héritent par le générateur de
configuration serveur et par l'étape `validate` du pipeline.

Un projet ne doit pas pouvoir être déployé avec un `/sitemap.xml` qui rend du
HTML. Ce n'est plus une consigne de relecture : c'est une garde du moteur.
