export function productionPlanError(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  const status = message.includes("not found") ? 404
    : message.includes("invalid") || message.includes("required") ? 400
      : 409;
  return Response.json({ error: message }, { status });
}
