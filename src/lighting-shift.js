// The lighting clock is accelerated independently of the production schedule.
const startMinute = 8 * 60;
const minutesPerDay = 24 * 60;
const dayStarts = 6 * 60;
const nightStarts = 18 * 60;
export const SHIFT_CLOCK_RATE = 15;

export function shiftMinuteAt(elapsedSeconds) {
  const seconds = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  return (startMinute + Math.floor(seconds * SHIFT_CLOCK_RATE / 60)) % minutesPerDay;
}

export function isNightShift(mode, minute) {
  return mode === 'night' || (mode === 'auto' && (minute >= nightStarts || minute < dayStarts));
}

export function formatShiftClock(minute) {
  const hours = Math.floor(minute / 60);
  return `${String(hours).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}
