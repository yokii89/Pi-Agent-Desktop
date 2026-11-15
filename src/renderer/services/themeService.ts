import { resolveAccentColor } from "../../shared/accentColor";
import { unwrap } from "./ipc";
import { pideskApi } from "./pideskApi";

/** 订阅系统色并读取初值；先订阅，避免读取期间丢失变化或由旧快照覆盖新推送。 */
export function subscribeSystemAccentColor(callback: (color: string | null) => void): () => void {
  const api = pideskApi()?.theme;
  if (!api) return () => {};
  let disposed = false;
  let receivedChange = false;
  const unsubscribe = api.onSystemAccentColorChanged((color) => {
    if (disposed) return;
    receivedChange = true;
    callback(resolveAccentColor("system", color));
  });
  void unwrap(api.getSystemAccentColor())
    .catch(() => null)
    .then((color) => {
      if (!disposed && !receivedChange) callback(resolveAccentColor("system", color));
    });
  return () => {
    disposed = true;
    unsubscribe();
  };
}
