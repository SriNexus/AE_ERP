import { useState } from 'react';
import { MapPin, Loader2, CheckCircle2 } from 'lucide-react';

import { Button } from '../../../components/ui/Button';
import { DocumentVault } from '../../../components/shared/DocumentVault';
import { reverseGeocodeLatLng } from '../services/reverseGeocode';
import type { SurveyLocation, SurveyPhoto, SurveyReportInput } from '../types';

const field = 'w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)]';

/** Maps the browser's GeolocationPositionError codes to a specific,
 * actionable message — "location capture failed" alone isn't enough for a
 * field user to know what to do next. */
function describeGeolocationError(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return 'Location permission was denied. Enable location access for this site and try again.';
    case err.POSITION_UNAVAILABLE:
      return 'Your device could not determine its location right now. Try again in an open area.';
    case err.TIMEOUT:
      return 'Location capture timed out. Try again — this can take longer indoors or with a weak signal.';
    default:
      return 'Location capture failed. Please try again.';
  }
}

export function SurveyReportForm({ photos, onPhotos, onSubmit, loading }: {
  photos: SurveyPhoto[];
  onPhotos: (files: File[]) => Promise<void>;
  onSubmit: (report: SurveyReportInput) => void;
  loading?: boolean;
}) {
  const [roofType, setRoofType] = useState('RCC');
  const [roofAreaSqm, setRoofAreaSqm] = useState('');
  const [shadingNotes, setShadingNotes] = useState('');
  const [structuralNotes, setStructuralNotes] = useState('');
  const [notes, setNotes] = useState('');
  const [location, setLocation] = useState<SurveyLocation>();
  const [capturingLocation, setCapturingLocation] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [error, setError] = useState('');

  function captureLocation() {
    if (capturingLocation) return; // never double-fire a capture in flight
    setLocationError('');
    if (!navigator.geolocation) {
      setLocationError('GPS is not available on this device.');
      return;
    }
    setCapturingLocation(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const captured: SurveyLocation = { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy, capturedAt: new Date().toISOString() };
        setLocation(captured);
        setCapturingLocation(false);
        // Reverse geocoding is a best-effort enhancement resolved once,
        // right after capture — never blocks the "GPS Captured" success
        // state above, and any failure here just leaves `address` unset.
        void reverseGeocodeLatLng(captured.latitude, captured.longitude).then((address) => {
          if (address) setLocation((prev) => (prev ? { ...prev, address } : prev));
        });
      },
      (err) => {
        setCapturingLocation(false);
        setLocationError(describeGeolocationError(err));
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded-xl bg-[var(--color-danger-light)] p-3 text-sm text-[var(--color-danger-text)]">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-[var(--color-text-muted)]">Roof type<select className={`${field} mt-1`} value={roofType} onChange={(e) => setRoofType(e.target.value)}><option>RCC</option><option>Metal Sheet</option><option>Tile</option><option>Ground Mount</option><option>Other</option></select></label>
        <label className="text-xs font-semibold text-[var(--color-text-muted)]">Usable roof area (m²)<input className={`${field} mt-1`} type="number" min="0" step="0.1" value={roofAreaSqm} onChange={(e) => setRoofAreaSqm(e.target.value)} /></label>
      </div>
      <label className="block text-xs font-semibold text-[var(--color-text-muted)]">Shading notes<textarea className={`${field} mt-1`} rows={3} value={shadingNotes} onChange={(e) => setShadingNotes(e.target.value)} /></label>
      <label className="block text-xs font-semibold text-[var(--color-text-muted)]">Structural notes<textarea className={`${field} mt-1`} rows={3} value={structuralNotes} onChange={(e) => setStructuralNotes(e.target.value)} /></label>
      <label className="block text-xs font-semibold text-[var(--color-text-muted)]">Additional notes<textarea className={`${field} mt-1`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <DocumentVault
        title="Survey photos and documents"
        description="Capture site photos or attach supporting documents."
        accept="image/*,application/pdf"
        documents={photos.map((photo) => ({ id: photo.id, name: photo.name, url: photo.url, type: photo.contentType, size: photo.size, uploadedAt: photo.capturedAt }))}
        onUpload={onPhotos}
      />
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={capturingLocation}
            icon={capturingLocation ? <Loader2 className="h-4 w-4 animate-spin" /> : location ? <CheckCircle2 className="h-4 w-4 text-[var(--color-success)]" /> : <MapPin className="h-4 w-4" />}
            onClick={captureLocation}
          >
            {capturingLocation ? 'Capturing GPS…' : location ? 'GPS Captured' : 'Capture GPS'}
          </Button>
          <Button type="button" loading={loading} onClick={() => {
            setError('');
            if (!roofAreaSqm || Number(roofAreaSqm) <= 0 || photos.length === 0) return setError('Roof area and at least one site photo are required.');
            onSubmit({ roofType, roofAreaSqm: Number(roofAreaSqm), shadingNotes, structuralNotes, notes, photos, location });
          }}>Submit for approval</Button>
        </div>
        {locationError && <p className="mt-2 text-xs font-medium text-[var(--color-danger-text)]">{locationError}</p>}
        {location && (
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">
            {location.address || 'Resolving address…'} · {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}
          </p>
        )}
      </div>
    </div>
  );
}
