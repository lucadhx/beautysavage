# TRAINING CERTIFICATION — Diplôme

> Génération et délivrance du diplôme (certificat) après validation d'une évaluation.
> Complète `docs/TRAINING_EVALUATION_SYSTEM.md`.

## Principe

Le diplôme est la **conséquence d'une validation** d'évaluation, pas une partie de la formation.
Il est créé automatiquement lors de l'acceptation d'une tentative par l'institut.

## Modèle `Certificate`

`certificateNumber` (opaque `BS-DIP-…`, unique) · `userId` · `formationId` · `attemptId` ·
`decisionId` · `qrToken` (opaque, jamais un secret) · snapshots (`clientNameSnapshot`,
`formationNameSnapshot`, `instituteNameSnapshot`) · `issuedAt` · `pdfGeneratedAt` · `reviewerId` ·
`revoked`.

## Génération (`services/evaluation/certificateService.js`)

Mirroir de l'attestation C3 (`attestationRenderService`) :
- **PDF** : `pdfkit`, A4 paysage, cadre, en-tête institut, nom client, nom formation, date, **numéro
  unique**, **QR code**, ligne de **signature**.
- **QR** : librairie `qrcode` (`QRCode.toDataURL`), encode `BSDIP.v1.<qrToken>` (token opaque) — sert
  une **future vérification d'authenticité** (aucun endpoint de vérif dans ce lot). Aucun secret dans le QR.
- **Stockage** : `storage/certificates/<certificateNumber>.pdf` — **gitignoré**, **non servi
  statiquement**, téléchargé via endpoint streamé (`Content-Disposition: attachment`).
- **Idempotent** : au plus un certificat par tentative (`issueCertificate` réutilise l'existant).

Pas d'éditeur de diplôme dans ce lot (rendu code-first ; le layout pdfkit est le point d'extension).

## Délivrance

`evaluationDecisionService.acceptAttempt` → crée `EvaluationDecision(accepted)` → `issueCertificate`
(PDF + base64) → e-mail client `evaluation_accepted` **avec le PDF en pièce jointe** +
notification admin + événements audit `training.certificate.generated` / `training.certificate.sent`.

## Téléchargement

- Client : `GET /api/client/evaluation/certificates/:id` (propriété vérifiée → 403 sinon).
- Institut : `GET /api/gestion/evaluation/certificates/:id`.
Le PDF est régénéré à la volée s'il manque sur le disque (idempotent).

## Sécurité

Numéro + token QR opaques (jamais un secret). PDF hors static. Aucun PIN/token en clair. Le client
ne télécharge que SON diplôme. Vérification QR = évolution future (le token est déjà persisté).

## Tests

`certificateGeneration` (PDF réel, base64 `%PDF`, numéro `BS-DIP-`, idempotence) +
`certificateMail` (e-mail `evaluation_accepted` + PJ + événements). Voir `npm run test:training`.
