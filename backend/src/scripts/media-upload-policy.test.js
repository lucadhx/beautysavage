/**
 * POLITIQUE D'IMPORT DES MÉDIAS — le projet modèle.
 *
 * ══ CE QUE CE FICHIER ÉPROUVE ═══════════════════════════════════════════════
 *
 * Le symptôme rapporté était un `413 Payload Too Large` au remplacement d'un
 * logo. Il ne venait NI d'Express, NI de multer — les deux acceptaient 12 Mo —
 * mais de Nginx, dont le générateur de vhost n'émettait pas
 * `client_max_body_size` : le serveur appliquait donc son défaut, 1 Mo.
 *
 * Un logo de 3 Mo passait en local et repartait en 413 une fois déployé. On
 * vérifie ici les deux moitiés de la réparation : la politique par type, et la
 * ligne qui la fait respecter par le serveur web.
 */
process.env.ENV = process.env.ENV || 'TEST';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
process.env.DB_TEST = process.env.DB_TEST || 'sbauto_media_policy';
process.env.DB_PROD = process.env.DB_PROD || 'sbauto_media_policy';
process.env.PANEL_SCHEDULER_ENABLED = 'false';

let pass = 0; let fail = 0;
const check = (nom, cond) => {
  if (cond) { pass += 1; console.log(`  ✓ ${nom}`); }
  else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (t) => console.log(`\n${t}`);

const politique = await import('../services/media/mediaPolicy.js');
const profil = await import('../deployment-engine/config/project.profile.js');
const nginx = await import('../deployment-engine/nginx.js');
const { validateImage, MEDIA_ERROR } = await import('../services/media/mediaValidation.js');
const sharp = (await import('sharp')).default;

/* ────────────────────────────────────────────────────────────────────────── */
section('LA POLITIQUE COUVRE LES TYPES MÉTIER RÉELS');
{
  const { MEDIA_TYPES } = await import('../controllers/upload.controller.js');
  const manquants = [...MEDIA_TYPES].filter((t) => !(t in politique.MEDIA_POLICIES));
  check(`chaque type métier a sa politique${manquants.length ? ` — manque ${manquants}` : ''}`,
    manquants.length === 0);
  check('le plafond est le maximum de la table',
    politique.MAX_INPUT_BYTES
      === Math.max(...Object.values(politique.MEDIA_POLICIES).map((p) => p.maxInputBytes)));
  check('un logo de 3 Mo est SOUS la limite du type',
    3 * 1024 * 1024 < politique.policyFor('company-logo').maxInputBytes);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('MEDIA_UPLOAD_LIMITS_DO_NOT_DIVERGE — Nginx ≥ application');
{
  console.log(`    politique : ${politique.HTTP_BODY_LIMIT_MB} Mo requis · profil : ${profil.HTTP_MAX_BODY_MB} Mo`);
  check('le vhost couvre la politique',
    profil.HTTP_MAX_BODY_MB >= politique.HTTP_BODY_LIMIT_MB);
  check('…sans être illimité', profil.HTTP_MAX_BODY_MB > 0 && profil.HTTP_MAX_BODY_MB <= 100);

  const target = {
    name: 'T', host: 'exemple.test', environment: 'PROD',
    domain: 'exemple.test', url: 'https://exemple.test',
  };
  const attendu = `client_max_body_size ${profil.HTTP_MAX_BODY_MB}m;`;
  let https = ''; let http = '';
  try { https = nginx.renderNginxConfig(target, { backendPort: 4000 }); } catch { https = ''; }
  try { http = nginx.renderNginxHttpOnly(target, { backendPort: 4000 }); } catch { http = ''; }

  check('LE VHOST HTTPS PORTE LA DIRECTIVE', https.includes(attendu));
  check('…et le vhost HTTP (pré-certificat) aussi', http.includes(attendu));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('VALIDATION SUR LES OCTETS');
{
  const faux = Buffer.from('PK pas une image du tout');
  let code = null;
  try { await validateImage(faux, { mediaType: 'company-logo' }); }
  catch (e) { code = e?.details?.code ?? null; }
  check('un fichier renommé en image est refusé', code === MEDIA_ERROR.INVALID);

  const vraie = await sharp({
    create: { width: 400, height: 400, channels: 3, background: '#123456' },
  }).png().toBuffer();
  const meta = await validateImage(vraie, { mediaType: 'company-logo' });
  check('une vraie image est acceptée', meta.format === 'png' && meta.width === 400);

  // Trop grosse pour un favicon, acceptable pour un logo : la limite est PAR TYPE.
  const pixels = Buffer.alloc(1400 * 1200 * 3);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 2654435761) % 256;
  const lourde = await sharp(pixels, { raw: { width: 1400, height: 1200, channels: 3 } })
    .png({ compressionLevel: 0 }).toBuffer();

  let codeTaille = null; let details = null;
  try { await validateImage(lourde, { mediaType: 'company-favicon' }); }
  catch (e) { codeTaille = e?.details?.code ?? null; details = e?.details ?? null; }
  check(`refusée pour un favicon (${(lourde.length / 1024 / 1024).toFixed(1)} Mo)`,
    codeTaille === MEDIA_ERROR.TOO_LARGE);
  check('…avec la limite du type dans les détails',
    details?.maxBytes === politique.policyFor('company-favicon').maxInputBytes);

  const pourLogo = await validateImage(lourde, { mediaType: 'company-logo' });
  check('…et ACCEPTÉE pour un logo — la limite est bien par type',
    pourLogo.bytes === lourde.length);
}


/* ────────────────────────────────────────────────────────────────────────── */
section('LES CHIFFRES ÉCRITS À L’ÉCRAN SONT CEUX DE LA POLITIQUE');
{
  /**
   * ══ LA DÉCISION, ET POURQUOI IL N'Y A PAS D'API DE POLITIQUE ═════════════
   *
   * Le backend reste le SEUL arbitre, et il l'est déjà : `uploadFile` ne
   * recopie aucune limite, et un refus voyage avec la sienne
   * (`details.maxBytes`). Exposer une route « politique publique d'upload »
   * n'aurait fermé qu'un défaut résiduel : deux PHRASES d'aide où des chiffres
   * sont écrits à la main, et qui mentiraient le jour où la table changerait.
   *
   * Une route nouvelle pour deux phrases, c'est une surface publique de plus à
   * documenter, à versionner et à défendre. Un contrôle de dérive coûte un
   * test, et échoue exactement quand le mensonge apparaît. C'est l'idiome de ce
   * dépôt — `spec-drift`, `engine-drift`, `payload-drift` — et il s'applique.
   *
   * Si un jour l'interface doit REFUSER un fichier avant de l'envoyer, la route
   * se justifiera : le client aura besoin du NOMBRE, pas seulement de son
   * libellé. Tant que ce n'est pas le cas, le backend arbitre et l'écran cite.
   */
  const fsp = await import('node:fs');
  const pathp = await import('node:path');
  const urlp = await import('node:url');
  const racine = pathp.resolve(
    pathp.dirname(urlp.fileURLToPath(import.meta.url)), '../../..',
  );
  const lire = (rel) => fsp.readFileSync(pathp.join(racine, rel), 'utf8');

  /** Tous les `.ts`/`.tsx` du Manager, hors tests d'atelier. */
  const fichiersFront = (dossier) => {
    if (!fsp.existsSync(dossier)) return [];
    return fsp.readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
      const complet = pathp.join(dossier, e.name);
      if (e.isDirectory()) return fichiersFront(complet);
      return /\.tsx?$/.test(e.name) && !e.name.includes('.test.') ? [complet] : [];
    });
  };

  /**
   * L'ÉCRAN QUI ANNONCE UNE LIMITE DOIT ANNONCER LA VRAIE.
   *
   * La fiche d'un chapitre propose un import d'image de tête ; sa politique
   * est celle du hero — pleine largeur, 2560 px. Un écran qui citerait un
   * chiffre écrit à la main mentirait au premier ajustement de la politique,
   * et c'est exactement ce que ce contrôle interdit.
   */
  const plafondChapitre = politique.policyFor('chapter-image').maxInputBytes;
  check('l’image de tête d’un chapitre partage la politique du hero',
    plafondChapitre === politique.policyFor('hero').maxInputBytes);

  const { MAX_PDF_BYTES, MAX_PDF_PAGES } = await import('../services/contractDocument.service.js');
  const libellePdf = politique.humanBytes(MAX_PDF_BYTES);
  check(`l’import de contrat cite la vraie limite (${libellePdf}, ${MAX_PDF_PAGES} pages)`,
    lire('manager/src/pages/dev/DevContractsPage.tsx')
      .includes(`${libellePdf} et ${MAX_PDF_PAGES} pages`));

  /**
   * ET AUCUN AUTRE ÉCRAN N'INVENTE UN PLAFOND. On relève les mégaoctets écrits
   * en toutes lettres : chacun doit correspondre à une valeur de la politique,
   * ou à la limite des PDF. Un nombre qui ne vient de nulle part est un nombre
   * qui dérivera — sans que personne ne s'en aperçoive, puisqu'il est dans une
   * phrase et pas dans du code.
   */
  const connus = new Set([
    ...Object.values(politique.MEDIA_POLICIES).map((p) => politique.humanBytes(p.maxInputBytes)),
    libellePdf,
  ]);
  const inventes = [];
  for (const fichier of fichiersFront(pathp.join(racine, 'manager/src'))) {
    for (const m of fsp.readFileSync(fichier, 'utf8').matchAll(/(\d+(?:[.,]\d+)?)\s*Mo\b/g)) {
      const cite = `${m[1].replace(',', '.')} Mo`;
      if (!connus.has(cite)) inventes.push(`${pathp.basename(fichier)} → ${cite}`);
    }
  }
  check(`aucun plafond inventé à l’écran${inventes.length ? ` — ${inventes.join(', ')}` : ''}`,
    inventes.length === 0);
}


console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
