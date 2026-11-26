import { ArrowsClockwise } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ManagedSkillsIntent } from "../../../shared/managedSkillCommand";
import type {
  ManagedSkillOperation,
  ManagedSkillPlan,
  ManagedSkillsSnapshot,
} from "../../../shared/managedSkills";
import { useT } from "../../hooks/useT";
import { managedSkillsService } from "../../services/managedSkillsService";
import { managedSkillsNavigation } from "../../stores/managedSkillsNavigation";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Segmented } from "../ui/Segmented";
import { ManagedSkillDiagnostics } from "./ManagedSkillDiagnostics";
import { ManagedSkillPlanDialog } from "./ManagedSkillPlanDialog";
import styles from "./ManagedSkillsSection.module.css";

type Tab = ManagedSkillsIntent["tab"];

/** Desktop replacement for /skills: inspect, preview, confirm, then reconcile from disk. */
export function ManagedSkillsSection({
  projectDir,
  onOpenPath,
  onChanged,
}: {
  projectDir: string | null;
  onOpenPath(path: string): void;
  onChanged(): void;
}) {
  const t = useT();
  const [snapshot, setSnapshot] = useState<ManagedSkillsSnapshot | null>(null);
  const [tab, setTab] = useState<Tab>("manage");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<ManagedSkillPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const section = useRef<HTMLElement | null>(null);
  const readSeq = useRef(0);
  const operationSeq = useRef(0);
  const intent = useSyncExternalStore(
    managedSkillsNavigation.subscribe,
    managedSkillsNavigation.get,
  );
  const errorMessage = useCallback(
    (value: unknown) => {
      const code =
        value instanceof Error ? /^PIDESK_SKILLS:(\w+)$/.exec(value.message)?.[1] : undefined;
      return t(
        `skills.error.${code && ["stale", "invalid", "source", "recovery", "unavailable"].includes(code) ? code : "failed"}`,
      );
    },
    [t],
  );

  const refresh = useCallback(async () => {
    const sequence = ++readSeq.current;
    setLoading(true);
    try {
      const result = await managedSkillsService.list(projectDir);
      if (sequence === readSeq.current) {
        setSnapshot(result);
        setError(null);
      }
    } catch (value) {
      if (sequence === readSeq.current) {
        setSnapshot(null);
        setError(errorMessage(value));
      }
    } finally {
      if (sequence === readSeq.current) setLoading(false);
    }
  }, [projectDir, errorMessage]);

  useEffect(() => {
    setSnapshot(null);
    setPlan(null);
    setNotice(null);
    setBusy(false);
    void refresh();
    return () => {
      readSeq.current++;
      operationSeq.current++;
    };
  }, [refresh]);

  const preview = useCallback(
    async (operation: ManagedSkillOperation, name: string) => {
      const sequence = ++operationSeq.current;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const result = await managedSkillsService.plan({ operation, name, projectDir });
        if (sequence === operationSeq.current) setPlan(result);
      } catch (value) {
        if (sequence === operationSeq.current) setError(errorMessage(value));
      } finally {
        if (sequence === operationSeq.current) setBusy(false);
      }
    },
    [projectDir, errorMessage],
  );

  useEffect(() => {
    if (!intent) return;
    managedSkillsNavigation.consume(intent);
    setTab(intent.tab);
    section.current?.scrollIntoView({ block: "start" });
    if (intent.operation && intent.name) void preview(intent.operation, intent.name);
  }, [intent, preview]);

  const apply = async () => {
    if (!plan?.canApply || busy) return;
    const sequence = ++operationSeq.current;
    setBusy(true);
    let failure: string | null = null;
    try {
      const result = await managedSkillsService.apply(plan.id);
      if (sequence === operationSeq.current)
        setNotice(t(result.preserved ? "skills.preserved" : "skills.completed"));
      onChanged();
    } catch (value) {
      failure = errorMessage(value);
    } finally {
      if (sequence === operationSeq.current) {
        setPlan(null);
        await refresh();
        if (failure) setError(failure);
        setBusy(false);
      }
    }
  };
  const diagnostics = snapshot
    ? [...snapshot.diagnostics, ...snapshot.items.flatMap((item) => item.diagnostics)]
    : [];

  return (
    <section ref={section} className={styles.section} aria-label={t("skills.title")}>
      <div className={styles.heading}>
        <h2 className={styles.title}>{t("skills.title")}</h2>
        <span className={styles.note}>{t("skills.global")}</span>
        <IconButton
          title={t("common.refresh")}
          disabled={busy || loading}
          onClick={() => void refresh()}
        >
          <ArrowsClockwise size={16} weight="regular" />
        </IconButton>
      </div>
      <p className={styles.note}>{t("skills.subtitle")}</p>
      <Segmented
        semantics="tab"
        ariaLabel={t("skills.title")}
        value={tab}
        onChange={setTab}
        items={(["manage", "doctor", "manifest"] as const).map((value) => ({
          value,
          label: t(`skills.tab.${value}`),
        }))}
      />
      {error ? (
        <p role="alert" className={styles.error} data-selectable-text>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className={styles.notice} data-selectable-text>
          {notice}
        </p>
      ) : null}
      {loading ? <p className={styles.note}>{t("skills.loading")}</p> : null}
      {snapshot && tab === "manage" ? (
        <div className={styles.surface}>
          <ManagedSkillDiagnostics diagnostics={snapshot.diagnostics} />
          {snapshot.items.map((item) => (
            <article key={item.name} className={styles.item}>
              <div className={styles.heading}>
                <strong data-selectable-text>{item.name}</strong>
                <span className={styles.note}>
                  {t(
                    item.managed?.state === "orphaned-user-modified"
                      ? "skills.orphaned"
                      : item.managed
                        ? "skills.installed"
                        : "skills.notInstalled",
                  )}
                </span>
                {item.updateAvailable ? (
                  <span className={styles.warning}>{t("skills.updateAvailable")}</span>
                ) : null}
              </div>
              <p className={styles.note} data-selectable-text>
                {item.description}
              </p>
              <code className={styles.path} data-selectable-text>
                {item.target}
              </code>
              {item.managed ? (
                <p className={styles.note}>
                  {t(item.available ? "skills.available" : "skills.unavailable")}
                </p>
              ) : null}
              <ManagedSkillDiagnostics diagnostics={item.diagnostics} />
              <div className={styles.actions}>
                {(item.managed
                  ? (["update", "repair", "uninstall"] as const)
                  : (["install"] as const)
                ).map((operation) => (
                  <Button
                    key={operation}
                    disabled={
                      busy ||
                      loading ||
                      (!item.bundled && operation !== "uninstall") ||
                      (operation === "update" && !item.updateAvailable)
                    }
                    onClick={() => void preview(operation, item.name)}
                  >
                    {t(`skills.operation.${operation}`)}
                  </Button>
                ))}
                {item.managed ? (
                  <Button onClick={() => onOpenPath(item.target)}>{t("skills.openFolder")}</Button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}
      {snapshot && tab === "doctor" ? (
        <div className={styles.surface}>
          <p className={styles.note}>{t("skills.doctorNote")}</p>
          {diagnostics.length ? (
            <ManagedSkillDiagnostics diagnostics={diagnostics} />
          ) : (
            <p className={styles.notice}>{t("skills.healthy")}</p>
          )}
        </div>
      ) : null}
      {snapshot && tab === "manifest" ? (
        <div className={styles.surface} data-selectable-text>
          <code className={styles.path}>{snapshot.manifestPath}</code>
          <p className={styles.note}>{t("skills.manifestNote")}</p>
          <pre className={styles.manifest}>
            {snapshot.manifest
              ? JSON.stringify(snapshot.manifest, null, 2)
              : t("skills.manifestInvalid")}
          </pre>
        </div>
      ) : null}
      <ManagedSkillPlanDialog
        plan={plan}
        busy={busy}
        onCancel={() => setPlan(null)}
        onConfirm={() => void apply()}
      />
    </section>
  );
}
