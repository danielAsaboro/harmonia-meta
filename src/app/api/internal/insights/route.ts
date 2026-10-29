import { getGoals, listRecentEngagement } from "@/lib/firestore";
import { internalTenantHandler } from "@/lib/internalAuth";

/** Cross-job reaction insights + operator goals the agent injects into ideation. */
async function get(_req: Request) {
  const [insights, goals] = await Promise.all([listRecentEngagement(), getGoals()]);
  const totals = insights.reduce(
    (acc, i) => ({
      posts: acc.posts + 1,
      likes: acc.likes + i.likes,
      reposts: acc.reposts + i.reposts,
      replies: acc.replies + i.replies,
    }),
    { posts: 0, likes: 0, reposts: 0, replies: 0 },
  );
  return Response.json({
    totals,
    topPosts: insights.slice(0, 5),
    goals,
  });
}

export const GET = internalTenantHandler(get);
