export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  return fetch(path, { ...init, headers, credentials: "same-origin", cache: "no-store" });
}
