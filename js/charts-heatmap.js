// charts-heatmap.js -- the offset density heatmap.

// ---------------------------------------------------------------------------
// Offset density heatmap
//
// A record carries one number, so a 2D density plot needs a second one to pair
// it with. X is always the hit's own offset; Y is a choice:
//
//   previous -- the previous tap's offset. This is the return map's two
//               coordinates binned into cells, so the same diagonal story
//               reads as a cloud instead of as a correlation coefficient.
//   delta    -- the signed step the timing took between those two taps.
//   absDelta -- the size of that step, direction ignored. Non-negative, so it
//               gets a 0-anchored axis where the other two are symmetric.
//
// Pairs follow the adjacency rule of buildReturnPairs()/buildDeltas(): a miss,
// auto or midspin between the two taps breaks the chain, because the two
// numbers would then describe unrelated presses.
//
// The axes get independent bin sizes: X follows the data spread, Y is derived
// from the canvas aspect so cells stay near square (see renderHeatmapChart).
// One shared bin size would squash one of the axes, because the panel is much
// wider than it is tall.
// ---------------------------------------------------------------------------

let heatmapYMode = 'previous';

const HEATMAP_MODES = ['previous', 'delta', 'absDelta'];

// Target only: the actual column count follows from the axis edge and the
// rounded step. ~26 columns per side keeps the cells large enough to read at
// any window width while still showing structure coarser than a single hit.
const HEATMAP_TARGET_BINS = 26;

// Cool -> hot, dark -> warm. Entries are [stop, rgb]; the stops are uneven on
// purpose, the warm end needs more room to stay distinguishable. Interpolation
// is plain RGB: the colour is decoration -- the count is in the tooltip and the
// ramp only has to read as "more hits".
const HEATMAP_RAMP = [
    [0.00, [26, 38, 92]],
    [0.18, [38, 82, 176]],
    [0.36, [40, 164, 208]],
    [0.54, [72, 208, 126]],
    [0.70, [186, 222, 72]],
    [0.84, [255, 188, 46]],
    [1.00, [226, 58, 50]]
];

function heatmapColor(t) {
    const value = Math.max(0, Math.min(1, t));

    for (let i = 1; i < HEATMAP_RAMP.length; i++) {
        const stop = HEATMAP_RAMP[i][0];
        if (value > stop) continue;

        const previousStop = HEATMAP_RAMP[i - 1][0];
        const from = HEATMAP_RAMP[i - 1][1];
        const to = HEATMAP_RAMP[i][1];
        const f = (value - previousStop) / (stop - previousStop || 1);
        const channels = from.map((channel, index) => Math.round(channel + (to[index] - channel) * f));
        return 'rgb(' + channels[0] + ', ' + channels[1] + ', ' + channels[2] + ')';
    }

    const last = HEATMAP_RAMP[HEATMAP_RAMP.length - 1][1];
    return 'rgb(' + last[0] + ', ' + last[1] + ', ' + last[2] + ')';
}

// The bin edge, rounded to a step axis labels can read: 1, 2, 2.5 or 5 times a
// power of ten. The input is the width the target column count would need.
function niceHeatmapStep(raw) {
    const target = Number.isFinite(raw) && raw > 0 ? raw : 1;
    const magnitude = Math.pow(10, Math.floor(Math.log10(target)));
    const normalized = target / magnitude;

    let nice;
    if (normalized <= 1) nice = 1;
    else if (normalized <= 2) nice = 2;
    else if (normalized <= 2.5) nice = 2.5;
    else if (normalized <= 5) nice = 5;
    else nice = 10;

    return nice * magnitude;
}

// Robust half-range: the 98th percentile of |value|, so one freak hit cannot
// squash the cloud into the centre. Same reasoning as
// getSymmetricOffsetLimit() for the return map.
function heatmapAxisLimit(values) {
    if (values.length === 0) return 1;

    const magnitudes = values.map(value => Math.abs(value)).sort((a, b) => a - b);
    const index = Math.min(magnitudes.length - 1, Math.floor(magnitudes.length * 0.98));
    return Math.max(magnitudes[index], 1e-6);
}

// -> [{ x, y }], one point per adjacent tap pair, in the units being plotted.
function buildHeatmapPoints(records, mode) {
    const points = [];

    for (let i = 1; i < records.length; i++) {
        if (!isTapRecord(records[i - 1]) || !isTapRecord(records[i])) continue;

        const current = records[i][REC.VALUE];
        const previous = records[i - 1][REC.VALUE];
        const delta = current - previous;

        points.push({
            x: current,
            y: mode === 'delta' ? delta : mode === 'absDelta' ? Math.abs(delta) : previous
        });
    }

    return points;
}

// The chart surface is much wider than it is tall, so reuse of one bin size on
// both axes would squash the grid into thin ribbons. The canvas aspect is the
// cheapest estimate available before layout and keeps cells near square.
function heatmapPlotAspect() {
    const canvas = document.getElementById('heatmapChart');
    const width = canvas && canvas.clientWidth ? canvas.clientWidth : 1100;
    const height = canvas && canvas.clientHeight ? canvas.clientHeight : 460;
    const plotWidth = Math.max(200, width - 84);
    const plotHeight = Math.max(140, height - 72);
    return Math.min(1.2, Math.max(0.18, plotHeight / plotWidth));
}

// Chart.js appends min and max to whatever ticks it generates, which leaves
// labels bunched at the ends (24 right next to 20). These ticks are built from
// the bin grid instead, so every label lands on a bin edge and the spacing is
// uniform.
function heatmapTicks(min, max, step, maxTicks) {
    const count = Math.max(1, Math.round((max - min) / step));
    const skip = Math.max(1, Math.ceil((count + 1) / maxTicks));
    const tickStep = step * skip;
    const first = Math.ceil(min / tickStep - 1e-9);
    const last = Math.floor(max / tickStep + 1e-9);
    const ticks = [];
    for (let index = first; index <= last; index++) {
        ticks.push({ value: Math.round(index * tickStep * 1e6) / 1e6 });
    }
    return ticks;
}

function renderHeatmapChart() {
    const records = getActiveRecords();
    const mode = HEATMAP_MODES.includes(heatmapYMode) ? heatmapYMode : 'previous';
    const points = records.length > 1 ? buildHeatmapPoints(records, mode) : [];
    const unit = getUnit();

    const filterEl = document.getElementById('heatmapFilterContainer');
    if (filterEl) filterEl.style.display = 'flex';
    const selectEl = document.getElementById('heatmapYSelect');
    if (selectEl && selectEl.value !== mode) selectEl.value = mode;

    const xLimit = heatmapAxisLimit(points.map(point => point.x));
    const yLimit = heatmapAxisLimit(points.map(point => point.y));

    // Each axis gets its own bin size so the grid stays close to square. The
    // two axes hold different quantities (offset vs. offset or step), so equal
    // millisecond bins were never a meaningful promise here.
    const aspect = heatmapPlotAspect();
    const stepX = niceHeatmapStep((2 * xLimit) / HEATMAP_TARGET_BINS);
    const xEdge = Math.max(stepX, Math.ceil(xLimit / stepX) * stepX);

    const xMin = -xEdge;
    const xMax = xEdge;
    const binsX = Math.max(1, Math.round((xMax - xMin) / stepX));

    const targetRows = Math.min(HEATMAP_TARGET_BINS, Math.max(6, Math.round(binsX * aspect)));
    const ySpan = mode === 'absDelta' ? yLimit : 2 * yLimit;
    const stepY = niceHeatmapStep(ySpan / targetRows);
    const yEdge = Math.max(stepY, Math.ceil(yLimit / stepY) * stepY);
    const yMin = mode === 'absDelta' ? 0 : -yEdge;
    const yMax = yEdge;
    const binsY = Math.max(1, Math.round((yMax - yMin) / stepY));

    const counts = new Map();
    let peak = 0;
    let outside = 0;
    let sumX = 0;

    points.forEach(point => {
        sumX += point.x;

        const ix = Math.floor((point.x - xMin) / stepX);
        const iy = Math.floor((point.y - yMin) / stepY);
        if (ix < 0 || ix >= binsX || iy < 0 || iy >= binsY) {
            outside += 1;
            return;
        }

        const key = iy * binsX + ix;
        const count = (counts.get(key) || 0) + 1;
        counts.set(key, count);
        if (count > peak) peak = count;
    });

    const meanX = points.length ? sumX / points.length : 0;

    const statsEl = document.getElementById('heatmapStats');
    if (statsEl) {
        statsEl.innerHTML = `
            <div class="stat-tile">
                <div class="label">${t('heatmapPairs')}</div>
                <div class="value">${points.length}</div>
            </div>
            <div class="stat-tile">
                <div class="label">${t('heatmapCells')}</div>
                <div class="value">${counts.size}</div>
            </div>
            <div class="stat-tile">
                <div class="label">${t('heatmapPeak')}</div>
                <div class="value">${peak}</div>
            </div>
            <div class="stat-tile">
                <div class="label">${t('heatmapMeanX')}</div>
                <div class="value">${points.length ? (meanX >= 0 ? '+' : '') + meanX.toFixed(2) + unit : '-'}</div>
            </div>
        `;
    }

    // The 98th-percentile edge is a robust choice, not a guarantee: whichever
    // pairs fall outside are reported rather than silently swallowed.
    const badgeEl = document.getElementById('heatmapAxisCropBadge');
    if (badgeEl) {
        if (outside > 0) {
            badgeEl.innerText = (t('heatmapClipped') || '').replace('{count}', outside);
            badgeEl.style.display = 'block';
        } else {
            badgeEl.style.display = 'none';
        }
    }

    const scaleBarEl = document.getElementById('heatmapScaleBar');
    if (scaleBarEl) {
        scaleBarEl.style.background = 'linear-gradient(to right, ' + HEATMAP_RAMP
            .map(entry => 'rgb(' + entry[1][0] + ', ' + entry[1][1] + ', ' + entry[1][2] + ') ' + Math.round(entry[0] * 100) + '%')
            .join(', ') + ')';
    }

    if (heatmapChart) { heatmapChart.destroy(); heatmapChart = null; }

    const canvas = document.getElementById('heatmapChart');
    if (!canvas) return;

    // Empty bins are drawn too: a solid panel reads as a density map, whereas
    // holes read as missing data. The zero colour is the ramp's coldest step.
    const cells = [];
    for (let iy = 0; iy < binsY; iy++) {
        for (let ix = 0; ix < binsX; ix++) {
            const count = counts.get(iy * binsX + ix) || 0;
            cells.push({
                x: xMin + (ix + 0.5) * stepX,
                y: yMin + (iy + 0.5) * stepY,
                v: count,
                color: heatmapColor(peak ? Math.sqrt(count / peak) : 0)
            });
        }
    }

    const yLabelKey = mode === 'previous' ? 'heatmapYPrevious'
        : mode === 'delta' ? 'heatmapYDelta' : 'heatmapYAbsDelta';
    const meanY = points.length
        ? points.reduce((sum, point) => sum + point.y, 0) / points.length
        : 0;

    const annotations = {
        zeroX: {
            type: 'line', xMin: 0, xMax: 0,
            borderColor: 'rgba(255, 255, 255, 0.4)', borderWidth: 1, borderDash: [5, 4]
        }
    };
    if (mode !== 'absDelta') {
        annotations.zeroY = {
            type: 'line', yMin: 0, yMax: 0,
            borderColor: 'rgba(255, 255, 255, 0.4)', borderWidth: 1, borderDash: [5, 4]
        };
    }
    if (points.length) {
        annotations.mean = {
            type: 'point',
            xValue: meanX,
            yValue: meanY,
            radius: 4,
            pointStyle: 'rectRot',
            backgroundColor: 'rgba(235, 248, 255, 0.95)',
            borderColor: 'rgba(10, 10, 10, 0.9)',
            borderWidth: 1
        };
    }

    // One decimal is enough once the step is a whole or half millisecond; below
    // that the axis needs two to stop neighbouring ticks from repeating.
    const tickFormatX = value => value.toFixed(stepX < 1 ? 2 : stepX < 10 ? 1 : 0);
    const tickFormatY = value => value.toFixed(stepY < 1 ? 2 : stepY < 10 ? 1 : 0);

    heatmapChart = new Chart(canvas.getContext('2d'), {
        type: 'matrix',
        data: {
            datasets: [{
                label: t('heatmapTitle'),
                data: cells,
                backgroundColor: context => (context.raw && context.raw.color) || 'transparent',
                borderColor: 'rgba(0, 0, 0, 0.55)',
                borderWidth: 1,
                // Half a pixel of overlap hides rounding seams between
                // neighbouring cells; the dark border supplies the grid line.
                width: context => {
                    const area = context.chart.chartArea;
                    return area ? area.width / binsX + 0.5 : 1;
                },
                height: context => {
                    const area = context.chart.chartArea;
                    return area ? area.height / binsY + 0.5 : 1;
                }
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            layout: { padding: { top: 6, right: 10, bottom: 2, left: 2 } },
            scales: {
                x: {
                    type: 'linear',
                    // The matrix controller defaults both of these the other
                    // way: offset pads the ends by half a step, and reverse
                    // flips the y axis so 0 would sit at the top.
                    offset: false,
                    min: xMin,
                    max: xMax,
                    title: { display: true, text: `${t('offsetX')} (${unit.trim()})`, color: '#aaa' },
                    grid: { color: '#232323' },
                    ticks: { color: '#bbb', autoSkip: false, callback: tickFormatX },
                    afterBuildTicks: axis => {
                        axis.ticks = heatmapTicks(xMin, xMax, stepX, 9);
                    }
                },
                y: {
                    type: 'linear',
                    offset: false,
                    reverse: false,
                    min: yMin,
                    max: yMax,
                    title: { display: true, text: `${t(yLabelKey)} (${unit.trim()})`, color: '#aaa' },
                    grid: { color: '#232323' },
                    ticks: { color: '#bbb', autoSkip: false, callback: tickFormatY },
                    afterBuildTicks: axis => {
                        axis.ticks = heatmapTicks(yMin, yMax, stepY, 9);
                    }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    displayColors: false,
                    callbacks: {
                        title: items => {
                            const cell = items[0] && items[0].raw;
                            if (!cell) return '';
                            return `${tickFormatX(cell.x - stepX / 2)} ~ ${tickFormatX(cell.x + stepX / 2)}${unit}`;
                        },
                        label: item => {
                            const cell = item.raw;
                            if (!cell) return '';
                            const share = points.length ? (cell.v / points.length * 100).toFixed(1) : '0';
                            return [
                                `${t(yLabelKey)}: ${tickFormatY(cell.y - stepY / 2)} ~ ${tickFormatY(cell.y + stepY / 2)}${unit}`,
                                `${t('heatmapDensity')}: ${cell.v} (${share}%)`
                            ];
                        }
                    }
                },
                annotation: { annotations }
            }
        }
    });
}

const heatmapYSelectEl = document.getElementById('heatmapYSelect');
if (heatmapYSelectEl) {
    heatmapYSelectEl.addEventListener('change', () => {
        heatmapYMode = HEATMAP_MODES.includes(heatmapYSelectEl.value) ? heatmapYSelectEl.value : 'previous';
        renderHeatmapChart();
    });
}
