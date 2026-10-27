import { STAGES, type Stage } from "../types";

export function jobProgressState(job: { stage: Stage; status: string }) {
  const stages = STAGES.filter((stage) => stage !== "failed");
  const current = Math.max(0, stages.indexOf(job.stage as typeof stages[number]));
  return {
    stage: job.stage,
    status: job.status,
    stages: stages.map((stage, index) => ({
      id: stage,
      label: stage.replaceAll("_", " "),
      status: job.status === "failed" && stage === job.stage ? "failed"
        : index < current || job.stage === "complete" ? "complete"
          : index === current ? "active" : "pending",
    })),
  };
}
