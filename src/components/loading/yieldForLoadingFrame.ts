/** Give progress a chance to paint without requiring a foreground browser tab. */
export function yieldForLoadingFrame(): Promise<void> {
  return new Promise((resolve) => {
    let frame: number | undefined;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (frame !== undefined) cancelAnimationFrame(frame);
      resolve();
    };
    // Background tabs can suspend animation frames entirely. Keep scene loading
    // moving so a hidden host cannot hold every other player at the ready gate.
    const timeout = setTimeout(finish, typeof requestAnimationFrame === 'function' ? 100 : 0);
    if (typeof requestAnimationFrame === 'function') {
      // The first frame's promise continuation runs before paint; use a second.
      frame = requestAnimationFrame(() => {
        if (!finished) frame = requestAnimationFrame(finish);
      });
    }
  });
}
