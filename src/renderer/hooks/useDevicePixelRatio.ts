import { useEffect, useState } from "react";

/** Re-render pixel surfaces when moving between displays or changing browser zoom. */
export function useDevicePixelRatio(): number {
  const [ratio, setRatio] = useState(() => window.devicePixelRatio || 1);
  useEffect(() => {
    let query: MediaQueryList;
    const update = (): void => {
      const nextRatio = window.devicePixelRatio || 1;
      setRatio(nextRatio);
      query?.removeEventListener("change", update);
      query = window.matchMedia(`(resolution: ${nextRatio}dppx)`);
      query.addEventListener("change", update);
    };
    update();
    window.addEventListener("resize", update);
    return () => {
      query.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return ratio;
}
