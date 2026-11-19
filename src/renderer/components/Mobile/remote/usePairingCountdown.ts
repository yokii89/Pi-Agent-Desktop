import { useEffect, useState } from "react";

/** Follow the relay's expiry time; never extend an invitation when the panel remounts. */
export function usePairingCountdown(expiresAt: string | null): number {
  const [now, setNow] = useState(Date.now);
  const deadline = expiresAt ? Date.parse(expiresAt) : 0;
  useEffect(() => {
    if (!Number.isFinite(deadline) || deadline <= 0) return;
    const update = () => setNow(Date.now());
    update();
    const timer = setInterval(update, 1_000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [deadline]);
  return Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now) / 1_000)) : 0;
}
