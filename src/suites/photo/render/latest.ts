/**
 * Slow work for whatever is wanted now, never for what was (rendering.md: "A stale result is never shown as
 * current"). One job runs at a time; a job is told when it's no longer wanted, so it can stop early; a result is
 * kept only if its key is still the one wanted when it finishes, and then the next wanted key starts. A job that
 * gives up (null) or fails while still wanted isn't tried again until another key has been wanted. Pure of the
 * GPU, so it's tested with jobs that finish in any order.
 */
export type Job<R> = (isCurrent: () => boolean) => Promise<R | null>;

export class LatestOnly<R> {
  private wanted: { key: string; job: Job<R> } | null = null;
  private running: string | null = null;
  private done: { key: string; result: R } | null = null;
  /** A key whose job gave up or failed while it was wanted. */
  private failed: string | null = null;

  /** `onDone` hears each result kept (its key was still wanted). */
  constructor(private readonly onDone: (key: string, result: R) => void) {}

  /** Wants `key` (made by `job` if it isn't already), or nothing. A running job for another key is told to stop. */
  want(key: string | null, job?: Job<R>) {
    if (key !== this.failed) this.failed = null;
    this.wanted = key && job ? { key, job } : null;
    this.next();
  }

  /** The kept result for `key`, if that's the last one kept. */
  resultFor(key: string): R | null {
    return this.done?.key === key ? this.done.result : null;
  }

  /** Whether `key` is being made now. */
  isRunning(key: string) {
    return this.running === key;
  }

  /** Forgets the kept result (its resources are gone: a lost device). */
  reset() {
    this.done = null;
  }

  private next() {
    const wanted = this.wanted;
    if (!wanted || this.running !== null || this.done?.key === wanted.key || this.failed === wanted.key) return;
    this.running = wanted.key;
    const isCurrent = () => this.wanted?.key === wanted.key;
    void wanted
      .job(isCurrent)
      .catch(() => null)
      .then((result) => {
        this.running = null;
        if (result !== null && isCurrent()) {
          this.done = { key: wanted.key, result };
          this.onDone(wanted.key, result);
        } else if (isCurrent()) this.failed = wanted.key;
        this.next();
      });
  }
}
