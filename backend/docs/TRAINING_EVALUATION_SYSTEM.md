# TRAINING EVALUATION SYSTEM — V1

> Moteur d'évaluation + certification des formations BeautySavage. Branche `phase-0-security-baseline`.
> Générique et extensible (correction IA, multi-correcteur, jurys ultérieurs) **sans refonte**.

## Architecture

```
Formation
  └─ EvaluationDefinition (agrégat, 1 par formation, versionné, soft-delete)
        ├─ sections[] → questions[] (true_false | quiz mono/multi) → answers[]
        └─ deliverables[] (photo_before_after | video)
   ─────────────────── cycle de vie CLIENT (collections séparées) ───────────────────
  EvaluationAttempt (in_progress → submitted → accepted|refused)
  EvaluationDecision (immuable, historique)
  Certificate (diplôme — conséquence d'une validation, jamais dans la définition)
```

**Choix clé** : la définition est un **aggregate root** (embedding sections/questions/answers +
deliverables — config faible volume) ; le cycle de vie est en collections distinctes pour un
historique durable. Le **diplôme n'appartient pas à la formation** : c'est la conséquence d'une décision.

## Modèles (`models/`)

| Modèle | Rôle | Index / contraintes |
|---|---|---|
| `EvaluationDefinition` | Définition (agrégat) | unique `formationId` ; soft-delete `isDeleted` ; `version` |
| `EvaluationAttempt` | Tentative client | partial-unique `{formationId,userId}` où `status:in_progress` (une reprise) ; `{status,submittedAt}` |
| `EvaluationDecision` | Décision institut (immuable) | `{userId,formationId,createdAt}` ; `{attemptId}` |
| `Certificate` | Diplôme | unique `certificateNumber` ; `{userId,formationId}` |

Question types : `true_false` (correctBoolean), `quiz` mono/multi (answers[].correct).
Deliverables : `photo_before_after` (avant+après), `video` (maxDurationSeconds).

## Services (`services/evaluation/`)

- **evaluationScoringService** — `computeScore` (pur, institut only) + `validateSubmission` (obligatoires).
- **evaluationDefinitionService** — sanitize/upsert (version++), `getActiveDefinition`, `toClientDefinition`
  (**retire toute correction** : le client ne voit ni bonne réponse ni `correctBoolean`).
- **certificateService** — PDF (pdfkit, A4 paysage) + QR (`qrcode`, token opaque `BSDIP.v1.…`), numéro
  opaque `BS-DIP-…`, stockage `storage/certificates/<n>.pdf` (gitignoré, streamé), idempotent par tentative.
- **evaluationEventsService** — Communication Center : audit + notif admin + e-mail client (chemin D).
- **evaluationDecisionService** — `acceptAttempt` (décision + diplôme + comms + statut) / `refuseAttempt`
  (décision + **scrub réponses/fichiers** + **nouvelle tentative** + comms). **Commentaire obligatoire.**

## API

Client (`/api/client/evaluation`, `requireAuth` + gating achat + complétion + propriété) :
`GET /formations/:id` · `POST /formations/:id/attempt` · `PUT /attempts/:id/answers` ·
`POST /attempts/:id/deliverables` (multer, photos/vidéos → `/uploads/evaluations`) ·
`POST /attempts/:id/submit` · `GET /certificates/:id` (son diplôme).

Institut (`/api/gestion/evaluation`, `requireDev` = admin/dev) :
`GET|PUT /formations/:id/definition` · `GET /results` (+filtres) · `GET /results/:attemptId` ·
`POST /results/:attemptId/accept` · `POST /results/:attemptId/refuse` · `GET /certificates/:id`.

## Parcours

**Client** (dans le player, après complétion) : questionnaire (sans score/correction) → rendus
(upload photo avant/après, vidéo) → récapitulatif → transmission → « Vos résultats ont été transmis ».
Selon la décision : « Diplôme obtenu » (+ téléchargement) ou « Recommencer » (+ motif).

**Institut** (menu **Résultats**) : liste (client/formation/date/statut/tentative) + filtres → fiche
(score + bonnes réponses, photos avant/après + zoom, lecteur vidéo, historique des décisions) →
commentaire obligatoire → **Valider le diplôme** ou **Refuser**.

## Communication Center

Événements catalogue : `training.evaluation.submitted|accepted|refused`,
`training.certificate.generated|sent`. Notifications admin : `evaluation_submitted|accepted|refused`.
E-mails client : `evaluation_accepted` (diplôme en PJ), `evaluation_refused` (motif) — règles
`mailDispatchRules` (commerciale→client). Voir `docs/COMMUNICATION_TRIGGER_ARCHITECTURE.md`.

## Permissions

- **Client** : répondre / uploader / consulter SES décisions. Jamais score ni bonnes réponses
  (projection backend). Ne peut pas toucher la tentative d'un autre (403).
- **Institut/Admin** : consulter / noter / commenter / valider / refuser (`requireDev`).

## Migration / rétro-compatibilité

Module **optionnel** : une formation sans définition (ou définition inactive) reste 100 % valide.
Le parcours d'apprentissage + l'attestation C3 existants sont **inchangés** (le diplôme s'ajoute).

## Tests

Backend `npm run test:training` → **10 fichiers / 32 tests** (definition, attempt, questionnaire &
deliverables validation, submission, decision, certificate génération réelle, certificate mail,
permissions, history). Frontend : `QuestionnaireEditor`, `EvaluationFlow`, `EvaluationResultPage`
(8 tests). `react:lint`/`react:build`/`test:p0` verts.

## Limites V1 (extensibilité prévue, sans refonte)

- Correction 100 % manuelle (le barème `computeScore` est isolé → correction IA/pondération future).
- Un seul correcteur (pas de jury/multi-correcteur — `reviewerId` déjà présent sur la décision).
- Éditeur inline fonctionnel avec réordonnancement par boutons ↑/↓ (pas de DnD animé — convention
  « pas de dépendance lourde »). Vérification du QR de diplôme = endpoint futur (token déjà stocké).
- Upload vidéo plafonné à 60 Mo (pas de transcodage/streaming).
