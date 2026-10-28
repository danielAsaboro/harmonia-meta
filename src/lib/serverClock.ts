export type ServerClockConfig = {
  originIso: string;
  speed: number;
};

type GlobalWithDate = typeof globalThis & {
  Date: typeof Date;
};

let installed = false;
let activeClock: ServerClockConfig | null = null;

function parseClockSpeed(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || !Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return value;
}

export function installServerClock(): void {
  if (installed || typeof process === "undefined") return;
  const originEnv = process.env.HARMONIA_TIME_ORIGIN;
  if (!originEnv) return;

  const originMs = Date.parse(originEnv);
  if (!Number.isFinite(originMs)) return;

  const NativeDate = Date;
  const speed = parseClockSpeed(process.env.HARMONIA_TIME_SPEED);
  const bootRealMs = NativeDate.now();
  const bootOriginMs = originMs;

  const nowMs = (): number => {
    const realElapsed = NativeDate.now() - bootRealMs;
    return Math.trunc(bootOriginMs + realElapsed * speed);
  };

  const shiftedDate = new Proxy(NativeDate, {
    apply: () => new NativeDate(nowMs()).toString(),
    construct: (target, argumentsList, newTarget) => Reflect.construct(
      target,
      argumentsList.length === 0 ? [nowMs()] : argumentsList,
      newTarget,
    ),
    get: (target, property, receiver) => property === "now"
      ? nowMs
      : Reflect.get(target, property, receiver),
  });

  (globalThis as GlobalWithDate).Date = shiftedDate;
  installed = true;
  activeClock = {
    originIso: new NativeDate(originMs).toISOString(),
    speed,
  };
}

export function currentServerClock(): ServerClockConfig | null {
  return activeClock;
}
