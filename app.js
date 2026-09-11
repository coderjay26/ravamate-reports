/* Ravamate report — all values below are parsed from the supplied Firebase CSV exports. */
const DAY = 86_400_000;
const state = { daily: {}, weekly: {}, retention: {}, min: null, max: null };

const iso = date => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const ymdDate = ymd => new Date(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8));
const addDays = (date, days) => new Date(date.getTime() + days * DAY);
const average = values => values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const comma = value => new Intl.NumberFormat('en-US').format(Math.round(value));
const formatDate = date => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
const shortDate = date => new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit' }).format(date);

function parseExport(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const sections = [];
  let start = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const startMatch = line.match(/^# Start date: (\d{8})/);
    if (startMatch) start = ymdDate(startMatch[1]);
    if (!/^(Nth (day|week)|Cohort),/.test(line)) continue;
    const [indexName, ...columns] = line.split(',');
    const rows = [];
    for (let rowIndex = index + 1; rowIndex < lines.length; rowIndex += 1) {
      const row = lines[rowIndex].trim();
      if (!row || row.startsWith('#')) break;
      const values = row.split(',');
      if (values.length !== columns.length + 1 || !/^\d+$/.test(values[0])) break;
      rows.push({ index: +values[0], values: values.slice(1).map(Number) });
    }
    sections.push({ indexName, columns, start, rows });
  }
  return sections;
}

function section(sections, indexName, column) {
  return sections.find(item => item.indexName === indexName && item.columns.includes(column));
}

function toPoints(source, column) {
  if (!source || !source.start) return [];
  const columnIndex = source.columns.indexOf(column);
  const dayFactor = source.indexName === 'Nth week' ? 7 : 1;
  return source.rows.map(row => ({ date: addDays(source.start, row.index * dayFactor), value: row.values[columnIndex] }));
}

function inRange(data, start, end) {
  return data.filter(point => point.date >= start && point.date <= end);
}

function previousRange(data, current) {
  if (!current.length) return [];
  const first = +current[0].date;
  const span = +current.at(-1).date - first + DAY;
  return data.filter(point => +point.date >= first - span && +point.date < first);
}

function delta(current, previous) {
  const before = average(previous.map(point => point.value));
  const now = average(current.map(point => point.value));
  return before ? ((now - before) / before) * 100 : null;
}

function setDelta(id, value) {
  const target = document.getElementById(id);
  if (value === null || !Number.isFinite(value)) { target.textContent = ''; target.className = 'delta'; return; }
  target.textContent = `${value >= 0 ? '+' : ''}${value.toFixed(0)}% vs prior`;
  target.className = `delta ${value >= 0 ? 'up' : 'down'}`;
}

function renderChart(svgId, tooltipId, series, options = {}) {
  const svg = document.getElementById(svgId);
  const tooltip = document.getElementById(tooltipId);
  const width = Math.max(280, svg.clientWidth || 520);
  const height = Math.max(180, svg.clientHeight || 255);
  const points = series.flatMap(item => item.data);
  if (!points.length) { svg.innerHTML = `<text x="${width / 2}" y="${height / 2}" text-anchor="middle">No data in this range</text>`; return; }
  const primary = series.filter(item => item.axis !== 'right');
  const secondary = series.filter(item => item.axis === 'right');
  const pad = { top: 12, right: secondary.length ? 43 : 12, bottom: 26, left: 40 };
  const minTime = Math.min(...points.map(point => +point.date));
  const maxTime = Math.max(...points.map(point => +point.date));
  const rangeTime = maxTime - minTime || DAY;
  const domain = (items, forcePercent) => {
    const values = items.flatMap(item => item.data.map(point => point.value));
    const max = forcePercent ? 100 : Math.max(1, ...values) * 1.08;
    return [0, max];
  };
  const [minY, maxY] = domain(primary, options.percent);
  const [minY2, maxY2] = domain(secondary, options.percent);
  const x = date => pad.left + ((+date - minTime) / rangeTime) * (width - pad.left - pad.right);
  const y = value => height - pad.bottom - ((value - minY) / (maxY - minY || 1)) * (height - pad.top - pad.bottom);
  const y2 = value => height - pad.bottom - ((value - minY2) / (maxY2 - minY2 || 1)) * (height - pad.top - pad.bottom);
  const format = value => options.percent ? `${Math.round(value)}%` : comma(value);
  let markup = '<defs>' + series.map((item, index) => `<linearGradient id="${svgId}-gradient-${index}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${item.color}" stop-opacity=".16"/><stop offset="1" stop-color="${item.color}" stop-opacity="0"/></linearGradient>`).join('') + '</defs>';
  [0, .5, 1].forEach(ratio => {
    const value = minY + (maxY - minY) * ratio;
    const yy = y(value);
    markup += `<line class="grid" x1="${pad.left}" x2="${width - pad.right}" y1="${yy}" y2="${yy}"/><text class="axis-label" x="${pad.left - 6}" y="${yy + 3}" text-anchor="end">${format(value)}</text>`;
    if (secondary.length) markup += `<text class="axis-label" x="${width - pad.right + 6}" y="${yy + 3}">${format(minY2 + (maxY2 - minY2) * ratio)}</text>`;
  });
  [0, .5, 1].forEach(ratio => {
    const date = new Date(minTime + rangeTime * ratio);
    const anchor = ratio === 0 ? 'start' : ratio === 1 ? 'end' : 'middle';
    markup += `<text class="axis-label" x="${x(date)}" y="${height - 5}" text-anchor="${anchor}">${shortDate(date)}</text>`;
  });
  series.forEach((item, index) => {
    const scale = item.axis === 'right' ? y2 : y;
    const path = item.data.map((point, itemIndex) => `${itemIndex ? 'L' : 'M'} ${x(point.date).toFixed(1)} ${scale(point.value).toFixed(1)}`).join(' ');
    if (item.area) markup += `<path d="${path} L ${x(item.data.at(-1).date).toFixed(1)} ${height - pad.bottom} L ${x(item.data[0].date).toFixed(1)} ${height - pad.bottom} Z" fill="url(#${svgId}-gradient-${index})"/>`;
    markup += `<path d="${path}" fill="none" stroke="${item.color}" stroke-width="${item.width || 1.8}" ${item.dash ? `stroke-dasharray="${item.dash}"` : ''} stroke-linecap="round" stroke-linejoin="round"/>`;
  });
  svg.innerHTML = markup;
  svg.onmousemove = event => {
    const rect = svg.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left - pad.left) / (width - pad.left - pad.right), 0, 1);
    const targetTime = minTime + rangeTime * ratio;
    const closest = data => data.reduce((best, point) => Math.abs(+point.date - targetTime) < Math.abs(+best.date - targetTime) ? point : best, data[0]);
    const items = series.map(item => ({ item, point: closest(item.data) }));
    tooltip.innerHTML = `<b>${formatDate(items[0].point.date)}</b><br>${items.map(({ item, point }) => `<span style="color:${item.color}">●</span> ${item.name}: ${item.valueFormat ? item.valueFormat(point.value) : format(point.value)}`).join('<br>')}`;
    tooltip.style.display = 'block';
    tooltip.style.left = `${clamp(event.clientX - rect.left + 12, 5, rect.width - 150)}px`;
    tooltip.style.top = `${clamp(event.clientY - rect.top - 55, 4, rect.height - 75)}px`;
  };
  svg.onmouseleave = () => { tooltip.style.display = 'none'; };
}

function refresh() {
  const start = new Date(`${document.getElementById('startDate').value}T00:00:00`);
  const end = new Date(`${document.getElementById('endDate').value}T23:59:59`);
  const daily = Object.fromEntries(Object.entries(state.daily).map(([key, data]) => [key, inRange(data, start, end)]));
  const weekly = Object.fromEntries(Object.entries(state.weekly).map(([key, data]) => [key, inRange(data, start, end)]));
  const retention = Object.fromEntries(Object.entries(state.retention).map(([key, data]) => [key, inRange(data, start, end)]));
  const mins = average(weekly.minutes.map(point => point.value)) / 420;
  const sessions = average(weekly.sessions.map(point => point.value)) / 7;
  const stickiness = average(daily.dauMau.map(point => point.value));
  const dau = average(daily.active.map(point => point.value));
  document.getElementById('dauValue').textContent = comma(dau);
  document.getElementById('minutesValue').textContent = `${mins.toFixed(1)}`;
  document.getElementById('sessionsValue').textContent = sessions.toFixed(1);
  document.getElementById('stickinessValue').textContent = `${stickiness.toFixed(0)}%`;
  setDelta('dauDelta', delta(daily.active, previousRange(state.daily.active, daily.active)));
  setDelta('minutesDelta', delta(weekly.minutes, previousRange(state.weekly.minutes, weekly.minutes)));
  setDelta('sessionsDelta', delta(weekly.sessions, previousRange(state.weekly.sessions, weekly.sessions)));
  setDelta('stickinessDelta', delta(daily.dauMau, previousRange(state.daily.dauMau, daily.dauMau)));
  renderChart('usageChart', 'usageTooltip', [
    { name: 'Minutes / day', data: weekly.minutes.map(point => ({ ...point, value: point.value / 420 })), color: '#2e5c51', area: true, valueFormat: value => `${value.toFixed(1)} min` },
    { name: 'Sessions / day', data: weekly.sessions.map(point => ({ ...point, value: point.value / 7 })), color: '#c6893c', axis: 'right', dash: '4 3', valueFormat: value => value.toFixed(1) }
  ]);
  renderChart('activeChart', 'activeTooltip', [
    { name: 'Daily active', data: daily.active, color: '#2e5c51', area: true },
    { name: 'Recently inactive', data: daily.recentlyInactive, color: '#76817b', dash: '3 3', width: 1.4 }
  ]);
  renderChart('acquisitionChart', 'acquisitionTooltip', [
    { name: 'New', data: daily.newUsers, color: '#c6893c', area: true },
    { name: 'Returning', data: daily.returning, color: '#2e5c51' }
  ]);
  renderChart('stickinessChart', 'stickinessTooltip', [
    { name: 'DAU / MAU', data: daily.dauMau, color: '#2e5c51', area: true },
    { name: 'DAU / WAU', data: daily.dauWau, color: '#c6893c', dash: '4 3' }
  ], { percent: true });
  renderChart('retentionChart', 'retentionTooltip', [
    { name: 'Day 1', data: retention.day1, color: '#2e5c51' },
    { name: 'Day 7', data: retention.day7, color: '#c6893c' },
    { name: 'Day 30', data: retention.day30, color: '#7c6a93' }
  ], { percent: true });
  const activeStart = daily.active[0]?.value || 0;
  const activeEnd = daily.active.at(-1)?.value || 0;
  const movement = activeEnd - activeStart;
  document.getElementById('insightText').textContent = movement >= 0
    ? `Daily activity rose by ${comma(movement)} users across this period; average daily use was ${mins.toFixed(1)} minutes per active user.`
    : `Daily activity moved down by ${comma(Math.abs(movement))} users across this period; average daily use was ${mins.toFixed(1)} minutes per active user.`;
  document.getElementById('rangeLabel').textContent = daily.active.length ? `Showing ${formatDate(daily.active[0].date)} – ${formatDate(daily.active.at(-1).date)}` : 'No data in this range';
}

function exportSelectedData() {
  const start = new Date(`${document.getElementById('startDate').value}T00:00:00`);
  const end = new Date(`${document.getElementById('endDate').value}T23:59:59`);
  const daily = Object.fromEntries(Object.entries(state.daily).map(([key, data]) => [key, inRange(data, start, end)]));
  const weeklyMinutes = new Map(inRange(state.weekly.minutes, start, end).map(point => [iso(point.date), point.value / 420]));
  const weeklySessions = new Map(inRange(state.weekly.sessions, start, end).map(point => [iso(point.date), point.value / 7]));
  const header = ['date', 'daily_active_users', 'recently_inactive_users', 'new_users', 'returning_users', 'dau_mau_percent', 'dau_wau_percent', 'minutes_per_active_user_per_day', 'engaged_sessions_per_active_user_per_day'];
  const rows = daily.active.map((point, index) => {
    const date = iso(point.date);
    return [
      date, point.value, daily.recentlyInactive[index]?.value ?? '', daily.newUsers[index]?.value ?? '', daily.returning[index]?.value ?? '',
      daily.dauMau[index]?.value ?? '', daily.dauWau[index]?.value ?? '', weeklyMinutes.get(date) ?? '', weeklySessions.get(date) ?? ''
    ];
  });
  const csv = [header, ...rows].map(row => row.join(',')).join('\n');
  const file = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = `ravamate-report-${iso(start)}-to-${iso(end)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function init() {
  try {
    const [engagementText, retentionText] = await Promise.all([
      fetch('Engagement_all.csv').then(response => response.text()),
      fetch('Retention_all.csv').then(response => response.text())
    ]);
    const engagement = parseExport(engagementText);
    const retention = parseExport(retentionText);
    const activeSection = section(engagement, 'Nth day', '1 day');
    state.daily = {
      active: toPoints(activeSection, '1 day'), active7: toPoints(activeSection, '7 days'), active30: toPoints(activeSection, '30 days'),
      dauMau: toPoints(section(engagement, 'Nth day', 'DAU / MAU'), 'DAU / MAU'), dauWau: toPoints(section(engagement, 'Nth day', 'DAU / MAU'), 'DAU / WAU'),
      newUsers: toPoints(section(retention, 'Nth day', 'New users'), 'New users'), returning: toPoints(section(retention, 'Nth day', 'Returning users'), 'Returning users')
    };
    state.daily.recentlyInactive = state.daily.active30.map((point, index) => ({
      date: point.date,
      value: Math.max(0, point.value - (state.daily.active[index]?.value || 0))
    }));
    state.weekly = {
      minutes: toPoints(section(engagement, 'Nth week', 'Average engagement time per active user'), 'Average engagement time per active user'),
      sessions: toPoints(section(engagement, 'Nth week', 'Engaged sessions per active user'), 'Engaged sessions per active user')
    };
    const cohort = section(retention, 'Cohort', 'Day 1');
    // Firebase exports cohort retention as a 0–1 ratio; the rest of the dashboard labels it as a percentage.
    const cohortPercent = column => toPoints(cohort, column).map(point => ({ ...point, value: point.value * 100 }));
    state.retention = { day1: cohortPercent('Day 1'), day7: cohortPercent('Day 7'), day30: cohortPercent('Day 30') };
    const firstActivity = state.daily.active.find(point => point.value > 0)?.date || state.daily.active[0].date;
    state.min = firstActivity;
    state.max = state.daily.active.at(-1).date;
    const start = document.getElementById('startDate');
    const end = document.getElementById('endDate');
    [start, end].forEach(input => { input.min = iso(state.min); input.max = iso(state.max); });
    start.value = iso(state.min); end.value = iso(state.max);
    document.getElementById('fullRange').textContent = `${formatDate(state.min)} – ${formatDate(state.max)}`;
    [start, end].forEach(input => input.addEventListener('change', () => { if (start.value > end.value) [start.value, end.value] = [end.value, start.value]; document.querySelectorAll('.presets button').forEach(button => button.classList.remove('active')); refresh(); }));
    document.querySelectorAll('.presets button').forEach(button => button.addEventListener('click', () => {
      end.value = iso(state.max);
      start.value = button.dataset.days === 'all' ? iso(state.min) : iso(addDays(state.max, -(+button.dataset.days - 1)));
      document.querySelectorAll('.presets button').forEach(item => item.classList.toggle('active', item === button));
      refresh();
    }));
    document.getElementById('exportData').addEventListener('click', exportSelectedData);
    window.addEventListener('resize', refresh);
    refresh();
  } catch (error) {
    document.getElementById('insightText').textContent = 'Open this report through a local web server so the supplied CSV files can be loaded.';
    console.error(error);
  }
}

init();
