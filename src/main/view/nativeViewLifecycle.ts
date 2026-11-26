let cleanup: (() => void) | undefined;

/** Register transport cleanup without importing Electron or the session service into the runtime manager. */
export function registerNativeViewCleanup(handler: () => void): void {
  cleanup = handler;
}

/** A runtime generation loses every View credential before fault listeners can reopen it. */
export function revokeRuntimeViews(): void {
  cleanup?.();
}
