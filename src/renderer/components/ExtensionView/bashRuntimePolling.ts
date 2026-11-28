import type { BashJobRuntime } from "../../../shared/bashWorkspace";

const REFRESH_MS = 3_000;
const MEMORY_SAMPLE_LIMIT = 20;

export interface RuntimeSnapshot {
  key: string | null;
  value: BashJobRuntime | null;
  error: string | null;
  loading: boolean;
  active: boolean;
  memory: readonly number[];
}

type Inspect = (viewId: string, jobId: string) => Promise<BashJobRuntime>;
type Listener = (state: RuntimeSnapshot) => void;

/** One serialized sampler survives React effect replay and switches of the selected job. */
export function createRuntimeSampler(inspect: Inspect) {
  let state: RuntimeSnapshot = {
    key: null,
    value: null,
    error: null,
    loading: false,
    active: false,
    memory: [],
  };
  let target: { viewId: string; jobId: string } | null = null;
  let listener: Listener | null = null;
  let generation = 0;
  let inFlight = false;
  let requested = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const emit = (): void => listener?.(state);
  const clearTimer = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const run = async (): Promise<void> => {
    if (!target || !state.active || !requested || inFlight) return;
    clearTimer();
    const current = target;
    const version = generation;
    requested = false;
    inFlight = true;
    state = { ...state, loading: true };
    emit();
    try {
      const value = await inspect(current.viewId, current.jobId);
      if (version !== generation || !state.active) return;
      const sample = value.memoryBytes;
      const memory =
        value.alive && Number.isFinite(sample) && sample >= 0
          ? [...state.memory, sample].slice(-MEMORY_SAMPLE_LIMIT)
          : state.memory;
      state = { ...state, value, error: null, memory };
    } catch (error) {
      if (version !== generation || !state.active) return;
      state = { ...state, error: error instanceof Error ? error.message : String(error) };
    } finally {
      inFlight = false;
      if (version === generation) {
        state = { ...state, loading: false };
        emit();
      }
      if (requested) {
        void run();
      } else if (state.active && state.value?.alive !== false) {
        timer = setTimeout(() => {
          requested = true;
          void run();
        }, REFRESH_MS);
      }
    }
  };

  return {
    getState: (): RuntimeSnapshot => state,
    subscribe(next: Listener | null): void {
      listener = next;
      emit();
    },
    select(viewId: string, jobId: string): void {
      const key = JSON.stringify([viewId, jobId]);
      if (key === state.key) return;
      generation += 1;
      clearTimer();
      target = { viewId, jobId };
      state = { key, value: null, error: null, loading: false, active: state.active, memory: [] };
      requested = true;
      emit();
      void run();
    },
    setActive(active: boolean): void {
      if (active === state.active) return;
      generation += 1;
      clearTimer();
      state = { ...state, active, loading: false };
      requested = active && state.value?.alive !== false;
      emit();
      void run();
    },
    refresh(): void {
      if (!state.active || inFlight) return;
      requested = true;
      void run();
    },
  };
}
