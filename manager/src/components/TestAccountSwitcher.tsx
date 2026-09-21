import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Building2, ChevronDown, FlaskConical, Link2Off, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { api, ApiError, isOffline } from '@/lib/api';
import { Badge, Button, Spinner } from '@/components/ui/primitives';
import { beginFederatedLogin, federatedErrorMessage } from '@/lib/federation';
import type { TestLoginAccount, TestLoginDescription, User } from '@/types';
import { messageUtilisateur } from '@/lib/erreurs';

/**
 * LA CONNEXION RAPIDE — ENVIRONNEMENT TEST (L12.D).
 *
 * ══ CE QU'IL REMPLACE, ET POURQUOI CE N'ÉTAIT PLUS TENABLE ══════════════════
 *
 * L'ancien widget listait `User` et posait un seul bouton par ligne :
 * « se connecter », qui appelait `dev-login`. Ce modèle décrivait fidèlement le
 * projet d'AVANT la fédération, où il n'existait qu'une population.
 *
 * Il en existe deux, et elles n'entrent pas par la même porte :
 *
 *   COMPTE DU PROJET    mot de passe ici, session LOCALE. Le mécanisme de
 *                       recette peut l'ouvrir sans preuve, parce que ce projet
 *                       est propriétaire du compte.
 *
 *   ACCÈS L.Y SOLUTION  aucun mot de passe ici, session PANEL. Rien dans ce
 *                       projet ne peut fabriquer cette identité — il faut la
 *                       DEMANDER au Panel, qui la signe.
 *
 * ══ CE QUE CE COMPOSANT NE FAIT JAMAIS ══════════════════════════════════════
 *
 * Il n'invente pas de mot de passe Panel, ne fabrique aucun jeton, ne fusionne
 * pas les deux listes, et ne contourne aucune garde : pour un accès L.Y
 * Solution, il lance LE VRAI parcours fédéré, celui-là même que le bouton du
 * formulaire de connexion utilise. Le Panel reste seul juge — appairage, rôle,
 * `projectAccess`.
 *
 * ══ L'HONNÊTETÉ DES BOUTONS ═════════════════════════════════════════════════
 *
 * Un point de conception, et c'est le plus important de cet écran :
 *
 *   LE PROJET NE CHOISIT PAS LE COMPTE PANEL.
 *
 * L'assertion est émise pour la SESSION ouverte chez le Panel, prouvée là-bas.
 * Ce projet ne sait même pas laquelle c'est — c'est une session d'une autre
 * origine. Afficher un bouton « se connecter » sur chaque identité fédérée
 * serait donc promettre un choix qui n'existe pas : quatre boutons, un seul
 * résultat possible, et trois échecs incompréhensibles.
 *
 * Les identités L.Y Solution connues sont donc affichées pour ce qu'elles
 * sont — un état, pas une commande — et UN SEUL bouton lance le parcours.
 */

/** Le badge de rôle. `DEV` porte l'écusson, comme partout ailleurs. */
function RoleBadge({ role }: { role: TestLoginAccount['role'] }) {
  return (
    <Badge
      className={role === 'DEV' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-700'}
    >
      {role === 'DEV' && <ShieldCheck className="mr-1 h-3 w-3" />}
      {role}
    </Badge>
  );
}

function Initiale({ compte }: { compte: TestLoginAccount }) {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
      {(compte.displayName || compte.email).charAt(0).toUpperCase()}
    </div>
  );
}

function Identite({ compte }: { compte: TestLoginAccount }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium">{compte.displayName || compte.email}</p>
      <p className="truncate text-xs text-muted-foreground">{compte.email}</p>
    </div>
  );
}

/** Le titre d'une catégorie — le MÊME vocabulaire métier que le Panel. */
function Categorie({ icon: Icon, title }: { icon: typeof Building2; title: string }) {
  return (
    <div className="mt-3 flex items-center gap-2 border-b border-border pb-1.5 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
      <Icon className="h-3.5 w-3.5" />
      {title}
    </div>
  );
}

export function TestAccountSwitcher({
  onLocalSession,
  redirectPath = '/',
}: {
  /** Une session LOCALE vient d'être ouverte : à l'écran d'en faire quelque chose. */
  onLocalSession: (token: string, user: User) => Promise<void> | void;
  redirectPath?: string;
}) {
  const [description, setDescription] = React.useState<TestLoginDescription | null>(null);
  const [expanded, setExpanded] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  /**
   * LA SONDE — un serveur INJOIGNABLE n'est pas une réponse « PROD ».
   *
   * Comportement conservé de l'écran précédent, et pour la raison qu'il
   * documentait : en développement le backend redémarre souvent, notamment
   * après une modification du `.env` — c'est-à-dire au moment exact où l'on
   * bascule en TEST. Un `.catch(() => false)` masquait alors le widget
   * DÉFINITIVEMENT, puisque la sonde ne tournait qu'au montage.
   *
   * On réessaie tant que le serveur est muet. Un `enabled: false` explicite
   * (PROD), lui, est définitif et n'est jamais rejoué.
   */
  React.useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout>;

    const probe = async () => {
      try {
        const r = await api.testAccounts();
        if (cancelled) return;
        setDescription(r.enabled ? r : null);
      } catch (err) {
        if (cancelled) return;
        if (isOffline(err) && attempt < 5) {
          attempt += 1; // 1s, 2s, 3s… le temps que le backend réouvre son port
          timer = setTimeout(probe, 1000 * attempt);
          return;
        }
        setDescription(null); // réponse explicite (PROD) ou serveur durablement absent
      }
    };

    void probe();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const locaux = React.useMemo(
    () => (description?.accounts ?? []).filter((c) => c.source === 'LOCAL'),
    [description],
  );
  const federes = React.useMemo(
    () => (description?.accounts ?? []).filter((c) => c.source === 'PANEL'),
    [description],
  );

  /**
   * LE WIDGET N'EXISTE QUE SI LE SERVEUR A DIT « TEST ».
   *
   * Pas de repli optimiste, pas de variable de build, pas de `|| true`. Et pas
   * de simple masquage CSS : le composant ne rend RIEN, donc aucune adresse de
   * compte n'atteint le DOM — ce qu'un `hidden` n'aurait pas empêché.
   */
  if (!description) return null;

  const connexionLocale = async (compte: TestLoginAccount) => {
    setBusy(compte.id);
    try {
      const { token, user } = await api.devLogin(compte.email);
      await onLocalSession(token, user);
    } catch (err) {
      toast.error(messageUtilisateur(err, 'Connexion impossible'));
      setBusy(null);
    }
  };

  const connexionFederee = async () => {
    setBusy('federation');
    try {
      await beginFederatedLogin(redirectPath);
    } catch (err) {
      setBusy(null);
      if (isOffline(err)) {
        toast.error('Serveur injoignable. Réessayez dans un instant.');
        return;
      }
      toast.error(
        err instanceof ApiError ? federatedErrorMessage(err) : 'Connexion L.Y Solution impossible.',
      );
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="w-full max-w-sm lg:mt-[4.5rem] lg:w-80"
    >
      <div className="overflow-hidden rounded-xl border border-dashed border-primary/40 bg-card shadow-sm">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex w-full items-center justify-between gap-2 p-4 text-left"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <FlaskConical className="h-4 w-4 text-primary" />
            Connexion rapide
            <Badge className="bg-amber-100 text-amber-700">TEST</Badge>
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </button>

        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="space-y-2 px-4 pb-4">
                {/* ── COMPTES DU PROJET ─────────────────────────────────── */}
                <Categorie icon={Building2} title="Comptes du projet" />
                {locaux.length === 0 ? (
                  <p className="pt-1 text-xs text-muted-foreground">
                    Aucun compte local activé sur ce projet.
                  </p>
                ) : (
                  locaux.map((compte) => (
                    <button
                      key={compte.id}
                      type="button"
                      onClick={() => void connexionLocale(compte)}
                      disabled={!!busy || !compte.connectable}
                      className="flex w-full items-center gap-3 rounded-lg border border-border p-2.5 text-left transition hover:bg-muted disabled:opacity-60"
                    >
                      <Initiale compte={compte} />
                      <Identite compte={compte} />
                      {busy === compte.id ? (
                        <Spinner className="h-4 w-4" />
                      ) : compte.connectable ? (
                        <RoleBadge role={compte.role} />
                      ) : (
                        <Badge className="bg-slate-100 text-slate-500">Désactivé</Badge>
                      )}
                    </button>
                  ))
                )}

                {/* ── ACCÈS L.Y SOLUTION ────────────────────────────────── */}
                <Categorie icon={ShieldCheck} title="Accès L.Y Solution" />

                {!description.federation.available ? (
                  /*
                    PROJET NON APPAIRÉ — on le DIT, et l'on ne montre aucun
                    bouton. Le login local, lui, reste entièrement fonctionnel
                    juste au-dessus : c'est tout l'intérêt de deux blocs
                    séparés plutôt que d'un formulaire qui saurait tout faire.
                  */
                  <p className="flex items-start gap-2 pt-1 text-xs text-muted-foreground">
                    <Link2Off className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Projet non appairé au Panel : aucune connexion fédérée n’est possible d’ici.
                  </p>
                ) : (
                  <>
                    {/*
                      LE SEUL BOUTON DE CETTE CATÉGORIE, ET IL EST HONNÊTE.

                      Il ne prétend pas choisir un compte : il ouvre le parcours,
                      et le Panel délivre pour la session qui s'y trouve. C'est
                      exactement ce que fait le bouton du formulaire de
                      connexion — même fonction, même garde, même refus.
                    */}
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-1 w-full"
                      loading={busy === 'federation'}
                      disabled={!!busy && busy !== 'federation'}
                      onClick={() => void connexionFederee()}
                    >
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      Se connecter via L.Y Solution
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Le compte utilisé est celui de votre session Panel. Ce projet ne peut pas en
                      choisir un autre : c’est le Panel qui signe.
                    </p>
                  </>
                )}

                {federes.length > 0 && (
                  <>
                    <p className="pt-1 text-[0.7rem] uppercase tracking-wide text-muted-foreground">
                      Identités déjà venues ici
                    </p>
                    {federes.map((compte) => (
                      /*
                        UNE LIGNE D'ÉTAT, PAS UNE COMMANDE — d'où le `div`.

                        Un bouton désactivé aurait suggéré « cliquable ailleurs,
                        pas maintenant ». Ces lignes ne seront jamais cliquables :
                        le choix du compte n'appartient pas à ce projet.
                      */
                      <div
                        key={compte.id}
                        className="flex w-full items-center gap-3 rounded-lg border border-border/60 bg-muted/30 p-2.5 text-left"
                      >
                        <Initiale compte={compte} />
                        <Identite compte={compte} />
                        {compte.blockedReason === 'PANEL_ACCESS_REVOKED' ? (
                          <Badge className="bg-amber-100 text-amber-700">Accès non autorisé</Badge>
                        ) : (
                          <RoleBadge role={compte.role} />
                        )}
                      </div>
                    ))}
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

export default TestAccountSwitcher;
