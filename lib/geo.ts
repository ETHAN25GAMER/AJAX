// Lightweight geo helpers for the GPS tracking feature.
// Straight-line distance + a crude ETA — good enough for v1; upgrade to a
// routing API when the rough number starts to feel obviously wrong.

export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(s));
}

const DEFAULT_AVG_SPEED_KMH = 30;

export function estimatedMinutes(distanceKm: number, kmh: number = DEFAULT_AVG_SPEED_KMH): number {
  if (kmh <= 0) return 0;
  return Math.max(0, Math.round((distanceKm / kmh) * 60));
}

// Server-side geocoder via OpenStreetMap Nominatim — free, no API key, rate
// limited to ~1 request/second. We cache results on customers.address_lat/lng,
// so this is effectively called once per customer ever. Returns null on any
// failure; callers degrade gracefully (no destination → no ETA shown).
export async function geocodeAddress(address: string): Promise<LatLng | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;

  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
    trimmed
  )}&format=json&limit=1`;

  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: {
        // Nominatim policy requires a unique User-Agent identifying the app.
        "User-Agent": "PestLLM/1.0 (geocoder)"
      }
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Array<{ lat: string; lon: string }>;
    const hit = body[0];
    if (!hit) return null;
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}
