/**
 * Production fix regression tests — the uncertainty-aware geofence
 * decision model (docs/audits/GEO_ATTENDANCE_CURRENT_STATE_AUDIT.md and
 * the production-fix task's §27 explicit requirement: "Add tests for
 * accuracy 30m/50m/75m/100m/116m/150m/beyond the configured maximum").
 *
 * Establishes the documented decision model first, then encodes it —
 * per the task's explicit instruction not to decide expected outcomes
 * arbitrarily:
 *
 *   accuracy > ceiling                        -> accuracyUsable: false
 *   distance + accuracy <= radius              -> confidence: 'high'
 *   distance <= radius (but not 'high')        -> confidence: 'medium'
 *   distance <= radius + accuracy (not above)  -> confidence: 'low'
 *   otherwise                                  -> confidence: 'none'
 */
import { describe, it, expect } from 'vitest';
import {
  distanceMeters,
  evaluateGeofenceWithConfidence,
  classifyGpsQuality,
  isValidCoordinate,
  GPS_QUALITY_EXCELLENT_METERS,
  GPS_QUALITY_ACCEPTABLE_METERS,
} from '../geo';

const CENTER = { latitude: 28.6139, longitude: 77.2090 };
const RADIUS = 100;
const CEILING = 150;
const GOOD = 50;

/** Build a point roughly `metres` north of CENTER (small-distance approximation). */
function pointAtDistance(metres: number) {
  const degPerMetre = 1 / 111_320; // ~metres per degree latitude
  return { latitude: CENTER.latitude + metres * degPerMetre, longitude: CENTER.longitude };
}

describe('evaluateGeofenceWithConfidence — the accuracy-as-uncertainty model', () => {
  it('accuracy beyond the ceiling is reported unusable, and falls back to plain distance<=radius', () => {
    const point = pointAtDistance(20);
    const result = evaluateGeofenceWithConfidence(point, CENTER, RADIUS, 480, CEILING);
    expect(result.accuracyUsable).toBe(false);
    expect(result.withinGeofence).toBe(true); // 20m <= 100m radius, regardless of the unusable accuracy
    expect(result.confidence).toBe('medium');
  });

  it('accuracy beyond the ceiling + point outside radius -> rejected, confidence none', () => {
    const point = pointAtDistance(500);
    const result = evaluateGeofenceWithConfidence(point, CENTER, RADIUS, 480, CEILING);
    expect(result.withinGeofence).toBe(false);
    expect(result.confidence).toBe('none');
  });

  it('reproduces the reported production case: ~20m away, ±116m accuracy, 100m radius -> accepted (low/medium confidence, not rejected)', () => {
    const point = pointAtDistance(20);
    const result = evaluateGeofenceWithConfidence(point, CENTER, RADIUS, 116, CEILING);
    expect(result.accuracyUsable).toBe(true);
    expect(result.withinGeofence).toBe(true);
    // distance(20) <= radius(100) already, independent of accuracy -> medium
    expect(result.confidence).toBe('medium');
  });

  it('accuracy=30m, distance=10m, radius=100m -> high confidence (worst case still inside)', () => {
    const result = evaluateGeofenceWithConfidence(pointAtDistance(10), CENTER, RADIUS, 30, CEILING);
    expect(result.withinGeofence).toBe(true);
    expect(result.confidence).toBe('high'); // 10+30=40 <= 100
  });

  it('accuracy=50m, distance=45m, radius=100m -> high confidence (10+90=... check boundary precisely)', () => {
    const result = evaluateGeofenceWithConfidence(pointAtDistance(45), CENTER, RADIUS, 50, CEILING);
    expect(result.withinGeofence).toBe(true);
    expect(result.confidence).toBe('high'); // 45+50=95 <= 100
  });

  it('accuracy=75m, distance=40m, radius=100m -> medium confidence (best estimate inside, worst case outside)', () => {
    const result = evaluateGeofenceWithConfidence(pointAtDistance(40), CENTER, RADIUS, 75, CEILING);
    expect(result.withinGeofence).toBe(true);
    expect(result.confidence).toBe('medium'); // dist(40)<=100 but 40+75=115 > 100
  });

  it('accuracy=100m, distance=140m, radius=100m -> low confidence (best estimate outside, but plausible within uncertainty)', () => {
    const result = evaluateGeofenceWithConfidence(pointAtDistance(140), CENTER, RADIUS, 100, CEILING);
    expect(result.withinGeofence).toBe(true);
    expect(result.confidence).toBe('low'); // dist(140) > 100, but 140 <= 100+100=200
  });

  it('accuracy=116m, distance=250m, radius=100m -> rejected (outside even with full uncertainty allowance)', () => {
    const result = evaluateGeofenceWithConfidence(pointAtDistance(250), CENTER, RADIUS, 116, CEILING);
    expect(result.withinGeofence).toBe(false);
    expect(result.confidence).toBe('none'); // 250 > 100+116=216
  });

  it('accuracy=150m (exactly at the ceiling) is usable; accuracy=150.01m is not', () => {
    const usable = evaluateGeofenceWithConfidence(pointAtDistance(10), CENTER, RADIUS, 150, 150);
    expect(usable.accuracyUsable).toBe(true);
    const unusable = evaluateGeofenceWithConfidence(pointAtDistance(10), CENTER, RADIUS, 150.01, 150);
    expect(unusable.accuracyUsable).toBe(false);
  });

  it('missing/invalid accuracy is treated as unusable, not as a crash', () => {
    const result = evaluateGeofenceWithConfidence(pointAtDistance(10), CENTER, RADIUS, undefined, CEILING);
    expect(result.accuracyUsable).toBe(false);
    expect(result.withinGeofence).toBe(true); // still passes via plain distance<=radius
  });

  it('non-positive or non-finite accuracy is treated as unusable', () => {
    expect(evaluateGeofenceWithConfidence(pointAtDistance(10), CENTER, RADIUS, 0, CEILING).accuracyUsable).toBe(false);
    expect(evaluateGeofenceWithConfidence(pointAtDistance(10), CENTER, RADIUS, -5, CEILING).accuracyUsable).toBe(false);
    expect(evaluateGeofenceWithConfidence(pointAtDistance(10), CENTER, RADIUS, NaN, CEILING).accuracyUsable).toBe(false);
    expect(evaluateGeofenceWithConfidence(pointAtDistance(10), CENTER, RADIUS, Infinity, CEILING).accuracyUsable).toBe(false);
  });

  it('exactly-at-radius-boundary with zero accuracy contribution still passes (inclusive <=, preserved from evaluateGeofence)', () => {
    const dist = distanceMeters(pointAtDistance(RADIUS), CENTER);
    expect(dist).toBeCloseTo(RADIUS, 0);
    const result = evaluateGeofenceWithConfidence(pointAtDistance(RADIUS), CENTER, RADIUS, undefined, CEILING);
    expect(result.withinGeofence).toBe(true);
  });
});

describe('classifyGpsQuality — UX-only tiers, not security gates', () => {
  it('classifies the full range from excellent to unusable', () => {
    expect(classifyGpsQuality(10, GOOD, CEILING)).toBe('excellent');
    expect(classifyGpsQuality(GPS_QUALITY_EXCELLENT_METERS, GOOD, CEILING)).toBe('excellent');
    expect(classifyGpsQuality(35, GOOD, CEILING)).toBe('good');
    expect(classifyGpsQuality(GOOD, GOOD, CEILING)).toBe('good');
    expect(classifyGpsQuality(75, GOOD, CEILING)).toBe('acceptable');
    expect(classifyGpsQuality(GPS_QUALITY_ACCEPTABLE_METERS, GOOD, CEILING)).toBe('acceptable');
    expect(classifyGpsQuality(120, GOOD, CEILING)).toBe('weak');
    expect(classifyGpsQuality(CEILING, GOOD, CEILING)).toBe('weak');
    expect(classifyGpsQuality(151, GOOD, CEILING)).toBe('unusable');
  });

  it('the exact reported production reading (±116m) classifies as weak, not unusable', () => {
    expect(classifyGpsQuality(116, GOOD, CEILING)).toBe('weak');
  });

  it('missing/invalid accuracy classifies as unusable', () => {
    expect(classifyGpsQuality(undefined, GOOD, CEILING)).toBe('unusable');
    expect(classifyGpsQuality(0, GOOD, CEILING)).toBe('unusable');
    expect(classifyGpsQuality(NaN, GOOD, CEILING)).toBe('unusable');
  });
});

describe('isValidCoordinate — coordinate sanity check', () => {
  it('accepts real-world coordinates', () => {
    expect(isValidCoordinate(28.6139, 77.2090)).toBe(true);
    expect(isValidCoordinate(-90, -180)).toBe(true);
    expect(isValidCoordinate(90, 180)).toBe(true);
    expect(isValidCoordinate(0, 0)).toBe(true);
  });

  it('rejects out-of-range and non-finite values', () => {
    expect(isValidCoordinate(91, 0)).toBe(false);
    expect(isValidCoordinate(-91, 0)).toBe(false);
    expect(isValidCoordinate(0, 181)).toBe(false);
    expect(isValidCoordinate(0, -181)).toBe(false);
    expect(isValidCoordinate(NaN, 0)).toBe(false);
    expect(isValidCoordinate(0, Infinity)).toBe(false);
  });
});
