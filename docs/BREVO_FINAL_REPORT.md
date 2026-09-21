# Rapport de clôture — Module e-mail (Brevo)

> Document de **fermeture de chantier**. Il fige l'état du module, consigne les
> arbitrages retenus et les dettes réelles, et répond à une seule question :
> le module peut-il être considéré comme terminé ?
>
> Pour comprendre le fonctionnement, lire **[BREVO_MODULE.md](BREVO_MODULE.md)**.
> Ce rapport-ci ne le remplace pas : il le complète par ce qui reste ouvert.

---

## 1. Architecture finale

```
                    ┌─────────────────────────────┐
   Manager          │  Carte « Configuration »    │  ← utilisateur
                    │  Diagnostic                 │  ← développeur
                    └──────────────┬──────────────┘
                                   │ HTTP
   ┌───────────────────────────────┴───────────────────────────────┐
   │                           BACKEND                             │
   │                                                               │
   │  emailConfiguration.service ──┐                               │
   │  (e-mail de test)             │                               │
   │                               ├──► brevoEmail.service         │
   │  emailDelivery.service ───────┘    ▲ GARDE-FOU UNIQUE         │
   │  (tous les envois métier)          │ brevoOperational         │
   │         ▲                          ▼                          │
   │         │                    POST /v3/smtp/email              │
   │  emailReadiness                                               │
   │  (préconditions de CONTENU, template uniquement)              │
   └───────────────────────────────────────────────────────────────┘
                                   ▲
                                   │ webhook = issue réelle
                    ┌──────────────┴──────────────┐
                    │  brevoWebhookIngest.service │
                    │  → EmailDelivery            │
                    └─────────────────────────────┘
```

**Périmètre :** 4 services `brevo/`, 13 services `email/`, 7 utilitaires,
4 modèles, 4 composants Manager, 2 pages, 5 modules de logique pure.

---

## 2. Pipeline complet

```
PENDING ──► SENDING ──► SENT ─────────────► DELIVERED     (webhook)
   │           │          │
   │           │          ├──────────────► DEFERRED       (webhook)
   │           │          └──────────────► HARD_BOUNCED / SPAM /
   │           │                           INVALID / BLOCKED…  (webhook)
   │           └──► FAILED                 l'envoi a été TENTÉ et a échoué
   └──────────────► PRECONDITION_FAILED    rien n'a été tenté
```

`EmailDelivery` est la source de vérité unique. L'issue du test en est
**dérivée** à la lecture (`resolveTestOutcome`), jamais recopiée.

Corrélation par `(provider, providerMode, providerMessageId)`, normalisée par un
helper canonique unique — l'API renvoie le `messageId` avec chevrons RFC, les
webhooks sans.

---

## 3. Règle opérationnelle

**Aucun envoi Brevo sans suivi de livraison opérationnel.**

`getBrevoOperationalReadiness(mode)` est la seule fonction qui en décide, appelée
depuis le driver juste avant le `fetch` — donc structurellement incontournable,
puisque le driver est l'unique entonnoir d'envoi.

La joignabilité est **prouvée et expirable** : 10 min en TEST (tunnel volatil),
60 min en PROD. Deux sources de preuve — un webhook reçu, ou une sonde
`GET …/health` publique et sans effet de bord, qui existe pour briser le blocage
circulaire « pas d'envoi donc pas de webhook ».

---

## 4. États métier

`manager/src/lib/emailStates.ts` définit **un** vocabulaire, et trois traductions
vers lui (configuration, test, livraison).

| État | Sens |
|---|---|
| Configuration requise | identité d'expéditeur absente |
| À tester | enregistré, jamais éprouvé |
| Préparation… | envoi en cours de constitution |
| En attente de confirmation | parti, réception non confirmée |
| Livré | remis au destinataire (webhook) |
| Livraison différée | report temporaire côté destinataire |
| Échec de livraison | non remis |
| Envoi suspendu | refusé avant tout appel, reprise automatique |
| Suivi indisponible | issue inconnaissable |

Trois règles verrouillées par des tests : aucun code technique affiché, aucun nom
de fournisseur dans les états, chaque message porte un geste.

---

## 5. Diagnostic

Outil **de développeur**, séparé de la configuration. `npm run email:diagnostic`
ou un bouton Manager. Processus par élimination, **un seul verdict** (la cause
racine), rapport horodaté écrit côté serveur.

Invariant : `HEALTHY` est impossible tant que le module n'est pas réellement
autorisé à envoyer — le diagnostic interroge la même fonction que le garde-fou.

---

## 6. Webhooks

Authentification Bearer avec fenêtre de rotation. Idempotence par clé composée ;
la timeline est écrite **avant** la mutation de la livraison, ce qui rend un
rejeu inoffensif. Machine de précédence contre les événements tardifs ou
désordonnés.

Deux comportements du fournisseur **établis empiriquement**, contre sa
documentation : il replie `sent` sur `request`, et il accepte `error`. Ne pas
« corriger » ces choix sur la foi de la doc — voir `EMAIL_FORENSIC_AUDIT.md`.

---

## 7. Reprise

Un envoi refusé par le garde-fou est marqué **retryable**. La reprise n'est pas
un balayage périodique : c'est le dispatcher d'événements qui rejoue l'action.

Conséquence à connaître : la reprise **en place** dépend de l'`actionExecutionId`,
qui porte l'idempotence. Les envois automatiques en ont un — ils sont repris sans
doublon. Un envoi manuel n'en a pas et créera légitimement une nouvelle ligne.

---

## 8. Ce qui a changé depuis le début du chantier

78 commits. Les bascules structurantes :

| Avant | Après |
|---|---|
| Brevo reproduit dans le Manager (OTP, expéditeurs, domaines, DKIM/DMARC, synchro) | deux champs et un bouton de test |
| « Fonctionnel » sur la foi d'un `201` | seul un webhook `delivered` l'autorise |
| Envoi possible sans suivi → livraisons éternellement « Accepté » | **suivi obligatoire**, envoi refusé sinon |
| Refus interne écrit `FAILED` (confondu avec un échec fournisseur) | `PRECONDITION_FAILED` + `BREVO_NOT_OPERATIONAL` |
| `messageId` normalisé différemment à l'écriture et à la lecture | un helper canonique unique |
| `sent` souscrit → boucle « Désynchronisé » perpétuelle | retiré, sur preuve empirique |
| Diagnostic manuel (`.env`, logs à copier) | diagnostic autonome, verdict par élimination |
| Trois états affichés simultanément, pouvant se contredire | un seul, dérivé d'une source unique |
| Un même fait nommé de trois façons selon l'écran | un vocabulaire, trois traductions |
| 14 replis affichant une constante backend | aucun |

---

## 9. Arbitrages conservés

Décisions prises et **assumées**, à ne pas « corriger » sans nouveau chantier.

**Un refus n'est pas une erreur HTTP.** Un test bloqué répond `200` avec
`status = FAILED` et un code métier. C'est un *résultat*, pas une panne : le
Manager l'affiche comme tel plutôt que de traiter une réponse d'erreur.

**Le vert est réservé à un fait constaté.** Un envoi accepté mais non confirmé
reste bleu, sur tous les écrans. La règle ne souffre pas d'exception locale —
sans quoi elle ne vaut nulle part.

**Le détail technique n'est pas dans la carte.** Identifiants, codes,
horodatages fournisseur : uniquement dans le diagnostic. La carte est l'outil de
l'utilisateur, le diagnostic celui du développeur.

**Les routes DEV d'événements webhook sont conservées** bien qu'aucun écran ne
les consomme (voir §10). Le journal fournisseur est déjà exploité en production
par le diagnostic et par la réconciliation ; ces routes sont le seul moyen
d'inspecter un événement non rapproché sans ouvrir un shell base de données.

**`emailReadiness` et `brevoOperational` restent distincts.** Le premier vérifie
les préconditions de *contenu* d'un envoi par template, le second l'*autorisation*
d'envoyer. Les fusionner mélangerait deux questions.

---

## 10. Dettes restantes

Cinq dettes **réelles**, vérifiées. Aucune n'est bloquante ; aucune n'est
hypothétique.

### D1 — `assertBrevoOperational` : porte d'entrée jamais empruntée
`backend/src/services/email/brevoOperational.service.js`

Zéro appelant en production ; seul un test l'invoque. Le garde-fou réel appelle
`getBrevoOperationalReadiness` directement, car il lui faut une erreur du driver
portant `retryable: true` — information qu'une `ApiError` 409 ne transporte pas,
et dont dépend `PRECONDITION_FAILED` puis la reprise automatique.

**Conséquence :** le code `BREVO_TRACKING_REQUIRED` et le statut **409 ne sont
produits nulle part**. Ce qui circule est `BREVO_NOT_OPERATIONAL`.

**Risque :** la fonction porte le nom et la documentation du « garde-fou d'envoi ».
Un développeur peut l'appeler depuis un nouveau contrôleur et introduire une
sémantique d'erreur incohérente avec l'existant.

**Recommandation :** supprimer, après avoir transféré vers
`getBrevoOperationalReadiness` les assertions de non-fuite (aucune URL, aucun
secret, aucun statut fournisseur dans les `blockers`) — elles portent sur le même
objet et sont la seule couverture de ce point. Coût ≈ 1 h.
*Non fait : la fonction avait été explicitement demandée en spécification ; sa
suppression est un arbitrage produit, pas un nettoyage.*

### D2 — `readiness.warnings` : champ constant à `[]`
Aucun `warnings.push` n'existe. Quatre consommateurs, tous inertes : une boucle
de log qui ne tourne jamais, deux sérialisations, un bloc d'affichage jamais
rendu. Une condition UI dont la moitié est toujours vraie.

Le texte « L'envoi reste possible » qu'il rendrait est en outre devenu
**trompeur** : `emailReadiness` n'évalue pas le webhook, donc un `ready === true`
ne garantit pas qu'un envoi passera.

**Recommandation :** supprimer (backend + type + UI), ≈ 10 fichiers, ≈ 25 lignes.
L'argument « stabilité du contrat » ne tient pas : le seul consommateur est le
Manager, versionné et déployé avec le backend.

### D3 — Recoupement `emailReadiness` / `brevoOperational`
Trois critères sont évalués **deux fois**, par des chemins de lecture différents :
fournisseur activé, clé présente, expéditeur configuré. Chacun avec ses propres
codes.

Divergence **déjà réelle** : `PROVIDER_NOT_VERIFIED` (clé jamais testée) bloque
un envoi par template, mais pas l'e-mail de test, qui ne passe pas par
`emailReadiness`. Deux chemins, deux verdicts, sur le même état système.

**Recommandation :** faire dépendre `emailReadiness` de `brevoOperational` pour
ces trois critères, plutôt que de les réévaluer. Chantier à part : cela touche le
contrat d'erreur de l'envoi par template.

### D4 — Trois clients API sans appelant
`manager/src/lib/api.ts` : `listBrevoWebhookEvents`, `getBrevoWebhookEvent`,
`getEmailDeliveryEvents`. L'écran correspondant n'a **jamais** été écrit (vérifié
en historique git : le commit qui a livré ces clients n'a créé qu'une page sur
deux). `getEmailDeliveryEvents` est en outre redondante — `getEmailDelivery`
renvoie déjà la timeline.

**Recommandation :** supprimer les trois méthodes côté front. Garder les routes
backend (voir §9). Coût ≈ 30 min.

### D5 — Dette documentaire résiduelle
`docs/Brevo/` contient une vingtaine de documents décrivant l'architecture
abandonnée (OTP, validation d'expéditeur, authentification de domaine). Ils ont
une valeur d'archive mais aucun avertissement ne signale qu'ils sont périmés — un
lecteur peut les prendre pour la référence courante.

**Recommandation :** déplacer sous `docs/Brevo/archive/` avec un en-tête
« architecture abandonnée », ou ajouter un bandeau en tête de chacun.

**Corrigé pendant cette clôture :** `docs/EMAIL_DELIVERY.md` documentait trois
codes supprimés (`EMAIL_SENDER_NOT_VERIFIED`, `DOMAIN_NOT_AUTHENTICATED`,
`DOMAIN_PUBLIC_NOT_AUTHENTICABLE`) et ignorait la règle du suivi obligatoire ;
`BREVO_MODULE.md` et `RX-HARDENING_WEBHOOK_OBLIGATOIRE.md` annonçaient un contrat
HTTP 409 inexistant ; le commentaire d'en-tête d'`emailReadiness` affirmait
qu'aucun envoi ne le contourne — c'est faux depuis la refonte.

---

## 11. Vérification d'architecture

| Invariant | Verdict |
|---|---|
| Une seule règle opérationnelle | **TIENT** — un seul décideur, trois lecteurs. Recoupement partiel avec `emailReadiness` → D3 |
| Une seule source de vérité des statuts | **TIENT** — divergence de vocabulaire corrigée pendant cette clôture |
| Un seul driver Brevo | **TIENT** — un seul émetteur, verrouillé par test statique |
| Un seul pipeline de livraison | **TIENT** — réserve : un test bloqué avant tout appel n'écrit pas d'`EmailDelivery` (rien n'est parti, aucun `messageId` — mais l'état vit alors hors du journal) |
| Un seul point de décision avant le provider | **TIENT** — contrôle final unique et incontournable ; contrôle amont de contenu distinct → D3 |

**Imports :** 0 cycle (vérifié statiquement *et* à l'exécution — un cycle ESM
laisserait des exports `undefined` au chargement), 0 helper mort, 0 composant
mort, 3 routes sans appelant front (conservées, §9).

---

## 12. Tests

| Suite | Résultat |
|---|---|
| Backend (22 suites) | **toutes vertes** |
| Manager (14 suites) | **toutes vertes** |
| Vitrine | **68 vertes** |
| TypeScript | **propre** |
| Build Manager | **OK** |

Aucun test ne dépend d'un état temporaire : chaque suite backend monte sa propre
base en mémoire, et les tests Manager utilisent un horodatage figé.

---

## 13. Recommandation finale

# OUI — le module peut être considéré comme terminé.

**Justification.**

Les cinq invariants d'architecture tiennent. Le défaut fondateur — afficher un
succès qu'on ne peut pas constater — est éliminé à la racine, et la protection
est *structurelle* plutôt que conventionnelle : le garde-fou est placé dans
l'unique entonnoir d'envoi, et deux tests statiques interdisent d'en créer un
second. Un futur développeur ne peut pas le contourner par inadvertance.

Les cinq dettes restantes ont une propriété commune : **aucune n'affecte le
comportement observable**. D1, D2 et D4 sont du code sans appelant — leur coût
est la confusion d'un lecteur, pas un défaut d'exécution. D3 est une divergence
réelle mais dont le seul effet est un refus *plus strict* sur un chemin que sur
l'autre : elle ne peut pas laisser passer un envoi qui devrait être bloqué. D5
est documentaire.

Autrement dit : ce qui reste est de l'**hygiène**, pas de la correction. Aucune
de ces dettes ne justifie de retarder le gel, et aucune ne s'aggravera d'elle-même.

**Réserve honnête :** le module n'a pas été éprouvé en production sur une
durée significative. Les comportements du fournisseur documentés ici ont été
établis par diagnostic sur environnement de test. La règle du suivi obligatoire,
en particulier, n'a jamais rencontré une panne de tunnel réelle en conditions de
production — le mécanisme est testé, sa rencontre avec le terrain ne l'est pas.

---

## 14. Réouverture RX-SIMPLIFY (post-gel)

Un test manuel a révélé un défaut que les tests automatiques ne pouvaient pas
voir : ils vérifiaient la *règle*, jamais la *cohérence de l'écran*.

**Symptôme :** tunnel de test arrêté, et pourtant la carte « Suivi des
livraisons » affichait « Actif » en vert, avec une date de dernier événement
vieille de treize heures — au-dessus d'un bandeau orange « Suivi indisponible ».
Le bouton « Réparer » produisait un message vert de succès sans que rien ne
change.

**Cause 1 — deux sources de vérité.** Le badge « Actif » dérivait du statut
d'ENREGISTREMENT du webhook (`WebhookConfigStatus.CONFIGURED`), qui dit « connu
et aligné chez le fournisseur » et reste vrai quand l'URL est tombée. Le bandeau,
lui, dérivait de l'autorisation d'envoyer. Les deux étaient exacts dans leur
registre, et contradictoires à la lecture.

**Cause 2 — un succès supposé.** L'action de réparation annonçait la réussite dès
que la resynchronisation n'avait pas levé d'erreur. Or resynchroniser parle à
l'API du fournisseur, parfaitement joignable quand c'est NOTRE adresse publique
qui est hors service : l'action « réussissait » donc toujours.

**Corrections :** un écran, trois états (`serviceView`), tous dérivés de
`operational.ready` ; une action unique « Rétablir le service » qui synchronise,
**sonde réellement**, relit l'état, et ne parle de succès que si `ready` est vrai ;
le détail technique replié dans une zone dédiée ; le second bandeau supprimé.

Le backend n'était **pas** en cause : la règle opérationnelle donnait le bon
verdict depuis le début. Le défaut était entièrement dans la présentation — ce
qui explique qu'aucun test ne l'ait attrapé. Des tests d'écran ont été ajoutés
(cohérence état/bouton, absence de code technique, pas de succès sans preuve).

**Leçon pour les prochaines intégrations :** vérifier la règle ne suffit pas ;
il faut aussi vérifier qu'aucun élément d'écran ne dérive d'une autre source
qu'elle.

## 15. Gel

Le module Brevo est **GELÉ**.

Aucune nouvelle fonctionnalité ne doit y être ajoutée sans ouverture d'un
chantier dédié. Les dettes D1 à D5 sont admissibles dans un chantier de
maintenance ; elles ne rouvrent pas celui-ci.

Trois choses à lire avant toute modification :
1. **[BREVO_MODULE.md](BREVO_MODULE.md)** — fonctionnement et raisons
2. **[EMAIL_FORENSIC_AUDIT.md](EMAIL_FORENSIC_AUDIT.md)** — pourquoi certains
   choix contredisent la documentation du fournisseur
3. Le §9 de ce rapport — les arbitrages à ne pas défaire par inadvertance
