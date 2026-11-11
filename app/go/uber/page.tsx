import GoUber from "@/components/GoUber";
import { appLink, tripFromParams, webLink } from "@/lib/integrations/uber";

export const metadata = { title: "Uber · Jarvis" };

// The page Jarvis's Uber alerts and buttons open: it opens the Uber app with the trip filled in.
export default async function GoUberPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const trip = tripFromParams(await searchParams);
  if (!trip) return <p className="p-6 text-muted">That Uber link is incomplete. Ask Jarvis again.</p>;
  return <GoUber app={appLink(trip)} web={webLink(trip)} to={trip.name} addr={trip.addr} from={trip.pickup ? trip.pickup.addr : "your current location"} />;
}
