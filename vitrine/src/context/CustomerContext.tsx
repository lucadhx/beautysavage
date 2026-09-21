import * as React from 'react';
import { customerApi, customerTokenStore, type Customer } from '@/lib/api';

interface CustomerContextValue {
  customer: Customer | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: { email: string; password: string; firstName?: string; lastName?: string }) => Promise<{ verificationCode?: string }>;
  refresh: () => Promise<void>;
  logout: () => void;
}

const CustomerContext = React.createContext<CustomerContextValue | null>(null);

export function CustomerProvider({ children }: { children: React.ReactNode }) {
  const [customer, setCustomer] = React.useState<Customer | null>(null);
  const [loading, setLoading] = React.useState(Boolean(customerTokenStore.get()));

  React.useEffect(() => {
    if (!customerTokenStore.get()) {
      setLoading(false);
      return;
    }
    customerApi.me()
      .then(setCustomer)
      .catch(() => {
        customerTokenStore.clear();
        setCustomer(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const refresh = React.useCallback(async () => {
    const next = await customerApi.me();
    setCustomer(next);
  }, []);

  const login = React.useCallback(async (email: string, password: string) => {
    const result = await customerApi.login(email, password);
    customerTokenStore.set(result.token);
    setCustomer(result.customer);
  }, []);

  const register = React.useCallback(async (payload: { email: string; password: string; firstName?: string; lastName?: string }) => {
    const result = await customerApi.register(payload);
    customerTokenStore.set(result.token);
    setCustomer(result.customer);
    return { verificationCode: result.verificationCode };
  }, []);

  const logout = React.useCallback(() => {
    customerTokenStore.clear();
    setCustomer(null);
  }, []);

  return (
    <CustomerContext.Provider value={{ customer, loading, login, register, refresh, logout }}>
      {children}
    </CustomerContext.Provider>
  );
}

export function useCustomer() {
  const ctx = React.useContext(CustomerContext);
  if (!ctx) throw new Error('useCustomer must be used inside CustomerProvider');
  return ctx;
}
