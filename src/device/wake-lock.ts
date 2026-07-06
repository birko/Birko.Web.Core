// Screen Wake Lock manager. The re-acquire-on-visibility and in-flight-guard bits are the subtle
// pieces every consumer gets wrong, so they live here once. Minimal Wake Lock typings are declared
// locally — not every TS DOM lib ships them.

interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}
interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

export interface WakeLockManager {
  /** Keep the screen awake, transparently re-acquiring after the page returns to the foreground. */
  acquire(): void;
  /** Release the lock and stop re-acquiring. Safe to call when none is held. */
  release(): void;
  /** Whether a lock is currently held. */
  readonly held: boolean;
}

/**
 * Creates a Screen Wake Lock manager: keeps the display awake while acquired and re-acquires on
 * `visibilitychange` (the browser drops the lock whenever the page is hidden), guarding against a
 * duplicate in-flight request so a sentinel can't leak. Entirely best-effort — a no-op when the
 * Wake Lock API is unsupported or the request is denied (battery saver, page not visible, …), so
 * callers never have to feature-detect. Pair every {@link WakeLockManager.acquire} with a
 * {@link WakeLockManager.release} when the keep-awake need ends.
 */
export function createWakeLockManager(): WakeLockManager {
  let sentinel: WakeLockSentinelLike | null = null;
  let wanted = false;
  let listenerBound = false;
  let requesting = false;

  async function requestNow(): Promise<void> {
    // Guard a second in-flight request (e.g. visibilitychange firing while the first is pending):
    // `sentinel` isn't assigned until the await resolves, so without `requesting` both calls would
    // pass and one sentinel would leak, held until the page hides.
    if (sentinel || requesting) return;
    const wl = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
    if (!wl) return;
    requesting = true;
    try {
      const s = await wl.request('screen');
      // The browser auto-releases when the page is hidden; drop our stale ref on release so the
      // visibility handler re-requests a fresh one on return.
      s.addEventListener('release', () => { if (sentinel === s) sentinel = null; });
      if (wanted && document.visibilityState === 'visible') sentinel = s;
      else void s.release(); // released between request and resolution — don't keep it
    } catch {
      /* unsupported / denied — degrade silently */
    } finally {
      requesting = false;
    }
  }

  function onVisibility(): void {
    if (wanted && document.visibilityState === 'visible') void requestNow();
  }

  return {
    acquire(): void {
      wanted = true;
      if (!listenerBound) {
        document.addEventListener('visibilitychange', onVisibility);
        listenerBound = true;
      }
      void requestNow();
    },
    release(): void {
      wanted = false;
      if (listenerBound) {
        document.removeEventListener('visibilitychange', onVisibility);
        listenerBound = false;
      }
      const s = sentinel;
      sentinel = null;
      try { void s?.release(); } catch { /* already released */ }
    },
    get held(): boolean {
      return sentinel !== null;
    },
  };
}
