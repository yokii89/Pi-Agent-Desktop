import { forwardRef } from "react";
import { useT } from "../../../../hooks/useT";
import type { OfficeSearchProvider } from "../../../../office/officeSearchTypes";
import { SearchPopover, type SearchPopoverHandle } from "../SearchPopover";
import { OfficeSearchPanel } from "./OfficeSearchPanel";

export type OfficeSearchPopoverHandle = SearchPopoverHandle;

interface OfficeSearchPopoverProps {
  provider: OfficeSearchProvider | null;
  onOpenChange: (open: boolean) => void;
}

/** Office search content inside the shared file-search popover. */
export const OfficeSearchPopover = forwardRef<OfficeSearchPopoverHandle, OfficeSearchPopoverProps>(
  function OfficeSearchPopover({ provider, onOpenChange }, ref) {
    const t = useT();
    return (
      <SearchPopover
        ref={ref}
        title={t("panels.files.office.searchTitle")}
        onOpenChange={onOpenChange}
      >
        {(close, focusTick) => (
          <OfficeSearchPanel provider={provider} focusTick={focusTick} onClose={close} />
        )}
      </SearchPopover>
    );
  },
);
