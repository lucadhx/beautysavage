# 15 — Ce que le projet expose au Panel : quoi, pourquoi, comment, garanties

> Rédigé à la Phase 2A. Prérequis : [00_ECOSYSTEME.md](00_ECOSYSTEME.md) §5-6.
> Spécification exécutoire : [spec/ProjectBridge.openapi.yaml](spec/ProjectBridge.openapi.yaml)
> (v1.1.0) — ce document explique, la spec fait foi.

---

## 1. Ce que le projet expose — la liste EXHAUSTIVE

Un projet expose au Panel **une seule surface** : le ProjectBridge, monté sous
`/api/project-bridge/v1`. Rien d'autre — pas d'accès Mongo, pas de routes
internes, pas de code distant.

| Endpoint | Quoi | Pourquoi |
|---|---|---|
| `GET /ping` | vivacité + `paired` (sans auth) | sondes ; savoir si la surface existe avant de s'authentifier |
| `GET /identity` | clé, nom, environnement, version logicielle, version de contrat | le Panel sait À QUI il parle |
| `GET /health` | état résumé OK/DEGRADED (non sensible) | supervision à la demande (complément du heartbeat) |
| `GET /manifest` | **manifeste officiel** : projet, pont, contrats parlés, capacités de sync réellement actives, modules installés, features AVAILABLE/RESERVED | le Panel ne DÉDUIT jamais rien ([spec](spec/ProjectBridge.openapi.yaml), schéma `ProjectManifest`) |
| `POST /sync/push` | livraison des écritures faites côté Panel (accusé PAR écriture) | données synchronisées, sens Panel → projet |
| `GET /sync/pull` | lecture paginée des écritures locales du projet | rattrapage côté Panel |
| `GET /operations` | catalogue FERMÉ des opérations invocables | découverte : le Panel n'invoque que ce qui est déclaré |
| `POST /operations/{id}/invoke` | invocation idempotente d'une opération du catalogue | seconde interface du moteur LOCAL (jamais un second moteur) |
| `POST /unpair` | notification de révocation | débranchement propre, propagé |

Dans l'autre sens, le projet **n'envoie** au Panel que ce que le contrat
[spec/PanelBridge.openapi.yaml](spec/PanelBridge.openapi.yaml) décrit :
bootstrap (avec manifeste), heartbeats, push/pull de synchronisation, unpair.
Aucun secret du projet ne quitte jamais le projet.

## 2. Comment c'est gardé

- **Authentification** : Bearer `bridgeToken`, délivré par le Panel au
  bootstrap — UN seul secret pour les deux sens ; le révoquer ferme tout.
  Vérification en temps constant (empreintes SHA-256).
- **Persistance chiffrée** : l'appairage survit aux redémarrages, le token est
  stocké AES-256-GCM (`BridgePairing`, clé maître
  `INTEGRATED_API_ENCRYPTION_KEY`) — jamais en clair, jamais journalisé,
  jamais renvoyé par une API.
- **Rotation prête** : `rotateBridgeToken()` avec fenêtre de transition (les
  deux tokens acceptés pendant la fenêtre, persistée, survivante au
  redémarrage).
- **Versionnement** : en-tête `X-Bridge-Contract-Version` obligatoire dans les
  deux sens ; majeure inconnue → 409 propre. Évolutions additives = mineures
  (1.1.0 : manifeste).
- **Idempotence partout** : writeId (sync), invocationId (opérations) ;
  rejouer est un non-événement.
- **Non appairé = état normal** : 503 `BRIDGE_NOT_PAIRED`, jamais une panne ;
  `/ping` reste public.

## 3. Les garanties (verrouillées par les tests)

| Garantie | Verrou |
|---|---|
| Aucun composant métier ne parle au Panel ; seul le module de pont | `bridge-conformity.test.js` (exclusivité des imports, 91 ✓) |
| Le module de pont n'importe rien du métier (revendable tel quel) | idem — exception ÉTROITE : `persistence/` → modèle d'appairage + crypto, rien d'autre |
| Le code parle EXACTEMENT le contrat OpenAPI | contrat exécutable `bridgeContract.js` (zod strict) + conformité spec↔code |
| Le manifeste servi est conforme et jamais déduit | registre déclaratif + validation avant réponse + tests |
| L'appairage survit au redémarrage, sans secret en clair | `bridge-persistence.test.js` (31 ✓, chiffrement au repos vérifié) |
| Un Panel injoignable ne casse RIEN | états DEGRADED, outbox, hello timeouté au boot, suites hors-ligne |
| Le débranchement local prime toujours | `unpair`/`clearPairing` : RAM purgée même si la persistance échoue |

## 4. Ce que le projet n'expose PAS (et n'exposera jamais)

Les données locales (catégorie 1 — contenu vitrine, comptes, moteurs), les
secrets (clés d'API, mots de passe, `bridgeToken`), la base Mongo, et tout ce
qui n'est pas déclaré dans la spec. Un besoin nouveau = une évolution de
contrat (mineure, documentée dans les DEUX specs), jamais un contournement.
