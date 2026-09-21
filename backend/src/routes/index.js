import { Router } from 'express';
import authRoutes from './auth.routes.js';
import metaRoutes from './meta.routes.js';
import publicRoutes from './public.routes.js';
import versionRoutes from './version.routes.js';
import companyRoutes from './company.routes.js';
import clientCompanyRoutes from './clientCompany.routes.js';
import chapterRoutes from './chapter.routes.js';
import sitePageRoutes from './sitePage.routes.js';
import homeContentRoutes from './homeContent.routes.js';
import themeRoutes from './theme.routes.js';
import siteStatusRoutes from './siteStatus.routes.js';
import teamRoutes from './team.routes.js';
import accountRoutes from './account.routes.js';
import uploadRoutes from './upload.routes.js';
import uiLiveRoutes from './uiLive.routes.js';
import systemConfigurationRoutes from './systemConfiguration.routes.js';
import roleAppearanceRoutes from './roleAppearance.routes.js';
import emailConfigurationRoutes from './emailConfiguration.routes.js';
import emailTemplateRoutes from './emailTemplate.routes.js';
import contactSubmissionRoutes from './contactSubmission.routes.js';
import domainEventRoutes from './domainEvent.routes.js';
import emailDeliveryDevRoutes from './emailDeliveryDev.routes.js';
import managedWebhookRoutes from './managedWebhook.routes.js';
import contactDiagnosticsRoutes from './contactDiagnostics.routes.js';
import contractRoutes from './contract.routes.js';
import myContractRoutes from './myContract.routes.js';
import calendarRoutes from './calendar.routes.js';
import deploymentRoutes from './deployment.routes.js';
import deploymentControlPlaneRoutes from './deploymentControlPlane.routes.js';
import projectBridgeRoutes from './projectBridge.routes.js';
import panelBridgeRoutes from './panelBridge.routes.js';
import { myInvoicesRouter, invoicesRouter } from './billing.routes.js';
import managerCommerceRoutes, { customerRoutes, publicCommerceRoutes } from './commerce.routes.js';

export const apiRouter = Router();

// Public (vitrine) + meta + version (non sensible)
apiRouter.use('/public', publicRoutes);
apiRouter.use('/public/commerce', publicCommerceRoutes);
apiRouter.use('/public/customer', customerRoutes);
apiRouter.use('/meta', metaRoutes);
apiRouter.use('/version', versionRoutes);

// Auth
apiRouter.use('/auth', authRoutes);

// Manager (authenticated)
apiRouter.use('/company', companyRoutes);
/**
 * MON ENTREPRISE — l’identité JURIDIQUE du client, publiée par le Panel.
 *
 * Volontairement DISTINCTE de `/company`, et la distinction est le chantier :
 *
 *   /company         la fiche COMMERCIALE de ce site — enseigne, horaires,
 *                    logos, coordonnées publiques. Éditée ici, par le client.
 *   /my-company      l’identité JURIDIQUE de l’entreprise cliente — raison
 *                    sociale, SIREN, adresse de facturation, signataire
 *                    contractuel. Publiée par le Panel, LECTURE SEULE.
 *
 * Les monter sous la même racine aurait entretenu l’idée qu’un champ de l’une
 * puisse corriger l’autre — et « SB Auto 06 » aurait continué de se retrouver
 * en « Facturer à » à la place de la société qui l’exploite.
 */
apiRouter.use('/my-company', clientCompanyRoutes);
/**
 * LE CONTENU DU SITE — deux référentiels, et deux seulement.
 *
 * `/chapters` les CHAPITRES du récit : Conception, Architecture, L'Expérience.
 *             Une structure FERMÉE, dessinée une fois, dont seul le texte
 *             change — c'est ce qui autorise la vitrine à leur donner une mise
 *             en scène propre.
 * `/pages`    les pages ÉDITORIALES, composées de blocs libres, pour tout ce
 *             qui se rédige au fil de l'eau.
 *
 * Les neuf référentiels du moteur d'origine — forfaits, gammes de prix, flotte,
 * tracés, avis, questions fréquentes, avant/après, bannières promotionnelles,
 * chronométrage — ont été RETIRÉS, pas désactivés. L.Y Solution ne vend pas un
 * catalogue : elle expose une méthode. Voir `models/Chapter.model.js`.
 */
apiRouter.use('/chapters', chapterRoutes);
apiRouter.use('/pages', sitePageRoutes);
// Le contenu de la page d'accueil — bannière, maquette, arguments, preuves.
apiRouter.use('/home-content', homeContentRoutes);
apiRouter.use('/theme', themeRoutes);
apiRouter.use('/site-status', siteStatusRoutes);
apiRouter.use('/uploads', uploadRoutes);
/**
 * FLUX D'INVALIDATION D'INTERFACE — le dernier maillon du live.
 *
 * Il ne transporte aucun objet metier : seulement le NOM d'une ressource qui
 * vient de changer. Le navigateur, prevenu, redemande la donnee a cette meme
 * API. Voir `services/uiLive/uiLive.service.js`.
 */
apiRouter.use('/live', uiLiveRoutes);
apiRouter.use('/my-contract', myContractRoutes);
apiRouter.use('/my-invoices', myInvoicesRouter);
apiRouter.use('/invoices', invoicesRouter);
apiRouter.use('/commerce', managerCommerceRoutes);
apiRouter.use('/calendar', calendarRoutes);
apiRouter.use('/role-appearance', roleAppearanceRoutes);
// Demandes de contact : ADMIN (destinataire) + DEV (diagnostic des notifications).
apiRouter.use('/admin/contact-submissions', contactSubmissionRoutes);

// DEV only
// `/dev-company` a été RETIRÉE : l'identité développeur est publiée par le
// Panel, et plus aucune lecture métier ne passe par la fiche locale. Laisser
// la route ouverte aurait entretenu l'idée qu'une seconde vérité subsiste.
apiRouter.use('/team', teamRoutes);
apiRouter.use('/accounts', accountRoutes);
apiRouter.use('/system-configuration', systemConfigurationRoutes);
apiRouter.use('/email-configuration', emailConfigurationRoutes);
apiRouter.use('/dev/email-templates', emailTemplateRoutes);
apiRouter.use('/dev/domain-events', domainEventRoutes);
apiRouter.use('/dev/email-deliveries', emailDeliveryDevRoutes);
apiRouter.use('/dev/managed-webhooks', managedWebhookRoutes);
apiRouter.use('/dev/contact-diagnostics', contactDiagnosticsRoutes);
apiRouter.use('/contracts', contractRoutes);
apiRouter.use('/deployment', deploymentRoutes);
apiRouter.use('/admin/deployments', deploymentControlPlaneRoutes);

// ProjectBridge : surface exposée AU Panel (spec ProjectBridge.openapi.yaml).
// Auth propre (secret d'appairage), disjointe des comptes DEV/ADMIN.
apiRouter.use('/project-bridge/v1', projectBridgeRoutes);
// Administration de la connexion au Panel (DEV) — distincte de la surface
// que le Panel appelle.
apiRouter.use('/panel-connection', panelBridgeRoutes);

export default apiRouter;
