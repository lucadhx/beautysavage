/**
 * CONNEXION AU PANEL — l'écran d'appairage, réservé aux comptes DEV.
 *
 * Le pont était complet et testé, mais injoignable : aucun écran n'appelait
 * `/api/panel-connection`. On ne pouvait appairer qu'en posant des variables
 * d'environnement ou en tapant une requête HTTP à la main. Cette page ne fait
 * que brancher l'existant — aucun endpoint, aucun DTO, aucun contrat n'a bougé.
 *
 * Deux champs, et rien de plus : l'URL du Panel et le code d'appairage. Le
 * reste (clé du projet, nom, URL publique du backend, bridgeToken) est
 * déterminé par le backend ou négocié par le pont — le demander reviendrait à
 * faire ressaisir ce que le système sait déjà.
 */
import * as React from 'react';
import { Link2, Link2Off, Plug, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { useResource, useAction } from '@/hooks/useResource';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
} from '@/components/ui/primitives';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { ConfirmDialog } from '@/components/ui/dialog';

/**
 * L'ÉTAT DU PONT, DIT EN FRANÇAIS — et il ne l'était pas.
 *
 * L'écran affichait la valeur brute de l'énumération du backend :
 * « CONNECTED », « DEGRADED », « UNCONFIGURED ». Ce sont des identifiants de
 * code, pas des états lisibles — et « DEGRADED » ne dit ni ce qui est dégradé,
 * ni s'il y a quelque chose à faire.
 *
 * On traduit donc, en gardant l'inconnu POUR CE QU'IL EST : un état ajouté au
 * backend et pas encore décrit ici doit se voir tel quel plutôt que d'être
 * ramené de force à un libellé faux.
 */
const ETAT_DU_PONT: Record<string, { libelle: string; aide: string }> = {
  CONNECTED: {
    libelle: 'Connecté',
    aide: 'Le transport fonctionne : les échanges avec le Panel aboutissent.',
  },
  DEGRADED: {
    libelle: 'Dégradé',
    aide: 'Le dernier échange a échoué. Le pont réessaie seul — rien n’est perdu.',
  },
  UNCONFIGURED: {
    libelle: 'Non configuré',
    aide: 'Aucun appairage : ce projet fonctionne de façon autonome.',
  },
};

function decrireEtatDuPont(etat?: string): { libelle: string; aide: string } {
  if (!etat) return { libelle: '—', aide: '' };
  return ETAT_DU_PONT[etat] ?? { libelle: etat, aide: 'État inconnu de cet écran.' };
}

/**
 * CE CHAMP N'A PLUS DE VALEUR PAR DÉFAUT — il a un EXEMPLE.
 *
 * ══ LE DÉFAUT CORRIGÉ ══════════════════════════════════════════════════════
 *
 * Il valait `https://panel.lycarz.com` : un domaine retiré, qui répond `410
 * Gone` — notre propre quarantaine. Il était pré-rempli dans le champ, donc
 * proposé À LA VALIDATION : l'opérateur d'un projet neuf n'avait qu'à cliquer
 * pour appairer vers une adresse morte, et le refus qui s'ensuivait ne disait
 * pas d'où venait l'adresse.
 *
 * Un repli est une réponse à « je ne sais pas ». Ici, on ne sait effectivement
 * pas : l'adresse du Panel appartient au `.env` du projet, et un projet qui ne
 * l'a pas renseignée doit se le voir DIRE, pas se voir remplir. Le champ reste
 * donc vide, et l'exemple ne part qu'en `placeholder` — qui ne se soumet pas.
 */
const PANEL_URL_EXEMPLE = 'https://api.panel.exemple.com';

/** Date lisible, ou rien du tout — on n'affiche jamais « Invalid Date ». */
function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString('fr-FR');
}

export default function DevPanelPage() {
  const { data, loading, refresh } = useResource(() => api.getPanelConnection());
  const { pending, run } = useAction();

  const [panelUrl, setPanelUrl] = React.useState('');
  const [pairingCode, setPairingCode] = React.useState('');
  const [justPaired, setJustPaired] = React.useState(false);

  /*
    DÉSAPPAIRER EST DESTRUCTEUR, ET SE FAISAIT SANS UN MOT.

    Le geste coupe la supervision, l'identité d'entreprise publiée et l'accès
    aux API intégrées — donc l'envoi d'e-mails et les paiements. Il était
    déclenché par un simple clic, à côté d'un bouton de synchronisation, sans
    confirmation. Et il ne se rejoue pas : réappairer exige un NOUVEAU code
    d'appairage, généré depuis le Panel.
  */
  const [confirmerDesappairage, setConfirmerDesappairage] = React.useState(false);


  // Pré-remplissage : ce que le projet a déjà configuré fait foi ; le repli
  // n'est là que pour un projet qui n'a rien renseigné.
  React.useEffect(() => {
    if (data && !panelUrl) setPanelUrl(data.suggested.panelUrl || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (loading || !data) return <BrandLoader />;

  const pair = async () => {
    await run(() => api.pairWithPanel({ panelUrl: panelUrl.trim(), pairingCode: pairingCode.trim() }), {
      success: 'Projet appairé',
    });
    // Le code d'appairage est à usage unique : le garder à l'écran laisserait
    // croire qu'on peut réessayer avec.
    setPairingCode('');
    setJustPaired(true);
    await refresh();
  };

  const unpair = async () => {
    await run(() => api.unpairFromPanel(), { success: 'Projet désappairé' });
    setConfirmerDesappairage(false);
    setJustPaired(false);
    await refresh();
  };

  const syncNow = async () => {
    await run(() => api.syncPanelNow(), { success: 'Synchronisation effectuée' });
    await refresh();
  };

  const pairedAt = formatDate(data.pairing.pairedAt);
  const canPair = panelUrl.trim().length > 0 && pairingCode.trim().length > 0;

  return (
    <div>
      <PageHeader
        title="Connexion au Panel"
        description="Rattache ce projet au Panel L.Y Solution : supervision, configuration d’entreprise et accès aux API intégrées."
      />

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plug className="h-4 w-4" /> État actuel
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Badge className={data.paired ? 'bg-emerald-600 text-white' : 'bg-muted text-muted-foreground'}>
                {data.paired ? 'Connecté' : 'Non connecté'}
              </Badge>
              {justPaired && data.paired && (
                <span className="text-sm text-emerald-600">✅ Projet appairé</span>
              )}
            </div>

            {data.paired ? (
              <>
                <p className="text-sm text-muted-foreground">Projet actuellement appairé.</p>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">URL du Panel</dt>
                    <dd className="text-right break-all">{data.pairing.panelUrl ?? '—'}</dd>
                  </div>
                  {data.pairing.panelName && (
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Panel</dt>
                      <dd className="text-right">{data.pairing.panelName}</dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">État du pont</dt>
                    <dd className="text-right">
                      {decrireEtatDuPont(data.bridge?.state).libelle}
                      {decrireEtatDuPont(data.bridge?.state).aide && (
                        <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                          {decrireEtatDuPont(data.bridge?.state).aide}
                        </span>
                      )}
                    </dd>
                  </div>
                  {/*
                    LE PONT VA BIEN ≠ LA DONNÉE PASSE.

                    « État du pont » ne décrit que le TRANSPORT. Une instance
                    dont toutes les écritures métier sont refusées par le
                    contrat du Panel affiche CONNECTED — le réseau va très
                    bien, c'est la livraison qui n'aboutit pas. La ligne
                    n'apparaît que s'il y a un refus ouvert : un projet sain
                    ne gagne pas un champ de plus.
                  */}
                  {(data.outbox?.rejected ?? 0) > 0 && (
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Livraison</dt>
                      <dd className="text-right text-amber-600">
                        ⚠ {data.outbox.rejected} écriture(s) refusée(s)
                        {data.outbox.oldestRejection?.entityType
                          ? ` — ${data.outbox.oldestRejection.entityType}`
                          : ''}
                        {data.outbox.oldestRejection?.code
                          ? ` (${data.outbox.oldestRejection.code})`
                          : ''}
                      </dd>
                    </div>
                  )}
                  {/* La date n'est affichée que si le backend en fournit une. */}
                  {pairedAt && (
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Appairé le</dt>
                      <dd className="text-right">{pairedAt}</dd>
                    </div>
                  )}
                </dl>

                <div className="flex flex-wrap gap-2 pt-2">
                  <Button variant="outline" onClick={syncNow} loading={pending}>
                    <RefreshCw className="h-4 w-4" /> Synchroniser maintenant
                  </Button>
                  <Button variant="destructive" onClick={() => setConfirmerDesappairage(true)} loading={pending}>
                    <Link2Off className="h-4 w-4" /> Désappairer
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Ce projet n’est rattaché à aucun Panel. Générez un code d’appairage depuis le Panel,
                puis saisissez-le ci-contre.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="h-4 w-4" /> Appairer
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="URL du Panel">
              <Input
                type="url"
                value={panelUrl}
                onChange={(e) => setPanelUrl(e.target.value)}
                placeholder={PANEL_URL_EXEMPLE}
                autoComplete="off"
              />
            </Field>

            <Field
              label="Code d’appairage"
              hint="À usage unique : il n’est consommé qu’au premier appairage réussi. Un essai refusé le laisse valide."
            >
              <Input
                value={pairingCode}
                onChange={(e) => setPairingCode(e.target.value)}
                placeholder="PAIR-XXXX-XXXX-XXXX"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>

            <Button onClick={pair} loading={pending} disabled={!canPair || data.paired}>
              <Link2 className="h-4 w-4" /> Appairer
            </Button>

            {data.paired && (
              <p className="text-xs text-muted-foreground">
                Désappairez d’abord pour rattacher ce projet à un autre Panel.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog
        open={confirmerDesappairage}
        onClose={() => setConfirmerDesappairage(false)}
        onConfirm={unpair}
        title="Désappairer ce projet du Panel ?"
        description={(
          <>
            <p>
              Le projet cessera d’être supervisé, ne recevra plus l’identité d’entreprise publiée
              par le Panel, et perdra l’accès aux API intégrées — envoi d’e-mails et paiements
              compris.
            </p>
            <p>
              Le rattacher de nouveau exigera un <b>nouveau code d’appairage</b>, à générer depuis
              le Panel. Aucune donnée déjà enregistrée n’est supprimée.
            </p>
          </>
        )}
        destructive
        confirmLabel="Désappairer"
        loading={pending}
      />

    </div>
  );
}
