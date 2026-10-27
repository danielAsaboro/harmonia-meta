/**
 * Local-only, explicitly labelled conversation fixture. It links existing
 * seeded records and artifacts; it does not represent provider execution.
 */
export function buildDemoStudioConversation({ runId }) {
  const artifact = { id: "artifact-x-1", outputType: "x_post", revision: 1, contentDigest: "a".repeat(64), title: "Founder onboarding story", payload: { kind: "x_post", text: "Your signup flow is an obstacle course. Ours was too — until we treated every step as a suspect." } };
  const pending = { id: "act-pub-launch", title: "Approve launch post", type: "publish_x_post", risk: "high" };
  const pair = (request, reply, data) => [
    { role: "user", surface: "dashboard", text: request },
    { role: "assistant", surface: "dashboard", text: `Local demo fixture: ${reply}`, data: { reply: "", ...data } },
  ];
  return [
    ...pair("What is the sharpest story in our onboarding interview?", "two grounded signals stand out: deleting ceremony and compressing time-to-value.", { intent: "status", jobId: "demo-clips" }),
    ...pair("Why would a founder care about that now?", "the useful tension is subtraction versus the usual feature-dump launch.", { intent: "status", jobId: "demo-clips" }),
    ...pair("Ground it in the source, not generic startup advice.", "the direction stays tied to the persisted nine-days-to-forty-hours moment.", { intent: "status", jobId: "demo-clips" }),
    ...pair("The voice should feel contrarian, not corporate.", "the narrative direction is founder conviction with a concrete proof point.", { intent: "list_artifacts", jobId: "demo-clips", artifacts: [] }),
    ...pair("Write it like a founder talking to another founder.", "one reviewed X artifact is linked to the working set.", { intent: "list_artifacts", jobId: "demo-clips", artifacts: [artifact] }),
    ...pair("Keep the opening about the obstacle course.", "the reviewed artifact keeps that hook and remains inside the X limit.", { intent: "list_artifacts", jobId: "demo-clips", artifacts: [artifact] }),
    ...pair("Now give the story a visual direction.", "the persisted local abstract image is available on the canvas.", { intent: "create_job", jobId: "demo-clips", assets: [{ actionId: "act-img-demo01", mime: "image/png" }] }),
    ...pair("Cut the strongest proof point into a vertical clip.", "the locally rendered vertical clip is linked; this fixture makes no provider-execution claim.", { intent: "create_job", chatRunId: runId, jobId: "demo-clips", assets: [{ actionId: "act-clip-demo1", mime: "video/mp4" }] }),
    ...pair("Put the image, clip, and reel in one working set.", "all three persisted local artifacts are linked side by side.", { intent: "create_job", jobId: "demo-clips", assets: [{ actionId: "act-img-demo01", mime: "image/png" }, { actionId: "act-clip-demo1", mime: "video/mp4" }, { actionId: "act-reel-top2", mime: "video/mp4" }] }),
    ...pair("What still needs my decision?", "one real seeded publish action is waiting and publishing remains blocked.", { intent: "status", jobId: "demo-launch", pendingActions: [pending] }),
    ...pair("Show the final launch post before I decide.", "the persisted launch artifact is ready for review.", { intent: "list_artifacts", jobId: "demo-launch", artifacts: [{ ...artifact, id: "artifact-launch", contentDigest: "b".repeat(64), title: "Usage billing launch", payload: { kind: "x_post", text: "Shipping today: usage-based billing for agent workloads. Pay for outcomes, not idle tokens. Launch post incoming 🚀" } }] }),
    ...pair("Keep publishing blocked and show the whole checkpoint.", "no decision was submitted; the media working set and separate pending launch action remain linked without executing it.", { intent: "approve", jobId: "demo-clips", pendingActions: [pending] }),
  ];
}
