// GET /api/approvals — everything waiting on Tommy.
import { listApprovals } from "@/lib/crews/crews";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ approvals: listApprovals("pending") });
}
