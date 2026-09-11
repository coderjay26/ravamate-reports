/* Ravamate engagement dashboard — reads the provided Firebase CSV exports. */
const TOTAL_KNOWN_USERS = 1768;
const DAY = 86400000;
const state = { engagement: {}, retention: {}, min: null, max: null };

const iso = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const dateFromYmd = (ymd) => new Date(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8));
const addDays = (date, days) => new Date(date.getTime() + days * DAY);
const formatDate = (date, short = false) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', ...(short ? {} : { year: 'numeric' }) }).format(date);
const num = (n) => new Intl.NumberFormat('en-US').format(Math.round(n));
const avg = (items) => items.length ? items.reduce((sum, item) => sum + item.value, 0) / items.length : 0;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

function parseExport(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const sections = [];
  let start = null, end = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const startMatch = line.match(/^# Start date: (\d{8})/);
    const endMatch = line.match(/^# End date: (\d{8})/);
    if (startMatch) start = dateFromYmd(startMatch[1]);
    if (endMatch) end = dateFromYmd(endMatch[1]);
    if (!/^(Nth (day|week)|Cohort),/.test(line)) continue;
    const [indexName, ...columns] = line.split(',');
    const rows = [];
    for (let j = i + 1; j < lines.length; j++) {
      const row = lines[j].trim();
      if (!row || row.startsWith('#')) break;
      const parts = row.split(',');
      if (parts.length !== columns.length + 1 || !/^\d+$/.test(parts[0])) break;
      rows.push({ index: +parts[0], values: parts.slice(1).map(Number) });
    }
    sections.push({ indexName, columns, start, end, rows });
  }
  return sections;
}

function findSection(sections, indexName, column) {
  return sections.find((section) => section.indexName === indexName && section.columns.includes(column));
}

function points(section, column) {
  if (!section) return [];
  const col = section.columns.indexOf(column);
  const multiplier = section.indexName === 'Nth week' ? 7 : 1;
  return section.rows.map((row) => ({ date: addDays(section.start, row.index * multiplier), value: row.values[col] }));
}

function within(data, start, end) {
  return data.filter((item) => item.date >= start && item.date <= end);
}

function dateTick(date) { return new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit' }).format(date); }

function chart(svgId, tooltipId, series, options = {}) {
  const svg = document.getElementById(svgId);
  const tooltip = document.getElementById(tooltipId);
  const width = Math.max(280, svg.clientWidth || 500);
  const height = Math.max(125, svg.clientHeight || 250);
  const pad = { top: 14, right: 10, bottom: 25, left: options.compact ? 35 : 42 };
  const flat = series.flatMap((s) => s.data);
  if (!flat.length) { svg.innerHTML = `<text x="${width / 2}" y="${height / 2}" text-anchor="middle">No data in selected range</text>`; return; }
  const minTime = Math.min(...flat.map((p) => +p.date)); const maxTime = Math.max(...flat.map((p) => +p.date));
  const maxValue = Math.max(1, ...flat.map((p) => p.value)); const minValue = options.zero ? 0 : Math.min(0, ...flat.map((p) => p.value));
  const rangeTime = maxTime - minTime || DAY; const rangeValue = maxValue - minValue || 1;
  const x = (date) => pad.left + ((+date - minTime) / rangeTime) * (width - pad.left - pad.right);
  const y = (value) => height - pad.bottom - ((value - minValue) / rangeValue) * (height - pad.top - pad.bottom);
  const labels = [minValue, minValue + rangeValue / 2, maxValue];
  let markup = `<defs>${series.map((s, i) => `<linearGradient id="grad-${svgId}-${i}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".20"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`).join('')}</defs>`;
  labels.forEach((value) => { const yy = y(value); markup += `<line class="grid" x1="${pad.left}" x2="${width - pad.right}" y1="${yy}" y2="${yy}"/><text class="axis-label" x="${pad.left - 7}" y="${yy + 3}" text-anchor="end">${options.valueFormat ? options.valueFormat(value) : num(value)}</text>`; });
  [0, .5, 1].forEach((ratio) => { const time = new Date(minTime + rangeTime * ratio); const xx = x(time); markup += `<text class="axis-label" x="${xx}" y="${height - 5}" text-anchor="${ratio === 0 ? 'start' : ratio === 1 ? 'end' : 'middle'}">${dateTick(time)}</text>`; });
  series.forEach((s, index) => {
    const line = s.data.map((p, i) => `${i ? 'L' : 'M'} ${x(p.date).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
    if (s.area) markup += `<path d="${line} L ${x(s.data[s.data.length - 1].date).toFixed(1)} ${height - pad.bottom} L ${x(s.data[0].date).toFixed(1)} ${height - pad.bottom} Z" fill="url(#grad-${svgId}-${index})"/>`;
    markup += `<path d="${line}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" stroke-linecap="round" stroke-linejoin="round"/>`;
  });
  svg.innerHTML = markup;
  svg.onmousemove = (event) => {
    const rect = svg.getBoundingClientRect(); const ratio = clamp((event.clientX - rect.left - pad.left) / (width - pad.left - pad.right), 0, 1);
    const target = minTime + rangeTime * ratio;
    const near = (data) => data.reduce((best, point) => Math.abs(+point.date - target) < Math.abs(+best.date - target) ? point : best, data[0]);
    const items = series.map((s) => ({ name: s.name, point: near(s.data), color: s.color }));
    tooltip.innerHTML = `<b>${formatDate(items[0].point.date)}</b><br>${items.map((item) => `<span style="color:${item.color}">●</span> ${item.name}: ${item.format ? item.format(item.point.value) : (options.valueFormat ? options.valueFormat(item.point.value) : num(item.point.value))}`).join('<br>')}`;
    tooltip.style.display = 'block'; tooltip.style.left = `${clamp(event.clientX - rect.left + 12, 8, rect.width - 145)}px`; tooltip.style.top = `${clamp(event.clientY - rect.top - 58, 4, rect.height - 72)}px`;
  };
  svg.onmouseleave = () => { tooltip.style.display = 'none'; };
}

function refresh() {
  const start = new Date(`${document.getElementById('startDate').value}T00:00:00`);
  const end = new Date(`${document.getElementById('endDate').value}T23:59:59`);
  const active = within(state.engagement.active, start, end);
  const usage = within(state.engagement.usage, start, end);
  const newUsers = within(state.retention.newUsers, start, end);
  const returning = within(state.retention.returning, start, end);
  const latestActive = active.at(-1)?.value || 0;
  const previousActive = active.at(-2)?.value || latestActive;
  const activeDelta = previousActive ? ((latestActive - previousActive) / previousActive) * 100 : 0;
  const dailyMinutes = avg(usage) / 420;
  // Firebase can include an all-zero in-progress day at the end of the export.
  // Use the last observed activity day for the summary, while retaining the full trend.
  const latestDailyIndex = [...newUsers.keys()].reverse().find((index) => (newUsers[index]?.value || 0) + (returning[index]?.value || 0) > 0);
  const latestNew = latestDailyIndex === undefined ? 0 : newUsers[latestDailyIndex].value;
  const latestReturning = latestDailyIndex === undefined ? 0 : returning[latestDailyIndex].value;
  const returnShare = latestNew + latestReturning ? latestReturning / (latestNew + latestReturning) : 0;
  document.getElementById('activeValue').textContent = num(latestActive);
  document.getElementById('activeChange').innerHTML = `<span class="${activeDelta >= 0 ? 'up' : 'down'}">${activeDelta >= 0 ? '↑' : '↓'} ${Math.abs(activeDelta).toFixed(1)}%</span> vs. prior week`;
  document.getElementById('usageValue').textContent = `${dailyMinutes.toFixed(1)}m`;
  document.getElementById('returningValue').textContent = `${(returnShare * 100).toFixed(0)}%`;
  document.getElementById('returningFoot').textContent = `${num(latestReturning)} returning · ${num(latestNew)} new (last active day)`;
  document.getElementById('inactiveValue').textContent = num(Math.max(0, TOTAL_KNOWN_USERS - latestActive));
  document.getElementById('usageAverage').textContent = `${dailyMinutes.toFixed(1)} min`;
  chart('audienceChart', 'audienceTooltip', [
    { name: 'Active', data: active, color: '#1d563f', area: true },
    { name: 'Dormant', data: active.map((p) => ({ date: p.date, value: Math.max(0, TOTAL_KNOWN_USERS - p.value) })), color: '#c7cabd', width: 1.5 }
  ], { zero: true });
  chart('usageChart', 'usageTooltip', [{ name: 'Minutes / day', data: usage.map((p) => ({ date: p.date, value: p.value / 420 })), color: '#cf8a36', area: true, format: (value) => `${value.toFixed(1)} min` }], { zero: true, compact: true, valueFormat: (value) => `${value.toFixed(0)}m` });
  chart('dailyChart', 'dailyTooltip', [
    { name: 'New', data: newUsers, color: '#db8964', area: true },
    { name: 'Returning', data: returning, color: '#7bc79e', width: 2 }
  ], { zero: true, compact: true });
  const first = active[0]?.value || 0;
  const trend = latestActive - first;
  document.getElementById('insightText').textContent = trend >= 0
    ? `Weekly activity grew by ${num(trend)} users across this selected period, while average daily use is ${dailyMinutes.toFixed(1)} minutes per active user.`
    : `Weekly activity is down ${num(Math.abs(trend))} users across this selected period. Returning users made up ${(returnShare * 100).toFixed(0)}% of the latest day’s activity.`;
}

async function init() {
  try {
    const [engagementText, retentionText] = await Promise.all([fetch('Engagement_all.csv').then((r) => r.text()), fetch('Retention_all.csv').then((r) => r.text())]);
    const engagementSections = parseExport(engagementText); const retentionSections = parseExport(retentionText);
    state.engagement.active = points(findSection(engagementSections, 'Nth week', 'Active users'), 'Active users');
    state.engagement.usage = points(findSection(engagementSections, 'Nth week', 'Average engagement time per active user'), 'Average engagement time per active user');
    state.retention.newUsers = points(findSection(retentionSections, 'Nth day', 'New users'), 'New users');
    state.retention.returning = points(findSection(retentionSections, 'Nth day', 'Returning users'), 'Returning users');
    state.min = new Date(Math.min(...state.retention.newUsers.map((p) => +p.date))); state.max = new Date(Math.max(...state.retention.newUsers.map((p) => +p.date)));
    const startInput = document.getElementById('startDate'); const endInput = document.getElementById('endDate');
    startInput.min = endInput.min = iso(state.min); startInput.max = endInput.max = iso(state.max); startInput.value = iso(state.min); endInput.value = iso(state.max);
    document.getElementById('lastUpdated').textContent = `DATA THROUGH ${formatDate(state.max).toUpperCase()}`;
    [startInput, endInput].forEach((input) => input.addEventListener('change', () => { if (startInput.value > endInput.value) [startInput.value, endInput.value] = [endInput.value, startInput.value]; document.querySelectorAll('.presets button').forEach((b) => b.classList.remove('active')); refresh(); }));
    document.getElementById('resetRange').addEventListener('click', () => { startInput.value = iso(state.min); endInput.value = iso(state.max); document.querySelectorAll('.presets button').forEach((b) => b.classList.remove('active')); refresh(); });
    document.querySelectorAll('.presets button').forEach((button) => button.addEventListener('click', () => { const days = +button.dataset.days; endInput.value = iso(state.max); startInput.value = iso(addDays(state.max, -(days - 1))); document.querySelectorAll('.presets button').forEach((b) => b.classList.toggle('active', b === button)); refresh(); }));
    window.addEventListener('resize', refresh); refresh();
  } catch (error) { document.getElementById('lastUpdated').textContent = 'Could not load CSV data'; document.getElementById('insightText').textContent = 'Open this dashboard through a local web server so the supplied CSV exports can be loaded.'; console.error(error); }
}
init();
