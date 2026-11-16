import { ArrowRight } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useT } from "../../../../hooks/useT";
import { parseOfficePage } from "../../../../office/officeSearch";
import { IconButton } from "../../../ui/IconButton";
import styles from "./OfficePageJump.module.css";

/** Explicit page navigation; invalid input never silently jumps to a different page. */
export function OfficePageJump({
  page,
  total,
  onChange,
  kind,
}: {
  page: number;
  total: number;
  onChange: (index: number) => void;
  kind: "docx" | "pptx" | "rows";
}) {
  const t = useT();
  const [value, setValue] = useState(String(page + 1));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setValue(String(page + 1));
    setInvalid(false);
  }, [page]);
  const submit = (): void => {
    const next = parseOfficePage(value, total);
    setInvalid(next === null);
    if (next !== null) onChange(next);
  };
  return (
    <form
      className={styles.jump}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label>
        <span>
          {t(
            kind === "pptx"
              ? "panels.files.office.slideLabel"
              : kind === "rows"
                ? "panels.files.office.rowBatch"
                : "panels.files.office.readingPage",
          )}
        </span>
        <input
          aria-label={t("panels.files.office.jumpPage")}
          aria-invalid={invalid || undefined}
          inputMode="numeric"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setInvalid(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setValue(String(page + 1));
              setInvalid(false);
            }
          }}
          title={invalid ? t("panels.files.office.invalidPage", { total }) : undefined}
        />
        <span>/ {total}</span>
      </label>
      <IconButton title={t("panels.files.office.goPage")} onClick={submit}>
        <ArrowRight size={16} weight="regular" />
      </IconButton>
    </form>
  );
}
