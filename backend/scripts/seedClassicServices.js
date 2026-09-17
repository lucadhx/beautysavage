// Seed de 3 prestations classiques d'institut de beauté, chacune avec description soignée,
// photos, 3 avis publiés (manual_institute) et 3 FAQ. SUPPRIME les prestations existantes
// (et leurs avis "service") avant de recréer — relançable sans dupliquer.
//
//   node scripts/seedClassicServices.js
import 'dotenv/config';
import mongoose from 'mongoose';

import Service from '../models/Service.js';
import Review from '../models/Review.js';

const SERVICES = [
  {
    name: 'Soin du Visage Éclat',
    slug: 'soin-du-visage-eclat',
    shortDescription: 'Un soin complet sur mesure pour une peau nette, repulpée et lumineuse.',
    description:
      'Offrez à votre peau la parenthèse qu’elle mérite. Ce soin du visage complet débute par un diagnostic ' +
      'personnalisé afin d’adapter chaque étape à votre type de peau : double nettoyage, gommage enzymatique doux, ' +
      'extraction si nécessaire, puis modelage liftant du visage, du cou et du décolleté pour relancer la ' +
      'micro-circulation. Un masque ciblé (hydratant, purifiant ou apaisant) vient sceller les actifs avant ' +
      'l’application d’un sérum et d’une protection adaptée. Vous repartez avec une peau nette, repulpée et un teint ' +
      'visiblement plus lumineux dès la première séance — ainsi que nos conseils pour prolonger les résultats à la maison.',
    duration: 60,
    price: 65,
    photos: [
      'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?w=1200&q=80',
      'https://images.unsplash.com/photo-1616394584738-fc6e612e71b9?w=1200&q=80',
      'https://images.unsplash.com/photo-1596755389378-c31d21fd1273?w=1200&q=80'
    ],
    faq: [
      {
        question: 'Ce soin convient-il aux peaux sensibles ?',
        answer:
          'Oui. Le diagnostic réalisé en début de séance nous permet d’adapter les produits et les gestes aux peaux ' +
          'réactives : gommage doux, masque apaisant et actifs sans parfum. Signalez simplement toute allergie connue.'
      },
      {
        question: 'Puis-je me maquiller après la séance ?',
        answer:
          'Nous conseillons de laisser la peau respirer 12 heures après le soin pour laisser les actifs agir. ' +
          'Idéalement, planifiez votre séance un jour sans obligation ou en fin de journée.'
      },
      {
        question: 'À quelle fréquence faut-il faire ce soin ?',
        answer:
          'Pour un résultat durable, une séance toutes les 4 à 6 semaines est idéale — c’est le cycle de ' +
          'renouvellement naturel de la peau. En cure (3 séances rapprochées), les résultats sont encore plus visibles.'
      }
    ],
    reviews: [
      {
        displayName: 'Camille R.',
        rating: 5,
        comment:
          'Ma peau n’a jamais été aussi lumineuse ! Le diagnostic de départ fait vraiment la différence, tout était ' +
          'adapté à ma peau mixte. Le modelage du visage est un pur moment de détente. Je reviendrai chaque mois.'
      },
      {
        displayName: 'Sophie L.',
        rating: 5,
        comment:
          'Institut très propre, accueil chaleureux et surtout un vrai résultat : teint frais et pores resserrés dès ' +
          'la sortie. J’ai même reçu des conseils personnalisés pour ma routine du soir. Merci !'
      },
      {
        displayName: 'Inès M.',
        rating: 4,
        comment:
          'Très beau soin, ma peau sensible a été parfaitement respectée. Petit bémol sur l’attente de quelques ' +
          'minutes en début de rendez-vous, mais le résultat en valait largement la peine.'
      }
    ]
  },
  {
    name: 'Manucure Semi-Permanente',
    slug: 'manucure-semi-permanente',
    shortDescription: 'Des ongles impeccables jusqu’à 3 semaines, pose soignée et brillance miroir.',
    description:
      'La manucure qui tient le rythme de votre quotidien. Après une préparation minutieuse de l’ongle — repoussage ' +
      'des cuticules, limage à la forme de votre choix et lissage de la surface — nous appliquons un vernis ' +
      'semi-permanent professionnel, catalysé sous lampe LED, pour une brillance miroir qui dure jusqu’à trois ' +
      'semaines sans écaille. Couleur intemporelle, french délicate ou nuance tendance de saison : notre nuancier de ' +
      'plus de 100 teintes a forcément la vôtre. La pose se termine par une huile nourrissante pour des cuticules ' +
      'souples et un fini parfait. Dépose douce de l’ancien vernis incluse.',
    duration: 45,
    price: 40,
    photos: [
      'https://images.unsplash.com/photo-1604654894610-df63bc536371?w=1200&q=80',
      'https://images.unsplash.com/photo-1610992015732-2449b76344bc?w=1200&q=80',
      'https://images.unsplash.com/photo-1632345031435-8727f6897d53?w=1200&q=80'
    ],
    faq: [
      {
        question: 'Combien de temps tient le vernis semi-permanent ?',
        answer:
          'Entre 2 et 3 semaines selon la vitesse de pousse de vos ongles et votre activité. Pour prolonger la tenue, ' +
          'portez des gants pour le ménage et hydratez vos cuticules quotidiennement avec l’huile conseillée en fin de séance.'
      },
      {
        question: 'La dépose est-elle incluse dans la prestation ?',
        answer:
          'Oui, la dépose douce de votre ancien vernis semi-permanent est incluse si elle est réalisée chez nous. ' +
          'Ne l’arrachez jamais vous-même : cela abîme la kératine de l’ongle en profondeur.'
      },
      {
        question: 'Le semi-permanent abîme-t-il les ongles ?',
        answer:
          'Non, à condition que la pose et la dépose soient réalisées dans les règles de l’art. Nous utilisons des ' +
          'produits professionnels de qualité et une préparation qui respecte l’ongle naturel. Une pause d’une semaine ' +
          'toutes les 3 ou 4 poses reste un bon réflexe.'
      }
    ],
    reviews: [
      {
        displayName: 'Julie P.',
        rating: 5,
        comment:
          'Pose ultra soignée, aucune bulle, aucun débordement. 3 semaines après, mes ongles sont toujours ' +
          'impeccables. Le choix de couleurs est impressionnant, j’ai eu du mal à me décider !'
      },
      {
        displayName: 'Marion D.',
        rating: 5,
        comment:
          'Enfin une esthéticienne qui prend le temps de bien préparer l’ongle avant la pose. Résultat net, brillant, ' +
          'et ma manucure a survécu à deux semaines de vacances à la plage. Je recommande les yeux fermés.'
      },
      {
        displayName: 'Laura B.',
        rating: 4,
        comment:
          'Très jolie french, fine et régulière comme je voulais. La tenue est top. Je retire une étoile uniquement ' +
          'parce que le créneau du samedi est difficile à obtenir — preuve que l’adresse est bonne !'
      }
    ]
  },
  {
    name: 'Massage Relaxant Corps Entier',
    slug: 'massage-relaxant-corps-entier',
    shortDescription: 'Une heure de lâcher-prise absolu, aux huiles chaudes et gestes enveloppants.',
    description:
      'Une heure rien que pour vous. Dans une cabine à la lumière tamisée, bercée par une musique douce, ce massage ' +
      'relaxant du corps entier enchaîne des manœuvres lentes et enveloppantes inspirées du massage californien : ' +
      'effleurages, lissages profonds et pressions glissées aux huiles végétales chauffées. Nuque, épaules, dos, ' +
      'jambes et pieds — chaque zone de tension est travaillée à l’écoute de vos besoins, avec une pression ajustée ' +
      'en continu. Le stress s’efface, la respiration s’apaise, les muscles se relâchent. Vous quittez la cabine avec ' +
      'une sensation de légèreté qui dure plusieurs jours. Le rituel parfait à s’offrir… ou à offrir.',
    duration: 60,
    price: 75,
    photos: [
      'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=1200&q=80',
      'https://images.unsplash.com/photo-1600334129128-685c5582fd35?w=1200&q=80',
      'https://images.unsplash.com/photo-1519824145371-296894a0daa9?w=1200&q=80'
    ],
    faq: [
      {
        question: 'Faut-il prévoir quelque chose avant la séance ?',
        answer:
          'Rien de particulier : évitez simplement un repas copieux dans l’heure qui précède et arrivez 5 minutes en ' +
          'avance pour profiter pleinement de votre heure de soin. Des lingettes et une serviette sont à votre disposition.'
      },
      {
        question: 'La pression du massage est-elle adaptable ?',
        answer:
          'Absolument. Nous faisons un point rapide avant la séance sur vos zones de tension et vos préférences, et ' +
          'la pression est ajustée tout au long du massage. N’hésitez jamais à le signaler pendant le soin.'
      },
      {
        question: 'Ce massage est-il adapté aux femmes enceintes ?',
        answer:
          'À partir du deuxième trimestre et avec l’accord de votre médecin, nous adaptons le protocole : installation ' +
          'confortable sur le côté, huiles neutres et zones sensibles évitées. Précisez-le simplement lors de la réservation.'
      }
    ],
    reviews: [
      {
        displayName: 'Élodie T.',
        rating: 5,
        comment:
          'Le meilleur massage que j’ai reçu depuis longtemps. L’huile chaude, la pression parfaitement dosée, ' +
          'l’ambiance de la cabine… Je me suis endormie tellement j’étais détendue. Une vraie bulle hors du temps.'
      },
      {
        displayName: 'Nadia K.',
        rating: 5,
        comment:
          'Offert par mon conjoint pour mon anniversaire : une merveille. Mes tensions dans les épaules ont disparu ' +
          'et la sensation de légèreté a duré tout le week-end. J’ai déjà repris rendez-vous.'
      },
      {
        displayName: 'Charlotte V.',
        rating: 4,
        comment:
          'Très beau moment de détente, gestes fluides et enchaînement sans interruption. J’aurais aimé un peu plus ' +
          'de temps sur le dos, mais la praticienne a noté ma préférence pour la prochaine fois. Très professionnel.'
      }
    ]
  }
];

async function seed() {
  const mongoURI = process.env.MONGODB_URI;
  if (!mongoURI) {
    console.error('MONGODB_URI manquant dans .env');
    process.exit(1);
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(mongoURI, {
    dbName: process.env.MONGODB_DB_NAME || 'beautysavage-database'
  });
  console.log('Connexion MongoDB — seed prestations classiques.');

  // 1) Purge : prestations existantes + leurs avis "service".
  const existing = await Service.find({}, { name: 1 }).lean();
  if (existing.length) {
    const ids = existing.map((s) => s._id);
    const { deletedCount: reviewsDeleted } = await Review.deleteMany({
      targetType: 'service',
      serviceId: { $in: ids }
    });
    await Service.deleteMany({ _id: { $in: ids } });
    console.log(
      `Supprimé : ${existing.length} prestation(s) (${existing.map((s) => s.name).join(', ')}) ` +
      `+ ${reviewsDeleted} avis associé(s).`
    );
  }

  // 2) Création des 3 prestations + avis.
  for (const spec of SERVICES) {
    const { reviews, ...serviceFields } = spec;
    const service = await Service.create({
      ...serviceFields,
      isActive: true,
      isBookable: true,
      paymentType: 'full'
    });

    await Review.insertMany(
      reviews.map((r, i) => ({
        targetType: 'service',
        sourceType: 'manual_institute',
        serviceId: service._id,
        userId: null,
        formationId: null,
        displayName: r.displayName,
        rating: r.rating,
        comment: r.comment,
        status: 'published',
        // Dates étalées sur les dernières semaines pour un rendu naturel.
        createdAt: new Date(Date.now() - (i + 1) * 9 * 24 * 60 * 60 * 1000)
      }))
    );

    console.log(
      `▶ ${service.name} — ${service.price}€ / ${service.duration} min, ` +
      `${service.photos.length} photos, ${service.faq.length} FAQ, ${reviews.length} avis.`
    );
  }

  await mongoose.disconnect();
  console.log('\nSeed terminé.');
}

seed().catch((err) => {
  console.error('Seed prestations classiques échoué', err);
  process.exit(1);
});
