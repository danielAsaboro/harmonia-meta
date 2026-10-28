const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "youtu.be", "m.youtube.com"]);

/** Extracts an 11-char YouTube video id from a watch/shorts/youtu.be URL. */
export function parseYouTubeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!YOUTUBE_HOSTS.has(url.hostname)) return null;
    const id = url.hostname === "youtu.be"
      ? url.pathname.slice(1)
      : url.searchParams.get("v") ?? url.pathname.split("/shorts/")[1]?.split("/")[0];
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
