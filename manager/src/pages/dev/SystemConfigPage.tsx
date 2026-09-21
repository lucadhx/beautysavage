import * as React from 'react';
import {
  Server,
  Monitor,
  Globe,
  Copy,
  Check,
  Save,
  RotateCcw,
  Wifi,
  CircleCheck,
  CircleX,
  CircleDashed,
  Loader2,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, API_ROOT } from '@/lib/api';
import type { NetworkConfig, NetworkConfigResponse, NetworkTestResponse, UrlTestResult } from '@/types';
import { normalizeAppUrl } from '@/lib/normalizeUrl';
import { useNetworkConfiguration } from '@/context/NetworkConfigContext';
import { useAction } from '@/hooks/useResource';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, Input, Label, Button, Badge } from '@/components/ui/primitives';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { formatDateTime } from '@/lib/utils';
import { messageUtilisateur } from '@/lib/erreurs';

type Key = 'backendUrl' | 'managerUrl' | 'websiteUrl';
const FIELDS: { key: Key; label: string; icon: typeof Server; hint: string; example: string }[] = [
  { key: 'backendUrl', label: 'URL du backend', icon: Server, hint: "L'API. Doit être joignable par le Manager et la Vitrine.", example: 'https://api.domaine.com' },
  { key: 'managerUrl', label: 'URL du manager', icon: Monitor, hint: "L'interface d'administration (celle-ci).", example: 'https://manager.domaine.com' },
  { key: 'websiteUrl', label: 'URL de la vitrine', icon: Globe, hint: 'Le site public.', example: 'https://domaine.com' },
];

const isHttp = (u: string) => /^http:\/\//i.test(u);
const isLocalHost = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(u);

export default function SystemConfigPage() {
  const [form, setForm] = React.useState<NetworkConfig>({ backendUrl: '', managerUrl: '', websiteUrl: '' });
  const [meta, setMeta] = React.useState<Pick<NetworkConfigResponse, 'updatedAt' | 'updatedBy'> | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [results, setResults] = React.useState<NetworkTestResponse | null>(null);
  const [testing, setTesting] = React.useState(false);
  const [copied, setCopied] = React.useState<Key | null>(null);
  const { pending, run } = useAction();
  const { refresh: refreshNetwork } = useNetworkConfiguration();

  const load = React.useCallback(async () => {
    try {
      const cfg = await api.getNetworkConfig();
      setForm(cfg.network);
      setMeta({ updatedAt: cfg.updatedAt, updatedBy: cfg.updatedBy });
    } catch (e) {
      toast.error(messageUtilisateur(e, 'Chargement impossible'));
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => {
    load();
  }, [load]);

  const setField = (key: Key, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setResults(null); // un test devient invalide dès qu'on modifie un champ
  };

  const norm = { backendUrl: normalizeAppUrl(form.backendUrl), managerUrl: normalizeAppUrl(form.managerUrl), websiteUrl: normalizeAppUrl(form.websiteUrl) };
  const allValid = norm.backendUrl.ok && norm.managerUrl.ok && norm.websiteUrl.ok;
  const normalized = (): NetworkConfig => ({
    backendUrl: norm.backendUrl.ok ? norm.backendUrl.value : form.backendUrl,
    managerUrl: norm.managerUrl.ok ? norm.managerUrl.value : form.managerUrl,
    websiteUrl: norm.websiteUrl.ok ? norm.websiteUrl.value : form.websiteUrl,
  });

  /* ------------------------------ warnings ------------------------------ */
  const warnings: string[] = [];
  if (allValid) {
    const n = normalized();
    const vals = [n.backendUrl, n.managerUrl, n.websiteUrl];
    if (new Set(vals).size < 3) warnings.push('Deux URL (ou plus) sont identiques — vérifiez qu’il ne s’agit pas d’une erreur.');
    if (n.backendUrl === n.managerUrl || n.backendUrl === n.websiteUrl) warnings.push('Le backend pointe vers la même origine que le Manager ou la Vitrine.');
    [['Backend', n.backendUrl], ['Manager', n.managerUrl], ['Vitrine', n.websiteUrl]].forEach(([lbl, u]) => {
      if (isHttp(u) && !isLocalHost(u)) warnings.push(`${lbl} utilise http:// sur un domaine — privilégiez https:// en production.`);
      if (/ngrok/i.test(u) && isHttp(u)) warnings.push(`${lbl} : une URL ngrok doit être en https://, pas http://.`);
    });
    if (API_ROOT && n.backendUrl !== API_ROOT.replace(/\/+$/, '')) {
      warnings.push(`L'URL backend saisie (${n.backendUrl}) diffère de l'API actuellement utilisée par le Manager (${API_ROOT}). La bascule ne prend effet qu'au prochain démarrage avec le bon VITE_API_URL.`);
    }
  }

  /* ------------------------------ actions ------------------------------ */
  const runTest = async () => {
    if (!allValid) return toast.error('Corrigez les URL avant de tester.');
    setTesting(true);
    try {
      setResults(await api.testNetworkConfig(normalized()));
    } catch (e) {
      toast.error(messageUtilisateur(e, 'Test impossible'));
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!allValid) return toast.error('Corrigez les URL avant d’enregistrer.');
    const res = await run(() => api.updateNetworkConfig(normalized()), { success: 'Configuration réseau enregistrée' });
    setForm(res.network);
    setMeta({ updatedAt: res.updatedAt, updatedBy: res.updatedBy });
    await refreshNetwork();
  };

  const copy = async (key: Key) => {
    const r = norm[key];
    await navigator.clipboard.writeText(r.ok ? r.value : form[key]);
    setCopied(key);
    setTimeout(() => setCopied(null), 1200);
  };

  if (loading) return <BrandLoader />;

  const resultByKey: Record<Key, UrlTestResult | undefined> = {
    backendUrl: results?.backend,
    managerUrl: results?.manager,
    websiteUrl: results?.website,
  };

  return (
    <div>
      <PageHeader
        title="Configuration système"
        description="Section Réseau — URL publiques du backend, du manager et de la vitrine (DEV uniquement)."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={load}>
              <RotateCcw className="h-4 w-4" /> Réinitialiser
            </Button>
            <Button variant="outline" onClick={runTest} loading={testing} disabled={!allValid}>
              <Wifi className="h-4 w-4" /> Tester les URL
            </Button>
            <Button onClick={save} loading={pending} disabled={!allValid}>
              <Save className="h-4 w-4" /> Enregistrer
            </Button>
          </div>
        }
      />

      {/* `min-w-0` : un enfant de grille refuse par défaut de descendre sous la
          largeur minimale de son contenu — ici, une URL insécable. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          {/* Champs */}
          {FIELDS.map(({ key, label, icon: Icon, hint, example }) => {
            const r = norm[key];
            return (
              <Card key={key}>
                <CardContent className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-muted-foreground" /> {label}
                    </Label>
                    {/*
                      Seize pixels de haut : sous la moitié d'une cible tactile
                      utilisable. Le rembourrage négatif rend la zone cliquable
                      sans déplacer d'un pixel ce qui est dessiné.
                    */}
                    <button onClick={() => copy(key)} className="-m-1.5 inline-flex shrink-0 items-center gap-1 p-1.5 text-xs text-muted-foreground hover:text-foreground">
                      {copied === key ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} copier
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">{hint} Exemple : {example}</p>
                  <Input
                    value={form[key]}
                    onChange={(e) => setField(key, e.target.value)}
                    placeholder={example}
                    className={r.ok ? '' : 'border-red-400'}
                  />
                  {/*
                    UNE URL NORMALISÉE EST UNE CHAÎNE SANS ESPACE : elle ne se
                    coupe nulle part, et poussait donc la carte hors de l'écran
                    à 320 px. `break-all` autorise la coupure ; `flex-wrap`
                    laisse l'icône et le texte se séparer plutôt que de
                    comprimer l'un des deux.
                  */}
                  {r.ok ? (
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-emerald-600">
                      <CircleCheck className="h-3.5 w-3.5 shrink-0" /> Normalisée :{' '}
                      <span className="min-w-0 break-all font-mono">{r.value}</span>
                    </p>
                  ) : (
                    <p className="flex flex-wrap items-start gap-1.5 text-xs text-red-600">
                      <CircleX className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 break-words">{r.error}</span>
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}

          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
              {warnings.map((w, i) => (
                <p key={i} className="flex items-start gap-2 text-xs text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {w}
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          {/* Résultats de test */}
          <div className="space-y-3">
            {FIELDS.map(({ key, label, icon: Icon }) => (
              <ResultCard key={key} label={label} icon={Icon} testing={testing} result={resultByKey[key]} />
            ))}
          </div>

          {/* ngrok help */}
          <Card>
            <CardContent className="space-y-2 text-sm">
              <p className="flex items-center gap-2 font-semibold"><Info className="h-4 w-4" /> Test avec ngrok</p>
              <p className="text-xs text-muted-foreground">Exposez chaque application :</p>
              <pre className="rounded-md bg-muted p-2 text-xs">{`ngrok http 6070   # Backend
ngrok http 6071   # Manager
ngrok http 6062   # Vitrine`}</pre>
              <p className="text-xs text-muted-foreground">
                Reportez les trois URL <strong>https</strong> obtenues dans le formulaire, puis
                <strong> videz-les</strong> une fois le test terminé : une URL ngrok périmée laissée
                dans <em>Backend</em> casserait la résolution des médias (logos) en local.
              </p>
            </CardContent>
          </Card>

          {/* Historique */}
          {meta?.updatedAt && (
            <Card>
              <CardContent className="text-xs text-muted-foreground">
                <p className="font-semibold text-foreground">Dernière modification</p>
                <p className="mt-1">{formatDateTime(meta.updatedAt)}</p>
                {meta.updatedBy && <p>Par {meta.updatedBy.name || meta.updatedBy.email}</p>}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultCard({
  label,
  icon: Icon,
  result,
  testing,
}: {
  label: string;
  icon: typeof Server;
  result?: UrlTestResult;
  testing: boolean;
}) {
  let badge: React.ReactNode;
  if (testing) badge = <Badge className="bg-slate-100 text-slate-600"><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Test…</Badge>;
  else if (!result) badge = <Badge className="bg-slate-100 text-slate-500"><CircleDashed className="mr-1 h-3 w-3" /> Non testé</Badge>;
  else if (result.reachable) badge = <Badge className="bg-emerald-100 text-emerald-700"><CircleCheck className="mr-1 h-3 w-3" /> En ligne</Badge>;
  else badge = <Badge className="bg-red-100 text-red-700"><CircleX className="mr-1 h-3 w-3" /> Hors ligne</Badge>;

  return (
    <Card>
      <CardContent className="py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-medium"><Icon className="h-4 w-4 text-muted-foreground" /> {label}</span>
          {badge}
        </div>
        {result && (
          <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
            <p className="truncate font-mono">{result.url}</p>
            <p>
              {result.statusCode != null && <>HTTP {result.statusCode} · </>}
              {result.durationMs} ms
            </p>
            {result.message && <p>{result.message}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
