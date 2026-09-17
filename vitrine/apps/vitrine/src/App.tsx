import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { LoadingState } from '@bs/ui';
import { PublicLayout } from './layouts/PublicLayout';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';

// RX-GO-2 — Code-splitting : layout + accueil + connexion restent EAGER (paint initial / auth) ; les autres
// pages sont chargées à la demande (React.lazy) sous une frontière Suspense. Named exports → default.
const ServicesPage = lazy(() => import('./pages/ServicesPage').then((m) => ({ default: m.ServicesPage })));
const ServiceDetailPage = lazy(() => import('./pages/ServiceDetailPage').then((m) => ({ default: m.ServiceDetailPage })));
const TrainingsPage = lazy(() => import('./pages/TrainingsPage').then((m) => ({ default: m.TrainingsPage })));
const TrainingDetailPage = lazy(() => import('./pages/TrainingDetailPage').then((m) => ({ default: m.TrainingDetailPage })));
const ProductsPage = lazy(() => import('./pages/ProductsPage').then((m) => ({ default: m.ProductsPage })));
const ProductDetailPage = lazy(() => import('./pages/ProductDetailPage').then((m) => ({ default: m.ProductDetailPage })));
const GiftCardsPage = lazy(() => import('./pages/GiftCardsPage').then((m) => ({ default: m.GiftCardsPage })));
const CartPage = lazy(() => import('./pages/CartPage').then((m) => ({ default: m.CartPage })));
const CheckoutPage = lazy(() => import('./pages/CheckoutPage').then((m) => ({ default: m.CheckoutPage })));
const PaymentSuccessPage = lazy(() => import('./pages/PaymentSuccessPage').then((m) => ({ default: m.PaymentSuccessPage })));
const PaymentCancelPage = lazy(() => import('./pages/PaymentCancelPage').then((m) => ({ default: m.PaymentCancelPage })));
const SignupPage = lazy(() => import('./pages/SignupPage').then((m) => ({ default: m.SignupPage })));
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage').then((m) => ({ default: m.VerifyEmailPage })));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })));
const MyFormationsPage = lazy(() => import('./pages/MyFormationsPage').then((m) => ({ default: m.MyFormationsPage })));
const FormationPlayerPage = lazy(() => import('./pages/FormationPlayerPage').then((m) => ({ default: m.FormationPlayerPage })));
const MyAccountPage = lazy(() => import('./pages/MyAccountPage').then((m) => ({ default: m.MyAccountPage })));
const MyAppointmentsPage = lazy(() => import('./pages/MyAppointmentsPage').then((m) => ({ default: m.MyAppointmentsPage })));
const MyGiftCardsPage = lazy(() => import('./pages/MyGiftCardsPage').then((m) => ({ default: m.MyGiftCardsPage })));
const MyInvoicesPage = lazy(() => import('./pages/MyInvoicesPage').then((m) => ({ default: m.MyInvoicesPage })));
const MyDocumentsPage = lazy(() => import('./pages/MyDocumentsPage').then((m) => ({ default: m.MyDocumentsPage })));
const MyProfilePage = lazy(() => import('./pages/MyProfilePage').then((m) => ({ default: m.MyProfilePage })));
const AccountHelpPage = lazy(() => import('./pages/AccountHelpPage').then((m) => ({ default: m.AccountHelpPage })));
const DecisionFlowPage = lazy(() => import('./pages/DecisionFlowPage').then((m) => ({ default: m.DecisionFlowPage })));
const DecisionReportPage = lazy(() => import('./pages/DecisionReportPage').then((m) => ({ default: m.DecisionReportPage })));
const RefundTrackingPage = lazy(() => import('./pages/RefundTrackingPage').then((m) => ({ default: m.RefundTrackingPage })));
const InvoicePublicPage = lazy(() => import('./pages/InvoicePublicPage').then((m) => ({ default: m.InvoicePublicPage })));
const LegalPage = lazy(() => import('./pages/LegalPage').then((m) => ({ default: m.LegalPage })));
const Placeholder = lazy(() => import('./pages/Placeholder').then((m) => ({ default: m.Placeholder })));

export function App() {
  return (
    <Suspense fallback={<LoadingState label="Chargement…" />}>
      <Routes>
        {/* RX4 S3 / RX-GO-2 — Parcours tokenisés + facture publique (lien e-mail, sans compte, layout autonome). */}
        <Route path="decision" element={<DecisionFlowPage />} />
        <Route path="decision/report" element={<DecisionReportPage />} />
        <Route path="refund-tracking/:token" element={<RefundTrackingPage />} />
        <Route path="invoice/:token" element={<InvoicePublicPage />} />

        <Route element={<PublicLayout />}>
          {/* Catalogue public (R1) */}
          <Route index element={<HomePage />} />
          <Route path="prestations" element={<ServicesPage />} />
          <Route path="prestations/:slug" element={<ServiceDetailPage />} />
          <Route path="formations" element={<TrainingsPage />} />
          <Route path="formations/:id" element={<TrainingDetailPage />} />
          <Route path="produits" element={<ProductsPage />} />
          <Route path="produits/:id" element={<ProductDetailPage />} />
          <Route path="cartes-cadeaux" element={<GiftCardsPage />} />

          {/* Panier + checkout + retour paiement */}
          <Route path="panier" element={<CartPage />} />
          <Route path="checkout" element={<CheckoutPage />} />
          <Route path="paiement/succes" element={<PaymentSuccessPage />} />
          <Route path="paiement/annule" element={<PaymentCancelPage />} />

          {/* RX-GO-2 — Auth React autonome (login eager ; le reste lazy) */}
          <Route path="connexion" element={<LoginPage />} />
          <Route path="inscription" element={<SignupPage />} />
          <Route path="verify-email" element={<VerifyEmailPage />} />
          <Route path="mot-de-passe-oublie" element={<ForgotPasswordPage />} />
          <Route path="reinitialiser-mot-de-passe" element={<ResetPasswordPage />} />

          {/* C2 — Learning */}
          <Route path="mes-formations" element={<MyFormationsPage />} />
          <Route path="mes-formations/:id" element={<FormationPlayerPage />} />
          {/* RX1 → RX4 — Espace compte client */}
          <Route path="mon-compte" element={<MyAccountPage />} />
          <Route path="mon-compte/rendez-vous" element={<MyAppointmentsPage />} />
          <Route path="mon-compte/cartes-cadeaux" element={<MyGiftCardsPage />} />
          <Route path="mon-compte/factures" element={<MyInvoicesPage />} />
          <Route path="mon-compte/documents" element={<MyDocumentsPage />} />
          <Route path="mon-compte/profil" element={<MyProfilePage />} />
          <Route path="mon-compte/aide" element={<AccountHelpPage />} />

          {/* RX3 — Pages légales */}
          <Route path="mentions-legales" element={<LegalPage kind="mentions-legales" />} />
          <Route path="cgv" element={<LegalPage kind="cgv" />} />
          <Route path="confidentialite" element={<LegalPage kind="confidentialite" />} />

          <Route path="*" element={<Placeholder title="Page introuvable" description="404." />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
