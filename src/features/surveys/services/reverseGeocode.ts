/**
 * reverseGeocodeLatLng — free reverse geocoding via OpenStreetMap Nominatim
 * (https://nominatim.org/release-docs/latest/api/Reverse/), no API key
 * required. Turns a captured GPS coordinate pair into a human-readable
 * label so a normal ERP user can understand "where was the Survey actually
 * conducted?" without pasting coordinates into a maps app themselves.
 *
 * This is a pure enhancement over the real source of truth (the
 * coordinates) — resolved once at GPS-capture time (SurveyReportForm.tsx),
 * then persisted alongside the coordinates through the existing Survey
 * report/submission pipeline (no separate geocoding call on every render,
 * no second GPS system). Any failure — network error, timeout, rate limit,
 * no match — resolves to `undefined` rather than throwing, so it can never
 * block Survey save/submit/completion.
 */
export async function reverseGeocodeLatLng(latitude: number, longitude: number): Promise<string | undefined> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=16&addressdetails=1`;
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) return undefined;
    const data = await response.json();
    return typeof data?.display_name === 'string' && data.display_name.trim() ? data.display_name.trim() : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeoutId);
  }
}
