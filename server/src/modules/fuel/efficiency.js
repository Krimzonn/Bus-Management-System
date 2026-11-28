// Fuel efficiency estimate (IMPLEMENTATION_SLICES.md, Slice 11):
//   (last valid odometer - first valid odometer in the range) / total liters in the range.
// An operational estimate, not a tank-to-tank measurement. The odometer unit is not
// defined by the application, so no unit is attached. When the data cannot support a
// safe figure the result says "Insufficient data" and why; nothing is fabricated.

export const INSUFFICIENT_DATA = "Insufficient data";

// NUMERIC(…,2) values arrive as text with exactly two decimals ("40.50"). Sums are
// done in whole hundredths so no floating-point drift can creep in.
export const toHundredths = (text) => Number(String(text).replace(".", ""));
export const formatHundredths = (value) =>
  `${Math.trunc(value / 100)}.${String(value % 100).padStart(2, "0")}`;

function insufficient(reason) {
  return {
    status: "insufficient_data",
    label: INSUFFICIENT_DATA,
    reason,
    distance: null,
    liters: null,
    distancePerLiter: null,
  };
}

const round2 = (value) => Math.round(value * 100) / 100;

// `odometers`: readings of ONE bus in chronological order (date, then odometer).
// `litersHundredths`: all liters recorded for that bus in the same range.
export function estimateFuelEfficiency(odometers, litersHundredths) {
  if (odometers.length === 0) return insufficient("NO_RECORDS");
  if (odometers.length < 2) return insufficient("NOT_ENOUGH_RECORDS");
  for (let i = 1; i < odometers.length; i += 1) {
    if (odometers[i] < odometers[i - 1]) return insufficient("INCONSISTENT_ODOMETER");
  }
  const distance = odometers[odometers.length - 1] - odometers[0];
  if (distance === 0) return insufficient("ZERO_DISTANCE");
  if (!(litersHundredths > 0)) return insufficient("NO_RECORDS");
  return {
    status: "ok",
    label: null,
    reason: null,
    distance,
    liters: formatHundredths(litersHundredths),
    distancePerLiter: round2(distance / (litersHundredths / 100)),
  };
}

// Several buses: total distance over total liters of the buses that have enough data.
// A distance cannot be pooled with the liters of a bus that has no usable distance.
export function combineEfficiency(results) {
  const usable = results.filter((item) => item.status === "ok");
  if (results.length === 0) return { ...insufficient("NO_RECORDS"), busesIncluded: 0, busesExcluded: 0 };
  if (usable.length === 0) {
    return { ...insufficient("NO_BUS_WITH_SUFFICIENT_DATA"), busesIncluded: 0, busesExcluded: results.length };
  }
  const distance = usable.reduce((sum, item) => sum + item.distance, 0);
  const liters = usable.reduce((sum, item) => sum + toHundredths(item.liters), 0);
  return {
    status: "ok",
    label: null,
    reason: null,
    distance,
    liters: formatHundredths(liters),
    distancePerLiter: round2(distance / (liters / 100)),
    busesIncluded: usable.length,
    busesExcluded: results.length - usable.length,
  };
}