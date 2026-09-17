// M4 — Layout Communication Center (en-tête + onglets + Outlet). Importe le CSS de la feature.
import { Outlet } from 'react-router-dom';
import './communication.css';
import { CommunicationTabs, type TabItem } from './components';

export interface CommunicationCenterLayoutProps {
  title: string;
  subtitle?: string;
  tabs: TabItem[];
}

export function CommunicationCenterLayout({ title, subtitle, tabs }: CommunicationCenterLayoutProps) {
  return (
    <section className="cc-page">
      <div className="cc-head">
        <h1 className="cc-head__title">{title}</h1>
        {subtitle ? <p className="cc-head__subtitle">{subtitle}</p> : null}
      </div>
      <CommunicationTabs items={tabs} />
      <Outlet />
    </section>
  );
}

const ADMIN_TABS: TabItem[] = [
  { to: '/communication', label: 'Tableau de bord', end: true },
  { to: '/communication/identite-commerciale', label: 'Identité commerciale' },
  { to: '/communication/mails', label: 'Journal des mails' },
];

const DEV_TABS: TabItem[] = [
  { to: '/dev/communication', label: 'Tableau de bord', end: true },
  { to: '/dev/communication/identite-support', label: 'Identité support' },
  { to: '/dev/communication/mail-deliveries', label: 'Livraisons mail' },
  { to: '/dev/communication/send-logs', label: 'Send logs' },
  { to: '/dev/communication/triggers', label: 'Déclencheurs' },
];

export function AdminCommunicationLayout() {
  return (
    <CommunicationCenterLayout
      title="Communication"
      subtitle="Identité commerciale, vérification d'expéditeur et journal des e-mails institut/client."
      tabs={ADMIN_TABS}
    />
  );
}

export function DevCommunicationLayout() {
  return (
    <CommunicationCenterLayout
      title="Communication (Dev)"
      subtitle="Identité support, supervision complète des livraisons et des envois."
      tabs={DEV_TABS}
    />
  );
}
