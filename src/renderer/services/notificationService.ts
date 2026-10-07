import { t } from "../../shared/i18n";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATION_SCENARIO_LABEL_KEYS,
  type NotificationPlayRequest,
  type NotificationPushMessage,
  type NotificationScenarioId,
  type NotificationSettings,
  type NotificationSoundId,
  normalizeNotificationSettings,
  shouldPlayNotification,
} from "../../shared/notification";
import sound1 from "../assets/notification/1.mp3";
import sound2 from "../assets/notification/2.mp3";
import sound3 from "../assets/notification/3.mp3";
import sound4 from "../assets/notification/4.mp3";
import sound5 from "../assets/notification/5.mp3";
import { pideskApi } from "./pideskApi";
import { settingsService } from "./settingsService";

const SOUND_URLS: Record<NotificationSoundId, string> = {
  "1": sound1,
  "2": sound2,
  "3": sound3,
  "4": sound4,
  "5": sound5,
};

type ActiveSessionResolver = () => string | null | undefined;

/** 会话标题 / JSONL 路径解析（toast 文案与点击回跳用，由 useNotificationSounds 注册）。 */
export interface ToastSessionInfo {
  /** 会话展示标题；无则只用应用名。 */
  sessionTitle?: string;
  sessionFile?: string;
}

type ToastSessionResolver = (sessionId?: string) => ToastSessionInfo | null | undefined;

/**
 * 系统提示音播放（docs/design/18）+ 系统桌面 toast 请求（docs/design/24）。
 * 音频资源与焦点/active 会话语义在渲染层；toast 本体由主进程 Electron Notification 弹出。
 */
class NotificationService {
  #settings: NotificationSettings = {
    ...DEFAULT_NOTIFICATION_SETTINGS,
    scenarios: { ...DEFAULT_NOTIFICATION_SETTINGS.scenarios },
  };
  #ready = false;
  #lastPlayedAt = new Map<NotificationScenarioId, number>();
  #audio = new Map<NotificationSoundId, HTMLAudioElement>();
  #activeSessionResolver: ActiveSessionResolver | null = null;
  #toastSessionResolver: ToastSessionResolver | null = null;
  #pushBound = false;

  get settings(): NotificationSettings {
    return this.#settings;
  }

  /** 启动时拉取设置并订阅主进程推送（扩展 SDK notify）。 */
  async init(): Promise<void> {
    const loaded = await settingsService.get();
    if (loaded?.notification) {
      this.#settings = normalizeNotificationSettings(loaded.notification);
    }
    this.#ready = true;
    this.#bindPush();
  }

  setActiveSessionResolver(resolver: ActiveSessionResolver | null): void {
    this.#activeSessionResolver = resolver;
  }

  setToastSessionResolver(resolver: ToastSessionResolver | null): void {
    this.#toastSessionResolver = resolver;
  }

  /** 设置页写穿后同步内存配置。 */
  applySettings(next: NotificationSettings | null | undefined): void {
    this.#settings = normalizeNotificationSettings(next ?? DEFAULT_NOTIFICATION_SETTINGS);
    this.#ready = true;
  }

  /** 试听：绕过 enabled/焦点/防抖。 */
  preview(sound: NotificationSoundId): void {
    this.#playRaw(sound, this.#settings.volume);
  }

  /**
   * 按场景门禁播放声音，并在窗口未聚焦时请求桌面 toast。
   * `source === "preview"` 由 preview() 承担，这里不处理。
   */
  play(request: NotificationPlayRequest): boolean {
    if (request.source === "preview") {
      const sound = request.sound ?? this.#settings.scenarios[request.scenario]?.sound ?? "1";
      this.#playRaw(sound, this.#settings.volume);
      return true;
    }
    if (!this.#ready) {
      // 首帧尚未加载设置：用默认配置尽力播放，避免静默丢失关键错误音
      this.applySettings(DEFAULT_NOTIFICATION_SETTINGS);
    }
    const settings = this.#settings;
    const scenario = request.scenario;
    const now = Date.now();
    const debounceMs = settings.debounceMs;
    const last = this.#lastPlayedAt.get(scenario);
    if (debounceMs > 0 && last !== undefined && now - last < debounceMs) {
      return false;
    }

    const windowFocused = typeof document !== "undefined" ? document.hasFocus() : true;
    const activeSessionId = this.#activeSessionResolver?.() ?? null;
    const scenarioEnabled = settings.scenarios[scenario]?.enabled === true;
    const playSound =
      scenarioEnabled &&
      shouldPlayNotification({
        settings,
        scenario,
        windowFocused,
        sessionId: request.sessionId,
        activeSessionId,
        source: request.source,
      });
    // 桌面 toast 只在未聚焦时弹（docs/design/24）；与提示音总开关独立。
    // source=sdk：toast 归 Host（handleNotify）直弹，渲染层再弹会双响，且 SDK 的 toast 是 opt-in。
    const playToast =
      scenarioEnabled && settings.systemToast && !windowFocused && request.source !== "sdk";
    if (!playSound && !playToast) return false;

    this.#lastPlayedAt.set(scenario, now);

    if (playSound) {
      const sound =
        request.sound && isKnownSound(request.sound)
          ? request.sound
          : (settings.scenarios[scenario]?.sound ?? "1");
      this.#playRaw(sound, settings.volume);
    }
    if (playToast) {
      this.#requestToast(request);
    }
    return true;
  }

  /** 主进程已门禁的推送（扩展 SDK）：仍走焦点策略，但信任 Host 的 scenario 合法性。 */
  playFromHost(message: NotificationPushMessage): boolean {
    return this.play({
      scenario: message.scenario,
      sound: message.sound,
      sessionId: message.sessionId,
      reason: message.reason,
      source: message.source ?? "sdk",
    });
  }

  #requestToast(request: NotificationPlayRequest): void {
    const api = pideskApi();
    if (!api?.notification?.showToast) return;
    const info = this.#toastSessionResolver?.(request.sessionId) ?? {};
    const sessionLabel = info.sessionTitle?.trim();
    const title = sessionLabel
      ? t("notification.toast.title", { session: sessionLabel })
      : t("notification.toast.titleFallback");
    const body = t(NOTIFICATION_SCENARIO_LABEL_KEYS[request.scenario]);
    void api.notification
      .showToast({
        title,
        body,
        sessionId: request.sessionId,
        sessionFile: info.sessionFile,
      })
      .catch(() => {
        // 主进程不可达时静默：提示音路径已独立完成
      });
  }

  #bindPush(): void {
    if (this.#pushBound) return;
    const api = pideskApi();
    if (!api?.notification?.onPlay) return;
    this.#pushBound = true;
    api.notification.onPlay((message) => {
      this.playFromHost(message);
    });
  }

  #playRaw(sound: NotificationSoundId, volume: number): void {
    if (typeof window === "undefined") return;
    const url = SOUND_URLS[sound];
    if (!url) return;
    let audio = this.#audio.get(sound);
    if (!audio) {
      audio = new Audio(url);
      audio.preload = "auto";
      this.#audio.set(sound, audio);
    }
    try {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = Math.min(1, Math.max(0, volume));
      void audio.play().catch(() => {
        // 自动播放策略拒绝：等用户下一次交互后由场景再触发
      });
    } catch {
      // 音频元素异常不阻塞会话
    }
  }
}

function isKnownSound(value: string): value is NotificationSoundId {
  return value === "1" || value === "2" || value === "3" || value === "4" || value === "5";
}

export const notificationService = new NotificationService();
