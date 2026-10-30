import ChatConsole from "@/components/ChatConsole";

export default async function DashboardConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  return <ChatConsole conversationId={conversationId} />;
}
