import type { ImportedReplayBundle } from "./importer";
import type { ReplayEvent } from "./schema";
import { digestReplayState, reduceReplayState } from "./state";

type PlaybackStatus = "idle" | "playing" | "paused" | "complete" | "stopped" | "failed";
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export class ReplayDispatcher {
  private status: PlaybackStatus = "idle"; private speed = 1; private lastSequence = -1;
  constructor(private readonly bundle: ImportedReplayBundle, private readonly emit: (event: ReplayEvent) => void = () => undefined) {}
  eventsAfter(sequence: number): readonly ReplayEvent[] { return this.bundle.events.filter((event) => event.sequence > sequence); }
  pause(): void { if (this.status !== "complete" && this.status !== "stopped") this.status = "paused"; }
  resume(): void { if (this.status === "paused") this.status = "playing"; }
  stop(): void { this.status = "stopped"; }
  setSpeed(multiplier: number): void { if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 100) throw new Error("invalid replay speed"); this.speed = multiplier; }
  snapshot() { return { status: this.status, speed: this.speed, lastSequence: this.lastSequence, bundleId: this.bundle.bundleId, executionMode: "recorded_replay" as const }; }
  async start(options: { immediate?: boolean } = {}): Promise<void> {
    if (this.status === "complete" || this.status === "stopped") return;
    if (this.status !== "paused") this.status = "playing";
    let previousOffset = 0;
    for (const event of this.eventsAfter(this.lastSequence)) {
      while (this.status === "paused") await delay(10);
      if ((this.status as PlaybackStatus) === "stopped") return;
      if (!options.immediate) await delay(Math.max(0, event.offsetMs - previousOffset) / this.speed);
      this.emit(event); this.lastSequence = event.sequence; previousOffset = event.offsetMs;
    }
    const state = reduceReplayState(this.bundle.events);
    this.status = digestReplayState(state) === this.bundle.terminalStateDigest ? "complete" : "failed";
  }
}
