import { TerminalWindow } from "@phosphor-icons/react";
import { useT } from "../../hooks/useT";
import { bashJobState } from "../ExtensionView/bashWorkspaceState";
import type { BashJobsProjection, MonitorBashJob } from "./bashJobs";
import { MonitorRow } from "./MonitorRow";

export function MonitorBashJobs({
  jobs,
  workspaces,
  total,
  onOpen,
  onOpenWorkspace,
}: BashJobsProjection & {
  onOpen: (item: MonitorBashJob) => void;
  onOpenWorkspace: (viewId: string) => void;
}) {
  const t = useT();
  return (
    <>
      {jobs.map((item) => {
        const label = item.job.label || item.job.command;
        return (
          <MonitorRow
            key={`${item.entry.id}:${item.job.id}`}
            icon={<TerminalWindow size={16} weight="regular" />}
            text={label}
            title={item.job.command}
            trailing={
              item.job.status === "orphaned" && item.job.processState
                ? t(`bashWorkspace.restored.${item.job.processState}`)
                : t(`bashWorkspace.${bashJobState(item.job)}`)
            }
            onActivate={() => onOpen(item)}
            actionLabel={`${t("bashWorkspace.details")}: ${label}`}
          />
        );
      })}
      {total > jobs.length
        ? workspaces.map((entry) => (
            <MonitorRow
              key={`all:${entry.id}`}
              icon={<TerminalWindow size={16} weight="regular" />}
              text={t("bashWorkspace.viewAll")}
              title={entry.title}
              trailing={String(entry.root.counts.total)}
              onActivate={() => onOpenWorkspace(entry.id)}
              actionLabel={t("bashWorkspace.viewAll")}
            />
          ))
        : null}
    </>
  );
}
