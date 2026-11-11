// Makes Jarvis installable on the Home Screen as a full-screen app, which iPhone requires for notifications.
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Jarvis",
    short_name: "Jarvis",
    description: "Tommy's Command Center",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0a0d12",
    theme_color: "#0a0d12",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
