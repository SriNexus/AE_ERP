export const DEMO_TIMELINE_BASE='2026-03-01T09:00:00.000Z';
const DAY=86_400_000;
export function demoAt(day:number,hour=9){const d=new Date(Date.parse(DEMO_TIMELINE_BASE)+day*DAY);d.setUTCHours(hour,0,0,0);return d.toISOString()}
export function demoDate(day:number){return demoAt(day).slice(0,10)}
