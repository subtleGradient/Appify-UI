import { getPulse } from "../../../lib/pulse";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    ...getPulse(),
    servedAt: new Date().toISOString(),
  });
}
