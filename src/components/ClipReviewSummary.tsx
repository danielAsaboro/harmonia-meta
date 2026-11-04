interface ClipVersion { window: [number, number]; passed: boolean; faults: { code: string; severity: string; startSec: number; endSec: number }[] }
export interface ClipReview { momentId: string; kept: number; passed: boolean; versions: ClipVersion[] }

export function clipReviews(detail: Record<string, unknown> | undefined): ClipReview[] {
  const review = detail?.review;
  if (!Array.isArray(review)) return [];
  return review.filter((item): item is ClipReview => (
    typeof item === "object" && item !== null && Array.isArray((item as ClipReview).versions)
    && (item as ClipReview).versions.length > 0 && typeof (item as ClipReview).kept === "number"
    && (item as ClipReview).kept >= 1 && (item as ClipReview).kept <= (item as ClipReview).versions.length
  ));
}

const label = (code: string) => code.replaceAll("_", " ");

/** What ffmpeg measured on each rendered version, and which one was delivered. */
export function ClipReviewSummary({ review }: { review: ClipReview }) {
  return (
    <ol className="mt-2 space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
      {review.versions.map((version, index) => (
        <li key={index} className={index + 1 === review.kept ? "font-medium text-zinc-900 dark:text-zinc-100" : ""}>
          v{index + 1} {version.window[0].toFixed(2)}–{version.window[1].toFixed(2)} s · {version.passed ? "passed" : "failed"}
          {version.faults.length > 0 && `: ${version.faults.map((fault) => `${label(fault.code)} ${fault.startSec.toFixed(1)}–${fault.endSec.toFixed(1)} s`).join(", ")}`}
          {index + 1 === review.kept && review.versions.length > 1 && " · delivered"}
        </li>
      ))}
    </ol>
  );
}
