# Documentation SB Auto — START HERE

Cette documentation contient à la fois des **références actives** et des
**rapports historiques**. La distinction est la première chose à connaître : un
rapport de lot décrit ce qui a été fait à une date, pas ce qui est vrai
aujourd'hui.

---

## Autorités

Un seul document fait autorité par domaine. En cas de contradiction, **c'est le
code qui tranche**, puis ces documents.

| Domaine | Autorité |
|---|---|
| Architecture générale, invariants, frontières | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Exploitation, incidents, démarrage, extinction | [PROTOCOL.md](PROTOCOL.md) |
| Pont SB Auto ↔ Panel, capacités, appairage | [PANEL_BRIDGE.md](PANEL_BRIDGE.md) |
| Fournisseurs, credentials, autorité plateforme | [INTEGRATED_API.md](INTEGRATED_API.md) |
| Moteur de déploiement | [DEPLOYMENT_ENGINE.md](DEPLOYMENT_ENGINE.md) |
| API backend | [API.md](API.md) |
| Qualité de la Vitrine (référentiel permanent) | [Controle qualité/Controle qualité vitrine.pdf](Controle%20qualit%C3%A9/Controle%20qualit%C3%A9%20vitrine.pdf) |
| Qualité du Manager (référentiel permanent) | [Controle qualité/Controle qualité manager.md](Controle%20qualit%C3%A9/Controle%20qualit%C3%A9%20manager.md) |

Les deux référentiels de **contrôle qualité** ne décrivent pas le runtime : ils
décrivent ce qu'un projet doit tenir. Ils s'appliquent à chaque lot touchant la
Vitrine ou le Manager, et se lisent AVANT d'écrire, pas après.

## Références spécialisées

Synchronisées avec les autorités ci-dessus, mais plus étroites :

- [EMAIL_TEMPLATES.md](EMAIL_TEMPLATES.md), [EMAIL_CONFIGURATION.md](EMAIL_CONFIGURATION.md),
  [EMAIL_DELIVERY.md](EMAIL_DELIVERY.md) — e-mail métier
- [DOMAIN_EVENTS.md](DOMAIN_EVENTS.md), [EVENT_DISPATCHER.md](EVENT_DISPATCHER.md) — événements métier
- [CONTRACTS.md](CONTRACTS.md), [STRIPE_BILLING.md](STRIPE_BILLING.md) — contrats et facturation
- [SYNCHRONISATION_PANEL_PROJET.md](SYNCHRONISATION_PANEL_PROJET.md) — synchronisation de données
- [VPS_DEPLOYMENT_GUIDE.md](VPS_DEPLOYMENT_GUIDE.md) — exploitation VPS
- [panelXvitrine/](panelXvitrine/) — standards de l'écosystème Panel × projets
- [yousign/](yousign/), [Brevo/](Brevo/) — références fournisseur (documentation externe)

## Rapports historiques

Les fichiers en `*_REPORT.md`, `RX_*.md`, `*_AUDIT.md`, `BUGFIX_*.md` et
`*_RECETTE_*.md` sont des **archives datées**. Ils expliquent pourquoi une
décision a été prise ; ils ne décrivent pas nécessairement le runtime actuel.

> **Ne jamais suivre une procédure lue dans un rapport historique.** Les
> procédures actives vivent dans [PROTOCOL.md](PROTOCOL.md).

Plusieurs d'entre eux décrivent des architectures **supprimées depuis** —
notamment la page IntegratedAPI du Manager, les credentials Brevo locaux et le
webhook Brevo local. Ils portent un bandeau le disant.

## Ce qui a changé récemment, et qu'aucun ancien document ne reflète

1. **Les quatre fournisseurs sont sous autorité Panel.** Plus de page
   « Intégrations API », plus de credential fournisseur dans SB Auto.
2. **Le déploiement appartient au backend.** Il survit à la navigation, au
   rechargement, à la fermeture d'onglet.
3. **Aucun service de fond ne démarre avant les reprises structurelles.**
4. **« API PRÊTE » est une conclusion prouvée**, pas un port ouvert.
