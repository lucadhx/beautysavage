# Rapport 4 — Recommandation stratégique

> Couvre **Partie 6 (gains)**, **Partie 7 (coût)**, **Partie 8 (timing React)**,
> **Partie 9 (recommandation finale)**. Décisions cadrées par : **mono-tenant**,
> **migration React non démarrée**, **transactionnel** (pas de marketing/CRM
> omnicanal). Référence les briques retenues aux Rapports 2-3.

---

## PARTIE 6 — Gains attendus

Échelle : faible · moyen · fort · très fort.

### 6.1 Gains techniques

| Gain | Niveau | Justification |
|---|---|---|
| Maintenabilité | **Fort** | Découplage par bus + découpe de `mailService.js` (3800 l.) + helper credentials unique |
| Modularité | Moyen | Drivers fins + handlers d'événements remplacent le couplage contrôleur↔email |
| Extensibilité | Moyen | Ajout provider = 1 entrée + 1 driver ; ajout réaction = 1 abonné. Bénéfice réel surtout si de nouveaux providers/canaux arrivent |
| Testabilité | Moyen | Coffre + helper isolables ; bus moquable. Brevo déjà mockable (`MESSAGING_PROVIDER=mock`) |
| Observabilité | **Fort** | SendLog + webhooks d'engagement + timeline d'événements = visibilité quasi nulle aujourd'hui |

### 6.2 Gains produit

| Gain | Niveau | Justification |
|---|---|---|
| Automatisation | Moyen | Bus permet relances/règles ; mais jobs actuels couvrent déjà le gros |
| Gouvernance | **Fort** | Versioning draft→publish + validation = vrai filet sur édition prod |
| Personnalisation | Faible | Mono-tenant : theme + variables suffisent déjà |
| Expérience utilisateur (admin) | Moyen | Aperçu fidèle, preuve d'envoi, statut email |
| Administration | **Fort** | Rotation/bascule sans redéploiement, secrets masqués, audit |

### 6.3 Gains futurs

| Gain | Niveau | Justification |
|---|---|---|
| IA | Moyen | Façades + coffre = base propre **si** l'IA devient un objectif ; sinon spéculatif |
| Multi-tenant | **Faible / nul** | Pas au programme. Ne pas payer pour ça |
| Nouveaux connecteurs | Moyen | Pattern registre+driver utile si SMS/IA/autre arrivent |
| Nouveaux canaux | Faible | SMS/WhatsApp non prévus ; à réévaluer sur besoin réel |
| Nouveaux workflows | Moyen | Bus = socle pour brancher de futurs workflows sans recâbler |

**Lecture.** Les gains **forts et certains** sont : **sécurité/administration des
secrets**, **observabilité des envois**, **gouvernance des templates**,
**maintenabilité**. Les gains multi-tenant/omnicanal/IA sont faibles ou
spéculatifs — ne pas les financer maintenant.

---

## PARTIE 7 — Coût d'intégration

### 7.1 Complexité par brique

| Brique | Complexité | Note |
|---|---|---|
| Coffre AES-256-GCM + `getCredentials` fail-loud | **Faible→Moyenne** | Bien balisé par la doc IAP ; ~quelques centaines de lignes + tests |
| Bascule test/prod gardée (`setMode`) | Faible | S'appuie sur le coffre |
| Registre `IntegratedApi` allégé (sans multi-tenant) | Faible | Modèle Mongoose + seeds |
| SendLog + webhooks Brevo (delivered/opened/bounced) | **Moyenne** | Endpoint webhook durci (secret + IP + anti-replay), Brevo ne signe pas en HMAC |
| Bus d'événements + catalogue figé | **Moyenne** | In-process (EventEmitter) ; le coût est la **discipline** du catalogue, pas le code |
| Versioning templates draft→publish | **Moyenne** | Évolution du modèle `EmailTemplate` + logique de version |
| Découpe `mailService.js` | Moyenne | Refactor à risque (régression) → tests d'abord |
| UI d'administration (intégrations + Template Studio) | **Forte** | **À faire en React** ; coût doublé si fait en Vanilla d'abord |
| Auto_refresh / multi-tenant / omnicanal / IA | — | **Non retenu** (coût évité) |

### 7.2 Volume de travail (ordre de grandeur)

| Axe | Charge | Détail |
|---|---|---|
| Backend | **Moyen** | Coffre, helper, registre, bus, SendLog, webhooks, versioning |
| Frontend | **Faible maintenant / Moyen après React** | UI différée à la migration React |
| Migration de données | Faible | Migrer 3 secrets `.env`→coffre ; templates existants → v1 publiée |
| Données | Faible | Nouveaux modèles (IntegratedApi, SendLog, EventLog) ; pas de migration lourde |
| Sécurité | Moyen | Gestion de la clé de chiffrement, durcissement webhook, révocation clé `sk_live_` |
| Tests | Moyen | Coffre (encrypt/decrypt/tampering), résolution runtime, SendLog, idempotence webhook |

### 7.3 Dépendances

**Bloquantes**
- Coffre **avant** registre **avant** `getCredentials` **avant** bascule prod.
- Bus/SendLog **avant** webhooks d'engagement.
- **Migration React** bloque toute nouvelle UI d'administration.

**Souhaitables**
- Audit log générique (réutilise le bus d'événements).
- Tests E2E avant la découpe de `mailService.js`.

**Facultatives**
- Façades IA, auto_refresh, canaux additionnels — uniquement sur besoin avéré.

### 7.4 Risques

| Type | Risque | Mitigation |
|---|---|---|
| Technique | Clé de chiffrement absente/perdue → secrets inaccessibles | Validation **bloquante au boot en prod** + script de rotation **écrit avant** la prod |
| Technique | Bus in-process → perte d'événement au crash | Idempotence + persistance des événements critiques (SendLog) |
| Technique | Régression à la découpe de `mailService.js` | Tests E2E préalables ; refactor incrémental |
| Produit | Sur-ingénierie (copier les RFC intégralement) | Périmètre verrouillé au sous-ensemble ; refuser multi-tenant/omnicanal |
| Produit | UI construite 2× (Vanilla puis React) | Différer toute UI à la migration React |
| Organisationnel | Connaissance tribale (projet à 1-2 personnes) | Documenter le coffre + catalogue d'événements |

---

## PARTIE 8 — Timing recommandé (autour de la migration React)

Principe directeur : **tout ce qui est backend pur et corrige une dette
sécurité/observabilité peut se faire maintenant ; toute UI attend React ; les
modèles structurants se conçoivent maintenant, se câblent progressivement.**

### 8.1 Implémentable AVANT la migration React

> Backend pur, sans nouvelle UI ; corrige des dettes critiques/importantes.

1. **🔴 Révocation de la clé `sk_live_` orpheline + audit `.gitignore`** — *immédiat, hors RFC.*
2. **Coffre AES-256-GCM + `getCredentials` fail-loud + sentinelle** (brique IAP).
3. **Registre `IntegratedApi` allégé** (sans `scope/garageId`) + migration des 3 secrets.
4. **Bascule test/prod gardée** (`setMode` + rôles requis) — prêt pour le go-live Stripe.
5. **SendLog + endpoint webhook Brevo durci** (delivered/opened/bounced) → fin de l'invisibilité d'envoi.
6. **Bus d'événements + catalogue figé** (in-process) + émission `email.*` et faits métier clés.
7. **Validation au boot bloquante en prod** + **script de rotation de clé**.

*Justification :* aucune dépend de React ; (1)(4)(5) répondent à des dettes
critiques/importantes ; (6) est une fondation réutilisable. Faire ceci d'abord
**réduit le risque** au passage en production et **n'engendre pas** de travail
jeté.

### 8.2 À ATTENDRE après la migration React

> Tout composant d'**interface**. Le construire en Vanilla puis le réécrire en
> React = travail doublé.

1. **UI d'administration des intégrations** (liste, tokens masqués, toggle mode, test de connexion).
2. **Template Studio** (édition draft→publish, aperçu live, catalogue de variables, validation visuelle).
3. **Console SendLog / timeline** (consultation des envois et de l'engagement en admin).
4. **Composer contextualisé** (envoi manuel depuis une Sale/Booking) si jugé utile.

*Justification :* la valeur de ces écrans dépend d'une UI moderne ; les en faire
en Vanilla serait jeté. En attendant, l'édition directe en base + les logs
couvrent l'exploitation.

### 8.3 À CONCEVOIR maintenant, développer plus tard

> Décisions de modèle/contrat à figer tôt pour éviter une refonte, code différé.

1. **Versioning des templates** : décider le schéma (version, status, archive)
   **maintenant** ; le câbler avec le Template Studio React.
2. **Catalogue d'événements figé** : nommer les événements (`{domaine}.{action}`)
   **maintenant** (même si peu d'abonnés), pour éviter de renommer plus tard.
3. **Façades d'action IA** : définir la liste d'actions (`prepareDraft`, `send`…)
   **si** l'IA est au plan ; coder plus tard.
4. **Audit log générique** : décider qu'il consomme le bus d'événements ;
   implémenter quand le bus est en place.

---

## PARTIE 9 — Recommandation finale

### 9.1 Faut-il intégrer ces technologies ?

**Oui, partiellement et de façon disciplinée.** Pas comme produits à copier, mais
comme **réservoirs de principes** dans lesquels on prélève un sous-ensemble ciblé
qui corrige des dettes réelles. Adopter l'intégralité serait du sur-engineering
pour un institut mono-tenant transactionnel.

### 9.2 Totalement ou partiellement ?

**Partiellement, franchement.** On retient ~30 % de chaque RFC :
- **IAP** : coffre, contrat unique fail-loud, sentinelle, bascule prod gardée,
  registre allégé. **On jette** : multi-tenant, auto_refresh, usage ledger,
  sous-comptes, UI complexe (différée).
- **EDCP** : SendLog + webhooks engagement, bus + catalogue, versioning templates,
  placeholders explicites. **On jette** : identités multiples/OTP/domaines,
  omnicanal, inbound, campagnes, multi-tenant, façades IA (différées).

### 9.3 Quelles parties apportent le plus de valeur ?

1. **Coffre + bascule test/prod gardée** (sécurité — corrige D-I1/D-I2, critiques).
2. **SendLog + webhooks Brevo** (observabilité — corrige D-C1/D-I4/D-C4).
3. **Versioning des templates** (gouvernance — corrige D-C2).
4. **Bus d'événements + catalogue** (maintenabilité/fondation — corrige D-C3).

### 9.4 Quelles parties apportent peu de valeur (ici) ?

Multi-tenant (senders/domaines/clés par locataire, isolation réputation),
omnicanal (SMS/WhatsApp), inbound/réponses, campagnes marketing, auto_refresh
(aucun OAuth), façades IA tant que l'IA n'est pas priorisée, pièce jointe
« document signé » (pas de signature électronique). **Ne rien financer de tout
cela maintenant.**

### 9.5 Meilleur ordre d'implémentation

```
0. (Immédiat, hors RFC) Révoquer la clé sk_live_ orpheline + vérifier .gitignore
1. Coffre AES-256-GCM + getCredentials fail-loud + sentinelle + validation boot
2. Registre IntegratedApi allégé + migration des 3 secrets + fallback env
3. Bascule test/prod gardée (setMode) + script de rotation de clé
4. Bus d'événements + catalogue figé (in-process)
5. SendLog + webhook Brevo durci (delivered/opened/bounced) abonné au bus
6. Versioning des templates (schéma + draft→publish backend)
7. Découpe de mailService.js (après tests E2E)
   ── FRONTIÈRE MIGRATION REACT ──
8. UI intégrations + Template Studio + console SendLog (React)
9. (Conditionnel) Composer contextualisé, façades IA, audit log UI
```

### 9.6 Roadmap recommandée

| Phase | Contenu | Quand | Dette traitée |
|---|---|---|---|
| **P0 — Sécurité immédiate** | Révocation clé live, `.gitignore`, durcissement webhook existant | Maintenant (jours) | D-I1 |
| **P1 — Coffre & secrets** | Étapes 1-3 (coffre, registre, bascule prod) | Avant React | D-I1, D-I2, D-I3 |
| **P2 — Observabilité** | Étapes 4-5 (bus, SendLog, webhooks Brevo) | Avant React | D-C1, D-I4, D-C3, D-C4 |
| **P3 — Gouvernance** | Étape 6-7 (versioning backend, découpe mailService) | Avant/pendant React | D-C2, D-C6 |
| **P4 — Interfaces** | Étape 8 (UI React) | Après React | UX admin |
| **P5 — Conditionnel** | Étape 9 (composer, IA, audit UI) | Sur besoin avéré | — |

> P1 et P2 sont prioritaires car elles ferment des dettes **critiques/importantes**
> sans dépendre de React. P4 attend volontairement React pour ne pas jeter de
> travail.

### 9.7 Risques subsistant même après implémentation

1. **Clé de chiffrement = nouveau secret racine** : sa fuite ou sa perte reste un
   point unique de défaillance (atténué par rotation outillée + boot bloquant,
   jamais éliminé).
2. **Bus in-process** : perte possible d'événement au crash entre publish et
   handler ; acceptable pour l'audit, à surveiller si on automatise des envois
   critiques.
3. **Dépendance Brevo** : toujours un fournisseur unique ; l'abstraction réduit le
   lock-in mais ne supprime pas le risque de panne provider.
4. **Projet à faible effectif** : la discipline (catalogue d'événements, versioning,
   refus du scope-creep multi-tenant/omnicanal) repose sur 1-2 personnes →
   risque de dérive ; la documentation est la principale mitigation.
5. **Go-live Stripe** : la bascule prod gardée réduit le risque mais ne dispense
   pas d'une recette complète en conditions réelles.

---

## Conclusion en une phrase

**Oui à une greffe partielle et disciplinée : extraire des deux RFC le coffre de
secrets + la bascule prod, l'observabilité d'envoi (SendLog/webhooks) et la
gouvernance de templates + un bus d'événements — tout en backend avant React, en
refusant explicitement le multi-tenant, l'omnicanal et l'IA tant qu'aucun besoin
produit concret ne les justifie.**
