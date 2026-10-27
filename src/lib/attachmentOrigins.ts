type AttachmentOriginEnvironment = Record<string, string | undefined>;

function httpOrigin(value: string): string {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    return url.origin;
  } catch {
    throw new Error(`invalid attachment allowed origin: ${value}`);
  }
}

export function attachmentOriginPolicy(environment: AttachmentOriginEnvironment, requestUrl: string) {
  const configured = environment.ATTACHMENT_ALLOWED_ORIGINS
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const fallback = environment.PUBLIC_BASE_URL ?? new URL(requestUrl).origin;
  const allowed = new Set((configured?.length ? configured : [fallback]).map(httpOrigin));

  return {
    accepts(origin: string | null): boolean {
      return origin === null || allowed.has(origin);
    },
    uploadOrigin(origin: string | null): string {
      if (origin && allowed.has(origin)) return origin;
      return allowed.values().next().value as string;
    },
  };
}
