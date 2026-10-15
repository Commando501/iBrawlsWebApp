/** A requested pause only holds the next job, never the simulation clock of a live trial. */
export class JobBoundary {
  paused = false;
  private wake: (() => void) | null = null;
  pause() { this.paused = true; }
  resume() { this.paused = false; this.wake?.(); }
  async wait(signal: AbortSignal): Promise<void> {
    if (!this.paused || signal.aborted) return;
    await new Promise<void>(resolve => {
      const done = () => { signal.removeEventListener('abort', done); this.wake = null; resolve(); };
      this.wake = done; signal.addEventListener('abort', done, { once: true });
    });
  }
}
