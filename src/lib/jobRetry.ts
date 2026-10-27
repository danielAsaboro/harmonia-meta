export interface RetryFailure {
  stage: string;
  category: string;
  code: string;
  publicMessage: string;
  retryable: boolean;
  details?: Record<string, string | number | boolean>;
}

export function authorizeJobRetry(
  failure: RetryFailure,
  afterFix: boolean,
  currentContractRevision: string,
): { allowPermanent: boolean } {
  if (failure.retryable) return { allowPermanent: false };
  if (!afterFix) {
    throw new Error("permanent failure requires an explicit deployed-fix acknowledgement");
  }
  if (failure.details?.contractRevision === currentContractRevision) {
    throw new Error("no newer contract correction is deployed for this failure");
  }
  return { allowPermanent: true };
}
