import { useEffect, useState } from "react";
import { peekFavicon, requestFavicon } from "../services/faviconService";

/**
 * 站点 favicon（data URL）：加载中 / 失败 / 非 http(s) 为 null。
 * 已成功抓过的站点走 `peekFavicon` 同步取值，首帧即有图（切会话、翻历史不闪兜底图标）。
 */
export function useFavicon(pageUrl: string | null | undefined): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(() => peekFavicon(pageUrl));
  useEffect(() => {
    const known = peekFavicon(pageUrl);
    if (known) {
      setDataUrl(known);
      return;
    }
    if (!pageUrl) {
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    void requestFavicon(pageUrl).then((result) => {
      if (!cancelled) setDataUrl(result);
    });
    return () => {
      cancelled = true;
    };
  }, [pageUrl]);
  return dataUrl;
}
