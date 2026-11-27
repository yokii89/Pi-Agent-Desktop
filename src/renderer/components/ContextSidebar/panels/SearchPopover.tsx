import { MagnifyingGlass } from "@phosphor-icons/react";
import {
  forwardRef,
  type ReactNode,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { IconButton } from "../../ui/IconButton";
import { Popover } from "../../ui/Popover";
import styles from "./SearchPopover.module.css";

export interface SearchPopoverHandle {
  openSearch(): void;
  closeSearch(): void;
}

interface SearchPopoverProps {
  title: string;
  onOpenChange: (open: boolean) => void;
  children: (close: () => void, focusTick: number) => ReactNode;
}

/** Shared anchored Ctrl+F shell for file previews. */
export const SearchPopover = forwardRef<SearchPopoverHandle, SearchPopoverProps>(
  function SearchPopover({ title, onOpenChange, children }, ref) {
    const [focusTick, setFocusTick] = useState(0);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const closeRef = useRef<(() => void) | null>(null);
    const openRef = useRef(false);

    const openSearch = useCallback((): void => {
      if (openRef.current) {
        setFocusTick((value) => value + 1);
        return;
      }
      triggerRef.current?.click();
      setFocusTick((value) => value + 1);
    }, []);
    const closeSearch = useCallback((): void => {
      closeRef.current?.();
    }, []);
    useImperativeHandle(ref, () => ({ openSearch, closeSearch }), [openSearch, closeSearch]);

    const handleOpenChange = useCallback(
      (open: boolean): void => {
        openRef.current = open;
        onOpenChange(open);
      },
      [onOpenChange],
    );

    return (
      <Popover
        align="right"
        direction="bottom"
        rootClassName={styles.root}
        panelClassName={styles.panel}
        onOpenChange={handleOpenChange}
        closeOnOutsideClick={false}
        closeOnScroll={false}
        trigger={({ open, onClick, close }) => {
          openRef.current = open;
          closeRef.current = close;
          return (
            <IconButton ref={triggerRef} title={title} active={open} onClick={onClick}>
              <MagnifyingGlass size={16} weight="regular" />
            </IconButton>
          );
        }}
      >
        {(close) => children(close, focusTick)}
      </Popover>
    );
  },
);
