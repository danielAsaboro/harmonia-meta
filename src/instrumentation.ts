import { installServerClock } from "@/lib/serverClock";

export async function register(): Promise<void> {
  installServerClock();
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!/^(1|true|yes|on)$/i.test(process.env.HARMONIA_TELEMETRY_ENABLED ?? "")) return;

  const [grpc, otlp, sdk, authLibrary] = await Promise.all([
    import("@grpc/grpc-js"),
    import("@opentelemetry/exporter-trace-otlp-grpc"),
    import("@opentelemetry/sdk-trace-node"),
    import("google-auth-library"),
  ]);
  const auth = new authLibrary.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const authClient = await auth.getClient();
  const callCredentials = grpc.credentials.createFromMetadataGenerator((_options, callback) => {
    authClient.getRequestHeaders("https://telemetry.googleapis.com/").then((headers) => {
      const metadata = new grpc.Metadata();
      headers.forEach((value, key) => metadata.set(key, value));
      callback(null, metadata);
    }).catch((error: Error) => callback(error));
  });
  const channelCredentials = grpc.credentials.combineChannelCredentials(
    grpc.credentials.createSsl(),
    callCredentials,
  );
  const exporter = new otlp.OTLPTraceExporter({
    url: "https://telemetry.googleapis.com:443",
    credentials: channelCredentials,
  });
  const provider = new sdk.NodeTracerProvider({
    spanProcessors: [new sdk.BatchSpanProcessor(exporter)],
  });
  provider.register();
}
