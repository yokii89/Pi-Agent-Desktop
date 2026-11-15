import type { ComponentType } from "react";
import type { InputBuddyCharacter, InputBuddyKind } from "../../../../shared/inputBuddy";
import { BuddyBear } from "./BuddyBear";
import { BuddyCapy } from "./BuddyCapy";
import { BuddyCat } from "./BuddyCat";
import { BuddyDog } from "./BuddyDog";
import { BuddyFox } from "./BuddyFox";
import { BuddyHamster } from "./BuddyHamster";
import { BuddyKoala } from "./BuddyKoala";
import { BuddyPanda } from "./BuddyPanda";
import { BuddyParrot } from "./BuddyParrot";
import { BuddyPea } from "./BuddyPea";
import { BuddyRabbit } from "./BuddyRabbit";
import { BuddyRaccoon } from "./BuddyRaccoon";
import { BuddySteve } from "./BuddySteve";
import type { BuddyArtworkProps } from "./BuddySvg";

// Record 让新增持久化 id 却漏接插画成为编译错误；设置与会话不再各维护一份分支。
const BUDDY_ARTWORK: Record<InputBuddyCharacter, ComponentType<BuddyArtworkProps>> = {
  dog: BuddyDog,
  cat: BuddyCat,
  parrot: BuddyParrot,
  capy: BuddyCapy,
  pea: BuddyPea,
  steve: BuddySteve,
  fox: BuddyFox,
  rabbit: BuddyRabbit,
  panda: BuddyPanda,
  raccoon: BuddyRaccoon,
  hamster: BuddyHamster,
  bear: BuddyBear,
  koala: BuddyKoala,
};

/** 设置预览与会话伙伴共用的纯插画入口，none 不产生 DOM。 */
export function BuddyArt({ kind, pose, animated }: BuddyArtworkProps & { kind: InputBuddyKind }) {
  if (kind === "none") return null;
  const Artwork = BUDDY_ARTWORK[kind];
  return <Artwork pose={pose} animated={animated} />;
}
