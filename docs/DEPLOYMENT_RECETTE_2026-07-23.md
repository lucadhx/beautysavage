# Recette de cohérence — déploiement du 2026-07-23 (demo-sbauto.lycarz.com)

> **⚠️ RAPPORT HISTORIQUE — NE PAS SUIVRE COMME PROCÉDURE.**
> Ce document décrit un état du système à la date de sa rédaction. Plusieurs
> architectures qu'il mentionne ont été supprimées depuis — notamment la page
> IntegratedAPI du Manager, les credentials Brevo locaux et le webhook Brevo
> local. Autorités actuelles : [ARCHITECTURE.md](ARCHITECTURE.md) ·
> [PROTOCOL.md](PROTOCOL.md) · [INTEGRATED_API.md](INTEGRATED_API.md) ·
> [PANEL_BRIDGE.md](PANEL_BRIDGE.md).


> Déploiement lancé par l'utilisateur via le Manager (procédure officielle,
> mot de passe VPS en RAM). Recette exécutée automatiquement à la détection de
> la nouvelle version en ligne.

## Version publiée

```
DEPLOY_COMMIT = df382bb55976e927567c04f43c36553152c5c994   (df382bb)
branche       = feat/unified-production-baseline
```

## Résultats

### API — `https://api.demo-sbauto.lycarz.com`
| Contrôle | Résultat |
|---|---|
| `/health` | 200, `env=PROD` ✓ |
| `/api/version` | `commitHash = df382bb…` ✓ |

### Vitrine — `https://demo-sbauto.lycarz.com`
| Contrôle | Résultat |
|---|---|
| `version.json` | commit = DEPLOY_COMMIT ✓ |
| hash `index.html` distant vs build local | **identique bit pour bit** ✓ |
| JS principal (`index-sN-UzkEu.js`) référencé + servi | 200, **hash identique** ✓ |
| Refonte (ServicesShowcase…) | incluse dans le commit publié ✓ |
| `Cache-Control` | `index.html: no-cache` · assets : `public, immutable, max-age=1y` ✓ (correctif cache actif) |

### Manager — `https://manager.demo-sbauto.lycarz.com`
| Contrôle | Résultat |
|---|---|
| `version.json` | commit = DEPLOY_COMMIT ✓ |
| hash `index.html` + JS principal (`index-6V2gXCwd.js`) | **identiques bit pour bit** au build reproduit avec l'env de staging (`VITE_API_URL=` vide baké) ✓ |

Note de méthode : une première comparaison échouait car le build local de
contrôle n'avait pas `.env.production.local` (`VITE_API_URL=` vide) que le
staging du moteur bake systématiquement — l'inlining `""` vs `undefined` change
le hash. Après reproduction à l'identique : correspondance exacte. Le garde
`WEBSITE_ARTIFACT_MISMATCH` du moteur compare, lui, le staging réel au servi —
il avait validé juste.

### Médias
| Média | Vitrine | Manager |
|---|---|---|
| Logo header | 200 + MIME image ✓ | 200 + MIME image ✓ |
| Favicon | 200 + MIME image ✓ | 200 + MIME image ✓ |
| Hero | 200 + MIME image ✓ | 200 + MIME image ✓ |

Aucune URL locale (`localhost`/ngrok) dans le bootstrap public ✓.

### Brevo
- Route webhook réellement exposée :
  `POST /api/webhooks/brevo/transactional/prod` → **401 sans Bearer** (existe,
  protégée) ; GET → 404 (POST-only). ✓
- La logique « carte verte dès que le webhook est installé et aligné, sans
  attendre un premier événement » (`brevoOperational.service.js`) est incluse
  dans le commit publié. Vérification visuelle de la carte + envoi d'un e-mail
  de test : action Manager (compte DEV) — voir `docs/EMAIL_DELIVERY.md`.

## Conclusion

| Critère | Verdict |
|---|---|
| Branche canonique poussée | **OUI** |
| Branche d'archive poussée | **OUI** (`feat/brevo` @ f094db4, sans dossier) |
| Runtime local unifié (dossier unique `SB Auto 06`) | **OUI** — 6070/6071/6062, 6060/6061 morts |
| Vitrine réellement à jour | **OUI** (hash bit pour bit) |
| Manager réellement à jour | **OUI** (hash bit pour bit) |
| API au même commit | **OUI** (df382bb, env=PROD) |
| Brevo webhook opérationnel | Route exposée ✓ — carte/e-mail de test à valider dans le Manager |
| Déploiement HEALTHY et ACTIVE | **OUI** (gardes d'artefact du moteur passés + recette externe 100 %) |
