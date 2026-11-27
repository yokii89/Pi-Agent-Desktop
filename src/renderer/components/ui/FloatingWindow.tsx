import { X } from "@phosphor-icons/react";
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useGlideOverlay } from "../../hooks/useGlideOverlay";
import { useT } from "../../hooks/useT";
import {
  type FloatingWindowMemory,
  type FloatingWindowRect,
  type FloatingWindowSize,
  fitFloatingWindow,
} from "../../utils/floatingWindowGeometry";
import styles from "./FloatingWindow.module.css";
import { IconButton } from "./IconButton";

const DEFAULT_SIZE: FloatingWindowSize = { width: 720, height: 560 };
const MINIMUM_SIZE: FloatingWindowSize = { width: 560, height: 400 };

interface PointerSession {
  pointerId: number;
  startX: number;
  startY: number;
  origin: FloatingWindowRect;
}

interface FloatingWindowProps {
  title: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  memory: FloatingWindowMemory;
  initialSize?: FloatingWindowSize;
  minimumSize?: FloatingWindowSize;
  closeLabel?: string;
  onClose: () => void;
}

/** Nonmodal tool window shared by Review and extension workspaces. */
export function FloatingWindow({
  title,
  icon,
  actions,
  children,
  memory,
  initialSize = DEFAULT_SIZE,
  minimumSize = MINIMUM_SIZE,
  closeLabel,
  onClose,
}: FloatingWindowProps) {
  const t = useT();
  const fitViewport = (rect: FloatingWindowRect): FloatingWindowRect =>
    fitFloatingWindow(rect, { width: window.innerWidth, height: window.innerHeight }, minimumSize);
  const [rect, setRect] = useState<FloatingWindowRect>(() =>
    fitViewport(
      memory.rect ?? {
        left: (window.innerWidth - initialSize.width) / 2,
        top: (window.innerHeight - initialSize.height) / 2 - 40,
        ...initialSize,
      },
    ),
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<PointerSession | null>(null);
  const resizeRef = useRef<PointerSession | null>(null);
  const overlay = useGlideOverlay(panelRef);
  const closing = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const close = (): void => {
    if (closing.current) return;
    closing.current = true;
    overlay.exit(() => closeRef.current());
  };

  useLayoutEffect(() => {
    const previousFocus = document.activeElement;
    overlay.prime();
    overlay.enter();
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [overlay]);

  useLayoutEffect(() => {
    memory.rect = rect;
  }, [memory, rect]);

  useEffect(() => {
    const onResize = (): void => {
      dragRef.current = null;
      resizeRef.current = null;
      setRect((current) =>
        fitFloatingWindow(
          current,
          { width: window.innerWidth, height: window.innerHeight },
          minimumSize,
        ),
      );
    };
    const endPointer = (): void => {
      dragRef.current = null;
      resizeRef.current = null;
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("blur", endPointer);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("blur", endPointer);
    };
  }, [minimumSize]);

  const startPointer = (event: ReactPointerEvent<HTMLElement>): PointerSession | null => {
    if (event.button !== 0) return null;
    event.preventDefault();
    panelRef.current?.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    return {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: rect,
    };
  };

  const endDrag = (): void => {
    dragRef.current = null;
  };
  const endResize = (): void => {
    resizeRef.current = null;
  };

  return createPortal(
    <div
      ref={panelRef}
      className={styles.window}
      role="dialog"
      aria-label={title}
      tabIndex={-1}
      data-floating-window=""
      style={rect}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        if (!panelRef.current?.contains(document.activeElement)) return;
        event.stopPropagation();
        close();
      }}
    >
      <header
        className={styles.header}
        onPointerDown={(event) => {
          if ((event.target as Element).closest("button, input, textarea, select, a")) return;
          dragRef.current = startPointer(event);
        }}
        onPointerMove={(event) => {
          const session = dragRef.current;
          if (!session || session.pointerId !== event.pointerId) return;
          setRect(
            fitViewport({
              ...session.origin,
              left: session.origin.left + event.clientX - session.startX,
              top: session.origin.top + event.clientY - session.startY,
            }),
          );
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        <span className={styles.title}>
          {icon}
          {title}
        </span>
        {actions}
        <IconButton title={closeLabel ?? t("common.close")} onClick={close}>
          <X size={16} weight="regular" />
        </IconButton>
      </header>
      <div className={styles.body}>{children}</div>
      <div
        className={styles.resizeHandle}
        onPointerDown={(event) => {
          resizeRef.current = startPointer(event);
        }}
        onPointerMove={(event) => {
          const session = resizeRef.current;
          if (!session || session.pointerId !== event.pointerId) return;
          setRect(
            fitViewport({
              ...session.origin,
              width: session.origin.width + event.clientX - session.startX,
              height: session.origin.height + event.clientY - session.startY,
            }),
          );
        }}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onLostPointerCapture={endResize}
      />
    </div>,
    document.body,
  );
}
