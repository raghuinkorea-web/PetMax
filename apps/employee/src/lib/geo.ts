/**
 * A single GPS reading, shaped exactly as the API's geo fields expect.
 */
export interface Fix {
  latitude: number;
  longitude: number;
  accuracyM: number;
}

/**
 * Best-effort GPS fix. Resolves null rather than rejecting when the device
 * has no geolocation, the employee denies permission, or no fix arrives in
 * time — field work happens in basements and steel structures, and a weak
 * signal must never be the reason a job cannot be started or completed.
 */
export function currentPosition(): Promise<Fix | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 6000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timeout);
        resolve({
          latitude: Number(pos.coords.latitude.toFixed(6)),
          longitude: Number(pos.coords.longitude.toFixed(6)),
          accuracyM: Math.round(pos.coords.accuracy),
        });
      },
      () => { clearTimeout(timeout); resolve(null); },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 30_000 });
  });
}
