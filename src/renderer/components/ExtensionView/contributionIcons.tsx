import {
  Calendar,
  ChartLine,
  ChatCircle,
  CheckCircle,
  ClipboardText,
  Code,
  Database,
  Envelope,
  Folder,
  Gear,
  GearSix,
  GitPullRequest,
  Globe,
  type Icon,
  Info,
  ListChecks,
  PuzzlePiece,
  Robot,
  Shield,
  ShieldCheck,
  Sliders,
  Sparkle,
  TerminalWindow,
  Warning,
} from "@phosphor-icons/react";
import type { ContributionIconName } from "../../../shared/contribution";

/**
 * manifest.icon / mode.icon 的宿主映射。
 *
 * `Record<ContributionIconName, Icon>` 是白名单与渲染层的锁步断言：
 * 往共享白名单加名字而忘了补映射，TypeScript 会在这里报缺键。
 */
const CONTRIBUTION_ICONS: Record<ContributionIconName, Icon> = {
  shield: Shield,
  "shield-check": ShieldCheck,
  clipboard: ClipboardText,
  gear: Gear,
  "gear-six": GearSix,
  sliders: Sliders,
  "puzzle-piece": PuzzlePiece,
  sparkle: Sparkle,
  warning: Warning,
  "check-circle": CheckCircle,
  info: Info,
  folder: Folder,
  globe: Globe,
  "git-pull-request": GitPullRequest,
  "terminal-window": TerminalWindow,
  "chat-circle": ChatCircle,
  robot: Robot,
  database: Database,
  code: Code,
  "list-checks": ListChecks,
  calendar: Calendar,
  envelope: Envelope,
  "chart-line": ChartLine,
};

/** 未知/缺省名字回落到 PuzzlePiece，与扩展面板的通用身份一致。 */
export function contributionIconComponent(name: string | undefined): Icon {
  if (name && Object.hasOwn(CONTRIBUTION_ICONS, name)) {
    return CONTRIBUTION_ICONS[name as ContributionIconName];
  }
  return PuzzlePiece;
}

export function ContributionIcon({
  name,
  size = 16,
  weight = "regular",
}: {
  name: string | undefined;
  size?: number;
  weight?: "regular" | "fill";
}) {
  const IconComponent = contributionIconComponent(name);
  return <IconComponent size={size} weight={weight} />;
}
