import type { FsReadOfficeResult } from "../../../src/shared/ipc";

declare global {
  interface Window {
    officeBenchmark: {
      read(name: string): Promise<FsReadOfficeResult>;
      metrics(): Promise<unknown>;
    };
  }
}
