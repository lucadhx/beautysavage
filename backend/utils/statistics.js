const MONTH_LABELS = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre'
];

export function startOfDay(date) {
  const target = date ? new Date(date) : new Date();
  target.setHours(0, 0, 0, 0);
  return target;
}

function createSegment(label, start, end) {
  return {
    label,
    start,
    end,
    count: 0,
    revenue: 0,
    formations: 0,
    products: 0,
    giftCardPurchases: 0,
    giftCardUsage: 0
  };
}

export function buildSegments(period, reference = new Date()) {
  const base = new Date(reference);
  if (Number.isNaN(base.getTime())) {
    base.setTime(Date.now());
  }
  const now = new Date(base);
  if (period === 'week') {
    const start = startOfDay(now);
    const adjust = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - adjust);
    start.setHours(0, 0, 0, 0);
    const segments = [];
    for (let index = 0; index < 7; index += 1) {
      const segmentStart = new Date(start);
      segmentStart.setDate(start.getDate() + index);
      const segmentEnd = new Date(segmentStart);
      segmentEnd.setDate(segmentStart.getDate() + 1);
      segments.push(
        createSegment(segmentStart.toLocaleDateString(undefined, { weekday: 'short' }), segmentStart, segmentEnd)
      );
    }
    return segments;
  }
  if (period === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const segments = [];
    for (let index = 0; index < daysInMonth; index += 1) {
      const segmentStart = new Date(start);
      segmentStart.setDate(start.getDate() + index);
      const segmentEnd = new Date(segmentStart);
      segmentEnd.setDate(segmentStart.getDate() + 1);
      segments.push(createSegment(`${segmentStart.getDate()}`, segmentStart, segmentEnd));
    }
    return segments;
  }
  if (period === 'year') {
    const start = new Date(now.getFullYear(), 0, 1);
    const segments = [];
    for (let month = 0; month < 12; month += 1) {
      const segmentStart = new Date(now.getFullYear(), month, 1);
      const segmentEnd =
        month === 11 ? new Date(now.getFullYear() + 1, 0, 1) : new Date(now.getFullYear(), month + 1, 1);
      segments.push(createSegment(MONTH_LABELS[month], segmentStart, segmentEnd));
    }
    return segments;
  }
  const start = startOfDay(now);
  const segments = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const segmentStart = new Date(start);
    segmentStart.setHours(hour);
    const segmentEnd = new Date(segmentStart);
    segmentEnd.setHours(segmentStart.getHours() + 1);
    const label = `${String(segmentStart.getHours()).padStart(2, '0')}h`;
    segments.push(createSegment(label, segmentStart, segmentEnd));
  }
  return segments;
}

export function locateSegment(segments, timestamp) {
  for (const segment of segments) {
    if (timestamp >= segment.start.getTime() && timestamp < segment.end.getTime()) {
      return segment;
    }
  }
  return null;
}
