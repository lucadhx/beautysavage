import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import type { ComponentType } from 'react';
import {
  ArrowRight,
  Building2,
  ExternalLink,
  FileCheck2,
  FileText,
  GraduationCap,
  Inbox,
  Palette,
  ReceiptText,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useResource } from '@/hooks/useResource';
import { useNetworkConfiguration } from '@/context/NetworkConfigContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, Button, Badge } from '@/components/ui/primitives';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { ContractStatusBadge, SubscriptionStatusBadge } from '@/components/contracts/status';
import { formatDate } from '@/lib/utils';

function ContractSiteCard() {
  const contract = useResource(() => api.getMyContract());
  const site = useResource(() => api.getSiteStatus(), [], { live: 'site-status' });
  if (contract.loading || site.loading) return null;
  const c = contract.data;
  const siteActive = site.data?.status === 'ACTIVE';
  const sub = c?.stripe.subscription;
  return (
    <Link to="/contrat">
      <Card className="h-full transition hover:shadow-md">
        <CardContent>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <FileCheck2 className="h-4 w-4 text-muted-foreground" /> Contrat & site
          </div>
          {!c ? (
            <p className="text-sm text-muted-foreground">Aucun contrat disponible.</p>
          ) : (
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <ContractStatusBadge status={c.status} />
                <Badge className={siteActive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}>
                  {siteActive ? <ShieldCheck className="mr-1 h-3 w-3" /> : <ShieldAlert className="mr-1 h-3 w-3" />}
                  Site {siteActive ? 'actif' : 'suspendu'}
                </Badge>
              </div>
              {c.pricing.subscription.enabled && sub && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Abonnement</span>
                  <SubscriptionStatusBadge status={sub.status} />
                </div>
              )}
              {sub?.currentPeriodEnd && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{c.status === 'CANCEL_AT_PERIOD_END' ? 'Fin de periode' : 'Prochaine echeance'}</span>
                  <span>{formatDate(sub.currentPeriodEnd)}</span>
                </div>
              )}
              {sub?.cancelAtPeriodEnd && <p className="text-xs text-orange-600">Resiliation programmee en fin de periode.</p>}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { websiteUrl } = useNetworkConfiguration();
  const products = useResource(() => api.commerceProducts());
  const sales = useResource(() => api.commerceSales());
  const customers = useResource(() => api.commerceCustomers());
  const pages = useResource(() => api.listPages());
  const company = useResource(() => api.getCompany());
  const demandes = useResource(() => api.listContactSubmissions('?limit=1'));

  const loading = products.loading || sales.loading || customers.loading || pages.loading || company.loading || demandes.loading;
  const catalogue = products.data ?? [];
  const formations = catalogue.filter((p) => p.kind === 'DISTANCE_TRAINING' || p.kind === 'IN_PERSON_TRAINING').length;
  const prestations = catalogue.filter((p) => p.kind === 'SERVICE').length;

  const stats = [
    { label: 'Formations', value: formations, icon: GraduationCap, to: '/commerce/formations' },
    { label: 'Prestations', value: prestations, icon: Sparkles, to: '/commerce/prestations' },
    { label: 'Ventes', value: sales.data?.length ?? 0, icon: ReceiptText, to: '/commerce/ventes' },
    { label: 'Clients', value: customers.data?.length ?? 0, icon: Users, to: '/commerce/clients' },
  ];

  const secondaryStats = [
    { label: 'Pages du site', value: pages.data?.length ?? 0, icon: FileText, to: '/pages' },
    { label: 'Demandes non lues', value: demandes.data?.unreadCount ?? 0, icon: Inbox, to: '/demandes-contact' },
    { label: 'Moyens de contact', value: company.data?.media.filter((m) => m.enabled).length ?? 0, icon: Building2, to: '/contacts' },
  ];

  const shortcuts = [
    { label: 'Gerer les formations', to: '/commerce/formations', icon: GraduationCap },
    { label: 'Gerer les prestations', to: '/commerce/prestations', icon: Sparkles },
    { label: 'Consulter les ventes', to: '/commerce/ventes', icon: ReceiptText },
    { label: 'Gerer les clients', to: '/commerce/clients', icon: Users },
    { label: 'Commissions', to: '/commerce/commissions', icon: ReceiptText },
    { label: 'Pages du site', to: '/pages', icon: FileText },
    { label: 'Modifier le theme du site', to: '/theme', icon: Palette },
  ];

  return (
    <div>
      <PageHeader
        title={`Bonjour, ${user?.name?.split(' ')[0] || 'bienvenue'}`}
        description="Vue d'ensemble de votre institut, de la vitrine et des ventes."
        action={
          websiteUrl ? (
            <a href={websiteUrl} target="_blank" rel="noreferrer">
              <Button variant="outline">
                <ExternalLink className="h-4 w-4" /> Voir la vitrine
              </Button>
            </a>
          ) : undefined
        }
      />

      {loading ? (
        <BrandLoader />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((s, i) => (
              <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
                <MetricLink {...s} />
              </motion.div>
            ))}
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {secondaryStats.map((s) => <MetricLink key={s.label} {...s} compact />)}
          </div>

          <div className="mt-4">
            <ContractSiteCard />
          </div>

          <h2 className="mb-3 mt-8 text-sm font-semibold text-muted-foreground">Raccourcis</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {shortcuts.map((s) => (
              <Link key={s.to} to={s.to}>
                <Card className="group transition hover:shadow-md">
                  <CardContent className="flex items-center justify-between py-4">
                    <div className="flex items-center gap-3">
                      <s.icon className="h-5 w-5 text-muted-foreground" />
                      <span className="text-sm font-medium">{s.label}</span>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-1" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function MetricLink({
  label,
  value,
  icon: Icon,
  to,
  compact = false,
}: {
  label: string;
  value: number;
  icon: ComponentType<{ className?: string }>;
  to: string;
  compact?: boolean;
}) {
  return (
    <Link to={to}>
      <Card className="transition hover:shadow-md">
        <CardContent className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className={compact ? 'mt-1 text-2xl font-bold' : 'mt-1 text-3xl font-bold'}>{value}</p>
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-muted">
            <Icon className="h-5 w-5" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
