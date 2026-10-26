/** State returned by server actions used with useActionState. */
export type FormState = {
  /** A general error shown above the form. */
  error?: string;
  /** Inline errors keyed by field name. */
  fieldErrors?: Record<string, string>;
  /** A success or info message. */
  message?: string;
} | null;
