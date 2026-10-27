import mongoose from 'mongoose';

/**
 * UN RAPPEL AVANT RENDEZ-VOUS OU SESSION — envoyé, ou délibérément sauté.
 *
 * `targetKey` désigne ce qui est rappelé, quelle qu'en soit la nature :
 *   · `event:<CalendarEvent>`           un rendez-vous prestation ;
 *   · `session:<sessionId>:<saleId>`    la place d'une stagiaire à une session
 *                                       de formation en présentiel.
 *
 * La clé (cible, délai en minutes, début visé) est UNIQUE : c'est elle qui
 * garantit qu'un rappel ne part jamais deux fois, même si deux passages du
 * planificateur se chevauchent ou si le serveur redémarre au milieu d'un envoi.
 * Le délai est stocké en minutes, pas en rang : réordonner les rappels d'une
 * fiche ne fait pas repartir ceux déjà envoyés. Un rendez-vous ou une session
 * DÉPLACÉ change de début : ses rappels visent la nouvelle date.
 */
const appointmentReminderSchema = new mongoose.Schema(
  {
    targetKey: { type: String, required: true },
    kind: { type: String, enum: ['SERVICE', 'TRAINING'], required: true },
    calendarEventId: { type: mongoose.Schema.Types.ObjectId, ref: 'CalendarEvent', default: null },
    sessionId: { type: mongoose.Schema.Types.ObjectId, default: null },
    saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceSale', default: null },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceProduct', default: null },
    /** Délai avant le début, en minutes. */
    offsetMinutes: { type: Number, required: true, min: 1 },
    /** Le début du rendez-vous / de la session visé par ce rappel. */
    appointmentStart: { type: Date, required: true },
    dueAt: { type: Date, required: true },
    /**
     * SENT     l'e-mail a été émis ;
     * SKIPPED  un rappel plus proche partait au même passage (serveur arrêté
     *          plusieurs heures) : on n'envoie pas deux rappels d'un coup ;
     * FAILED   l'événement a été refusé — `lastError` dit pourquoi.
     */
    status: { type: String, enum: ['SENT', 'SKIPPED', 'FAILED'], required: true },
    sentAt: { type: Date, default: null },
    lastError: { type: String, default: '' },
  },
  { timestamps: true },
);

appointmentReminderSchema.index({ targetKey: 1, offsetMinutes: 1, appointmentStart: 1 }, { unique: true });

export const AppointmentReminder = mongoose.model('AppointmentReminder', appointmentReminderSchema);
export default AppointmentReminder;
