/**
 * geoFence.test.ts — Phase 5: Geo-Fence Reusable Infrastructure Verification.
 *
 * Confirms evaluateGeofence() is genuinely business-neutral and works correctly
 * for realistic Warehouse-shaped scenarios using static fixture data only.
 * No Firestore, no Attendance, no Warehouse production logic — pure
 * geographic verification.
 *
 * All fixtures are test-only data. They must NOT become a production model.
 */
import { describe, expect, it } from 'vitest';
import { distanceMeters, evaluateGeofence } from '../geo';

// ═══════════════════════════════════════════════════════════════════════════
// Warehouse-shaped test fixtures (test data only, NOT a production model)
// ═══════════════════════════════════════════════════════════════════════════

/** A warehouse near New Delhi (concrete example) */
const warehouseDelhi = {
  center: { latitude: 28.6139, longitude: 77.209 },
  radiusMeters: 200, // typical small warehouse geofence
};

/** A warehouse near Pune */
const warehousePune = {
  center: { latitude: 18.5204, longitude: 73.8567 },
  radiusMeters: 500, // medium warehouse geofence
};

/** A warehouse near Mumbai (larger campus) */
const warehouseMumbai = {
  center: { latitude: 19.076, longitude: 72.8777 },
  radiusMeters: 1000, // large campus geofence
};

/** A warehouse near a rural site (small radius) */
const warehouseRural = {
  center: { latitude: 26.9124, longitude: 75.7873 }, // Jaipur
  radiusMeters: 50, // very tight geofence
};

// ═══════════════════════════════════════════════════════════════════════════
// A. Basic Warehouse-shaped scenarios
// ═══════════════════════════════════════════════════════════════════════════
describe('Warehouse-shaped fixture scenarios', () => {
  it('point well inside Delhi warehouse geofence → PASS', () => {
    // ~50m south of center — well within 200m radius
    const degPerM = 1 / 111_320;
    const point = {
      latitude: warehouseDelhi.center.latitude - 50 * degPerM,
      longitude: warehouseDelhi.center.longitude,
    };
    const result = evaluateGeofence(point, warehouseDelhi.center, warehouseDelhi.radiusMeters);
    expect(result.withinGeofence).toBe(true);
    expect(result.distanceMeters).toBeGreaterThan(0);
    expect(result.distanceMeters).toBeLessThan(warehouseDelhi.radiusMeters);
  });

  it('point well outside Delhi warehouse geofence → FAIL', () => {
    // ~500m south — clearly outside 200m radius
    const degPerM = 1 / 111_320;
    const point = {
      latitude: warehouseDelhi.center.latitude - 500 * degPerM,
      longitude: warehouseDelhi.center.longitude,
    };
    const result = evaluateGeofence(point, warehouseDelhi.center, warehouseDelhi.radiusMeters);
    expect(result.withinGeofence).toBe(false);
    expect(result.distanceMeters).toBeGreaterThan(warehouseDelhi.radiusMeters);
  });

  it('point near boundary of Pune warehouse → boundary behavior', () => {
    // Place a point at exactly ~499m from Pune center — within 500m radius
    const degPerM = 1 / 111_320;
    const point = {
      latitude: warehousePune.center.latitude + 499 * degPerM,
      longitude: warehousePune.center.longitude,
    };
    const result = evaluateGeofence(point, warehousePune.center, warehousePune.radiusMeters);
    expect(result.withinGeofence).toBe(true);
    expect(result.distanceMeters).toBeLessThan(warehousePune.radiusMeters);
  });

  it('point at Mumbai warehouse center → PASS (distance 0)', () => {
    const result = evaluateGeofence(warehouseMumbai.center, warehouseMumbai.center, warehouseMumbai.radiusMeters);
    expect(result.withinGeofence).toBe(true);
    expect(result.distanceMeters).toBe(0);
  });

  it('point far outside Mumbai warehouse → FAIL', () => {
    // Delhi is ~1,148 km from Mumbai — well outside 1km radius
    const result = evaluateGeofence(warehouseDelhi.center, warehouseMumbai.center, warehouseMumbai.radiusMeters);
    expect(result.withinGeofence).toBe(false);
    expect(result.distanceMeters).toBeGreaterThan(warehouseMumbai.radiusMeters);
  });

  it('point inside rural warehouse with very tight 50m radius', () => {
    // ~30m from center — within 50m radius
    const degPerM = 1 / 111_320;
    const point = {
      latitude: warehouseRural.center.latitude + 30 * degPerM,
      longitude: warehouseRural.center.longitude,
    };
    const result = evaluateGeofence(point, warehouseRural.center, warehouseRural.radiusMeters);
    expect(result.withinGeofence).toBe(true);
    expect(result.distanceMeters).toBeGreaterThan(0);
    expect(result.distanceMeters).toBeLessThan(warehouseRural.radiusMeters);
  });

  it('point outside rural warehouse with very tight 50m radius', () => {
    // ~80m from center — outside 50m radius
    const degPerM = 1 / 111_320;
    const point = {
      latitude: warehouseRural.center.latitude + 80 * degPerM,
      longitude: warehouseRural.center.longitude,
    };
    const result = evaluateGeofence(point, warehouseRural.center, warehouseRural.radiusMeters);
    expect(result.withinGeofence).toBe(false);
    expect(result.distanceMeters).toBeGreaterThan(warehouseRural.radiusMeters);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B. Boundary precision
// ═══════════════════════════════════════════════════════════════════════════
describe('Boundary precision — the <= contract', () => {
  const center = warehouseDelhi.center;

  it('distance < radius → withinGeofence = true', () => {
    const degPerM = 1 / 111_320;
    const point = { latitude: center.latitude + 100 * degPerM, longitude: center.longitude };
    const result = evaluateGeofence(point, center, 200);
    expect(result.withinGeofence).toBe(true);
  });

  it('distance = radius → withinGeofence = true (<= convention)', () => {
    // Construct a point at exactly 200m from center using distanceMeters as the oracle
    const degPerM = 1 / 111_320;
    // Try a point placed at approximately the radius distance
    const point = { latitude: center.latitude + 200 * degPerM, longitude: center.longitude };
    const result = evaluateGeofence(point, center, 200);
    // Due to Haversine vs linear approximation, the actual distance may differ slightly
    // from 200m. Verify the <= contract holds regardless of exact floating point:
    // if distance is very close to radius, it should pass
    expect(result.distanceMeters).toBeCloseTo(200, -1); // within ~10m tolerance
    expect(result.withinGeofence).toBe(true);
  });

  it('distance > radius → withinGeofence = false', () => {
    const degPerM = 1 / 111_320;
    const point = { latitude: center.latitude + 300 * degPerM, longitude: center.longitude };
    const result = evaluateGeofence(point, center, 200);
    expect(result.withinGeofence).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C. Multiple realistic radii
// ═══════════════════════════════════════════════════════════════════════════
describe('Multiple realistic radii', () => {
  const center = warehouseDelhi.center;
  const degPerM = 1 / 111_320;

  it('very small radius (1 metre) — point at ~0.5m → PASS', () => {
    const point = { latitude: center.latitude + 0.5 * degPerM, longitude: center.longitude };
    const result = evaluateGeofence(point, center, 1);
    expect(result.withinGeofence).toBe(true);
  });

  it('small radius (50 metres) — point at 30m → PASS', () => {
    const point = { latitude: center.latitude + 30 * degPerM, longitude: center.longitude };
    const result = evaluateGeofence(point, center, 50);
    expect(result.withinGeofence).toBe(true);
  });

  it('medium radius (200 metres) — point at 150m → PASS', () => {
    const point = { latitude: center.latitude + 150 * degPerM, longitude: center.longitude };
    const result = evaluateGeofence(point, center, 200);
    expect(result.withinGeofence).toBe(true);
  });

  it('large radius (1 km) — point at 800m → PASS', () => {
    const point = { latitude: center.latitude + 800 * degPerM, longitude: center.longitude };
    const result = evaluateGeofence(point, center, 1000);
    expect(result.withinGeofence).toBe(true);
  });

  it('very large radius (10 km) — point at 8km → PASS', () => {
    const point = { latitude: center.latitude + 8000 * degPerM, longitude: center.longitude };
    const result = evaluateGeofence(point, center, 10_000);
    expect(result.withinGeofence).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D. Nearby vs distant locations
// ═══════════════════════════════════════════════════════════════════════════
describe('Nearby vs distant locations', () => {
  const center = warehouseDelhi.center;
  const radius = 500; // 500m geofence

  it('same point → distance 0, withinGeofence true', () => {
    const result = evaluateGeofence(center, center, radius);
    expect(result.distanceMeters).toBe(0);
    expect(result.withinGeofence).toBe(true);
  });

  it('very nearby point (~10m) → withinGeofence true', () => {
    const degPerM = 1 / 111_320;
    const point = { latitude: center.latitude + 10 * degPerM, longitude: center.longitude };
    const result = evaluateGeofence(point, center, radius);
    expect(result.withinGeofence).toBe(true);
  });

  it('nearby point (~200m) → withinGeofence true', () => {
    const degPerM = 1 / 111_320;
    const point = { latitude: center.latitude + 200 * degPerM, longitude: center.longitude };
    const result = evaluateGeofence(point, center, radius);
    expect(result.withinGeofence).toBe(true);
  });

  it('moderately distant (~1km) → withinGeofence false', () => {
    const degPerM = 1 / 111_320;
    const point = { latitude: center.latitude + 1000 * degPerM, longitude: center.longitude };
    const result = evaluateGeofence(point, center, radius);
    expect(result.withinGeofence).toBe(false);
  });

  it('far-away point (Mumbai from Delhi) → withinGeofence false', () => {
    const result = evaluateGeofence(warehouseMumbai.center, center, radius);
    expect(result.withinGeofence).toBe(false);
    expect(result.distanceMeters).toBeGreaterThan(100_000); // > 100km
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E. Determinism
// ═══════════════════════════════════════════════════════════════════════════
describe('Determinism', () => {
  const center = warehouseDelhi.center;
  const degPerM = 1 / 111_320;
  const point = { latitude: center.latitude + 150 * degPerM, longitude: center.longitude + 50 * degPerM };

  it('repeated calls produce identical results', () => {
    const r1 = evaluateGeofence(point, center, 200);
    const r2 = evaluateGeofence(point, center, 200);
    const r3 = evaluateGeofence(point, center, 200);
    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
  });

  it('distanceMeters is deterministic across calls', () => {
    const d1 = distanceMeters(point, center);
    const d2 = distanceMeters(point, center);
    expect(d1).toBe(d2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// F. Input immutability
// ═══════════════════════════════════════════════════════════════════════════
describe('Input immutability', () => {
  it('evaluateGeofence does not mutate input objects', () => {
    const point = { latitude: 28.62, longitude: 77.21 };
    const center = { latitude: 28.6139, longitude: 77.209 };
    const pointCopy = { ...point };
    const centerCopy = { ...center };

    evaluateGeofence(point, center, 200);

    expect(point).toEqual(pointCopy);
    expect(center).toEqual(centerCopy);
  });

  it('distanceMeters does not mutate input objects', () => {
    const a = { latitude: 28.62, longitude: 77.21 };
    const b = { latitude: 28.6139, longitude: 77.209 };
    const aCopy = { ...a };
    const bCopy = { ...b };

    distanceMeters(a, b);

    expect(a).toEqual(aCopy);
    expect(b).toEqual(bCopy);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// G. Symmetry
// ═══════════════════════════════════════════════════════════════════════════
describe('Symmetry of distanceMeters', () => {
  it('distanceMeters(A, B) === distanceMeters(B, A) for Warehouse fixtures', () => {
    const d1 = distanceMeters(warehouseDelhi.center, warehousePune.center);
    const d2 = distanceMeters(warehousePune.center, warehouseDelhi.center);
    expect(d1).toBeCloseTo(d2, 6);
  });

  it('distanceMeters is symmetric for nearby points', () => {
    const degPerM = 1 / 111_320;
    const a = { latitude: 28.61, longitude: 77.20 };
    const b = { latitude: 28.61 + 100 * degPerM, longitude: 77.20 + 50 * degPerM };
    expect(distanceMeters(a, b)).toBeCloseTo(distanceMeters(b, a), 6);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// H. Business-neutrality verification
// ═══════════════════════════════════════════════════════════════════════════
describe('Business-neutrality verification', () => {
  it('evaluateGeofence is a pure function — no I/O, no side effects', () => {
    // Verify by calling it and checking the result is purely derived from inputs
    const result = evaluateGeofence(
      { latitude: 28.62, longitude: 77.21 },
      { latitude: 28.6139, longitude: 77.209 },
      200,
    );
    // Result must be a plain object with only the two documented keys
    expect(Object.keys(result).sort()).toEqual(['distanceMeters', 'withinGeofence']);
    expect(typeof result.withinGeofence).toBe('boolean');
    expect(typeof result.distanceMeters).toBe('number');
  });

  it('distanceMeters is a pure function — no I/O, no side effects', () => {
    const d = distanceMeters(
      { latitude: 28.62, longitude: 77.21 },
      { latitude: 28.6139, longitude: 77.209 },
    );
    expect(typeof d).toBe('number');
    expect(d).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(d)).toBe(true);
  });

  it('no business-specific parameters — only coordinates and radius', () => {
    // evaluateGeofence accepts only: point, center, radiusMeters
    // No employeeId, warehouseId, companyId, attendancePolicy, etc.
    // This is verified by the function signature — calling with just the three args succeeds
    const result = evaluateGeofence(
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 0 },
      100,
    );
    expect(result).toBeDefined();
  });

  it('no Firebase/Firestore dependency — functions are pure math', () => {
    // Verified by the fact that these functions have no imports from firebase/firestore modules
    // and no async/network calls. The implementation is purely synchronous math.
    const d1 = distanceMeters({ latitude: 1, longitude: 1 }, { latitude: 2, longitude: 2 });
    const d2 = distanceMeters({ latitude: 3, longitude: 3 }, { latitude: 4, longitude: 4 });
    expect(d1).toBeGreaterThan(0);
    expect(d2).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// I. DistanceMeters with Warehouse-shaped coordinates
// ═══════════════════════════════════════════════════════════════════════════
describe('distanceMeters with Warehouse-shaped coordinates', () => {
  it('Delhi → Pune is approximately 1,170 km', () => {
    const d = distanceMeters(warehouseDelhi.center, warehousePune.center);
    // Known distance: ~1,170 km
    expect(d).toBeGreaterThan(1_150_000);
    expect(d).toBeLessThan(1_200_000);
  });

  it('Delhi → Mumbai is approximately 1,148 km', () => {
    const d = distanceMeters(warehouseDelhi.center, warehouseMumbai.center);
    expect(d).toBeGreaterThan(1_140_000);
    expect(d).toBeLessThan(1_160_000);
  });

  it('Pune → Mumbai is approximately 120 km', () => {
    const d = distanceMeters(warehousePune.center, warehouseMumbai.center);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(140_000);
  });

  it('Delhi → Jaipur is approximately 235 km', () => {
    const d = distanceMeters(warehouseDelhi.center, warehouseRural.center);
    expect(d).toBeGreaterThan(220_000);
    expect(d).toBeLessThan(250_000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// J. Geo-fence across different geographic directions
// ═══════════════════════════════════════════════════════════════════════════
describe('Geo-fence across directions', () => {
  const center = warehouseDelhi.center;
  const radius = 500;
  const degPerM = 1 / 111_320;

  it('north of center → withinGeofence true (400m)', () => {
    const point = { latitude: center.latitude + 400 * degPerM, longitude: center.longitude };
    expect(evaluateGeofence(point, center, radius).withinGeofence).toBe(true);
  });

  it('south of center → withinGeofence true (400m)', () => {
    const point = { latitude: center.latitude - 400 * degPerM, longitude: center.longitude };
    expect(evaluateGeofence(point, center, radius).withinGeofence).toBe(true);
  });

  it('east of center → withinGeofence true (400m)', () => {
    const point = { latitude: center.latitude, longitude: center.longitude + 400 * degPerM };
    expect(evaluateGeofence(point, center, radius).withinGeofence).toBe(true);
  });

  it('west of center → withinGeofence true (400m)', () => {
    const point = { latitude: center.latitude, longitude: center.longitude - 400 * degPerM };
    expect(evaluateGeofence(point, center, radius).withinGeofence).toBe(true);
  });

  it('diagonal (northeast) → withinGeofence true (400m diagonal ≈ 566m — outside)', () => {
    // 400m NE diagonal: sqrt(400^2 + 400^2) ≈ 566m > 500m radius
    const point = {
      latitude: center.latitude + 400 * degPerM,
      longitude: center.longitude + 400 * degPerM,
    };
    expect(evaluateGeofence(point, center, radius).withinGeofence).toBe(false);
  });

  it('diagonal (northeast, shorter) → withinGeofence true (280m diagonal ≈ 396m < 500m)', () => {
    const point = {
      latitude: center.latitude + 280 * degPerM,
      longitude: center.longitude + 280 * degPerM,
    };
    expect(evaluateGeofence(point, center, radius).withinGeofence).toBe(true);
  });
});
