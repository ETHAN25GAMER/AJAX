import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.app,
    short_name: BRAND.app,
    description: `Admin and technician console for ${BRAND.app}.`,
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0a7d3c",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      // Replace these with real PNGs before launch (iOS A2HS needs a PNG).
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };
}
