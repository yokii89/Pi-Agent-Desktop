import { useCallback, useEffect, useRef, useState } from "react";
import type { PideskSettings } from "../../../shared/ipc";
import {
  DEFAULT_SPLASH_LOGO_SIZE,
  DEFAULT_SPLASH_SPEED,
  DEFAULT_SPLASH_TEXT_EN,
  DEFAULT_SPLASH_TEXT_SUB,
  DEFAULT_SPLASH_TEXT_ZH,
  resolveSplashFontStack,
  SPLASH_PREVIEW_EVENT,
  type SplashConfig,
} from "../../../shared/splash";
import { settingsService } from "../../services/settingsService";
import { SplashScreen } from "./SplashScreen";

const SHOWN_KEY = "pidesk:splash:shown";

function removeBootCurtain(): void {
  document.getElementById("boot-curtain")?.remove();
}

function configFromSettings(settings: PideskSettings | null): SplashConfig {
  return {
    logoImage: settings?.splashLogoImage ?? "",
    logoSize: settings?.splashLogoSize ?? DEFAULT_SPLASH_LOGO_SIZE,
    fontStack: resolveSplashFontStack(settings?.splashFontPreset),
    textZh: settings?.splashTextZh ?? DEFAULT_SPLASH_TEXT_ZH,
    textEn: settings?.splashTextEn ?? DEFAULT_SPLASH_TEXT_EN,
    textSub: settings?.splashTextSub ?? DEFAULT_SPLASH_TEXT_SUB,
    speed: settings?.splashSpeed ?? DEFAULT_SPLASH_SPEED,
  };
}

interface SplashRun {
  id: number;
  config: SplashConfig;
  /** 自然启动要记「本窗口已播」；设置页预览不记。 */
  markShown: boolean;
}

/**
 * 启动动画门卫：启动时按设置决定播不播；设置页「立即预览」通过
 * `SPLASH_PREVIEW_EVENT` 强制播一次（不看开关与已播标记）。
 */
export function SplashGate() {
  const [run, setRun] = useState<SplashRun | null>(null);
  const runIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void settingsService.get().then((settings) => {
      if (cancelled) return;
      let alreadyShown = false;
      try {
        alreadyShown = sessionStorage.getItem(SHOWN_KEY) === "1";
      } catch {
        // 隐私模式不可写，按未播处理
      }
      if (!settings || settings.splashEnabled === false || alreadyShown) {
        removeBootCurtain();
        return;
      }
      runIdRef.current += 1;
      setRun({ id: runIdRef.current, config: configFromSettings(settings), markShown: true });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onPreview = (): void => {
      void settingsService.get().then((settings) => {
        runIdRef.current += 1;
        setRun({ id: runIdRef.current, config: configFromSettings(settings), markShown: false });
      });
    };
    window.addEventListener(SPLASH_PREVIEW_EVENT, onPreview);
    return () => window.removeEventListener(SPLASH_PREVIEW_EVENT, onPreview);
  }, []);

  const finish = useCallback((markShown: boolean): void => {
    if (markShown) {
      try {
        sessionStorage.setItem(SHOWN_KEY, "1");
      } catch {
        // 写不进去也不影响揭幕
      }
    }
    setRun(null);
    removeBootCurtain();
  }, []);

  if (!run) return null;
  return <SplashScreen key={run.id} config={run.config} onDone={() => finish(run.markShown)} />;
}
