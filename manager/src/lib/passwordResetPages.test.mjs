import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0;
let fail = 0;
const check = (name, ok) => {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.error(`  ✗ ${name}`);
  }
};
const section = (title) => console.log(`\n${title}`);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const app = read('App.tsx');
const api = read('lib/api.ts');
const auth = read('context/AuthContext.tsx');
const page = read('pages/PasswordResetPages.tsx');

section('Routes publiques');
{
  check('la route forgot-password est publique',
    app.includes('path="/mot-de-passe-oublie" element={<ForgotPasswordPage />}'));
  check('la route reset-password est publique',
    app.includes('path="/reinitialiser-mot-de-passe" element={<ResetPasswordPage />}'));
  check('les deux routes restent hors RequireAuth',
    app.indexOf('path="/reinitialiser-mot-de-passe" element={<ResetPasswordPage />}') < app.indexOf('<RequireAuth>'));
}

section('Client API');
{
  check('forgot/reset utilisent des endpoints publics dedies',
    api.includes("request<{ message: string }>('/auth/forgot-password'")
    && api.includes("request<{ message: string }>('/auth/reset-password'"));
  check('la verification de session reste bornee a /auth/me',
    /return controle\.status === 401;/.test(api)
    && /if \(path\.startsWith\('\/auth\/me'\)\) return true;/.test(api));
}

section('Page publique');
{
  check('la page forgot appelle bien l API dediee',
    page.includes('await api.forgotPassword(email.trim())'));
  check('la confirmation reste generique',
    /Si un compte correspond .* lien de r/i.test(page));
  check('la page reset lit le token depuis l URL',
    page.includes("const token = params.get('token') || ''"));
  check('la page reset appelle l API dediee',
    page.includes('await api.resetPassword(token, password, confirm)'));
  check('la validation locale bloque le mot de passe trop court et le mismatch',
    /password\.length < 6/.test(page)
    && /password !== confirm/.test(page));
  check('les cas sans token et token invalide proposent de redemander un lien',
    page.includes('Lien incomplet')
    && page.includes('Redemander un lien')
    && /Redemander un lien de r/i.test(page));
}

section('Bootstrap session');
{
  check('AuthContext ne purge pas sur une panne reseau simple',
    /const refus = err instanceof ApiError && \(err\.status === 401 \|\| err\.status === 403\);/.test(auth)
    && /\} else \{\s*setUnreachable\(true\);\s*\}/.test(auth));
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
