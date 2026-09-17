# frontend-react — Beauty Savage (React parallèle)

App React construite **en parallèle** du frontend Vanilla (`backend/public`), sans le remplacer.
Vanilla reste actif jusqu'à bascule (rollback DNS/proxy/feature-flag). **Aucun changement
d'endpoint backend.**

## Structure
```
apps/
  vitrine/      # SPA publique + client (beautysavage.fr)
  manager/      # SPA manager + /dev (manager.beautysavage.fr)
packages/
  api-client/   # client HTTP typé + hooks TanStack Query + mapping codes erreur
  ui/           # design system (thème dynamique via /api/vitrine/theme)
  auth/         # session (/auth/me), guards RequireAuth / RequireRole
  config/       # env, dictionnaire codes erreur → UX
docs/           # documentation OBLIGATOIRE (Folder*, Vitrine*, Manager*)
```

## Stack (installée en R0)
Vite + React 18 + TypeScript (strict) + React Router 6 + TanStack Query 5. Tests : Vitest + Testing
Library (jsdom). Lint : ESLint 9 (flat config). CSS : **CSS variables / tokens** dans `packages/ui`
(cohérent avec le thème dynamique `/api/vitrine/theme`) — pas de Tailwind, pas de design final.
Playwright (E2E) plus tard.

## Statut
**R0 effectué.** Monorepo buildable, routing placeholder (vitrine + manager/dev), guards
auth/rôles, 4 packages, proxy `/api`+`/auth`. Aucune vraie page métier (placeholders). Cf. rapport
157.

## Commandes (depuis `frontend-react/`)
| Commande | Effet |
|---|---|
| `npm install` | installe les workspaces. |
| `npm run dev:vitrine` / `dev:manager` | dev server (proxy `/api`,`/auth`,`/uploads` → backend). |
| `npm run build` | build des 2 apps (`dist/`). |
| `npm run test` | Vitest (jsdom + Testing Library). |
| `npm run lint` | ESLint. |
| `npm run typecheck` | `tsc --noEmit`. |

Depuis la racine backend : `react:dev:vitrine`, `react:dev:manager`, `react:build`, `react:test`,
`react:lint` (délèguent ici via `npm --prefix frontend-react`).

## Proxy & sécurité
Dev same-origin : Vite proxifie `/api`, `/auth`, `/uploads` vers `VITE_PROXY_TARGET`
(défaut `http://localhost:3000`). Pas de CORS. Cookie `beautysavage_session` (HttpOnly) via
`credentials:'include'`. **Aucun secret** côté front (clé Stripe publique via `/api/stripe/config`,
R2).

## Règle de documentation
Chaque sprint met à jour la doc du scope touché (`docs/Vitrine*` ou `docs/Manager*`) **et**
`docs/FolderArchitecture.md` + `docs/FolderProjectContext.md` si l'architecture globale change.

## Liens
- [docs/FolderArchitecture](./docs/FolderArchitecture.md) · [docs/FolderProjectContext](./docs/FolderProjectContext.md)
- [docs/VitrineArchitecture](./docs/VitrineArchitecture.md) · [docs/VitrineProjectContext](./docs/VitrineProjectContext.md)
- [docs/ManagerArchitecture](./docs/ManagerArchitecture.md) · [docs/ManagerProjectContext](./docs/ManagerProjectContext.md)
- Rapports backend : `backend/Rapports/version 1/143..149`
