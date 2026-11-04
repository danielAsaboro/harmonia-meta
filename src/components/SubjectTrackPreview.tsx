export interface SubjectTrack {
  momentId: string;
  model: string;
  subject: string;
  sourceWidth: number;
  sourceHeight: number;
  cropWidth: number;
  cropHeight: number;
  keyframes: { t: number; x: number }[];
}

export function subjectTracks(detail: Record<string, unknown> | undefined): SubjectTrack[] {
  const tracking = detail?.tracking;
  if (!Array.isArray(tracking)) return [];
  return tracking.filter((item): item is SubjectTrack => (
    typeof item === "object" && item !== null
    && typeof (item as SubjectTrack).sourceWidth === "number" && (item as SubjectTrack).sourceWidth > 0
    && typeof (item as SubjectTrack).sourceHeight === "number" && (item as SubjectTrack).sourceHeight > 0
    && Array.isArray((item as SubjectTrack).keyframes) && (item as SubjectTrack).keyframes.length > 0
  ));
}

/** The source frame with the crop window SAM 3.1 steered, replayed over the moment's duration. */
export function SubjectTrackPreview({ track }: { track: SubjectTrack }) {
  const { sourceWidth: width, sourceHeight: height, cropWidth, cropHeight, keyframes } = track;
  const start = keyframes[0].t;
  const duration = Math.max(keyframes.at(-1)!.t - start, 0.5);
  const xs = keyframes.map((frame) => frame.x);
  const keyTimes = keyframes.map((frame) => ((frame.t - start) / duration).toFixed(4));
  keyTimes[0] = "0";
  if (keyframes.length > 1) keyTimes[keyTimes.length - 1] = "1";
  return (
    <figure className="mt-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${track.model} tracked the ${track.subject}: the ${cropWidth}×${cropHeight} crop moved between x ${Math.min(...xs)} and ${Math.max(...xs)} of a ${width}-pixel-wide frame`}
        className="w-full max-w-sm rounded-md border border-zinc-200 bg-zinc-900 dark:border-zinc-800"
      >
        <rect x={0} y={0} width={width} height={height} fill="#27272a" />
        <rect x={xs[0]} y={(height - cropHeight) / 2} width={cropWidth} height={cropHeight} fill="#b9ff66" fillOpacity={0.18} stroke="#b9ff66" strokeWidth={Math.max(width / 240, 2)}>
          {keyframes.length > 1 && (
            <animate attributeName="x" values={xs.join(";")} keyTimes={keyTimes.join(";")} dur={`${duration}s`} repeatCount="indefinite" calcMode="linear" />
          )}
        </rect>
      </svg>
      <figcaption className="mt-1 text-xs text-zinc-500">{track.model} · {track.subject}</figcaption>
    </figure>
  );
}
