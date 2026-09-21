import * as React from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Power, AlertTriangle, CheckCircle2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useSiteStatus } from '@/context/SiteStatusContext';
import { useAction } from '@/hooks/useResource';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, Button, Textarea, Field } from '@/components/ui/primitives';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { Modal } from '@/components/ui/dialog';
import { formatDateTime } from '@/lib/utils';
import type { SiteStatus } from '@/types';

export default function StatusPage() {
  const { isDev } = useAuth();
  const { status, set, reload } = useSiteStatus();
  const { pending, run } = useAction();
  const [suspendOpen, setSuspendOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  /**
   * ══ DÉCOCHÉE PAR DÉFAUT, ET C'EST UNE DÉCISION ═════════════════════════════
   *
   * Cocher par défaut enverrait un e-mail aux administrateurs du client à
   * CHAQUE manipulation interne — une maintenance de dix minutes un dimanche
   * matin comprise. Prévenir est un geste délibéré ; ne pas prévenir est le cas
   * courant. Le serveur applique le même défaut, pour qu'un appel sans le champ
   * se comporte comme avant ce lot.
   */
  const [notifyAdmins, setNotifyAdmins] = React.useState(false);

  React.useEffect(() => {
    reload();
  }, [reload]);

  if (!status) {
    return (
      <BrandLoader />
    );
  }

  const suspended = status.status === 'SUSPENDED';
  /**
   * Une fiche antérieure à ce champ ne le porte pas : l'absence se lit
   * « désactivée », c'est-à-dire le comportement historique — jamais « inconnu »,
   * qui laisserait l'écran sans réponse.
   */
  const protectionEnabled = status.contractProtectionEnabled === true;

  /**
   * ══ FERMER LA MODALE N'A AUCUN EFFET ═══════════════════════════════════════
   *
   * Rien ne part tant que « Confirmer la suspension » n'a pas été cliqué. La
   * remise à zéro du formulaire vit ici, à un seul endroit, pour qu'une
   * fermeture par Échap, par le fond, ou par « Annuler » se comporte
   * exactement pareil — et ne laisse pas un motif d'hier dans la modale de
   * demain.
   */
  const closeSuspend = () => {
    setSuspendOpen(false);
    setReason('');
    setNotifyAdmins(false);
  };

  const doSuspend = async () => {
    /**
     * LE DOUBLE CLIC EST ARRÊTÉ ICI *ET* CÔTÉ SERVEUR.
     *
     * `pending` est du confort : il évite une seconde requête. Il ne PROTÈGE
     * rien — un rechargement le remet à zéro. La vraie garantie est que poser
     * la cause est un REMPLACEMENT d'état : huit appels posent huit fois la
     * même chose, et un seul franchit la transition, donc un seul journalise
     * et notifie.
     */
    if (pending) return;
    const updated = await run(() => api.suspendSite(reason, notifyAdmins), {
      success: 'Site suspendu',
    });
    set(updated);

    /**
     * ON DIT LA VÉRITÉ SUR L'ENVOI, MÊME QUAND ELLE DÉÇOIT.
     *
     * La suspension est acquise dans tous les cas — c'est la doctrine du lot.
     * Mais laisser croire que les administrateurs ont été prévenus alors que
     * l'envoi a échoué serait pire que de se taire : personne ne relancerait.
     */
    const n = updated.notification;
    if (n) {
      if (n.skipped === 'NO_RECIPIENTS') {
        toast.warning('Site suspendu — aucun administrateur à prévenir.');
      } else if (n.skipped || n.failed > 0) {
        toast.warning(
          `Site suspendu — la notification n’a pas pu être envoyée${
            n.sent > 0 ? ` à ${n.failed} destinataire(s)` : ''
          }.`,
        );
      } else if (n.sent > 0) {
        toast.success(`${n.sent} administrateur(s) prévenu(s).`);
      }
    }

    closeSuspend();
  };

  const doReactivate = async () => {
    const updated = await run(() => api.reactivateSite(), { success: 'Site réactivé' });
    set(updated);
  };

  /**
   * Bascule la protection. AUCUNE mise à jour optimiste : on n'écrit dans le
   * contexte que le statut RECALCULÉ par le backend. Si l'appel échoue, `run`
   * lève, `set` n'est jamais atteint, et l'écran continue d'afficher l'état
   * réel — un interrupteur qui aurait déjà bougé mentirait sur l'accès au site.
   */
  const doToggleProtection = async () => {
    const next = !protectionEnabled;
    const updated = await run(() => api.setContractProtection(next), {
      success: next ? 'Protection contractuelle activée' : 'Protection contractuelle désactivée',
    });
    set(updated);
  };

  return (
    <div>
      <PageHeader title="Statut du site" description="État de publication de votre site vitrine." />

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div
                className={`flex h-14 w-14 items-center justify-center rounded-full ${
                  suspended ? 'bg-orange-100 text-orange-600' : 'bg-emerald-100 text-emerald-600'
                }`}
              >
                {suspended ? <AlertTriangle className="h-7 w-7" /> : <CheckCircle2 className="h-7 w-7" />}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Statut actuel</p>
                <p className="text-2xl font-bold">{suspended ? 'Suspendu' : 'Actif'}</p>
              </div>
            </div>

            {suspended && (
              <div className="mt-6 space-y-2 rounded-lg bg-orange-50 p-4 text-sm">
                {/* La CAUSE d'abord : « suspendu » ne dit pas pourquoi, et les
                    deux causes ne se lèvent pas de la même façon. */}
                <Row label="Cause" value={causeLabel(status.suspensionSource)} />
                <Row label="Date de suspension" value={status.suspendedAt ? formatDateTime(status.suspendedAt) : '—'} />
                {status.suspendedBy && <Row label="Par" value={status.suspendedBy} />}
                <Row label="Motif" value={status.reason || 'Aucun motif précisé'} />
              </div>
            )}

            <div className="mt-6 flex items-start gap-2 rounded-lg border border-border bg-muted/50 p-4">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                La suspension et la réactivation ne peuvent être effectuées que par l'équipe
                technique (rôle développeur).
              </p>
            </div>

            {isDev && (
              <div className="mt-6 flex gap-2">
                {suspended ? (
                  <Button onClick={doReactivate} loading={pending}>
                    <Power className="h-4 w-4" /> Réactiver le site
                  </Button>
                ) : (
                  <Button variant="destructive" onClick={() => setSuspendOpen(true)}>
                    <Power className="h-4 w-4" /> Suspendre le site
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/*
        PROTECTION CONTRACTUELLE — un réglage distinct de la suspension.

        Elle ne suspend ni ne réactive : elle dit si l'absence de contrat actif
        COMPTE comme une cause de suspension. La désactiver ne rouvre donc pas
        un site suspendu pour maintenance, et l'écran le dit plutôt que de
        laisser croire à un interrupteur général.
      */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-semibold">Protection contractuelle</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {protectionEnabled
                    ? 'Suspend automatiquement le site lorsqu’aucun contrat actif n’est présent.'
                    : 'L’état du contrat n’affecte pas l’accès au site.'}
                </p>
              </div>

              {isDev && (
                <Button
                  variant={protectionEnabled ? 'outline' : 'default'}
                  onClick={doToggleProtection}
                  loading={pending}
                >
                  <ShieldCheck className="h-4 w-4" />
                  {protectionEnabled ? 'Désactiver' : 'Activer'}
                </Button>
              )}
            </div>

            {/* La conséquence CONSTATÉE — jamais déduite du seul réglage. */}
            {status.suspensionSource === 'CONTRACT' && (
              <p className="mt-4 rounded-lg bg-orange-50 p-3 text-sm text-orange-800">
                Site suspendu par la protection contractuelle.
              </p>
            )}
            {protectionEnabled && suspended && status.suspensionSource === 'TECHNICAL' && (
              <p className="mt-4 rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
                Le site est suspendu pour maintenance technique : désactiver cette protection
                ne le réactivera pas.
              </p>
            )}

            {!isDev && (
              <p className="mt-4 text-sm text-muted-foreground">
                Seule l’équipe technique (rôle développeur) peut modifier ce réglage.
              </p>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <Modal open={suspendOpen} onClose={closeSuspend} title="Suspendre le site" className="max-w-md">
        <p className="mb-4 text-sm text-muted-foreground">
          Le site vitrine affichera une page de suspension. Vous pourrez le réactiver à tout moment.
        </p>
        <Field label="Motif (optionnel)">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex: Maintenance planifiée" />
        </Field>

        {/*
          NOTIFIER LES ADMINISTRATEURS — un geste délibéré, décoché par défaut.

          Le libellé dit QUI reçoit (« les administrateurs du site ») et non
          « envoyer un e-mail » : la question que se pose l'opérateur est de
          savoir s'il dérange le client, pas quel canal est employé.
        */}
        <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-lg border border-border/70 px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={notifyAdmins}
            onChange={(e) => setNotifyAdmins(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Notifier les administrateurs du site
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Ils recevront un message indiquant la suspension et le motif
              {/*
                LA VÉRITÉ SUR CE QUI SERA ÉCRIT. L'opérateur doit savoir que
                laisser le motif vide n'efface pas la ligne : elle affichera
                « Aucun ». Le lui cacher lui ferait croire à une discrétion
                qu'il n'a pas.
              */}
              {reason.trim() ? '.' : ' — « Aucun » si vous n’en indiquez pas.'}
            </span>
          </span>
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={closeSuspend}>
            Annuler
          </Button>
          <Button variant="destructive" onClick={doSuspend} loading={pending} disabled={pending}>
            Confirmer la suspension
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/**
 * La cause, en clair. `NONE`/absent ne se produit pas quand le site est
 * suspendu, mais on le nomme quand même plutôt que d'afficher une case vide.
 */
function causeLabel(source: SiteStatus['suspensionSource']): string {
  if (source === 'CONTRACT') return 'Protection contractuelle (aucun contrat actif)';
  if (source === 'TECHNICAL') return 'Maintenance technique';
  /**
   * L10.6 — la troisième cause dominante. Son absence de cette liste affichait
   * « Non précisée » à un client dont le site était fermé pour impayé : la
   * seule cause sur laquelle il pouvait agir était justement celle qu'on ne
   * lui nommait pas.
   */
  if (source === 'PAYMENT_DEFAULT') return 'Défaut de paiement';
  return 'Non précisée';
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
