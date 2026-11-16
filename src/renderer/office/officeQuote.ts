import { t } from "../../shared/i18n";

export type OfficeQuoteLocation =
  | { kind: "docx"; page: number; headingPath: string[] }
  | { kind: "pptx"; page: number }
  | { kind: "spreadsheet"; sheet: string; range: string };

/** Keep the selected original text intact and distinguish reading pages from printed pagination. */
export function formatOfficeQuote(location: OfficeQuoteLocation, text: string): string {
  const lines: string[] = [];
  if (location.kind === "spreadsheet")
    lines.push(
      t("panels.files.office.quoteCells", { sheet: location.sheet, range: location.range }),
    );
  else if (location.kind === "pptx")
    lines.push(t("panels.files.office.slideNumber", { page: location.page }));
  else {
    if (location.headingPath.length)
      lines.push(
        t("panels.files.office.quoteHeading", { heading: location.headingPath.join(" › ") }),
      );
    lines.push(t("panels.files.office.quoteReadingPage", { page: location.page }));
  }
  return `${lines.join("\n")}\n${t("panels.files.office.quoteOriginal")}\n${text}`;
}
