/**
 * Attendance toast copy — the small, auto-dismissing success notification
 * shown after Check In / Check Out (Attendance page redesign spec §6):
 * employee name, action, time, and geofence verification status, in one
 * compact line. Never a modal.
 */
import type { AttendanceCheckSubRecord } from './types';
import { formatDistanceMeters } from '../../lib/geo';

function describeVerification(sub: AttendanceCheckSubRecord | undefined): string {
  if (!sub || sub.source !== 'gps') return '';
  if (!sub.withinGeofence) return 'not geofence-verified';
  const distance = formatDistanceMeters(sub.distanceFromLocationMeters);
  const where = sub.approvedLocationName ? ` from ${sub.approvedLocationName}` : '';
  const confidence = sub.geoConfidence === 'low' ? ', low confidence' : '';
  return distance ? `verified — ${distance}${where}${confidence}` : `verified${where}${confidence}`;
}

export function describeCheckInToast(employeeName: string, sub: AttendanceCheckSubRecord | undefined): string {
  const time = sub ? new Date(sub.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const verification = describeVerification(sub);
  return [`${employeeName || 'You'} checked in`, time, verification].filter(Boolean).join(' · ');
}

export function describeCheckOutToast(employeeName: string, sub: AttendanceCheckSubRecord | undefined, workingHours?: number): string {
  const time = sub ? new Date(sub.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const verification = describeVerification(sub);
  const hours = typeof workingHours === 'number' ? `${workingHours.toFixed(2)}h worked` : '';
  return [`${employeeName || 'You'} checked out`, time, verification, hours].filter(Boolean).join(' · ');
}
