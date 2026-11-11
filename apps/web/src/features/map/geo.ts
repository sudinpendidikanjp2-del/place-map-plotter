export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Area pandang yang diperlebar agar peta tidak kosong sesaat saat digeser. */
export function paddedBBox(b: google.maps.LatLngBounds, pad = 0.25) {
  const ne = b.getNorthEast();
  const sw = b.getSouthWest();
  const dLat = (ne.lat() - sw.lat()) * pad;
  let west = sw.lng();
  let east = ne.lng();
  if (east < west || east - west >= 360) {
    west = -180;
    east = 180;
  } else {
    const dLng = (east - west) * pad;
    west = Math.max(-180, west - dLng);
    east = Math.min(180, east + dLng);
  }
  return {
    west,
    east,
    south: Math.max(-90, sw.lat() - dLat),
    north: Math.min(90, ne.lat() + dLat),
  };
}
