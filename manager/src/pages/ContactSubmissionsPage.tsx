import * as React from 'react';
import {
  Inbox, ArrowLeft, Mail, Phone, Globe, AlertTriangle, RotateCcw,
  CheckCircle2, Clock, Search, X, Send, ExternalLink,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, Card, CardContent, Badge, Input, Spinner, EmptyState } from '@/components/ui/primitives';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { useResource, useAction } from '@/hooks/useResource';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { formatDateTime, cn } from '@/lib/utils';
import type {
  ContactSubmissionPage, ContactSubmissionDetail, ContactSubmissionSummary,
  ContactSubmissionFilters, ContactNotificationDetail,
} from '@/types';
import {
  REASON_OPTIONS, reasonLabel, stateLabel, stateTone,
  notificationLabel, notificationTone, notificationSummaryText, notificationNeedsAttention,
  notificationErrorLabel, notificationClientMessage, EMPTY_FILTERS, hasActiveFilters, buildListQuery,
  isUnread, truncate, replyHref,
} from '@/lib/contactSubmissions';
import { decisionMeta, abuseReasonLabel, hasRecentRejections } from '@/lib/contactDiagnostics';
import { useContactUnread } from '@/context/ContactUnreadContext';

/**
 * Demandes de contact — ADMIN et DEV.
 *
 * ─── PAS UN CRM ──────────────────────────────────────────────────────────────
 *
 * On lit, on qualifie (statut, assignation), on répond par `mailto:`. Il n'y a
 * ni conversation, ni pièce jointe, ni réponse depuis le Manager : ces
 * fonctions demandent un fil, un stockage, une identité d'expéditeur par
 * utilisateur. Tant que le besoin n'est pas exprimé, `mailto:` fait le travail
 * avec l'outil que l'ADMIN utilise déjà.
 *
 * ─── LE SERVEUR DÉCIDE DES TRANSITIONS ───────────────────────────────────────
 *
 * `allowedTransitions` vient du détail : cette page n'a pas de table de
 * transitions, elle affiche ce que le serveur autorise. Une table recopiée ici
 * finirait par proposer un bouton que le backend refuse.
 */

const TONE_CLASS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-800',
  progress: 'bg-amber-100 text-amber-900',
  success: 'bg-emerald-100 text-emerald-800',
  danger: 'bg-red-100 text-red-800',
  warning: 'bg-amber-100 text-amber-900',
  pending: 'bg-muted text-muted-foreground',
  muted: 'bg-muted text-muted-foreground',
};

function StateBadge({ state }: { state: string }) {
  return <Badge className={TONE_CLASS[stateTone(state)]}>{stateLabel(state)}</Badge>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Notification
// ═══════════════════════════════════════════════════════════════════════════

/**
 * État réel de la notification aux administrateurs.
 *
 * ⚠️ N'affiche JAMAIS « délivrée » : le lot n'a pas de webhook, et `SENT` ne
 * signifie que « Brevo a accepté ». Voir docs/EMAIL_DELIVERY.md §2.
 */
function NotificationPanel({ notification, isDev }: { notification: ContactNotificationDetail; isDev: boolean }) {
  const needsAttention = notificationNeedsAttention(notification);

  // ── Vue CLIENT (non-DEV) : sobre, aucun code technique ────────────────────
  //
  // On ne montre RIEN quand la notification est partie (le client n'a pas à
  // s'en soucier), et une seule phrase neutre en cas d'échec. Le diagnostic
  // (codes, retry, Brevo) vit dans DEV → Événements système.
  if (!isDev) {
    const clientMessage = notificationClientMessage(notification);
    if (!clientMessage) return null;
    return (
      <Card>
        <CardContent className="pt-5">
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-600" />
            <span>{clientMessage}</span>
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── Vue DEV : détail complet (destinataires, codes, événement système) ────
  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">Notification aux administrateurs</p>
          <Badge className={TONE_CLASS[notificationTone(notification.status)]}>
            {notificationLabel(notification.status)}
          </Badge>
        </div>

        <p className="text-xs text-muted-foreground">{notificationSummaryText(notification)}</p>

        {/* Une demande enregistrée sans notification reste une demande valide :
            on le dit, pour que personne ne croie à une perte. */}
        {notification.status === 'NONE' && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5">
            <p className="flex items-start gap-1.5 text-[11px] text-amber-800">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>
                Aucune notification n’a été déclenchée : l’émission de l’événement a échoué.
                <strong> La demande est bien enregistrée</strong> — elle est sous vos yeux. Prévenez
                les personnes concernées à la main.
              </span>
            </p>
          </div>
        )}

        {notification.recipients.length > 0 && (
          <div className="divide-y divide-border rounded-md border border-border">
            {notification.recipients.map((r) => (
              <div key={r.executionId} className="flex flex-wrap items-center justify-between gap-2 p-2.5">
                <span className="font-mono text-[11px]">{r.recipientEmailMasked || '—'}</span>
                <div className="flex items-center gap-2">
                  {r.executionStatus === 'SUCCEEDED' && (
                    <span className="flex items-center gap-1 text-[11px] text-sky-800">
                      <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> {notificationLabel('SENT')}
                    </span>
                  )}
                  {r.executionStatus === 'DEAD_LETTER' && (
                    <span className="flex items-center gap-1 text-[11px] text-red-700">
                      <AlertTriangle className="h-3 w-3" /> {notificationErrorLabel(r.lastErrorSafe.code)}
                    </span>
                  )}
                  {r.executionStatus === 'FAILED' && (
                    <span className="flex items-center gap-1 text-[11px] text-amber-800">
                      <Clock className="h-3 w-3" /> Nouvelle tentative prévue ({r.attempts}/{r.maxAttempts})
                    </span>
                  )}
                  {['PENDING', 'PROCESSING'].includes(r.executionStatus) && (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Spinner className="h-3 w-3" /> En cours
                    </span>
                  )}
                  {r.executionStatus === 'SKIPPED' && (
                    <span className="text-[11px] text-muted-foreground">Ignorée</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Le renvoi manuel vit dans /dev/evenements : le DEV y a le contexte
            complet (tentatives, erreur, backoff). Un bouton « renvoyer » ici
            donnerait à l'ADMIN un levier qu'il ne peut pas interpréter. */}
        {isDev && notification.eventId && (
          <a
            href={`/dev/evenements?type=contact.submitted`}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" /> Voir l’événement système
            {needsAttention && ' (pour relancer)'}
          </a>
        )}
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Détail
// ═══════════════════════════════════════════════════════════════════════════

function SubmissionDetail({ submissionId, onBack, onChanged }: {
  submissionId: string;
  onBack: () => void;
  onChanged: () => void;
}) {
  // L'ouverture marque la première lecture, côté serveur. On rafraîchit le
  // compteur de non-lues juste après (le badge sidebar doit baisser tout de suite).
  const { data, loading, refresh } = useResource(() => api.getContactSubmission(submissionId), [submissionId]);
  const { pending, run } = useAction();
  const { user } = useAuth();
  const unread = useContactUnread();

  const submission = data as ContactSubmissionDetail | null;
  const isDev = user?.role === 'DEV';

  // Ouvrir = lire : le serveur pose readAt, on met le badge à jour dès le chargement.
  React.useEffect(() => {
    if (submission && submission.readAt) unread.refresh();
  }, [submission?.submissionId, submission?.readAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const resolve = async () => {
    try {
      await run(() => api.resolveContact(submissionId), { success: 'Demande marquée comme résolue' });
      refresh();
      unread.refresh();
      onChanged();
    } catch { /* toast déjà émis */ }
  };

  const reopen = async () => {
    try {
      await run(() => api.reopenContact(submissionId), { success: 'Demande rouverte' });
      refresh();
      onChanged();
    } catch { /* */ }
  };

  if (loading || !submission) return <BrandLoader />;

  const resolved = submission.state === 'RESOLVED';

  return (
    <div>
      <button onClick={onBack} className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Retour aux demandes
      </button>

      <PageHeader
        title={submission.contact.name}
        description={`${reasonLabel(submission.reason)} · reçue le ${formatDateTime(submission.submittedAt)}`}
        action={<StateBadge state={submission.state} />}
      />

      {/* Action principale EN HAUT, immédiatement visible. Verte + icône. */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {resolved ? (
          <>
            <Button variant="outline" loading={pending} onClick={reopen}>
              <RotateCcw className="h-4 w-4" /> Rouvrir la demande
            </Button>
            <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> Résolue{submission.resolvedAt ? ` le ${formatDateTime(submission.resolvedAt)}` : ''}
            </span>
          </>
        ) : (
          <Button
            loading={pending}
            onClick={resolve}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            <CheckCircle2 className="h-4 w-4" /> Marquer comme résolu
          </Button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card className="border-l-4 border-l-primary/60">
            <CardContent className="pt-5">
              <p className="mb-2 text-sm font-semibold text-foreground">Message du visiteur</p>
              {/*
                `whitespace-pre-line` : les retours à la ligne du visiteur sont
                conservés (le backend les préserve), mais RIEN n'est interprété.
                React échappe le texte — un `<script>` s'affiche tel quel. Bloc mis en
                valeur (bordure, ombre, interligne aéré) pour un repérage immédiat.
              */}
              <div className="whitespace-pre-line rounded-md border border-border bg-card p-4 text-[15px] leading-7 text-foreground shadow-sm">
                {submission.message}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2.5 pt-5 text-sm">
              <p className="mb-1 font-medium">Coordonnées</p>
              <a href={replyHref(submission.contact.email, submission.reason)}
                 className="flex items-center gap-2 hover:opacity-70">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span>{submission.contact.email}</span>
              </a>
              {submission.contact.phone ? (
                <a href={`tel:${submission.contact.phone}`} className="flex items-center gap-2 hover:opacity-70">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span>{submission.contact.phone}</span>
                </a>
              ) : (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-4 w-4" /> Non renseigné
                </p>
              )}
              {submission.pageUrl && (
                <a href={submission.pageUrl} target="_blank" rel="noreferrer"
                   className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
                  <Globe className="h-3.5 w-3.5" /> Envoyée depuis {submission.pageUrl}
                </a>
              )}
            </CardContent>
          </Card>

          {/* Répondre depuis le Manager n'existe pas (ce n'est pas un CRM) :
              `mailto:` ouvre l'outil que l'ADMIN utilise déjà, avec le sujet prêt. */}
          <a
            href={replyHref(submission.contact.email, submission.reason)}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            <Send className="h-4 w-4" /> Répondre par e-mail
          </a>
        </div>

        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 pt-5">
              <p className="text-sm font-medium">Suivi</p>

              <div className="space-y-1 text-[11px] text-muted-foreground">
                <p>Reçue le {formatDateTime(submission.submittedAt)}</p>
                <p>{submission.readAt ? `Lue le ${formatDateTime(submission.readAt)}` : 'Jamais lue'}</p>
                {submission.resolvedAt && <p>Résolue le {formatDateTime(submission.resolvedAt)}</p>}
                {submission.metadataSafe.userAgentFamily && (
                  <p>Navigateur : {submission.metadataSafe.userAgentFamily}</p>
                )}
              </div>
            </CardContent>
          </Card>

          <NotificationPanel notification={submission.notification} isDev={isDev} />
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Liste
// ═══════════════════════════════════════════════════════════════════════════

export default function ContactSubmissionsPage() {
  const { isDev } = useAuth();
  const [filters, setFilters] = React.useState<ContactSubmissionFilters>(EMPTY_FILTERS);
  const [searchDraft, setSearchDraft] = React.useState('');
  const [selected, setSelected] = React.useState<string | null>(null);
  const [pages, setPages] = React.useState<ContactSubmissionSummary[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);

  const query = buildListQuery(filters);
  const { data, loading, refresh } = useResource(() => api.listContactSubmissions(query), [query]);
  const page = data as ContactSubmissionPage | null;

  // Première page : on repart de zéro à chaque changement de filtre.
  React.useEffect(() => {
    if (page) {
      setPages(page.items);
      setCursor(page.nextCursor);
    }
  }, [page]);

  /** Recherche débattue : une requête par frappe serait du gâchis. */
  React.useEffect(() => {
    const t = setTimeout(() => setFilters((f) => ({ ...f, search: searchDraft })), 350);
    return () => clearTimeout(t);
  }, [searchDraft]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await api.listContactSubmissions(buildListQuery(filters, { cursor }));
      // Concaténation : la pagination par curseur garantit l'absence de doublon.
      setPages((p) => [...p, ...next.items]);
      setCursor(next.nextCursor);
    } catch { /* toast */ } finally {
      setLoadingMore(false);
    }
  };

  if (selected) {
    return <SubmissionDetail submissionId={selected} onBack={() => setSelected(null)} onChanged={refresh} />;
  }

  const unreadCount = page?.unreadCount ?? 0;

  return (
    <div>
      <PageHeader
        title="Demandes de contact"
        description="Messages déposés depuis le formulaire du site. Ils ne peuvent être ni créés ni supprimés ici."
      />

      {isDev && <ContactDiagnosticsPanel />}

      {/* Onglets : demandes actives (non résolues) / archives (résolues). */}
      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFilters((f) => ({ ...f, resolved: false }))}
            className={cn(
              'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
              !filters.resolved ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted'
            )}
          >
            À traiter
            {!filters.resolved && unreadCount > 0 && (
              <span className="ml-1.5 tabular-nums opacity-80">{unreadCount} non lu{unreadCount > 1 ? 'es' : 'e'}</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setFilters((f) => ({ ...f, resolved: true }))}
            className={cn(
              'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
              filters.resolved ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted'
            )}
          >
            Résolues
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Rechercher un nom, un e-mail, un message…"
              className="pl-9"
            />
          </div>
          <select
            value={filters.reason}
            onChange={(e) => setFilters((f) => ({ ...f, reason: e.target.value as ContactSubmissionFilters['reason'] }))}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm"
          >
            <option value="">Tous les motifs</option>
            {REASON_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          {hasActiveFilters(filters) && (
            <Button size="sm" variant="ghost" onClick={() => { setFilters(EMPTY_FILTERS); setSearchDraft(''); }}>
              <X className="h-3.5 w-3.5" /> Effacer
            </Button>
          )}
        </div>
      </div>

      {loading && pages.length === 0 ? (
        <BrandLoader />
      ) : pages.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={hasActiveFilters(filters) ? 'Aucun résultat' : 'Aucune demande'}
          description={
            hasActiveFilters(filters)
              ? 'Aucune demande ne correspond à ces filtres.'
              : 'Les demandes déposées depuis le formulaire de contact du site apparaîtront ici.'
          }
        />
      ) : (
        <>
          <Card>
            <CardContent className="divide-y divide-border p-0">
              {pages.map((s) => (
                <button
                  key={s.submissionId}
                  onClick={() => setSelected(s.submissionId)}
                  className="flex w-full items-start justify-between gap-3 px-5 py-3.5 text-left hover:bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Une demande jamais ouverte se repère sans lire. */}
                      {isUnread(s) && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Non lue" />}
                      <span className={cn(isUnread(s) ? 'font-bold' : 'font-medium')}>{s.contact.name}</span>
                      {isUnread(s) && <Badge className={TONE_CLASS[stateTone('UNREAD')]}>Non lu</Badge>}
                      <Badge className="bg-muted text-[10px] text-muted-foreground">{reasonLabel(s.reason)}</Badge>
                      {/* Une notification en échec doit sauter aux yeux depuis la liste. */}
                      {notificationNeedsAttention(s.notification ?? null) && (
                        <Badge className="bg-red-100 text-[10px] text-red-800">
                          <AlertTriangle className="mr-1 inline h-3 w-3" />
                          {notificationLabel(s.notification!.status)}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{s.contact.email}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{truncate(s.messagePreview)}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(s.submittedAt)}</span>
                </button>
              ))}
            </CardContent>
          </Card>

          {cursor && (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" onClick={loadMore} loading={loadingMore}>
                Charger plus de demandes
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Diagnostics DEV (anti-abus) — rendu UNIQUEMENT pour les DEV.
 *
 * Rend visible ce que la réponse neutre cache : une soumission rejetée par
 * l'anti-abus (honeypot rempli par l'autofill, débit global épuisé pendant des
 * essais…) « réussit » côté vitrine mais ne crée rien. Ce panneau le montre.
 */
function ContactDiagnosticsPanel() {
  const [open, setOpen] = React.useState(false);
  const { data, loading, reload } = useResource(() => api.getContactDiagnostics(), []);
  const decisions = data?.decisions ?? [];
  const alert = hasRecentRejections(decisions);

  return (
    <Card className="mb-4 border-dashed">
      <CardContent className="py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="-my-1 flex w-full items-center justify-between gap-2 py-1 text-left"
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className={cn('h-4 w-4', alert ? 'text-red-600' : 'text-muted-foreground')} />
            Diagnostics des soumissions (DEV)
            {alert && <Badge className="bg-red-100 text-red-700">Rejets anti-abus récents</Badge>}
          </span>
          <span className="text-xs text-muted-foreground">{open ? 'Masquer' : 'Afficher'}</span>
        </button>

        {open && (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              Une soumission peut « réussir » côté visiteur sans être enregistrée si l'anti-abus la neutralise
              (réponse neutre volontaire). Ce journal DEV (en mémoire, sans le message) le rend observable.
            </p>
            <div className="flex justify-end">
              <Button size="sm" variant="ghost" onClick={() => reload()}>Rafraîchir</Button>
            </div>
            {loading ? (
              <div className="py-4"><Spinner /></div>
            ) : decisions.length === 0 ? (
              <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
                Aucune tentative récente (le journal est vidé au redémarrage du serveur).
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {decisions.map((d, i) => {
                  const meta = decisionMeta(d.decision);
                  return (
                    <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5 text-xs">
                      <span className="flex items-center gap-2">
                        <Badge className={meta.cls}>{meta.label}</Badge>
                        <span className="font-mono">{d.emailMasked || '—'}</span>
                        {d.reason && <span className="text-muted-foreground">· {abuseReasonLabel(d.reason)}</span>}
                      </span>
                      <span className="text-muted-foreground">{formatDateTime(d.at)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
