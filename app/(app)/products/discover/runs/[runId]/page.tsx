import { RealDiscoveryWorkspace } from "@/components/sourcing/selection-center-real";

export default async function Page({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  return <RealDiscoveryWorkspace runId={runId} />;
}
