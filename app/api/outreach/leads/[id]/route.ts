// GET /api/outreach/leads/:id — every email to and from one lead.
import { leadMessages } from "@/lib/outreach/outreach";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return Response.json({ messages: leadMessages(Number((await params).id)) });
}
