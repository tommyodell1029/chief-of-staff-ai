import Hud from "@/components/Hud";
import Station from "@/components/Station";

export const metadata = { title: "Station · Jarvis" };

// The always-on home screen: the HUD plus hands-free "Jarvis" voice. Made for the all-in-one PC.
export default function StationPage() {
  return (
    <>
      <Hud station />
      <Station />
    </>
  );
}
