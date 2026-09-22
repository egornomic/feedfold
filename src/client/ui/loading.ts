import { useEffect, useState } from "react";

export function useDelayedPending(pending: boolean, key: string | number | null) {
  const [revealed, setRevealed] = useState<{ key: typeof key } | null>(null);

  useEffect(() => {
    setRevealed(null);
    if (!pending) return;
    const timer = window.setTimeout(() => setRevealed({ key }), 300);
    return () => window.clearTimeout(timer);
  }, [key, pending]);

  return pending && revealed !== null && revealed.key === key;
}
