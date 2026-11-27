import { ArrowDown, CaretRight, ChatCircleText, Robot } from "@phosphor-icons/react";
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ViewAgentEvent, ViewAgentNode } from "../../../shared/view";
import { useT } from "../../hooks/useT";
import { AssistantMessage } from "../SessionArea/AssistantMessage";
import { CustomNotice } from "../SessionArea/CustomNotice";
import streamStyles from "../SessionArea/SessionView.module.css";
import { StreamErrorCard } from "../SessionArea/StreamErrorCard";
import { UserMessage } from "../SessionArea/UserMessage";
import { Button } from "../ui/Button";
import { AgentStatus } from "./AgentStatus";
import styles from "./AgentWorkspace.module.css";
import { agentConversationEntries } from "./agentConversationEntries";
import { agentAncestry } from "./agentGraphLayout";

export interface AgentReadingPosition {
  top: number;
  follow: boolean;
}
interface Props {
  agent?: ViewAgentNode;
  agents: ViewAgentNode[];
  events: ViewAgentEvent[];
  ready: boolean;
  memory: AgentReadingPosition;
  onSelect: (id: string) => void;
  onLoadEarlier?: () => void;
}

export function AgentConversation({
  agent,
  agents,
  events,
  ready,
  memory,
  onSelect,
  onLoadEarlier,
}: Props) {
  const t = useT();
  const streamRef = useRef<HTMLElement>(null);
  const previousRef = useRef<{ first?: string; height: number } | null>(null);
  const programmedTop = useRef<number | null>(null);
  const [following, setFollowing] = useState(memory.follow);
  const entries = useMemo(() => agentConversationEntries(events), [events]);

  useLayoutEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    stream.scrollTop = memory.follow ? stream.scrollHeight : memory.top;
    programmedTop.current = stream.scrollTop;
    return () => {
      memory.top = stream.scrollTop;
    };
  }, [memory]);

  // Stable event ids let the reader prepend history without losing the visible message.
  useLayoutEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const previous = previousRef.current;
    const prepended =
      previous?.first &&
      events[0]?.id !== previous.first &&
      events.some((event) => event.id === previous.first);
    const nextTop = memory.follow
      ? stream.scrollHeight
      : prepended
        ? memory.top + stream.scrollHeight - previous.height
        : memory.top;
    stream.scrollTop = nextTop;
    programmedTop.current = stream.scrollTop;
    memory.top = stream.scrollTop;
    previousRef.current = { first: events[0]?.id, height: stream.scrollHeight };
  });

  const followLatest = (): void => {
    const stream = streamRef.current;
    memory.follow = !memory.follow;
    if (stream && memory.follow) {
      stream.scrollTop = stream.scrollHeight;
      memory.top = stream.scrollTop;
      programmedTop.current = stream.scrollTop;
    }
    setFollowing(memory.follow);
  };

  return (
    <section className={styles.detailPanel} aria-label={t("agentWorkspace.detail")}>
      <div className={styles.panelHeading}>
        <ChatCircleText size={16} weight="regular" />
        <span>{t("agentWorkspace.detail")}</span>
        <small>{t("agentWorkspace.stream")}</small>
      </div>
      {agent ? (
        <div className={styles.detailSummary} data-selectable-text="">
          <nav className={styles.trail} aria-label={t("agentWorkspace.ancestry")}>
            {agentAncestry(agents, agent.id).map((ancestor, index) => (
              <Fragment key={ancestor.id}>
                {index ? <CaretRight size={16} weight="regular" /> : null}
                {ancestor.id === agent.id ? (
                  <span>{ancestor.label}</span>
                ) : (
                  <button type="button" onClick={() => onSelect(ancestor.id)}>
                    {ancestor.label}
                  </button>
                )}
              </Fragment>
            ))}
          </nav>
          <div className={styles.detailRole}>
            <span>
              <Robot size={20} weight="regular" />
              {agent.label}
            </span>
            <AgentStatus state={agent.state} label={agent.stateLabel} />
          </div>
          <h3 className={styles.detailTask}>{agent.description}</h3>
          {agent.meta?.length ? (
            <div className={styles.detailMeta}>
              {[...new Set(agent.meta)].map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <section
        ref={streamRef}
        className={styles.conversation}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the scroll region needs keyboard access
        tabIndex={0}
        aria-label={t("agentWorkspace.stream")}
        aria-busy={!ready}
        data-agent-stream={agent?.id}
        data-selectable-text=""
        onScroll={(event) => {
          const stream = event.currentTarget;
          memory.top = stream.scrollTop;
          if (
            programmedTop.current !== null &&
            Math.abs(programmedTop.current - stream.scrollTop) < 1
          ) {
            programmedTop.current = null;
            return;
          }
          programmedTop.current = null;
          memory.follow = stream.scrollHeight - stream.clientHeight - stream.scrollTop < 40;
          setFollowing(memory.follow);
        }}
      >
        {!agent ? (
          <p className={styles.empty}>{t("agentWorkspace.noSelection")}</p>
        ) : !ready ? (
          <p className={styles.empty} role="status">
            {t("agentWorkspace.loading")}
          </p>
        ) : (
          <>
            {onLoadEarlier ? (
              <Button
                className={styles.earlierButton}
                onClick={() => {
                  memory.follow = false;
                  setFollowing(false);
                  onLoadEarlier();
                }}
              >
                {t("agentWorkspace.earlier")}
              </Button>
            ) : null}
            {events.length === 0 ? (
              <p className={styles.empty}>{t("agentWorkspace.noMessages")}</p>
            ) : (
              <div className={styles.conversationInner} data-stream-surface="">
                {entries.map((entry, index) => (
                  <div
                    key={entry.id}
                    className={streamStyles.entry}
                    data-kind={entry.kind}
                    data-entry-id={entry.id}
                    data-event-id={entry.id}
                  >
                    {entry.kind === "user" ? (
                      <UserMessage text={entry.text} />
                    ) : entry.kind === "assistant" ? (
                      <AssistantMessage
                        blocks={entry.blocks}
                        at={entry.at}
                        settled={
                          index < entries.length - 1 ||
                          (agent.state !== "running" && agent.state !== "queued")
                        }
                      />
                    ) : entry.kind === "custom" ? (
                      <CustomNotice entry={entry} />
                    ) : entry.kind === "error" ? (
                      <StreamErrorCard
                        entry={{ ...entry, title: entry.title || t("agentWorkspace.error") }}
                      />
                    ) : (
                      <p className={streamStyles.notice}>{entry.text}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>
      <div className={styles.conversationFooter}>
        <span>{t("agentWorkspace.retained")}</span>
        <button
          type="button"
          className={styles.followButton}
          aria-pressed={following}
          onClick={followLatest}
        >
          <ArrowDown size={16} weight="regular" />
          {t(following ? "agentWorkspace.follow" : "agentWorkspace.latest")}
        </button>
      </div>
    </section>
  );
}
