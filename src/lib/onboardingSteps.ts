/** The steps a website onboarding run moves through, in order. */
export const ONBOARDING_STEPS = ["fetching_site", "reading_site", "researching_competitors", "researching_customers", "writing_brief"] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];
export type OnboardingStepStatus = "pending" | "running" | "done" | "failed";

export interface OnboardingStep {
  id: OnboardingStepId;
  status: OnboardingStepStatus;
  startedAt?: string;
  finishedAt?: string;
  detail?: string;
}

export interface OnboardingRun {
  id: string;
  url: string;
  status: "running" | "done" | "failed";
  steps: OnboardingStep[];
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  error?: string;
  briefDigest?: string;
}

/** What each step is called wherever a run is shown (dashboard, settings, chat). */
export const ONBOARDING_STEP_LABELS: Record<OnboardingStepId, string> = {
  fetching_site: "Reading your website",
  reading_site: "Understanding what you sell",
  researching_competitors: "Finding your competitors",
  researching_customers: "Listening to your customers",
  writing_brief: "Writing your brand brief",
};
