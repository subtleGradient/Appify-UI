import { getScenarioSet } from "../../../lib/scenarios";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    ...getScenarioSet(),
    servedAt: new Date().toISOString(),
  });
}
