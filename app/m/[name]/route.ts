// GET /m/:name?sig=… — a signed, unguessable link to one image, so Instagram can download it when publishing.
import { mediaType, readMedia, validMediaSignature } from "@/lib/media";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const name = (await params).name;
  if (!validMediaSignature(name, new URL(req.url).searchParams.get("sig"))) return new Response("Not found", { status: 404 });
  const file = readMedia(name);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file), { headers: { "Content-Type": mediaType(name) } });
}
