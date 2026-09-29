/** A caught value's message, for toasts, logs and API errors. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
