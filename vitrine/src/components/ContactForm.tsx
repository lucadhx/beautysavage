import { useRef, useState } from 'react';
import { Send, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { api, ContactApiError } from '@/lib/api';
import {
  CONTACT_REASONS,
  EMPTY_FORM,
  MAX_MESSAGE_LENGTH,
  validateContactForm,
  errorMessage,
  remainingChars,
  shouldShowCounter,
  buildContactPayload,
  newClientSubmissionId,
  SUCCESS_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  type ContactFormValues,
  type ContactErrors,
  type ContactField,
} from '@/lib/contactForm';

/**
 * Formulaire de contact public.
 *
 * ─── COMPOSANT AUTONOME, PAR NÉCESSITÉ ───────────────────────────────────────
 *
 * Les primitives de la vitrine vivent dans `components/ui.tsx`, mais ce fichier
 * porte des modifications non commitées : on n'y touche pas. Le formulaire est
 * donc autonome et n'utilise que les tokens CSS (`--v-*`) déjà en place — le
 * rendu reste cohérent sans dépendre d'un fichier en cours d'édition.
 *
 * ─── LA LOGIQUE VIT DANS `lib/contactForm.ts` ────────────────────────────────
 *
 * Validation, construction du payload, messages : tout est dans le module pur,
 * testé sous Node. Ce composant ne fait qu'afficher et appeler — c'est ce qui
 * permet de tester les règles sans stack DOM.
 */

const labelStyle = 'mb-1.5 block text-sm font-medium text-muted-foreground';
/**
 * `v-field` (défini dans index.css) porte fond, bordure, placeholder et focus.
 *
 * ── `text-base sm:text-sm` N'EST PAS UNE PRÉFÉRENCE ─────────────────────────
 * Sous 16 px, iOS Safari ZOOME la page à la mise au point d'un champ, puis ne
 * dézoome pas : le visiteur se retrouve dans un formulaire décadré, qu'il doit
 * repositionner à la main entre chaque champ. 16 px sur mobile supprime le
 * zoom ; au-dessus de 640 px, où le problème n'existe pas, on garde 14 px.
 *
 * `min-h-[44px]` garantit la cible tactile même si la police change.
 */
/**
 * `min-w-0` N'EST PAS DÉCORATIF NON PLUS.
 *
 * Un `<input>` et surtout un `<select>` portent une largeur INTRINSÈQUE : celle
 * de leur plus longue option pour le second (« Question sur un service »).
 * `w-full` fixe la largeur souhaitée, mais pas le minimum : dans une grille,
 * c'est ce minimum qui empêchait la colonne de rétrécir et faisait déborder le
 * formulaire sur les petits écrans. `min-w-0` autorise le champ à suivre la
 * place disponible ; le navigateur tronque proprement le libellé affiché.
 */
const fieldStyle =
  'v-field w-full min-w-0 rounded-xl px-4 py-3 text-base sm:text-sm outline-none transition '
  + 'min-h-[44px] disabled:cursor-not-allowed disabled:opacity-60';
// Seule la bordure rouge d'erreur reste en style inline (elle prime sur `v-field`).
const invalidBorder = { borderColor: '#dc2626' };

export function ContactForm() {
  const [values, setValues] = useState<ContactFormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<ContactErrors>({});
  const [touched, setTouched] = useState<Partial<Record<ContactField, boolean>>>({});
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState('');

  /**
   * Horodatage d'affichage et clé d'idempotence — posés UNE fois, à la première
   * frappe, et conservés dans des refs.
   *
   * La clé ne doit PAS être regénérée à chaque tentative : c'est elle qui fait
   * qu'un double clic ou un retry après erreur réseau produit une seule demande.
   * La regénérer supprimerait toute la protection — précisément quand elle sert.
   */
  const startedAt = useRef<number | null>(null);
  const submissionId = useRef<string>('');

  const ensureSession = () => {
    if (startedAt.current === null) startedAt.current = Date.now();
    if (!submissionId.current) submissionId.current = newClientSubmissionId();
  };

  const set = (field: keyof ContactFormValues, value: string) => {
    ensureSession();
    const next = { ...values, [field]: value };
    setValues(next);
    // Validation inline : on ne signale une erreur QUE sur un champ déjà quitté.
    // Afficher « nom requis » dès la première lettre serait agressif et faux.
    if (touched[field as ContactField]) setErrors(validateContactForm(next));
    if (formError) setFormError('');
  };

  const blur = (field: ContactField) => {
    setTouched((t) => ({ ...t, [field]: true }));
    setErrors(validateContactForm(values));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Protection double clic : le garde le plus simple, et le plus efficace.
    if (pending) return;

    const found = validateContactForm(values);
    setErrors(found);
    setTouched({ name: true, companyName: true, activity: true, email: true, phone: true, reason: true, message: true });
    if (Object.keys(found).length > 0) return;

    ensureSession();
    setPending(true);
    setFormError('');

    try {
      await api.submitContact(
        buildContactPayload(values, {
          clientSubmissionId: submissionId.current,
          formStartedAt: startedAt.current,
          pageUrl: typeof window !== 'undefined' ? window.location.href : undefined,
        })
      );
      // Reset APRÈS succès seulement.
      setValues(EMPTY_FORM);
      setTouched({});
      startedAt.current = null;
      submissionId.current = '';
      setDone(true);
    } catch (err) {
      // ── LES SAISIES SONT CONSERVÉES ────────────────────────────────────────
      // On ne vide RIEN en cas d'erreur : le visiteur a écrit un message, le lui
      // effacer parce que le réseau a coupé serait le pire moment pour le perdre.
      if (err instanceof ContactApiError) {
        // Le serveur peut refuser ce que le client a laissé passer (règle plus
        // récente). On replace ses codes sous les bons champs.
        const serverErrors: ContactErrors = {};
        for (const issue of err.issues) {
          const field = issue.path?.[0];
          if (typeof field === 'string' && issue.message) {
            serverErrors[field as ContactField] = issue.message;
          }
        }
        if (Object.keys(serverErrors).length > 0) {
          setErrors(serverErrors);
          setTouched({ name: true, companyName: true, activity: true, email: true, phone: true, reason: true, message: true });
        } else {
          setFormError(errorMessage(err.code ?? undefined) || err.message);
        }
      } else {
        setFormError(NETWORK_ERROR_MESSAGE);
      }
    } finally {
      setPending(false);
    }
  };

  if (done) {
    return (
      <div
        className="rounded-2xl border p-6 text-center sm:p-8"
        style={{ borderColor: 'var(--v-border)' }}
        role="status"
        aria-live="polite"
      >
        <span
          className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
          style={{ background: 'var(--v-muted)', color: 'var(--v-primary)' }}
        >
          <CheckCircle2 className="h-7 w-7" />
        </span>
        <h3 className="mb-2 text-lg font-bold">Message envoyé</h3>
        {/* Aucune mention d'e-mail ni d'administrateur : le visiteur n'a pas à
            connaître notre infrastructure, et l'e-mail a pu échouer alors que sa
            demande est bien enregistrée. */}
        <p className="text-sm text-muted-foreground">{SUCCESS_MESSAGE}</p>
        <button
          type="button"
          onClick={() => setDone(false)}
          className="mt-5 text-sm font-semibold underline underline-offset-4 transition hover:opacity-70"
        >
          Envoyer une autre demande
        </button>
      </div>
    );
  }

  const err = (field: ContactField) => (touched[field] ? errorMessage(errors[field]) : '');
  const invalid = (field: ContactField) => Boolean(touched[field] && errors[field]);
  const remaining = remainingChars(values.message);

  return (
    <form
      onSubmit={submit}
      noValidate
      className="rounded-2xl border p-5 sm:p-7"
      style={{
        borderColor: 'var(--v-border)',
        background: 'color-mix(in srgb, var(--v-foreground) 3%, var(--v-background))',
      }}
    >
      {/*
        AUCUN DÉLAI DE RÉPONSE ANNONCÉ.

        Le moteur d'origine promettait « Réponse sous 24 h ouvrées » : c'est le
        langage d'un service client, et c'est un engagement qu'une maison de
        conception à capacité volontairement limitée ne tiendra pas toujours.
        Une promesse chiffrée non tenue coûte plus cher que pas de promesse du
        tout. Ce que la page dit à la place — « ce qui se passe ensuite », trois
        lignes, dans la colonne voisine — engage sur la MANIÈRE, pas sur
        l'horloge.
      */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold">Votre demande</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Rendez-vous, formation, carte cadeau ou question institut : laissez-nous les informations utiles.
        </p>
      </div>

      <div className="space-y-4">
        {/* ── HONEYPOT ────────────────────────────────────────────────────────
            Retiré du flux d'accessibilité (`aria-hidden`) ET du parcours clavier
            (`tabIndex={-1}`) : un lecteur d'écran ne l'annonce pas, une tabulation
            ne l'atteint pas. `autoComplete="off"` empêche le navigateur de le
            remplir tout seul — ce qui rejetterait un vrai visiteur.

            Positionné hors écran plutôt qu'en `display: none` : c'est le premier
            attribut que regarde un robot un peu sérieux. La combinaison reste
            triviale à contourner pour qui vise CE site — le honeypot n'arrête que
            les robots génériques, et c'est tout ce qu'on lui demande. */}
        {/* Hors écran SANS pouvoir élargir le document : `left-[-9999px]` sur un
            élément non contenu ajoute de la largeur sur certains navigateurs et
            provoque un défilement horizontal parasite sur mobile. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute h-px w-px overflow-hidden"
          style={{ clip: 'rect(0 0 0 0)', clipPath: 'inset(50%)', whiteSpace: 'nowrap' }}
        >
          <label htmlFor="contact-hp-check">Ne remplissez pas ce champ</label>
          <input
            id="contact-hp-check"
            // Nom NON SÉMANTIQUE : ni « website », ni « url », ni un nom reconnu
            // par l'autofill des navigateurs et gestionnaires de mots de passe.
            name="hpCheck"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={values.hpCheck}
            onChange={(e) => set('hpCheck', e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="contact-name" className={labelStyle}>
            Nom <span aria-hidden="true">*</span>
          </label>
          <input
            id="contact-name"
            name="name"
            type="text"
            autoComplete="name"
            required
            disabled={pending}
            value={values.name}
            onChange={(e) => set('name', e.target.value)}
            onBlur={() => blur('name')}
            aria-invalid={invalid('name')}
            aria-describedby={invalid('name') ? 'contact-name-error' : undefined}
            className={fieldStyle}
            style={invalid('name') ? invalidBorder : undefined}
          />
          {err('name') && (
            <p id="contact-name-error" className="mt-1.5 flex items-center gap-1 text-xs text-red-600">
              <AlertCircle className="h-3.5 w-3.5" /> {err('name')}
            </p>
          )}
        </div>

        {/*
          L'ENTREPRISE ET SON ACTIVITÉ — dans cet ordre, et avant les
          coordonnées.

          Le plan de site fixe le contenu et l'ordre : « Entreprise, activité,
          projet, coordonnées ». Ce n'est pas de la mise en page : commencer par
          l'entreprise plutôt que par le demandeur dit ce qui nous intéresse, et
          le formulaire devient une présentation plutôt qu'un bon de commande.
        */}
        <div>
          <label htmlFor="contact-company" className={labelStyle}>
            Sujet <span aria-hidden="true">*</span>
          </label>
          <input
            id="contact-company"
            name="companyName"
            type="text"
            autoComplete="organization"
            required
            disabled={pending}
            placeholder="Ex : pose gel, formation cils, carte cadeau"
            value={values.companyName}
            onChange={(e) => set('companyName', e.target.value)}
            onBlur={() => blur('companyName')}
            aria-invalid={invalid('companyName')}
            aria-describedby={invalid('companyName') ? 'contact-company-error' : undefined}
            className={fieldStyle}
            style={invalid('companyName') ? invalidBorder : undefined}
          />
          {err('companyName') && (
            <p id="contact-company-error" className="mt-1.5 flex items-center gap-1 text-xs text-red-600">
              <AlertCircle className="h-3.5 w-3.5" /> {err('companyName')}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="contact-activity" className={labelStyle}>
            Preference ou disponibilite <span className="text-xs font-normal text-muted-foreground">(facultatif)</span>
          </label>
          <input
            id="contact-activity"
            name="activity"
            type="text"
            disabled={pending}
            placeholder="Ex : mercredi apres-midi, matin uniquement..."
            value={values.activity}
            onChange={(e) => set('activity', e.target.value)}
            onBlur={() => blur('activity')}
            aria-invalid={invalid('activity')}
            aria-describedby={invalid('activity') ? 'contact-activity-error' : undefined}
            className={fieldStyle}
            style={invalid('activity') ? invalidBorder : undefined}
          />
          {err('activity') && (
            <p id="contact-activity-error" className="mt-1.5 flex items-center gap-1 text-xs text-red-600">
              <AlertCircle className="h-3.5 w-3.5" /> {err('activity')}
            </p>
          )}
        </div>

        {/* Même règle qu'ailleurs : les deux colonnes doivent pouvoir rétrécir
            au lieu d'imposer la largeur intrinsèque de leurs champs. */}
        <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
          <div>
            <label htmlFor="contact-email" className={labelStyle}>
              E-mail <span aria-hidden="true">*</span>
            </label>
            <input
              id="contact-email"
              name="email"
              // `type="email"` + `inputMode` : le clavier mobile affiche « @ ».
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              disabled={pending}
              value={values.email}
              onChange={(e) => set('email', e.target.value)}
              onBlur={() => blur('email')}
              aria-invalid={invalid('email')}
              aria-describedby={invalid('email') ? 'contact-email-error' : undefined}
              className={fieldStyle}
              style={invalid('email') ? invalidBorder : undefined}
            />
            {err('email') && (
              <p id="contact-email-error" className="mt-1.5 flex items-center gap-1 text-xs text-red-600">
                <AlertCircle className="h-3.5 w-3.5" /> {err('email')}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="contact-phone" className={labelStyle}>
              Téléphone <span className="text-xs font-normal text-muted-foreground">(facultatif)</span>
            </label>
            <input
              id="contact-phone"
              name="phone"
              // `tel` + `inputMode="tel"` : pavé numérique sur mobile.
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              disabled={pending}
              value={values.phone}
              onChange={(e) => set('phone', e.target.value)}
              onBlur={() => blur('phone')}
              className={fieldStyle}
            />
          </div>
        </div>

        <div>
          <label htmlFor="contact-reason" className={labelStyle}>
            Motif <span aria-hidden="true">*</span>
          </label>
          <select
            id="contact-reason"
            name="reason"
            required
            disabled={pending}
            value={values.reason}
            onChange={(e) => set('reason', e.target.value)}
            onBlur={() => blur('reason')}
            aria-invalid={invalid('reason')}
            aria-describedby={invalid('reason') ? 'contact-reason-error' : undefined}
            className={fieldStyle}
            style={invalid('reason') ? invalidBorder : undefined}
          >
            <option value="">Choisissez...</option>
            {/* Les motifs viennent du module pur, miroir du registre serveur : le
                formulaire envoie un CODE, jamais le libellé affiché. */}
            {CONTACT_REASONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          {err('reason') && (
            <p id="contact-reason-error" className="mt-1.5 flex items-center gap-1 text-xs text-red-600">
              <AlertCircle className="h-3.5 w-3.5" /> {err('reason')}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="contact-message" className={labelStyle}>
            Votre message <span aria-hidden="true">*</span>
          </label>
          <textarea
            id="contact-message"
            name="message"
            required
            rows={5}
            disabled={pending}
            value={values.message}
            onChange={(e) => set('message', e.target.value)}
            onBlur={() => blur('message')}
            aria-invalid={invalid('message')}
            aria-describedby={invalid('message') ? 'contact-message-error' : undefined}
            className={`${fieldStyle} max-w-full resize-y`}
            style={invalid('message') ? invalidBorder : undefined}
          />
          <div className="mt-1.5 flex items-start justify-between gap-3">
            {err('message') ? (
              <p id="contact-message-error" className="flex items-center gap-1 text-xs text-red-600">
                <AlertCircle className="h-3.5 w-3.5" /> {err('message')}
              </p>
            ) : (
              <span />
            )}
            {/* Le compteur n'apparaît qu'à l'approche de la limite : afficher
                « 3972 restants » sur un message de trois mots est du bruit. */}
            {shouldShowCounter(values.message) && (
              <p className={`shrink-0 text-xs tabular-nums ${remaining < 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                {remaining} / {MAX_MESSAGE_LENGTH}
              </p>
            )}
          </div>
        </div>

        {formError && (
          <div
            className="flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800"
            role="alert"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        {/*
          LE BOUTON PORTE L'ACCENT — et son libellé est CALCULÉ, pas blanc.

          ══ POURQUOI L'ACCENT ICI, ALORS QUE LES AUTRES CTA SONT EN `primary` ══

          Les appels à l'action du site — « Présenter un projet » de la barre,
          « Présenter mon projet » de l'accueil — sont des aplats CLAIRS sur le
          noir : ils invitent à venir ici. Celui-ci est le geste FINAL, au bas
          d'un formulaire rempli. Lui donner la couleur de la marque le
          distingue de tous les autres, et signale qu'on ne navigue plus : on
          envoie.

          ══ `text-white` EST RETIRÉ, ET C'EST LE POINT ══════════════════════

          Il était écrit en dur. C'est juste tant que l'accent est sombre — un
          violet, un bleu — et faux dès qu'une palette claire est choisie
          depuis le Manager : du blanc sur un jaune vif donne 1,7:1, très en
          dessous du seuil AA, et le libellé du bouton d'envoi devient
          illisible sans que rien ne le signale.

          `--v-accent-foreground` est CALCULÉ à partir de la luminance de
          l'accent (voir `lib/theme.ts`) : il vaut noir ou blanc, celui des
          deux qui se lit. C'est le même jeton que les autres surfaces
          accentuées du site.
        */}
        <button
          type="submit"
          disabled={pending}
          className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-sm font-semibold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          style={{ background: 'var(--v-accent)', color: 'var(--v-accent-foreground)' }}
        >
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Envoi en cours…
            </>
          ) : (
            <>
              <Send className="h-4 w-4" /> Envoyer ma demande
            </>
          )}
        </button>

        <p className="text-center text-xs text-muted-foreground">
          Les champs marqués <span aria-hidden="true">*</span>
          <span className="sr-only">d’un astérisque</span> sont obligatoires.
        </p>
      </div>
    </form>
  );
}

export default ContactForm;
