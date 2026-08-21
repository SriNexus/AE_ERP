# Phase 10 — Location Assignment / Multi-Location Decision

## Decision: DEFERRED

Multi-location support is **not implemented** in this phase.

## Rationale

1. **Single-warehouse sufficient**: The current `User.warehouseId` assignment model covers the near-term geo-attendance MVP. Most employees are assigned to one primary work location.

2. **Schema is extensible**: Adding multi-location later requires only:
   - A new optional field on `User`: `additionalApprovedWarehouseIds?: string[]`
   - Extending `resolveAttendanceWarehouse()` to loop over multiple warehouses
   - No breaking changes, no data migration, no Firestore rule changes

3. **Rules are already safe**: The Phase 6 attendance rules block checks employee identity ownership (`resource.data.employeeId == request.auth.uid`), not location. Multi-location writes will pass existing rules without modification.

4. **Complexity not justified**: Closest-location selection, fallback logic, and multi-warehouse evaluation add real complexity that isn't needed for the core geo-attendance feature yet.

## Extension Point Documentation

When multi-location is needed, the implementation path is:

### User Type Extension
```typescript
// src/types/index.ts — add to User interface
additionalApprovedWarehouseIds?: string[];
```

### Warehouse Resolution Extension
```typescript
// src/services/AttendanceService.ts — extend resolveAttendanceWarehouse
// Current: resolveAttendanceWarehouse(warehouseId) → single Warehouse | null
// Future:  resolveEligibleWarehouses(user) → Warehouse[] (primary + additional)
// Then:    loop over eligible warehouses, find closest match
```

### Schema Compatibility
- `AttendanceCheckSubRecord.approvedLocationId` already records which Warehouse was matched
- `AttendanceCheckSubRecord.distanceFromLocationMeters` already records distance
- No schema changes needed — the existing fields naturally support multi-location

### No Firestore Changes Required
- Rules already use identity-based access control, not location-based
- Indexes already cover `companyId + employeeId + date` queries
- No new collections needed

## Acceptance Criteria

- [x] Explicit decision documented
- [x] Schema confirmed extensible (no breaking changes needed)
- [x] Extension point documented for future implementation
- [x] Single-location check-in continues working identically

## Verified

- `AttendanceService.resolveAttendanceWarehouse()` accepts a single `warehouseId` and returns `Warehouse | null`
- `AttendanceCheckSubRecord.approvedLocationId` records the matched Warehouse
- `User.warehouseId` is the sole assignment field
- Firestore rules don't reference Warehouse in access control
- All Phase 1–9 tests pass with single-location behavior
