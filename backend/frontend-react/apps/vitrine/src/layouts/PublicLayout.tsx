import { Outlet } from 'react-router-dom';
import { AppShell } from '@bs/ui';
import { SiteStatusBanner } from '../features/catalog/components/SiteStatusBanner';
import { VitrineHeader } from './VitrineHeader';
import { VitrineFooter } from './VitrineFooter';
import './shell.css';

// RX3 — Shell vitrine officiel : header responsive (nav active, panier + badge, burger drawer),
// footer réel + routes légales. Remplace le header/footer placeholder R0.
export function PublicLayout() {
  return (
    <AppShell header={<VitrineHeader />} footer={<VitrineFooter />}>
      <SiteStatusBanner />
      <Outlet />
    </AppShell>
  );
}
