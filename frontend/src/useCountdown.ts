import { useCallback, useEffect, useState } from 'react';

/**
 * Countdown that does not trust the counter's clock.
 *
 * The kiosk's wall clock (Date.now) can be minutes wrong, so we never compare against the
 * server's expiresAt. Instead the server tells us "seconds left", and we count down using
 * performance.now(), which measures elapsed time on a monotonic timer and is not affected by
 * what time the device thinks it is (or by someone changing it).
 *
 * The deadline is anchored to when the request was SENT. The server measured the seconds
 * somewhere between send and receive, so this can only make the countdown a little shorter
 * than the real hold, never longer.
 */
export function useCountdown() {
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(timer);
  }, []);

  /** Call with the server's expiresInSeconds and the performance.now() taken before the request. */
  const sync = useCallback((expiresInSeconds: number, requestSentAt: number) => {
    setDeadline(requestSentAt + expiresInSeconds * 1000);
  }, []);

  const secondsLeft = deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));
  return { secondsLeft, sync };
}

export function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
