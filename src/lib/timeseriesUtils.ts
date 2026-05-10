// Shared chart utilities used by both the full Trends view and the grid of
// thumbnail MiniCharts. Pulled out of Trends.tsx so the two renderers stay in
// sync on date alignment, color selection, and year grouping.

export interface DatasetSeries {
  dates: string[];   // 'YYYY-MM-DD'
  values: number[];  // parallel to dates
}

export interface YearSeries {
  year: number;
  data: [number, number][]; // [day-of-year (leap-aligned), value]
}

export interface ThemeColors {
  yearOld: string;
  yearRecent: string;
  yearCurrent: string;
  yearPrev: string;
  yearPrev2: string;
  yearRecord: string;
  axis: string;
  grid: string;
  text: string;
  subtitle: string;
  tooltipBg: string;
  tooltipBorder: string;
}

// Days-before-month index for a leap year. Used to align all years' day-of-year
// onto a common 0..365 axis so non-leap and leap years overlay cleanly,
// matching ymd_to_year_day_for_graph() in sea-surface-temps.py.
export const LEAP_DAYS_BEFORE_MONTH = [
  0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335,
];

export function leapAlignedDayOfYear(dateStr: string): number {
  const [, m, d] = dateStr.split('-').map(Number);
  return LEAP_DAYS_BEFORE_MONTH[m - 1] + d - 1;
}

// Day-of-year (leap-aligned) → "Mon D" label.
export function dayLabel(doy: number): string {
  const refStart = Date.UTC(2000, 0, 1); // 2000 is a leap year
  const date = new Date(refStart + doy * 86400000);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

// Linear interpolation between two color stops in CSS hex. Sufficient for the
// year-gradient; not perceptually uniform but visually acceptable for the
// 44-year fade.
export function lerpHex(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const out = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('');
}

function parseHex(c: string): [number, number, number] {
  const h = c.trim().replace(/^#/, '');
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h.padEnd(6, '0');
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function readVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function readThemeColors(): ThemeColors {
  return {
    yearOld: readVar('--year-old', '#cccccc'),
    yearRecent: readVar('--year-recent', '#1a3a96'),
    yearCurrent: readVar('--year-current', '#d92020'),
    yearPrev: readVar('--year-prev', '#c66400'),
    yearPrev2: readVar('--year-prev2', '#1f7a3a'),
    yearRecord: readVar('--year-record', '#000000'),
    axis: readVar('--chart-axis', 'rgba(0,0,0,0.4)'),
    grid: readVar('--chart-grid', 'rgba(0,0,0,0.08)'),
    text: readVar('--chart-text', 'rgba(0,0,0,0.8)'),
    subtitle: readVar('--chart-subtitle', 'rgba(0,0,0,0.55)'),
    tooltipBg: readVar('--chart-tooltip-bg', 'rgba(255,255,255,0.96)'),
    tooltipBorder: readVar('--chart-tooltip-border', 'rgba(0,0,0,0.18)'),
  };
}

// Group a (dates, values) series into per-year arrays of [day-of-year, value]
// points, sorted oldest year first.
export function groupByYear(series: DatasetSeries): YearSeries[] {
  const byYear = new Map<number, [number, number][]>();
  for (let i = 0; i < series.dates.length; i++) {
    const date = series.dates[i];
    const value = series.values[i];
    if (!Number.isFinite(value)) continue;
    const year = Number(date.slice(0, 4));
    const doy = leapAlignedDayOfYear(date);
    const arr = byYear.get(year) ?? [];
    arr.push([doy, value]);
    byYear.set(year, arr);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, data]) => ({ year, data: data.sort((p, q) => p[0] - q[0]) }));
}
