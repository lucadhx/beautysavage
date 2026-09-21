import { ArrowUpRight } from 'lucide-react';
import { useSiteData } from '@/context/SiteDataContext';
import { useSeo } from '@/lib/useSeo';
import { Reveal } from '@/components/ui';
import { MediaIcon } from '@/components/MediaIcon';
import { ContactForm } from '@/components/ContactForm';
import { mediaHref } from '@/lib/utils';

export default function ContactPage() {
  const { data } = useSiteData();
  const company = data!.company;
  const media = company.media.filter((m) => m.enabled && m.value);

  useSeo({
    title: 'Contact BeautySavage',
    description: "Contactez l'institut BeautySavage pour une prestation, une formation ou une carte cadeau.",
  });

  return (
    <div className="pt-32 md:pt-44">
      <section className="mx-auto max-w-6xl px-5 md:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.32em]" style={{ color: 'var(--v-accent)' }}>
          Contact institut
        </p>
        <h1 className="mt-7 max-w-3xl text-4xl font-semibold leading-[1.03] sm:text-6xl" style={{ fontFamily: 'var(--font-heading)' }}>
          Parlons de votre prochain rendez-vous.
        </h1>
        <div className="mt-10 flex items-start gap-5">
          <span className="mt-3 h-px w-10 shrink-0 sm:w-16" style={{ background: 'var(--v-accent)' }} />
          <p className="max-w-2xl text-lg font-light leading-relaxed" style={{ color: 'color-mix(in srgb, var(--v-foreground) 70%, var(--v-background))' }}>
            Prestations, formations, cartes cadeaux ou demande particuliere : envoyez-nous les informations utiles,
            l'institut vous recontacte avec une reponse claire.
          </p>
        </div>
      </section>

      <section className="mx-auto mt-20 max-w-6xl px-5 pb-28 md:px-8 md:pb-36">
        <div className="grid gap-14 lg:grid-cols-[1.35fr_1fr] [&>*]:min-w-0">
          <Reveal>
            <ContactForm />
          </Reveal>

          <Reveal delay={0.1}>
            <div className="flex h-full flex-col gap-12">
              {media.length > 0 && (
                <div>
                  <h2 className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'color-mix(in srgb, var(--v-foreground) 42%, var(--v-background))' }}>
                    Nous joindre directement
                  </h2>
                  <ul className="mt-5 divide-y" style={{ borderColor: 'var(--v-border)' }}>
                    {media.map((m) => (
                      <li key={m.key}>
                        <a href={mediaHref(m.kind, m.value)} target="_blank" rel="noreferrer" className="group flex items-center gap-4 py-4 text-sm">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center border transition-colors duration-300" style={{ borderColor: 'var(--v-border)', borderRadius: 'var(--v-radius)' }}>
                            <MediaIcon name={m.icon} className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[10px] uppercase tracking-[0.18em]" style={{ color: 'color-mix(in srgb, var(--v-foreground) 42%, var(--v-background))' }}>
                              {m.label}
                            </span>
                            <span className="block truncate font-medium">{m.value}</span>
                          </span>
                          <ArrowUpRight className="h-4 w-4 shrink-0 opacity-0 transition-all duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100" />
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-auto border-t pt-8" style={{ borderColor: 'var(--v-border)' }}>
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'color-mix(in srgb, var(--v-foreground) 42%, var(--v-background))' }}>
                  Ce qui se passe ensuite
                </h2>
                <ol className="mt-6 space-y-5">
                  {[
                    'Nous lisons votre demande avec le contexte de votre besoin.',
                    'Nous vous repondons avec les disponibilites, le tarif ou les prochaines etapes.',
                    'Si un rendez-vous est necessaire, il est confirme avec acompte et rappel clair.',
                  ].map((step, index) => (
                    <li key={step} className="flex gap-4 text-sm font-light leading-relaxed">
                      <span className="shrink-0 tabular-nums tracking-[0.2em]" style={{ color: 'var(--v-accent)' }}>
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span style={{ color: 'color-mix(in srgb, var(--v-foreground) 66%, var(--v-background))' }}>
                        {step}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
