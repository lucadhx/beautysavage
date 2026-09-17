# Recette manuelle — IntegratedAPI & Communications

> Parcours de validation manuelle après le portage IntegratedAPI (LOTs 1→4).
> Prérequis : `CREDENTIAL_VAULT_KEY` valide dans `.env` (64 hex), Mongo up, backend démarré.
> Accès DEV : se connecter au panel Manager avec un compte `dev`.
> **Aucun secret ne doit apparaître** à l'écran (valeurs masquées ••••XXXX) ni dans les logs.

---

## 1. Configuration Brevo (clé + expéditeur)

```
DEV → Intégrations API (/dev/integrated-api)
→ carte « Brevo »
→ Configurer (bloc « Clé unique »)
→ coller la clé api_key (xkeysib-…)
→ Enregistrer                     → badge « Configuré », valeur masquée ••••XXXX
→ Tester                          → « Clé Brevo valide » (succès) → badge « Testé »
                                    (401 ⇒ « clé invalide OU IP serveur non autorisée »)
```

Expéditeur (identité) — reste géré par le Communication Center :

```
Communication → Identité commerciale (/communication/identite-commerciale)
→ saisir nom + adresse d'expédition
→ Demander la vérification (Brevo envoie un e-mail/OTP)
→ saisir le code → identité « vérifiée » + active
```

En **dev**, une identité `commerciale` vérifiée est seedée automatiquement au boot
(`seedDevCommunicationIdentity`) pour que les envois locaux fonctionnent sans configuration.

**Attendu** : plus aucun log `MAIL_FROM inutilisable`. Si l'identité manque →
`SENDER_NOT_CONFIGURED` ; si la clé manque → `API_KEY_MISSING` (jamais un drop silencieux).

---

## 2. Inscription client (signup cohérent)

Cas nominal (Brevo + identité OK) :

```
Vitrine → Créer un compte → saisir e-mail + mot de passe
→ 200, message « code envoyé »
→ recevoir le code, le saisir → compte vérifié
→ notification institut « Nouveau client inscrit » présente (créée APRÈS l'envoi réussi)
```

Cas dégradé (Brevo/identité non configurés) :

```
Créer un compte
→ 202 « Votre compte a été créé, mais nous n'avons pas pu envoyer le code. Vous pouvez réessayer. »
   (code ACCOUNT_PENDING_VERIFICATION — PAS un 500 générique)
→ AUCUNE notification « Nouveau client inscrit » (pas de fausse notif de succès)
→ « Renvoyer le code » disponible ; une 2e inscription du même e-mail = reprise (409 pending)
```

---

## 3. Stripe (institut & plateforme)

```
DEV → Intégrations API
→ carte « Stripe Institut » (2 blocs TEST | PROD)
→ Configurer TEST : secret_key (sk_test_…), webhook_secret (whsec_…), publishable_key (pk_test_…)
   (un sk_live_ en TEST est refusé : « préfixe attendu sk_test_ »)
→ Tester TEST → « Clé Stripe valide » (compte/pays/devise affichés)
→ Activer TEST
→ lancer un paiement test (vitrine) → webhook /api/stripe/webhook → statut métier OK
```

Passage PROD (gardé) :

```
→ Configurer PROD (sk_live_/pk_live_/whsec_) → Tester PROD (succès requis)
→ Activer la production → saisir EXACTEMENT « ACTIVER STRIPE INSTITUT PROD »
   (sans test réussi → « MODE_NOT_VERIFIED » ; mauvaise phrase → « CONFIRMATION_REQUIRED »)
→ badge « Mode actif : PROD »
```

Idem « Stripe Developer » (plateforme) avec la phrase « ACTIVER STRIPE DEV PROD ».
**Changer une clé** invalide immédiatement le « Testé » (badge « clé changée »).

---

## 4. Notifications (suppression / lecture)

```
Panel → cloche notifications
→ marquer une notification lue     → compteur décrémenté
→ supprimer une notification       → disparaît IMMÉDIATEMENT (plus de 404)
→ re-supprimer (double clic)       → idempotent, la liste reste synchronisée
```

Vérifie que la suppression fonctionne pour une notif visible (le front envoie le `_id`).

---

## 5. Remboursements & job de reprise

```
Créer un remboursement test valide (Stripe configuré + transaction présente)
→ exécuter → succès (statut pending/succeeded)

Créer un remboursement sans transaction Stripe (sale sans stripePaymentIntentId)
→ le job de reprise le classe TRANSACTION_NOT_FOUND → refundFailedFinalAt posé
→ AUCUNE reprise aux cycles suivants (plus de spam)

Stripe non configuré au boot
→ remboursements classés MISSING_CREDENTIAL → différés (jamais final)
→ se débloquent dès que les clés sont saisies via l'UI
```

Au démarrage, les logs affichent **une seule ligne de résumé** par cycle :

```
[RefundRecovery] startup: inspected=N recovered=… deferred=… finalFailed=… configurationBlocked=… stripeConfigured=…
```

(au lieu d'une stack par remboursement).

---

## 6. Sécurité (à vérifier partout)

- Aucune clé Stripe/Brevo/webhook affichée : uniquement `••••••••••••XXXX`.
- Aucune clé dans les logs, les réponses API, ou les erreurs.
- La page Intégrations API est **DEV uniquement** (un admin obtient 403).
- Le passage PROD exige configuré + testé + phrase exacte.
