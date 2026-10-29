export async function GET() {
  return Response.json({
    ok: true,
    service: "harmonia-web",
    project: process.env.GOOGLE_CLOUD_PROJECT ?? "harmonia-local",
    region: process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1",
    mode: process.env.HARMONIA_PREVIEW_MODE === "1" ? "preview" : "full",
    durableRuntime: {
      protocolVersion: 1,
      stateStore: "firestore",
      wakeTransport: "pubsub",
      contextCompiler: "harmonia-context/v1",
    },
  });
}
