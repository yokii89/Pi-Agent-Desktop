import { type Gsap, loadGsap, prefersReducedMotion } from "../../../utils/animation";
import { BUDDY_THINKING_MOTION as motion } from "../../../utils/motionTokens";

function createThinkingTimeline(gsap: Gsap, svg: SVGSVGElement) {
  const head = svg.querySelector('[data-part="head"]');
  const eyes = svg.querySelector('[data-part="eyes-thinking"]');
  const details = svg.querySelectorAll(
    '[data-part="ear-left"], [data-part="ear-right"], [data-part="tail"], [data-part="crest"], [data-part="orange"], [data-part="sprout"]',
  );
  const dots = svg.querySelectorAll('[data-part="thought-dot"]');
  const timeline = gsap.timeline({ paused: true, repeat: -1, defaults: { ease: motion.ease } });

  // 只写消费节点上的变量：保留各角色原有的 SVG 锚点，退出时 context 会恢复原始样式。
  if (head) {
    gsap.set(head, { "--buddy-think-angle": "2deg", "--buddy-think-lift": "-1px" });
    timeline
      .to(
        head,
        {
          "--buddy-think-angle": "5deg",
          "--buddy-think-lift": "-2px",
          duration: motion.lookDuration,
        },
        motion.lookAt,
      )
      .to(
        head,
        {
          "--buddy-think-angle": "-1deg",
          "--buddy-think-lift": "0px",
          duration: motion.settleDuration,
        },
        motion.settleAt,
      )
      .to(
        head,
        {
          "--buddy-think-angle": "2deg",
          "--buddy-think-lift": "-1px",
          duration: motion.returnDuration,
        },
        motion.returnAt,
      );
  }
  if (eyes) {
    gsap.set(eyes, { "--buddy-think-gaze-x": "1px", "--buddy-think-gaze-y": "-1px" });
    timeline
      .to(
        eyes,
        {
          "--buddy-think-gaze-x": "2px",
          "--buddy-think-gaze-y": "-2px",
          duration: motion.lookDuration,
        },
        motion.lookAt,
      )
      .to(
        eyes,
        {
          "--buddy-think-gaze-x": "0px",
          "--buddy-think-gaze-y": "0px",
          duration: motion.settleDuration,
        },
        motion.settleAt,
      )
      .to(
        eyes,
        {
          "--buddy-think-gaze-x": "1px",
          "--buddy-think-gaze-y": "-1px",
          duration: motion.returnDuration,
        },
        motion.returnAt,
      );
  }
  if (details.length) {
    gsap.set(details, { "--buddy-think-detail": 0 });
    timeline
      .to(details, { "--buddy-think-detail": 1, duration: motion.detailDuration }, motion.detailAt)
      .to(
        details,
        { "--buddy-think-detail": 0, duration: motion.detailReturnDuration },
        motion.detailReturnAt,
      );
  }
  if (dots.length) {
    gsap.set(dots, { "--buddy-thought-alpha": 0.5, "--buddy-thought-lift": "0px" });
    for (let round = 0; round < motion.dotRounds; round++) {
      dots.forEach((dot, index) => {
        const at = round * motion.dotCycle + index * motion.dotStagger;
        timeline
          .to(
            dot,
            {
              "--buddy-thought-alpha": 1,
              "--buddy-thought-lift": "-2px",
              duration: motion.dotRise,
            },
            at,
          )
          .to(
            dot,
            {
              "--buddy-thought-alpha": 0.5,
              "--buddy-thought-lift": "0px",
              duration: motion.dotFall,
            },
            at + motion.dotRise,
          );
      });
    }
  }
  // 留白也是节奏的一部分；不对身体 / 爪子补间，卡沿接触点始终固定。
  timeline.to({}, { duration: motion.cycle }, 0);
  return timeline;
}

/**
 * 挂载一份思考动效并返回完整清理函数。延迟加载、系统偏好和可见性都受同一生命周期约束；
 * 加载失败时由 CSS 保留静态思考姿态，退出后不留下内联样式影响其他表情。
 */
export function animateBuddyThinking(svg: SVGSVGElement): () => void {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  let disposed = false;
  let generation = 0;
  let inViewport = true;
  let context: ReturnType<Gsap["context"]> | null = null;
  let timeline: ReturnType<Gsap["timeline"]> | null = null;

  const stop = () => {
    generation++;
    context?.revert();
    context = null;
    timeline = null;
  };
  const syncVisibility = () => {
    timeline?.paused(document.hidden || !inViewport);
  };
  const syncPreference = () => {
    stop();
    if (media.matches || prefersReducedMotion()) return;
    const current = generation;
    void loadGsap()
      .then((gsap) => {
        if (disposed || current !== generation || media.matches || prefersReducedMotion()) return;
        context = gsap.context(() => {
          timeline = createThinkingTimeline(gsap, svg);
        }, svg);
        syncVisibility();
      })
      .catch(() => undefined);
  };
  const observer = new IntersectionObserver((entries) => {
    const entry = entries.find((candidate) => candidate.target === svg);
    if (!entry) return;
    inViewport = entry.isIntersecting;
    syncVisibility();
  });
  observer.observe(svg);
  document.addEventListener("visibilitychange", syncVisibility);
  media.addEventListener("change", syncPreference);
  syncPreference();

  return () => {
    disposed = true;
    stop();
    observer.disconnect();
    document.removeEventListener("visibilitychange", syncVisibility);
    media.removeEventListener("change", syncPreference);
  };
}
