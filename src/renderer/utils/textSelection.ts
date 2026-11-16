/** Selection adapters let virtualized text surfaces use the shared selection toolbar. */
export interface TextSelectionSnapshot {
  rect: Pick<DOMRect, "left" | "top" | "bottom" | "width">;
  getText(): string;
  /** Optional source metadata captured with this selection; clipboard copies still use getText(). */
  getQuoteText?(): string;
}

/** Text and geometry come from the owning surface rather than its rendered DOM. */
export interface TextSelectionSource {
  read(): TextSelectionSnapshot | null;
  clear(): void;
  subscribe(listener: () => void): () => void;
}
