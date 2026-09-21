import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { Dropdown } from '@/components/base/dropdown/dropdown';
import {
  CommercePageFrame,
  Metric,
  Panel,
  StatusBadge,
  cents,
  dateShort,
  type CommerceCustomer,
  type CommerceSale,
} from './CommerceShared';

type CustomerWithVerification = CommerceCustomer & { emailVerified?: boolean };

function customerEmail(sale: CommerceSale) {
  return typeof sale.customerId === 'object' && sale.customerId ? sale.customerId.email || '' : '';
}

function customerName(customer: CommerceCustomer) {
  return [customer.firstName, customer.lastName].filter(Boolean).join(' ') || 'Client';
}

export default function CommerceClientsPage() {
  const [customers, setCustomers] = React.useState<CustomerWithVerification[]>([]);
  const [sales, setSales] = React.useState<CommerceSale[]>([]);
  const [search, setSearch] = React.useState('');
  const [error, setError] = React.useState('');
  const { customerId } = useParams();
  const navigate = useNavigate();

  React.useEffect(() => {
    Promise.all([api.commerceCustomers(), api.commerceSales()])
      .then(([customerList, saleList]) => {
        setCustomers(customerList as CustomerWithVerification[]);
        setSales(saleList as CommerceSale[]);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Chargement impossible'));
  }, []);

  const buyers = new Set(sales.map(customerEmail).filter(Boolean));
  const newsletter = customers.filter((customer) => customer.marketingConsent).length;
  const selected = customerId ? customers.find((customer) => customer._id === customerId) || null : null;
  const filtered = customers.filter((customer) => {
    const haystack = `${customerName(customer)} ${customer.email} ${customer.phone || ''}`.toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  });

  if (customerId) {
    const customerSales = selected ? sales.filter((sale) => customerEmail(sale) === selected.email) : [];
    const spent = customerSales
      .filter((sale) => sale.paymentStatus === 'PAID')
      .reduce((sum, sale) => sum + (sale.totalCents || 0), 0);
    return (
      <CommercePageFrame
        title={selected ? customerName(selected) : 'Fiche cliente'}
        description="Vue 360 cliente : identite, verification e-mail, consentements et historique de commandes."
        actions={<button type="button" onClick={() => navigate('/commerce/clients')} className="rounded-md border px-3 py-2 text-sm font-semibold hover:bg-muted">Retour aux clients</button>}
      >
        {error && <p className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
        {!selected ? (
          <Panel title="Chargement">
            <p className="text-sm text-muted-foreground">{customers.length === 0 ? 'Chargement de la cliente...' : 'Cliente introuvable.'}</p>
          </Panel>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-4">
              <Metric label="Commandes" value={customerSales.length} />
              <Metric label="Total paye" value={cents(spent)} />
              <Metric label="Marketing" value={selected.marketingConsent ? 'Oui' : 'Non'} />
              <Metric label="E-mail" value={selected.emailVerified ? 'Verifie' : 'A verifier'} />
            </div>
            <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
              <Panel title="Identite">
                <div className="grid gap-3 text-sm">
                  <Detail label="Nom" value={customerName(selected)} />
                  <Detail label="E-mail" value={selected.email} />
                  <Detail label="Telephone" value={selected.phone || 'Non renseigne'} />
                  <Detail label="Inscription" value={dateShort(selected.createdAt)} />
                  <Detail label="Verification e-mail" value={selected.emailVerified ? 'Verifiee' : 'Non verifiee'} />
                </div>
              </Panel>
              <Panel title="Commandes">
                <SalesMiniTable sales={customerSales} onOpen={(sale) => navigate(`/commerce/ventes/${sale._id}`)} />
              </Panel>
            </div>
          </>
        )}
      </CommercePageFrame>
    );
  }

  return (
    <CommercePageFrame
      title="Clients"
      description="Comptes clients de la vitrine, coordonnees, consentements et historique d'achat rattache."
    >
      {error && <p className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
      <div className="grid gap-4 md:grid-cols-3">
        <Metric label="Comptes clients" value={customers.length} />
        <Metric label="Clients acheteurs" value={buyers.size} />
        <Metric label="Consentements marketing" value={newsletter} />
      </div>
      <Panel title="Liste clients">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Rechercher par nom, e-mail ou telephone"
          className="mb-4 w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
        {filtered.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Aucun client ne correspond.</p>
        ) : (
          <div className="max-w-full overflow-x-auto rounded-lg border">
            <table className="min-w-[760px] w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Telephone</th>
                  <th className="px-4 py-3">Inscription</th>
                  <th className="px-4 py-3">E-mail</th>
                  <th className="px-4 py-3">Marketing</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((customer) => (
                  <tr key={customer._id} className="border-t">
                    <td className="px-4 py-3">
                      <div className="font-medium">{customerName(customer)}</div>
                      <div className="text-xs text-muted-foreground">{customer.email}</div>
                    </td>
                    <td className="px-4 py-3">{customer.phone || 'Non renseigne'}</td>
                    <td className="px-4 py-3">{dateShort(customer.createdAt)}</td>
                    <td className="px-4 py-3"><StatusBadge>{customer.emailVerified ? 'VERIFIE' : 'A VERIFIER'}</StatusBadge></td>
                    <td className="px-4 py-3">{customer.marketingConsent ? 'Oui' : 'Non'}</td>
                    <td className="px-4 py-3">
                      <Dropdown.Root>
                        <Dropdown.DotsButton aria-label={`Actions ${customer.email}`} />
                        <Dropdown.Popover className="w-44">
                          <Dropdown.Menu>
                            <Dropdown.Section>
                              <Dropdown.Item onAction={() => navigate(`/commerce/clients/${customer._id}`)}>Ouvrir la fiche</Dropdown.Item>
                              <Dropdown.Item onAction={() => navigator.clipboard.writeText(customer.email)}>Copier l'e-mail</Dropdown.Item>
                            </Dropdown.Section>
                          </Dropdown.Menu>
                        </Dropdown.Popover>
                      </Dropdown.Root>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </CommercePageFrame>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 break-all font-semibold">{value}</p>
    </div>
  );
}

function SalesMiniTable({ sales, onOpen }: { sales: CommerceSale[]; onOpen: (sale: CommerceSale) => void }) {
  if (sales.length === 0) {
    return <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Aucune commande rattachee.</p>;
  }
  return (
    <div className="max-w-full overflow-x-auto rounded-lg border">
      <table className="min-w-[620px] w-full text-left text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr><th className="px-4 py-3">Commande</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Montant</th><th className="px-4 py-3">Paiement</th><th className="px-4 py-3">Action</th></tr>
        </thead>
        <tbody>
          {sales.map((sale) => (
            <tr key={sale._id} className="border-t">
              <td className="px-4 py-3 font-medium">{sale.saleNumber}</td>
              <td className="px-4 py-3">{dateShort(sale.createdAt)}</td>
              <td className="px-4 py-3">{cents(sale.totalCents)}</td>
              <td className="px-4 py-3"><StatusBadge>{sale.paymentStatus}</StatusBadge></td>
              <td className="px-4 py-3"><button type="button" onClick={() => onOpen(sale)} className="text-sm font-semibold underline">Voir</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
