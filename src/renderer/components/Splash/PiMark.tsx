import styles from "./PiMark.module.css";

/** pi 官方三色标志（pi.dev/logo.svg）；viewBox 已裁到标志本体。 */
export function PiMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="165.29 165.29 469.43 469.43"
      aria-hidden="true"
      focusable="false"
    >
      <path className={styles.coral} d="M165.29 165.29H517.36V400H400V282.65H165.29Z" />
      <path
        className={styles.blue}
        d="M165.29 282.65H282.65V400H400V517.36H282.65V634.72H165.29Z"
      />
      <path className={styles.yellow} d="M517.36 400H634.72V634.72H517.36Z" />
    </svg>
  );
}
