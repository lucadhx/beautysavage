// tests/setup/testEnv.js
// Loaded by vitest (setupFiles) BEFORE any test file or app import.
// Sets fake/safe environment variables so the real `.env` (live secrets, prod DB)
// is NEVER used during tests.
//
// IMPORTANT: app.js runs `import 'dotenv/config'` at import time. dotenv does NOT
// override variables already present in process.env, so by pre-setting these here
// we guarantee the real values from `.env` cannot leak into the test run.

process.env.NODE_ENV = 'test';

// Required secrets (app utils throw if these are missing)
process.env.SESSION_SECRET = process.env.SESSION_SECRET_TEST || 'test-session-secret-do-not-use-in-prod';
process.env.PWD_PEPPER = 'test-pwd-pepper-do-not-use-in-prod';
process.env.GIFT_CARD_PASSWORD_SECRET = 'test-gift-card-secret-do-not-use-in-prod';
process.env.EMAIL_VERIFICATION_SECRET = 'test-email-verification-secret-do-not-use-in-prod';

// Stripe (fake/test — no real network calls expected in these tests)
process.env.STRIPE_SECRET_KEY = 'sk_test_fake_harness';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_fake_harness';
process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_fake_harness';
process.env.STRIPE_DEV_SECRET_KEY = 'sk_test_fake_harness_dev';
process.env.STRIPE_DEV_PUBLISHABLE_KEY = 'pk_test_fake_harness_dev';
process.env.STRIPE_DEV_WEBHOOK_SECRET = 'whsec_test_fake_harness_dev';

// Mail / Brevo (fake — the mail service is mocked in tests that exercise it)
process.env.BREVO_API_KEY = 'fake-brevo-key';
process.env.MAIL_FROM = 'test@example.com';
process.env.MAIL_FROM_NAME = 'Beauty Savage (test)';

// Credential vault (fake 64-hex key — never a real key). Lets the vault encrypt/
// decrypt in tests. Migration fallback is ENABLED so vault-miss reads fall back to
// the fake provider env vars above (existing Stripe/Brevo tests keep passing).
process.env.CREDENTIAL_VAULT_KEY =
  process.env.CREDENTIAL_VAULT_KEY || '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
process.env.ALLOW_ENV_CREDENTIAL_FALLBACK = 'true';

// S1C — Plus aucune variable de domaine en env (ni APP_BASE_URL ni NGROK_DOMAIN). Le
// DomainResolver retombe sur http://localhost:3000 tant qu'aucune SystemConfiguration n'existe ;
// les tests qui veulent une base publique précise seedent SystemConfiguration.domains.

// MONGODB_URI is injected per-file by tests/setup/testDb.js (in-memory server).
// Remove any value here so app.js cannot connect to a real database if testDb
// fails to set it (testApp.js also guards against non-local URIs).
delete process.env.MONGODB_URI;
