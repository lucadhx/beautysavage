// MIGRATION — recopier `contract.yousign` dans `contract.signature`.
//
// docs/OPENSIGN_MIGRATION.md.
//
//   node src/scripts/migrate-signature-block.js [--apply]
//
// ══ POURQUOI CETTE MIGRATION EXISTE ═════════════════════════════════════════
//
// Le bloc de signature portait le nom d'un fournisseur. Depuis la bascule, une
// nouvelle demande part chez OpenSign : le champ `yousign.signatureRequestId`
// contenant un identifiant OpenSign aurait été faux à la lecture, et faux dans
// chaque écran, chaque export et chaque requête d'exploitation qui le mentionne.
//
// Le code lit désormais les DEUX blocs (`signatureRecord.js`), ce qui rend cette
// migration facultative pour fonctionner. Elle reste nécessaire pour trois
// raisons qui, elles, ne se contournent pas :
//
//  1. une requête d'exploitation peut filtrer sur `signature.provider` — encore
//     faut-il que le champ existe ;
//  2. la réconciliation cherche les contrats à relire : tant que les deux blocs
//     coexistent, elle doit interroger les deux, et cette double interrogation
//     ne doit pas devenir permanente ;
//  3. le repli de lecture pourra disparaître sans que personne ait à se
//     demander ce qu'il couvrait.
//
// ══ CE QU'ELLE NE FAIT PAS ══════════════════════════════════════════════════
//
// Elle n'EFFACE PAS `yousign`. Le bloc historique reste en place : c'est la
// seule preuve que les valeurs recopiées venaient bien de là, et il ne coûte
// rien. L'effacer transformerait une migration réversible en migration
// définitive, pour aucun gain.
//
// ══ SANS `--apply`, ELLE NE FAIT QUE COMPTER ════════════════════════════════
import mongoose from 'mongoose';

import { config } from '../config/env.js';
import { Contract } from '../models/Contract.model.js';
import { LEGACY_SIGNATURE_PROVIDER } from '../services/signature/signatureRecord.js';

const APPLIQUER = process.argv.includes('--apply');

await mongoose.connect(config.mongoUri, { dbName: config.dbName });

const total = await Contract.countDocuments();
const aMigrer = await Contract.find({
  'yousign.signatureRequestId': { $ne: null },
  $or: [
    { 'signature.requestId': null },
    { 'signature.requestId': { $exists: false } },
  ],
}).lean();

console.log('\n=== BLOC DE SIGNATURE DES CONTRATS ===');
console.log(`contrats                       : ${total}`);
console.log(`portant une demande historique : ${aMigrer.length}`);

const dejaMigres = await Contract.countDocuments({ 'signature.requestId': { $ne: null } });
console.log(`portant déjà le bloc neutre    : ${dejaMigres}`);

if (!APPLIQUER) {
  console.log('\n(simulation — relancer avec --apply pour écrire)');
} else if (aMigrer.length === 0) {
  console.log('\nRien à faire.');
} else {
  let migres = 0;
  for (const c of aMigrer) {
    const y = c.yousign ?? {};
    // eslint-disable-next-line no-await-in-loop
    await Contract.updateOne({ _id: c._id }, {
      $set: {
        /**
         * LE FOURNISSEUR EST INSCRIT, PAS DEVINÉ.
         *
         * Aucun autre fournisseur n'a jamais écrit dans ce bloc : c'est un fait
         * historique, pas une probabilité. L'inscrire une fois vaut mieux que
         * le redéduire à chaque lecture pendant des années.
         */
        'signature.provider': LEGACY_SIGNATURE_PROVIDER,
        'signature.requestId': y.signatureRequestId ?? null,
        'signature.documentId': y.documentId ?? null,
        'signature.devSignerId': y.devSignerId ?? null,
        'signature.clientSignerId': y.adminSignerId ?? null,
        'signature.status': y.status ?? 'NONE',
        'signature.devSignedAt': y.devSignedAt ?? null,
        'signature.clientSignedAt': y.adminSignedAt ?? null,
        'signature.autoReturn': Boolean(y.autoReturn),
      },
    });
    migres += 1;
  }
  console.log(`\n${migres} contrat(s) migré(s). Le bloc « yousign » est conservé intact.`);
}

await mongoose.disconnect();
