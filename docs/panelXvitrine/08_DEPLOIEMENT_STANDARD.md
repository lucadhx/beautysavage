# 08 — Déploiement : moteur local, Panel déployé comme un projet

> Prérequis de lecture : [00_ECOSYSTEME.md](00_ECOSYSTEME.md) §3 (règle « le
> Panel n'est jamais une exception »).
> État actuel détaillé : [13_ETAT_DES_LIEUX.md](13_ETAT_DES_LIEUX.md) §6.

---

## 1. Principe : le moteur de déploiement reste local à chaque projet

Chaque projet embarque et conserve **son** moteur de déploiement
(`backend/src/deployment/` : préflight, pipeline build → upload → nginx →
certbot → pm2 → health → runtime_config → validate, DNS Hostinger, backups,
transport SSH, rapports sanitisés). Le déploiement d'un projet est déclenché
depuis **son** Manager (page DEV « Déploiement »), par un humain, avec le mot de
passe VPS **en RAM seulement** — jamais persisté, jamais confié au Panel.

Le Panel ne déploie PAS les projets à leur place :

- il ne possède ni les secrets VPS, ni le code du projet ;
- un déploiement raté se diagnostique sur place, avec les rapports locaux ;
- c'est la condition de la revente : le repreneur déploie sans nous.

Ce que le Panel FAIT autour du déploiement (supervision uniquement) :

```
   PROJET (déploie lui-même)                      PANEL (observe)
   ┌───────────────────────────┐                  ┌───────────────────────────┐
   │ assistant Manager         │   heartbeat +    │ versions déployées        │
   │ moteur local              │   remontées ────▶│ dernier déploiement       │
   │ mot de passe VPS en RAM   │  (PanelBridge)│ santé des destinations    │
   │ rapports locaux           │                  │ alertes de dérive         │
   └───────────────────────────┘                  └───────────────────────────┘
```

Le projet remonte au Panel (via PanelBridge, best-effort) : version déployée,
date, destination, résultat. Le Panel agrège : « le parc est-il à jour ? quel
projet a dérivé ? » — sans jamais tenir les manettes.

---

## 2. Le Panel possède SON propre moteur de déploiement

> **Le Panel doit pouvoir être déployé et mis à jour de la même manière que les
> projets. Le Panel est donc lui aussi un projet autonome.**

C'est l'application directe de la règle d'or n°2
([00_ECOSYSTEME.md](00_ECOSYSTEME.md) §3) :

- le Panel est construit comme un projet standard : **backend + interface +
  moteur de déploiement** ;
- il réutilise le MÊME moteur (`DeploymentEngine`, pipeline, transports,
  rapports) — pas une réimplémentation ;
- il a sa page « Déploiement » dans sa propre interface, ses destinations, ses
  backups, son `/api/version`, son healthcheck ;
- il se duplique même, si un jour un second Panel est nécessaire (staging du
  Panel, par exemple).

```
                    ┌────────────────────────────────────────┐
                    │        MOTEUR DE DÉPLOIEMENT           │
                    │   (une seule implémentation partagée)  │
                    └───────┬───────────────────────┬────────┘
                            │ embarqué dans         │ embarqué dans
                    ┌───────▼────────┐      ┌───────▼────────┐
                    │  chaque PROJET │      │     PANEL      │
                    │  se déploie    │      │  se déploie    │
                    │  lui-même      │      │  lui-même      │
                    └────────────────┘      └────────────────┘
```

Bénéfices concrets :

1. **Une seule architecture à maintenir** — toute amélioration du pipeline
   (rollback P3, releases, diagnostics) profite aux projets ET au Panel.
2. **Pas de dépendance circulaire** : le Panel ne dépend d'aucun « super-Panel »
   pour exister ; il se déploie comme n'importe quel projet, donc il peut être
   le premier composant installé comme le dernier.
3. **Même culture opérationnelle** : mêmes rapports, mêmes codes d'erreur, mêmes
   checklists de recette pour tout le parc, Panel compris.

### Conséquence pratique pour la Phase 1

Le moteur actuel vit dans `backend/src/deployment/` de SB Auto 06 et se propage
par duplication. Pour que le Panel (et les projets futurs) partagent réellement
« une seule implémentation », la stratégie de partage (duplication synchronisée
comme aujourd'hui, ou extraction en module versionné) devra être tranchée en
Phase 1 — voir [10_PANEL_ROADMAP.md](10_PANEL_ROADMAP.md). En Phase 0, rien ne
bouge : le moteur reste dans le projet.

---

## 3. Invariants du standard de déploiement

Valables pour tout projet ET pour le Panel :

1. **Déclenchement humain** : un déploiement PROD est une action utilisateur
   explicite (jamais automatique, jamais déclenché à distance par le Panel).
2. **Secrets d'infrastructure éphémères** : mot de passe VPS en RAM (coffre à
   TTL), jamais dans un rapport, jamais dans une base.
3. **`.env` embarqué verbatim** avec surcharges limitées et explicites
   (`ENV`, `PORT`, `CORS_ORIGINS`, `PUBLIC_URL`) ; échec AVANT upload si des
   clés vitales manquent.
4. **Préflight bloquant** avant toute mutation ; mutations DNS uniquement APRÈS
   validation de la connexion SSH.
5. **Trois hostnames par destination** : site, `manager.<host>`, `api.<host>` —
   chacun avec certificat et healthcheck.
6. **Rapport persisté et sanitisé** pour chaque run (secrets rédigés), backups
   restaurables.
7. **La destination sait ce qu'elle exécute** : manifeste de build
   (commit/branche), `/api/version`, comparaison artefact/manifeste — la
   supervision du Panel s'appuie sur ces preuves existantes.

---

## 4. Résumé

| Question | Réponse |
|---|---|
| Qui déploie un projet ? | Le projet lui-même, depuis son Manager, action humaine. |
| Le Panel peut-il déployer un projet ? | Non. Il supervise (versions, santé, historique remonté). |
| Comment le Panel est-il déployé ? | Comme un projet : même moteur, sa propre page Déploiement. |
| Qui détient les secrets VPS ? | L'humain au moment de l'action (RAM only). Jamais le Panel. |
| Une seule implémentation du moteur ? | Oui — règle d'or ; modalité de partage à trancher en Phase 1. |
