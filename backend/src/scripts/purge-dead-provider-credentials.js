/**
 * PURGE DES CREDENTIALS FOURNISSEUR MORTES (L6.4).
 *
 * ══ CE QUE CE SCRIPT SUPPRIME, ET CE QU'IL NE SUPPRIMERA JAMAIS ═════════════
 *
 * Les lots L9.2 et L6.3 FINAL ont retiré au projet la capacité d'appeler
 * Hostinger et Stripe. Les clés, elles, sont restées chiffrées en base : plus
 * lues, plus modifiables, plus affichées — mais toujours là.
 *
 * « Un vieux secret qu'on ne lit plus mais qu'on garde au cas où » est
 * exactement ce que ce lot supprime. Le « au cas où » n'existe pas : il n'y a
 * plus de code pour s'en servir, et la seule chose qu'une clé oubliée puisse
 * encore faire, c'est fuir.
 *
 * ══ LA RÈGLE : ON NE DEVINE JAMAIS ══════════════════════════════════════════
 *
 * Chaque champ rencontré doit figurer dans une liste EXPLICITE, par
 * fournisseur : soit à conserver, soit à supprimer. Tout le reste est déclaré
 * `UNKNOWN`, laissé intact, et remonté dans le rapport.
 *
 * C'est volontairement plus strict qu'un « tout sauf ce qu'on garde » : ce
 * dernier supprimerait un champ qu'on aurait simplement oublié de reconnaître,
 * et une suppression de secret ne se rattrape pas.
 *
 * ══ LE PIÈGE QU'IL FAUT ÉVITER ══════════════════════════════════════════════
 *
 * Stripe conserve un `webhookSecret` — un `whsec_` livré par le Panel, qui sert
 * à VÉRIFIER les événements reçus. Le supprimer parce que « le projet n'appelle
 * plus Stripe » rendrait le projet sourd : les paiements continueraient, et il
 * n'en serait plus averti. La distinction clé d'APPEL / secret de VÉRIFICATION
 * est la raison d'être de la table ci-dessous.
 *
 * ── USAGE ───────────────────────────────────────────────────────────────────
 *
 *   node src/scripts/purge-dead-provider-credentials.js --dry-run
 *   node src/scripts/purge-dead-provider-credentials.js --apply
 *   node src/scripts/purge-dead-provider-credentials.js --dry-run --json
 *
 * Le monde vient de l'environnement du processus (ENV/DB), comme partout
 * ailleurs : ce script ne choisit aucun monde, il nettoie celui qu'on lui
 * donne.
 */
import mongoose from 'mongoose';

/**
 * LA TABLE. Code-first, fermée, et relue à chaque lot qui la touche.
 *
 * `keep` — le champ a un LECTEUR RUNTIME prouvé. Ne jamais supprimer.
 * `dead` — le champ n'a AUCUN lecteur, aucune route d'écriture, aucune UI.
 *
 * Un champ absent des deux listes est `UNKNOWN` : intact, signalé.
 */
export const CREDENTIAL_POLICY = Object.freeze({
  /**
   * STRIPE — autorité PANEL depuis L6.3 FINAL.
   *
   * `webhookSecret` est le SEUL survivant, et il est actif : lu par
   * `stripe.service.js#verifyStripeWebhookAnyMode` à chaque événement reçu, et
   * par le gestionnaire de webhook pour dire s'il est configuré.
   *
   * `secretKey` et `publishableKey` sont mortes : aucun lecteur depuis L6.3C,
   * aucun champ au catalogue depuis L6.3 FINAL, aucune route qui les accepte.
   */
  STRIPE: {
    keep: ['webhookSecret'],
    dead: ['secretKey', 'publishableKey'],
  },
  /**
   * HOSTINGER — autorité PANEL depuis L9.2.
   *
   * Aucun credential local n'a de lecteur. Le DNS d'une publication passe
   * entièrement par la plateforme, qui prouve que le nom appartient au projet
   * puis écrit avec SA clé. Il n'existe aucun webhook Hostinger entrant, donc
   * aucun secret de vérification à préserver.
   */
  HOSTINGER: {
    keep: [],
    dead: ['apiToken'],
  },
  /**
   * BREVO — autorité PANEL depuis R11. Les TROIS credentials sont morts.
   *
   * `apiKey` n'a plus aucun lecteur : les envois passent par la capacité
   * `email.send_template` du Panel, et son dernier appelant — le provisionneur
   * de webhook local — a été supprimé avec le reste du stack.
   *
   * ══ POURQUOI LES SECRETS DE WEBHOOK MEURENT AUSSI ════════════════════════
   *
   * On ne supprime JAMAIS un secret de webhook encore en usage : ce serait
   * rendre le projet sourd à un fournisseur, en silence, et le constat
   * n'arriverait que le jour où une livraison resterait « Accepté » pour
   * toujours.
   *
   * Ici la surdité est impossible, parce qu'il n'y a plus d'oreille : la route
   * `/webhooks/brevo/transactional/:mode` n'existe plus, et Brevo ne l'appelait
   * déjà plus — les événements de livraison suivent le COMPTE, celui du Panel.
   * `webhookSecretPrevious`, qui couvrait la fenêtre de rotation, protège une
   * rotation qui ne peut plus avoir lieu.
   */
  BREVO: {
    keep: [],
    dead: ['apiKey', 'webhookSecret', 'webhookSecretPrevious'],
  },
  /**
   * YOUSIGN — autorité PANEL depuis R10.5C. Les DEUX credentials sont morts.
   *
   * ══ POURQUOI `webhookSecret` MEURT AUSSI, ET C'EST LE POINT DÉLICAT ═══════
   *
   * On ne supprime JAMAIS un secret de webhook encore en usage : ce serait
   * rendre le projet sourd à un fournisseur, en silence, et le constat
   * n'arriverait que le jour où un contrat signé resterait « en cours ».
   *
   * Ici l'usage n'existe plus, et pas seulement « plus dans le code » : la
   * route `POST /api/webhooks/yousign` a été SUPPRIMÉE, et Yousign appelle
   * désormais le Panel. Ce secret ne pourrait donc plus servir à vérifier quoi
   * que ce soit — aucun événement ne se présente à une porte qui n'existe pas.
   *
   * Le contraste avec STRIPE est délibéré : là-bas le webhook arrive encore
   * ici, donc `webhookSecret` est CONSERVÉ alors même que `secretKey` meurt.
   * La règle n'est pas « le fournisseur est passé sous autorité Panel », c'est
   * « plus personne ne lit ce champ, et plus rien ne peut le lire ».
   *
   * `apiKey` : aucun appel, aucun lecteur, aucun champ au catalogue
   * (`fields: []`), aucune route qui l'accepte, aucun diagnostic qui la
   * consulte — la préparation vient de la plateforme.
   */
  YOUSIGN: {
    keep: [],
    dead: ['apiKey', 'webhookSecret'],
  },
});

const MODES = Object.freeze(['TEST', 'PROD']);

/**
 * Analyse un document, sans rien écrire.
 *
 * Rendu volontairement PUR : la sélection du dry-run et celle de l'apply sont
 * donc identiques par construction, plutôt que par discipline. Deux sélections
 * qui divergeraient rendraient le dry-run mensonger — et c'est précisément ce
 * qu'un dry-run doit empêcher.
 */
export function planForDocument(doc) {
  const provider = String(doc?.provider ?? '').toUpperCase();
  const politique = CREDENTIAL_POLICY[provider];
  const aRetirer = [];
  const inconnus = [];
  const conserves = [];

  if (!politique) {
    /**
     * Fournisseur présent en base mais absent de la table : on ne suppose
     * RIEN. Un provider retiré du catalogue peut très bien avoir gardé des
     * secrets encore utilisés par un chemin qu'on ne connaît pas.
     */
    for (const mode of MODES) {
      for (const champ of champsDe(doc, mode)) {
        inconnus.push({ provider, mode, field: champ, reason: 'PROVIDER_NOT_IN_POLICY' });
      }
    }
    return { provider, aRetirer, inconnus, conserves };
  }

  for (const mode of MODES) {
    for (const champ of champsDe(doc, mode)) {
      if (politique.keep.includes(champ)) {
        conserves.push({ provider, mode, field: champ });
      } else if (politique.dead.includes(champ)) {
        aRetirer.push({ provider, mode, field: champ, path: `modes.${mode}.credentials.${champ}` });
      } else {
        inconnus.push({ provider, mode, field: champ, reason: 'FIELD_NOT_IN_POLICY' });
      }
    }
  }
  return { provider, aRetirer, inconnus, conserves };
}

/**
 * Les noms de champs réellement présents pour un mode.
 *
 * Lit la Map mongoose comme l'objet brut d'un `.lean()` : les deux formes
 * existent selon l'appelant, et supposer l'une des deux ferait manquer des
 * documents — donc rater une purge, ou pire, croire un champ absent.
 */
function champsDe(doc, mode) {
  const creds = doc?.modes?.[mode]?.credentials;
  if (!creds) return [];
  if (typeof creds.keys === 'function') return [...creds.keys()];
  return Object.keys(creds);
}

/**
 * Exécute l'analyse, et n'écrit QUE si `apply` est vrai.
 *
 * @param {object} args
 * @param {boolean} [args.apply]  `false` = dry-run (aucune écriture)
 * @param {object} args.model     le modèle `IntegratedApi`
 */
export async function purgeDeadCredentials({ apply = false, model }) {
  const rapport = {
    mode: apply ? 'APPLY' : 'DRY_RUN',
    scanned: 0,
    providers: {},
    fieldsRemoved: 0,
    documentsUpdated: 0,
    skippedActiveSecrets: 0,
    unknown: [],
    errors: [],
  };

  const documents = await model.find({}).lean();
  rapport.scanned = documents.length;

  for (const doc of documents) {
    let plan;
    try {
      plan = planForDocument(doc);
    } catch (err) {
      rapport.errors.push({ provider: doc?.provider ?? null, message: String(err?.message ?? err) });
      continue;
    }

    const p = (rapport.providers[plan.provider] ??= {
      documents: 0, fieldsRemoved: 0, kept: 0, unknown: 0,
    });
    p.documents += 1;
    p.kept += plan.conserves.length;
    p.unknown += plan.inconnus.length;
    rapport.skippedActiveSecrets += plan.conserves.length;
    rapport.unknown.push(...plan.inconnus);

    if (plan.aRetirer.length === 0) continue;

    if (apply) {
      /**
       * `$unset` CIBLÉ, jamais un remplacement de document.
       *
       * Remplacer écraserait ce qu'un autre processus vient d'écrire — le
       * provisionnement de webhook, par exemple, qui pose un `whsec_` sans
       * prévenir. On ne retire que les chemins nommés, et rien d'autre.
       *
       * On ne supprime pas non plus l'objet `credentials` parent, même s'il
       * devient vide : il porte encore la forme du document, et un mode sans
       * `credentials` casserait les lectures qui l'attendent.
       */
      const unset = Object.fromEntries(plan.aRetirer.map((r) => [r.path, '']));
      try {
        const res = await model.updateOne({ _id: doc._id }, { $unset: unset });
        if (res.modifiedCount > 0) rapport.documentsUpdated += 1;
      } catch (err) {
        rapport.errors.push({ provider: plan.provider, message: String(err?.message ?? err) });
        continue;
      }
    } else {
      rapport.documentsUpdated += 1;
    }

    rapport.fieldsRemoved += plan.aRetirer.length;
    p.fieldsRemoved += plan.aRetirer.length;
  }

  return rapport;
}

/* -------------------------------------------------------------------------- */
/*  LIGNE DE COMMANDE                                                         */
/* -------------------------------------------------------------------------- */

const estAppeleDirectement = process.argv[1]
  && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());

if (estAppeleDirectement) {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  const json = args.has('--json');

  if (!apply && !args.has('--dry-run')) {
    console.error('Usage : --dry-run | --apply [--json]');
    process.exit(2);
  }

  const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
  await connectDatabase();
  const { IntegratedApi } = await import('../models/IntegratedApi.model.js');

  const rapport = await purgeDeadCredentials({ apply, model: IntegratedApi });

  if (json) {
    console.log(JSON.stringify(rapport, null, 2));
  } else {
    /**
     * AUCUNE VALEUR N'EST AFFICHÉE — jamais un secret, jamais un fragment,
     * jamais une empreinte partielle. Un rapport se recopie dans un ticket.
     */
    console.log(`\n[${rapport.mode}] base ${mongoose.connection.name}`);
    console.log(`  documents analysés   : ${rapport.scanned}`);
    console.log(`  documents modifiés   : ${rapport.documentsUpdated}`);
    console.log(`  champs retirés       : ${rapport.fieldsRemoved}`);
    console.log(`  secrets ACTIFS gardés: ${rapport.skippedActiveSecrets}`);
    console.log(`  inconnus (intacts)   : ${rapport.unknown.length}`);
    for (const [prov, p] of Object.entries(rapport.providers)) {
      console.log(`    · ${prov.padEnd(12)} retirés=${p.fieldsRemoved} gardés=${p.kept} inconnus=${p.unknown}`);
    }
    for (const u of rapport.unknown) {
      console.error(`  ⚠ INCONNU — ${u.provider}.${u.mode}.${u.field} (${u.reason}) : INTACT`);
    }
    for (const e of rapport.errors) console.error(`  ✗ ${e.provider} : ${e.message}`);
  }

  await disconnectDatabase();
  /**
   * Un `UNKNOWN` fait sortir en ÉCHEC, même en dry-run : il signifie qu'un
   * champ existe dont personne ne sait dire s'il est vivant. C'est exactement
   * le cas où il faut un humain, et un code de sortie nul l'enverrait dormir.
   */
  process.exit(rapport.errors.length > 0 || rapport.unknown.length > 0 ? 1 : 0);
}

export default { purgeDeadCredentials, planForDocument, CREDENTIAL_POLICY };
