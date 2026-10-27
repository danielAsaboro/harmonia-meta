export interface DemoChatRunInput {
  runId: string;
  startedAt: string;
  completedAt: string;
  jobId: string;
  confirmationJobId: string;
  confirmationActionId: string;
  imageSizeBytes: number;
  clipSizeBytes: number;
  reelSizeBytes: number;
}

export function buildDemoChatRunEvents(input: DemoChatRunInput): unknown[];
