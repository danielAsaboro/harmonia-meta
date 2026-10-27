export function surfaceRevisionRequest(jobId: string, draftId: string): string {
  return `Show drafts for job ${jobId}. Recompose the generated comparison around draft ${draftId}.`;
}
