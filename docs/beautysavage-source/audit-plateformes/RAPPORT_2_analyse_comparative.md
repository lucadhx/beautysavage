# Rapport 2 — Analyse comparative (existant vs architectures proposées)

> Couvre la **Partie 2 (cartographie des dettes)** et la **Partie 3 (analyse des
> deux architectures cibles)** de la mission. Référence les dettes du Rapport 1
> (codes `D-I*` intégrations, `D-C*` communication).

---

## PARTIE 2 — Cartographie des dettes

Échelle : **Critique** (sécurité/perte de données/blocage prod) · **Important**
(maintenabilité/produit à moyen terme) · **Confort** (qualité de vie).

### 2.1 Dette de maintenabilité

| # | Dette | Niveau | Impact | Coût futur si non traitée |
|---|---|---|---|---|
| D-C6 | `mailService.js` monolithique (~3800 l. : templates + rendu + envoi) | Important | Toute évolution email touche un fichier géant ; risque de régression | Croît avec chaque template ; ralentit la réécriture React |
| D-I5 | Pas d'abstraction provider (SDK appelés en dur) | Confort | Changer Brevo/Stripe = réécriture | Faible tant qu'on ne change pas de fournisseur |
| D-C3 | Pas de bus d'événements ; déclencheurs email couplés aux contrôleurs | Important | Logique métier et notification mêlées ; difficile d'ajouter un canal/une règle | Chaque nouveau déclencheur recâble un contrôleur |
| D-C5 | Emails et notifications in-app = deux chemins non unifiés | Confort | Double maintenance | Divergence des deux systèmes |
| D-I-arch | Secrets lus via `process.env` partout | Confort | Pas de point unique | Faible (mono-tenant, peu de providers) |

### 2.2 Dette de sécurité

| # | Dette | Niveau | Impact | Coût futur si non traitée |
|---|---|---|---|---|
| D-I1 | Secrets en clair dans `.env`, **clé d'allure `sk_live_` orpheline** | **Critique** | Fuite `.env` = compromission totale ; clé live potentiellement exposée | Incident de sécurité, fraude paiement |
| D-I2 | Pas de bascule test→prod gouvernée | **Critique** (au moment du go-live) | Oubli de clé prod → indispo, ou appel prod en contexte test | Incident au lancement |
| D-I3 | Rotation non outillée | Important | Rotation = redémarrage manuel, pas de période de grâce | Rotation reportée → clés anciennes qui traînent |
| D-C1 / D-I4 | Aucun log d'envoi ; échec Brevo silencieux | Important | Pas de preuve d'envoi, email critique perdu sans trace | Litiges, support à l'aveugle |
| AUDIT | Pas d'audit log (qui a fait quoi) | Important | Aucune traçabilité des actions admin/dev | Forensic impossible, conformité faible |
| Multi-tenant | — | **Sans objet** | Mono-tenant : pas de risque d'isolation | — |

### 2.3 Dette produit

| # | Dette | Niveau | Impact | Coût futur si non traitée |
|---|---|---|---|---|
| D-C2 | Pas de versioning/gouvernance des templates | Important | Édition prod sans filet ; pas de rollback | Régression de contenu irréversible |
| D-C4 | Pas de webhooks d'engagement Brevo (delivered/opened/bounced) | Important | Zéro visibilité délivrabilité, pas de gestion bounce/désinscription | Réputation d'envoi dégradée, spam |
| D-C3 | Pas de moteur événementiel → automatisations limitées | Important | Toute relance/automatisation est un job ad hoc | Multiplication de jobs spécifiques |
| AUTO | Automatisations = jobs cron figés | Confort | Pas de règles configurables | Faible à l'échelle actuelle |
| IA | Aucune préparation agents IA | Confort | — | À regarder seulement si l'IA devient une priorité |
| Multi-tenant / Omnicanal / Inbound | — | **Sans objet** | Mono-tenant, email seul suffit aujourd'hui | — |

### 2.4 Top dettes à retenir

1. **D-I1 (Critique, sécurité)** — secrets en clair + clé live orpheline. *Action immédiate, indépendante des RFC.*
2. **D-I2 (Critique au go-live)** — bascule test/prod.
3. **D-C1/D-I4 + D-C4 (Important)** — invisibilité totale des envois email.
4. **D-C2 (Important)** — pas de versioning de templates.
5. **D-C3 (Important)** — pas de bus d'événements.

---

## PARTIE 3 — Analyse des architectures proposées

> Rappel de la règle de mission : **ne pas valider les RFC**, mais évaluer leur
> pertinence réelle pour Beauty Savage. Le filtre dominant est : **mono-tenant**.

### A — Integrated API Platform (IAP)

#### A.1 Compatibilité

| Axe | Verdict | Détail |
|---|---|---|
| Architecture actuelle | ✅ Compatible | Node/Mongoose ; le coffre (AES-256-GCM), le modèle `IntegratedApi`, le helper `getCredentials` s'intègrent sans friction. |
| Modèle multi-tenant | ⚠️ Surdimensionné | Tout le `scope: garage/tenant`, override/fallback, isolation = **inutile** en mono-tenant. |
| Permissions | ⚠️ À simplifier | L'IAP suppose `integrations.{view,edit,toggle_mode}` + panel staff. Beauty Savage a 3 rôles, pas de permissions granulaires. Mapper sur `requireStrictDev` suffirait. |
| Intégrations existantes | ✅ Couvre les 3 cas | Stripe = `dual_environment`, Brevo = `single`. Pas de cas `auto_refresh` (aucun OAuth/token de session aujourd'hui). |
| Futurs connecteurs | ✅ Bon | Si l'IA (OpenAI/Anthropic) ou un SMS (Twilio) arrivent, le pattern « 1 entrée + 1 driver » accélère. |

#### A.2 Réutilisable / à adapter / inutile

**Directement réutilisable (forte valeur, faible coût)**
- Coffre **AES-256-GCM** (`encrypt/decrypt`, format `iv.authTag.ciphertext`, clé en env, validation au boot).
- Contrat unique `getCredentials(slug,{role,runtime})` + **erreurs typées** + **fail-loud**.
- **Sentinelle `__UNFILLED__`** (ne jamais appeler un tiers avec un placeholder).
- **Bascule test/prod gardée** (`setMode` + refus prod si rôles requis manquants) → répond directement à **D-I2**.

**À adapter (réduire)**
- Modèle `IntegratedApi` : garder `slug/baseUrl/runtimeModel/mode/tokens[]`, **retirer** `scope/garageId` (mono-tenant).
- UI d'administration : **différer** (cf. timing React) ; au début, seeds + édition directe en base suffisent.

**Inutile pour Beauty Savage (aujourd'hui)**
- Tout le multi-tenant (`scope`, override garage→platform, isolation).
- `auto_refresh` + locks atomiques (aucun token de session OAuth).
- Usage Ledger / quotas par tenant.
- Sous-comptes provider.

#### A.3 Valeur / dette supprimée / dette créée

| | Évaluation |
|---|---|
| **Valeur réelle** | **Moyenne**. 3 providers seulement ⇒ le gain de « gouvernance d'intégrations » est limité. Mais la **brique coffre + fail-loud + bascule prod** a une valeur **forte** (sécurité). |
| **Dette supprimée** | D-I1 (secrets chiffrés), D-I2 (bascule gardée), partiellement D-I3 (rotation = ajouter/activer un token). |
| **Dette créée** | Une **couche d'infra à maintenir** (coffre, helper, seeds, à terme UI). Sur-ingénierie si on copie l'IAP tel quel. Un nouveau secret critique : la **clé de chiffrement** (à gérer/rotationner). |
| **Gains gouvernance** | Faibles en mono-tenant (peu d'opérateurs). |
| **Gains sécurité** | **Forts** : plus de secret en clair, refus prod sans config, masquage. |
| **Gains exploitation** | Moyens : rotation/bascule sans redéploiement. |

#### A.4 Risques d'intégration / complexification

- **Sur-ingénierie** : copier l'IAP intégral (registre + dual + auto_refresh +
  panel + multi-tenant) pour 3 clés serait disproportionné.
- **Nouveau point de défaillance** : la clé de chiffrement (si absente/perdue,
  tous les secrets inaccessibles) — l'IAP elle-même note cette dette (validation
  boot non bloquante, rotation non outillée). À faire **mieux** que l'original.
- **Migration des secrets** : prévoir le fallback env (déjà décrit dans l'IAP)
  pour une transition douce.

#### A.5 Verdict IAP

> **Adopter les *principes* à échelle réduite, pas le produit complet.** La
> valeur tient à 4 briques (coffre chiffré, contrat unique fail-loud, sentinelle,
> bascule prod gardée). Le registre multi-tenant + admin UI + auto_refresh sont à
> **différer ou ignorer**. ROI sécurité **bon** pour un coût **maîtrisé** si on
> reste minimaliste.

---

### B — Event-Driven Communication Platform (EDCP)

#### B.1 Compatibilité

| Axe | Verdict | Détail |
|---|---|---|
| Architecture actuelle | ✅/⚠️ | Le socle templates existe **déjà** (DB + admin + variables). L'EDCP formalise ce qui est partiellement là. Le **bus d'événements** est à créer (n'existe pas). |
| Workflows | ⚠️ Partiel | Beauty Savage a des workflows métier (sessions, remboursements, commissions) mais **pas** de moteur de transition. L'EDCP suppose un bus + déclencheurs ; ici tout est en jobs/contrôleurs. |
| CRM | ❌ Sans objet | Pas de CRM/dossier/opportunité. Le concept « communication contextualisée depuis un dossier » ne mappe pas — l'équivalent serait « depuis une Sale / un ServiceBooking ». |
| Futurs modules | ✅ | Un bus + un SendLog seraient réutilisables par tout futur module. |
| Agents IA | ✅ (préparation) | Les façades d'action (`prepareDraft`, `send`) sont un bon cadre **si** l'IA devient un objectif. Sinon, prématuré. |

#### B.2 Gains de centralisation / automatisation / gouvernance / personnalisation / maintenabilité

| Gain | Niveau pour Beauty Savage | Commentaire |
|---|---|---|
| **Centralisation** | Moyen | Déjà partiellement centralisé (mailService unique). Le gain net = unifier emails + notifications in-app + SendLog. |
| **Automatisation** | Moyen→Fort | Un bus d'événements remplacerait les déclencheurs ad hoc et permettrait relances/règles. Mais les jobs actuels couvrent déjà l'essentiel. |
| **Gouvernance** | Fort | Versioning draft→publish + validation = **vrai manque** (D-C2). Forte valeur. |
| **Personnalisation** | Faible | Mono-tenant : pas de personnalisation par locataire. Personnalisation actuelle (theme + variables) suffit. |
| **Maintenabilité** | Fort | Découper `mailService.js` + bus + SendLog = base saine pour la réécriture React. |

#### B.3 Briques de l'EDCP par valeur

**Forte valeur (à retenir)**
- **SendLog + webhooks d'engagement Brevo** (delivered/opened/bounced) → corrige D-C1/D-I4/D-C4. Visibilité et preuve d'envoi.
- **Versioning de templates (draft→publish, jamais d'écrasement)** → corrige D-C2.
- **Bus d'événements + catalogue figé** → corrige D-C3 ; fondation pour timeline/audit et automatisations.
- **Placeholders explicites** pour variables manquantes (aperçu qui ne ment pas).

**Valeur moyenne / conditionnelle**
- Séparation Template ≠ Expéditeur ≠ Destinataire : **déjà respectée de fait** (sender global env, destinataire résolu par l'appelant). Faible gain à formaliser.
- Façades d'action IA : seulement si l'IA est priorisée.

**Faible valeur / sans objet (mono-tenant)**
- Identités d'expéditeur multiples + vérification OTP + domaines (1 seul sender suffit).
- Multi-tenant senders, isolation de réputation, sous-comptes.
- Inbound/réponses, SMS/WhatsApp, omnicanal (sauf besoin produit avéré).
- Pièce jointe « document signé » de premier ordre (pas de signature électronique chez Beauty Savage).

#### B.4 Limites / risques / complexité induite

- **Risque de cargo-cult** : l'EDCP est conçue pour un centre de communication
  CRM omnicanal multi-tenant. En copier la vision = construire un système 5× trop
  grand. La discipline « V1 = sortant seulement, manuel » de l'EDCP elle-même doit
  être appliquée encore plus strictement ici.
- **Bus in-process** : risque de perte d'événement au crash (l'EDCP le note, T2).
  Pour un SendLog persistant c'est acceptable ; pour des déclencheurs critiques,
  prévoir idempotence + persistance.
- **Double-build UI** : toute UI (Template Studio, gouvernance) construite en
  Vanilla JS serait jetée à la migration React → **timing critique** (Rapport 4).

#### B.5 Verdict EDCP

> **Adopter un sous-ensemble « backend d'abord ».** Trois briques à forte valeur :
> (1) SendLog + webhooks Brevo, (2) bus d'événements + catalogue, (3) versioning
> de templates. Tout le reste (identités multiples, omnicanal, inbound, multi-
> tenant, IA) est **hors périmètre** tant qu'un besoin produit concret n'émerge
> pas. ROI **bon** sur le sous-ensemble, **négatif** si adoption intégrale.

---

## Conclusion comparative

| | IAP | EDCP |
|---|---|---|
| Terrain vierge ? | Quasi (secrets en .env) | **Non** — socle templates déjà là |
| Valeur intégrale | Faible (mono-tenant, 3 providers) | Faible (conçu CRM omnicanal multi-tenant) |
| Valeur du **sous-ensemble** | **Forte** (coffre, fail-loud, bascule prod) | **Forte** (SendLog, bus, versioning) |
| Dépendance React | Backend pur → **non bloquant** | Backend (bus/SendLog) non bloquant ; **UI bloquée par React** |
| Risque principal | Sur-ingénierie | Cargo-cult de la vision omnicanale |

Les deux technologies méritent une adoption **partielle et disciplinée**. Le
détail (projection cible, parcours, ROI, timing, roadmap) suit aux Rapports 3 et 4.
