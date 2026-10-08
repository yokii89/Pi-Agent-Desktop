import styles from "./Toggle.module.css";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
}

/** 开关：设置页布尔项使用。 */
export function Toggle({ checked, onChange, disabled, ...rest }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={[styles.toggle, checked ? styles.on : ""].join(" ")}
      onClick={() => onChange(!checked)}
      {...rest}
    >
      <span className={styles.knob} />
    </button>
  );
}
