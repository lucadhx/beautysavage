/**
 * L10.6A — LA TROISIÈME CAUSE, ET LA CONJONCTION.
 *
 * Ce que ces contrôles verrouillent :
 *
 *   · que `PAYMENT_DEFAULT` soit une cause INDÉPENDANTE, pas une valeur de plus
 *     dans une étiquette ;
 *   · que l'accessibilité soit la conjonction des trois conditions ;
 *   · qu'une régularisation retire UNE cause et ne rouvre jamais un site
 *     maintenu fermé par une autre ;
 *   · que l'instantané publié porte les trois causes, et pas seulement celle
 *     qui prime à l'affichage.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = process.env.DB_TEST || 'sbauto_payment_default';
process.env.DB_PROD = process.env.DB_PROD || 'sbauto_payment_default';
process.env.PANEL_SCHEDULER_ENABLED = 'false';
process.env.JWT_SECRET = process.env.JWT_SECRET
  || 'test-payment-default-secret-0123456789abcdef';

let pass = 0; let fail = 0;
const check = (nom, cond) => {
  if (cond) { pass += 1; console.log(`  ✓ ${nom}`); }
  else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (t) => console.log(`\n${t}`);

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();

const { SiteStatus } = await import('../models/SiteStatus.model.js');
const { getSingleton } = await import('../utils/singleton.js');
const { reconcileSiteStatus } = await import('../services/siteEnforcement.service.js');
const { buildSiteStatusProjection } = await import('../services/projectBridge/projectSync.service.js');
const { applyPaymentDefaultCause } = await import('../services/billing/paymentDefaultCause.applier.js');
{
  /** Remet les trois causes à zéro, sans passer par le moteur. */
  async function poser({ technical = false, protection = false }) {
    const site = await getSingleton(SiteStatus);
    site.technicalSuspension = technical
      ? { active: true, reason: 'Maintenance', suspendedAt: new Date(), suspendedBy: 'dev@test' }
      : { active: false, reason: '', suspendedAt: null, suspendedBy: '' };
    site.contractProtectionEnabled = protection;
    site.paymentDefault = { active: false, reason: '', since: null, paymentDefaultId: null, amountDueCents: 0 };
    await site.save();
    return reconcileSiteStatus({ actor: 'test' });
  }

  const cause = (active) => applyPaymentDefaultCause({
    change: {
      payload: active
        ? {
          active: true, reason: 'Défaut de paiement', since: new Date().toISOString(),
          paymentDefaultId: 'pd-1', amountDueCents: 24_900,
        }
        : { active: false },
    },
  });

  /* ════════════════════════════════════════════════════════════════════════ */
  section('1. La cause financière ferme un site que rien d’autre ne bloque');
  {
    await poser({ technical: false, protection: false });
    const avant = await getSingleton(SiteStatus);
    check('site ouvert au départ', avant.status === 'ACTIVE');

    const apres = await cause(true);
    check('LE SITE FERME', apres.status === 'SUSPENDED');
    check('…et la cause dominante est la nôtre', apres.suspensionSource === 'PAYMENT_DEFAULT');
    check('…avec le motif exact du contrat de service', apres.reason === 'Défaut de paiement');
    check('l’instantané porte la cause', apres.causes.paymentDefault === true);
  }

  /* ════════════════════════════════════════════════════════════════════════ */
  section('2. Régularisation seule — le site rouvre');
  {
    const apres = await cause(false);
    check('LE SITE ROUVRE', apres.status === 'ACTIVE');
    check('…plus aucune cause dominante', apres.suspensionSource === 'NONE');
    check('…et l’instantané est vide', apres.causes.paymentDefault === false);
  }

  /* ════════════════════════════════════════════════════════════════════════ */
  section('3. LE CAS QUI JUSTIFIE LE LOT — maintenance ET impayé');
  {
    await poser({ technical: true, protection: false });
    const apres = await cause(true);

    check('le site est fermé', apres.status === 'SUSPENDED');
    /**
     * La maintenance prime à l'affichage — et c'est voulu : elle explique mieux
     * une fermeture qu'un impayé, et le client doit lire en dernier la cause
     * sur laquelle il peut agir.
     */
    check('la cause DOMINANTE est TECHNICAL', apres.suspensionSource === 'TECHNICAL');
    /**
     * Mais notre cause EST appliquée. C'est exactement ce que `suspensionSource`
     * seul ne pourrait pas prouver, et pourquoi l'instantané existe.
     */
    check('L’INSTANTANÉ PROUVE QUE LA CAUSE FINANCIÈRE EST APPLIQUÉE',
      apres.causes.paymentDefault === true);
    check('…à côté de la technique', apres.causes.technical === true);
  }

  /* ════════════════════════════════════════════════════════════════════════ */
  section('4. Régularisation avec maintenance — AUCUNE réactivation');
  {
    const apres = await cause(false);

    check('la cause financière est retirée', apres.causes.paymentDefault === false);
    check('LE SITE RESTE FERMÉ', apres.status === 'SUSPENDED');
    check('…pour la maintenance', apres.suspensionSource === 'TECHNICAL');
    check('…qui n’a pas bougé', apres.causes.technical === true);
  }

  /* ════════════════════════════════════════════════════════════════════════ */
  section('5. Régularisation avec cause contractuelle — AUCUNE réactivation');
  {
    /** Protection active sans contrat servable : la cause CONTRACT naît. */
    await poser({ technical: false, protection: true });
    const initial = await getSingleton(SiteStatus);
    check('la cause contractuelle est active', initial.causes.contract === true);

    await cause(true);
    const apres = await cause(false);

    check('la cause financière est retirée', apres.causes.paymentDefault === false);
    check('LE SITE RESTE FERMÉ', apres.status === 'SUSPENDED');
    check('…pour le contrat', apres.suspensionSource === 'CONTRACT');
  }

  /* ════════════════════════════════════════════════════════════════════════ */
  section('6. Idempotence — deux livraisons identiques, un seul effet');
  {
    await poser({ technical: false, protection: false });
    const un = await cause(true);
    const deux = await cause(true);

    check('le site est fermé', deux.status === 'SUSPENDED');
    check('…et la date de suspension n’a pas bougé',
      new Date(un.suspendedAt).getTime() === new Date(deux.suspendedAt).getTime());

    const trois = await cause(false);
    const quatre = await cause(false);
    check('le retrait rejoué reste sans effet',
      trois.status === 'ACTIVE' && quatre.status === 'ACTIVE');
  }

  /* ════════════════════════════════════════════════════════════════════════ */
  section('7. La projection publie les trois causes');
  {
    await poser({ technical: true, protection: false });
    await cause(true);

    const { payload, entityType } = await buildSiteStatusProjection();
    check('c’est bien PROJECT_SITE_STATUS', entityType === 'PROJECT_SITE_STATUS');
    check('le verdict voyage', payload.accessible === false);
    check('la cause dominante aussi', payload.suspensionSource === 'TECHNICAL');
    check('L’INSTANTANÉ COMPLET VOYAGE — technique', payload.causes.technical === true);
    check('…contrat', payload.causes.contract === false);
    check('…et paiement', payload.causes.paymentDefault === true);

    /** Le Panel doit pouvoir conclure SANS recalculer quoi que ce soit. */
    check('les trois causes suffisent à expliquer le verdict',
      payload.accessible === !(payload.causes.technical
        || payload.causes.contract || payload.causes.paymentDefault));
  }

  /* ════════════════════════════════════════════════════════════════════════ */
  section('8. Aucun status forcé — la conjonction décide seule');
  {
    const fs = await import('node:fs');
    const url = await import('node:url');
    const pathMod = await import('node:path');
    const ici = pathMod.dirname(url.fileURLToPath(import.meta.url));
    const lire = (rel) => fs.readFileSync(pathMod.resolve(ici, rel), 'utf8');
    const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');

    const applicateur = code(lire('../services/billing/paymentDefaultCause.applier.js'));
    check('l’applicateur ne force jamais un statut',
      !/status\s*=\s*['"]ACTIVE|status\s*=\s*['"]SUSPENDED/.test(applicateur));
    check('…il rend la main au moteur', /reconcileSiteStatus/.test(applicateur));

    const moteur = code(lire('../services/siteEnforcement.service.js'));
    check('le moteur porte la conjonction des TROIS causes',
      /!technicalActive\s*&&\s*contractHonoured\s*&&\s*!paymentDefaultActive/.test(moteur));
    check('…et publie l’instantané', /site\.causes\s*=/.test(moteur));
  }
}

await SiteStatus.deleteMany({});
await disconnectDatabase();
await mongod.stop();

console.log(`
${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
