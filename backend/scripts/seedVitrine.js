import 'dotenv/config';
import mongoose from 'mongoose';

import Page from '../models/Page.js';
import VitrineMenuItem from '../models/VitrineMenuItem.js';

const vitrinePages = [
  {
    slug: 'home',
    moduleFile: 'home',
    type: 'vitrine',
    order: 1,
    navigationPlacement: 'burger',
    access: { public: true, requiresAuth: false, requiresPurchase: false },
    disabled: { enabled: false }
  },
  {
    slug: 'about',
    moduleFile: 'about',
    type: 'vitrine',
    order: 2,
    navigationPlacement: 'burger',
    access: { public: true, requiresAuth: false, requiresPurchase: false },
    disabled: { enabled: false }
  },
  {
    slug: 'myaccount',
    moduleFile: 'myAccount',
    type: 'vitrine',
    order: 3,
    navigationPlacement: 'header',
    access: { public: true, requiresAuth: false, requiresPurchase: false },
    disabled: { enabled: false }
  },
  {
    slug: 'myformations',
    moduleFile: 'myFormations',
    type: 'vitrine',
    order: 4,
    navigationPlacement: 'burger',
    access: { public: false, requiresAuth: true, requiresPurchase: true },
    disabled: { enabled: false }
  },
  {
    slug: 'my-gift-cards',
    moduleFile: 'myGiftCards',
    type: 'vitrine',
    order: 0,
    navigationPlacement: 'burger',
    access: { public: false, requiresAuth: true, requiresPurchase: false },
    disabled: { enabled: false }
  },
  {
    slug: 'myfavorites',
    moduleFile: 'myFavorites',
    type: 'vitrine',
    order: 13,
    navigationPlacement: 'header',
    access: { public: false, requiresAuth: true, requiresPurchase: false },
    disabled: { enabled: false }
  },
  {
    slug: 'distanciel-modules',
    moduleFile: 'distancielModules',
    type: 'vitrine',
    order: 5,
    navigationPlacement: 'burger',
    access: { public: false, requiresAuth: true, requiresPurchase: true },
    disabled: { enabled: false }
  },
  {
    slug: 'presentiel-sessions',
    moduleFile: 'presentielSessions',
    type: 'vitrine',
    order: 6,
    navigationPlacement: 'burger',
    access: { public: false, requiresAuth: true, requiresPurchase: true },
    disabled: { enabled: false }
  },
  {
    slug: 'checkout',
    moduleFile: 'checkout',
    type: 'vitrine',
    order: 7,
    navigationPlacement: 'header',
    access: { public: false, requiresAuth: true, requiresPurchase: false },
    disabled: { enabled: false }
  },
  {
    slug: 'shop',
    moduleFile: 'shop',
    type: 'vitrine',
    order: 8,
    navigationPlacement: 'burger',
    access: { public: true, requiresAuth: false, requiresPurchase: false },
    disabled: { enabled: false }
  },
  {
    slug: 'item-detail',
    moduleFile: 'itemDetail',
    type: 'vitrine',
    order: 9,
    access: { public: true, requiresAuth: false, requiresPurchase: false },
    disabled: { enabled: false }
  },
  {
    slug: 'mentions-legales',
    moduleFile: 'legalPage',
    type: 'vitrine',
    order: 10,
    navigationPlacement: 'burger',
    access: { public: true, requiresAuth: false, requiresPurchase: false },
    disabled: { enabled: false }
  },
  {
    slug: 'politique-confidentialite',
    moduleFile: 'legalPage',
    type: 'vitrine',
    order: 11,
    navigationPlacement: 'burger',
    access: { public: true, requiresAuth: false, requiresPurchase: false },
    disabled: { enabled: false }
  },
  {
    slug: 'cgv',
    moduleFile: 'legalPage',
    type: 'vitrine',
    order: 12,
    navigationPlacement: 'burger',
    access: { public: true, requiresAuth: false, requiresPurchase: false },
    disabled: { enabled: false }
  }
];

const gestionPages = [
  {
    slug: 'pageManager',
    moduleFile: 'pageManager',
    type: 'gestion',
    order: 1,
    disabled: { enabled: false }
  },
  {
    slug: 'vitrineManager',
    moduleFile: 'vitrineManager',
    type: 'gestion',
    order: 2
  },
  {
    slug: 'productManager',
    moduleFile: 'productManager',
    type: 'gestion',
    order: 3
  },
  {
    slug: 'formationManager',
    moduleFile: 'formationManager',
    type: 'gestion',
    order: 4
  },
  {
    slug: 'adminManager',
    moduleFile: 'adminManager',
    type: 'gestion',
    order: 5,
    disabled: { enabled: false }
  },
  {
    slug: 'legalPagesManager',
    moduleFile: 'legalPagesManager',
    type: 'gestion',
    order: 6,
    disabled: { enabled: false }
  },
  {
    slug: 'monthly-commission-invoices',
    moduleFile: 'monthlyCommissionInvoices',
    type: 'gestion',
    order: 7,
    disabled: { enabled: false }
  },
  {
    slug: 'mail-template-editor',
    moduleFile: 'mailTemplateEditor',
    type: 'gestion',
    order: 8,
    disabled: { enabled: false },
    devOnly: true
  },
  {
    slug: 'site-status',
    moduleFile: 'siteStatus',
    type: 'gestion',
    order: 9,
    disabled: { enabled: false },
    devOnly: true,
    allowedRolesGestion: ['dev']
  }
];

const menuItems = [
  { label: 'Accueil', slug: 'home', order: 1, access: { public: true } },
  { label: 'À propos', slug: 'about', order: 2, access: { public: true } },
  { label: 'Mon compte', slug: 'myaccount', order: 3, access: { requiresAuth: true } },
  { label: 'Mes formations', slug: 'myformations', order: 4, access: { requiresAuth: true, requiresPurchase: true } },
  { label: 'Boutique', slug: 'shop', order: 5, access: { public: true } },
  { label: 'Mes favoris', slug: 'myfavorites', order: 6, access: { requiresAuth: true } }
];

async function seed() {
  const mongoURI = process.env.MONGODB_URI;
  if (!mongoURI) {
    console.error('MONGODB_URI manquant dans .env');
    process.exit(1);
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(mongoURI, { dbName: 'beautysavage-database' });
  console.log('Connexion MongoDB pour le seed vitrine.');
  for (const page of vitrinePages) {
    await Page.updateOne(
      { slug: page.slug },
      { $set: page },
      { upsert: true }
    );
  }
  for (const page of gestionPages) {
    await Page.updateOne(
      { slug: page.slug },
      { $set: page },
      { upsert: true }
    );
  }
  for (const item of menuItems) {
    await VitrineMenuItem.updateOne(
      { slug: item.slug },
      { $set: item },
      { upsert: true }
    );
  }
  console.log('Seed vitrine terminé.');
  await mongoose.disconnect();
}

seed().catch(err => {
  console.error('Seed vitrine échoué', err);
  process.exit(1);
});
