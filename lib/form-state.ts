/** State returned by server actions used with useActionState. */
export type FormState = {
  /** A general error shown above the form. */
  error?: string;
  /** Inline errors keyed by field name. */
  fieldErrors?: Record<string, string>;
  /** A success or info message. */
  message?: string;
  /** Manual cancellation: this slot is already on the board; ask before adding it again. */
  confirmDuplicate?: boolean;
  /** Public sign-up: this patient earlier replied STOP; ask whether texts should start again. */
  askSmsPreference?: { patientId: string };
  /** Staff waitlist form: the saved patient's number opted out of SMS earlier. Shown until staff close the dialog. */
  smsOptedOutNote?: string;
} | null;
