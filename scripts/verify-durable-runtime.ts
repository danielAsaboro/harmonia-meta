import { runDurableRuntimeBenchmark } from "../src/lib/durableRuntimeVerification";

process.stdout.write(`${JSON.stringify(runDurableRuntimeBenchmark(), null, 2)}\n`);
