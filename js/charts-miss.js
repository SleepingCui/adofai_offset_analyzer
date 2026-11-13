// charts-miss.js -- the mistake strip. The chart tooltip helpers live here
// too: the scatter, rolling and BPM charts share them.

// ---------------------------------------------------------------------------
// Mistake strip
//
// The combo strip above tiles the whole play with blocks; this one keeps the
// same span but reduces each non-perfect judgment to a thin spectral line.
// Position is a percentage of the run, so the strip reads as "where in the
// level" rather than as a raw hit or millisecond count.
// ---------------------------------------------------------------------------

// Everything outside the core Perfect window. EarlyPerfect / LatePerfect are
// included on purpose: they are the outer perfect ring, and the player wants
// them visible here. Perfect, PerfectPlus, XPerfect and Auto stay off the strip.
const MISS_PERFECT_CODES = new Set([3, 4, 5, 12]);
function isMistakeJudgeCode(type) {
    return !MISS_PERFECT_CODES.has(type);
}

function getMissUseHitBasis() {
    return document.getElementById('missUseHitCheckbox')?.checked === true;
}

// MARGIN_MAP colours are all six-digit hex, so the conversion only has to
// handle that one shape.
function withAlpha(color, alpha) {
    const hex = color.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
}

// -> [{ item, index, type, label, color, hitNumber, time, value, position,
//      ms, angle, floor, bpm, speed, pitch }]
// One entry per non-perfect hit, with the position already normalised to 0-100.
// Time is the default basis; a log without timestamps falls back to the hit
// number, which is the only other ordering the log carries.
// First and last timestamp of the run. The strip and its axis share this span,
// so a tick always names the moment its percentage actually maps to.
function getMissTimeSpan(records) {
    let start = Infinity;
    let end = -Infinity;

    records.forEach(item => {
        const time = item[REC.TIME];
        if (Number.isFinite(time) && time >= 0) {
            if (time < start) start = time;
            if (time > end) end = time;
        }
    });

    return { start, end, span: end - start };
}

function buildMissPoints(records, useTimeline) {
    const timeSpan = useTimeline ? getMissTimeSpan(records) : null;
    const lastIndex = records.length - 1;
    const points = [];

    records.forEach((item, index) => {
        const type = item[REC.JUDGE];
        if (!isMistakeJudgeCode(type)) return;

        const time = Number.isFinite(item[REC.TIME]) && item[REC.TIME] >= 0 ? item[REC.TIME] : null;
        let position;
        if (useTimeline && timeSpan.span > 0 && time !== null) {
            position = ((time - timeSpan.start) / timeSpan.span) * 100;
        } else {
            position = lastIndex > 0 ? (index / lastIndex) * 100 : 0;
        }
        position = Math.max(0, Math.min(100, position));

        const definition = getMarginDefinition(type);
        points.push({
            item,
            index,
            type,
            label: definition.label,
            color: definition.color,
            hitNumber: getRecordHitNumber(item, index),
            time,
            value: Number(item[REC.VALUE]),
            position,
            ms: Number.isFinite(item[REC.MS]) ? item[REC.MS] : null,
            angle: Number.isFinite(item[REC.ANGLE]) ? item[REC.ANGLE] : null,
            floor: Number.isFinite(item[REC.FLOOR]) ? item[REC.FLOOR] : -1,
            bpm: Number.isFinite(item[REC.BPM]) && item[REC.BPM] > 0 ? item[REC.BPM] : null,
            speed: Number.isFinite(item[REC.SPEED]) && item[REC.SPEED] > 0 ? item[REC.SPEED] : null,
            pitch: Number.isFinite(item[REC.PITCH]) && item[REC.PITCH] > 0 ? item[REC.PITCH] : null
        });
    });

    return points;
}

function formatMissOffset(value, unit) {
    if (!Number.isFinite(value)) return '-';
    const digits = displayUnit === 'deg' ? 4 : 3;
    return (value >= 0 ? '+' : '-') + Math.abs(value).toFixed(digits) + unit;
}

// m:ss.mmm (exact ms) -- the formatted time is what the eye reads, the
// parenthesised value is the untouched number the log stored.
function formatMissTime(ms) {
    // Round to the displayed precision first, so 59.9996 s rolls over to
    // 1:00.000 instead of printing 0:60.000.
    const totalSeconds = Math.round(Math.max(0, ms)) / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds - minutes * 60;
    return minutes + ':' + seconds.toFixed(3).padStart(6, '0')
        + ' (' + Number(ms).toFixed(5) + 'ms)';
}

// Axis ticks do not need the tooltip's millisecond precision.
function formatMissTickTime(ms) {
    const totalSeconds = Math.max(0, ms) / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds - minutes * 60);
    return minutes + ':' + String(seconds).padStart(2, '0');
}

function buildMissTooltipLines(miss, totalHits) {
    const unit = getUnit();
    const lines = [];

    let offsetText = t('offsetX') + ': ' + formatMissOffset(miss.value, unit);
    if (displayUnit !== 'deg' && miss.angle !== null) {
        offsetText += ' (' + miss.angle.toFixed(3) + '°)';
    } else if (displayUnit !== 'ms' && miss.ms !== null) {
        offsetText += ' (' + miss.ms.toFixed(3) + ' ms)';
    }
    lines.push(offsetText);

    lines.push(t('keyX') + ': ' + miss.hitNumber.toLocaleString() + ' / ' + totalHits.toLocaleString()
        + ' · ' + t('missPosition') + ': ' + miss.position.toFixed(1) + '%');

    if (miss.time !== null) {
        lines.push(t('missTime') + ': ' + formatMissTime(miss.time));
    }

    const contextParts = [];
    if (miss.floor >= 0) contextParts.push(t('floorLabel') + ' ' + miss.floor);
    if (miss.bpm !== null && miss.speed !== null && miss.pitch !== null) {
        const trim = value => Number(value.toFixed(2)).toString();
        const effective = miss.bpm * miss.speed * miss.pitch;
        contextParts.push('BPM ' + trim(effective) + ' (' + trim(miss.bpm) + '×' + trim(miss.speed) + '×' + trim(miss.pitch) + ')');
    }
    if (contextParts.length > 0) lines.push(contextParts.join(' · '));

    return lines;
}

function hideChartTooltip(id) {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
}

function hideMissTooltip() {
    hideChartTooltip('missTooltip');
}

function hideScatterTooltip() {
    hideChartTooltip('scatterTooltip');
}

// Shared hover panel: a title line in the item's colour plus one row per
// detail line. Both the strip and the scatter plot use it so the two charts
// report hit details in the same shape.
function showChartTooltip(el, titleText, titleColor, lines) {
    const title = document.createElement('div');
    title.className = 'chart-hover-tooltip-title';
    title.style.color = titleColor;
    title.textContent = titleText;

    const body = document.createElement('div');
    body.className = 'chart-hover-tooltip-body';
    lines.forEach(line => {
        const row = document.createElement('div');
        row.textContent = line;
        body.appendChild(row);
    });

    el.replaceChildren(title, body);
    el.hidden = false;
}

// The panel is fixed to the viewport rather than the canvas, so a short chart
// frame cannot clip it. It flips sides near the right/top edges.
function positionChartTooltip(el, context) {
    const tooltip = context.tooltip;
    const canvasRect = context.chart.canvas.getBoundingClientRect();
    const caretX = canvasRect.left + tooltip.caretX;
    const caretY = canvasRect.top + tooltip.caretY;
    const margin = 12;
    let left = caretX + 14;
    let top = caretY - el.offsetHeight - 12;

    if (left + el.offsetWidth > window.innerWidth - margin) {
        left = caretX - el.offsetWidth - 14;
    }
    if (left < margin) left = margin;
    if (top < margin) top = caretY + 16;
    if (top + el.offsetHeight > window.innerHeight - margin) {
        top = window.innerHeight - el.offsetHeight - margin;
    }

    el.style.left = left + 'px';
    el.style.top = top + 'px';
}

// The strip is deliberately short, so a canvas-drawn tooltip would be clipped
// by the frame. The shared overlay is positioned in viewport coordinates
// instead: it can sit above or below the strip and still show every detail.
function updateMissTooltip(context, totalHits) {
    const el = document.getElementById('missTooltip');
    if (!el) return;

    const tooltip = context.tooltip;
    const dataPoints = tooltip && tooltip.dataPoints;
    if (!tooltip || tooltip.opacity === 0 || !dataPoints || dataPoints.length === 0) {
        el.hidden = true;
        return;
    }

    const miss = dataPoints[0].raw && dataPoints[0].raw.miss;
    if (!miss) {
        el.hidden = true;
        return;
    }

    showChartTooltip(el, miss.label, miss.color, buildMissTooltipLines(miss, totalHits));
    positionChartTooltip(el, context);
}

// Scatter points carry the whole hit tuple, so the panel can show the same
// context the strip does without a second lookup. The x value is whatever the
// chart is plotting: song time or hit number.
function updateScatterTooltip(context, useTimeline, unit) {
    const el = document.getElementById('scatterTooltip');
    if (!el) return;

    const tooltip = context.tooltip;
    const dataPoints = tooltip && tooltip.dataPoints;
    if (!tooltip || tooltip.opacity === 0 || !dataPoints || dataPoints.length === 0) {
        el.hidden = true;
        return;
    }

    const item = dataPoints[0];
    const point = item.raw;
    if (!point) {
        el.hidden = true;
        return;
    }

    const dataset = context.chart.data.datasets[item.datasetIndex] || {};
    const title = dataset.label || '';
    const color = typeof dataset.borderColor === 'string' ? dataset.borderColor : '#fff';
    const lines = [];

    if (useTimeline) {
        lines.push(t('missTime') + ': ' + formatMissTime(point.x));
    } else {
        lines.push(t('keyX') + ': ' + Number(point.x).toLocaleString());
    }

    lines.push(t('offsetX') + ': ' + formatMissOffset(point.y, unit));

    const hit = point.hit;
    const showDetails = document.getElementById('scatterShowHitDetailsCheckbox')?.checked === true;
    if (hit && showDetails) {
        const parts = [];
        if (hit[REC.FLOOR] >= 0) parts.push(t('floorLabel') + ' ' + hit[REC.FLOOR]);
        if (Number.isFinite(hit[REC.ANGLE]) && displayUnit !== 'deg') {
            parts.push(hit[REC.ANGLE].toFixed(4) + '°');
        }
        if (Number.isFinite(hit[REC.MS]) && displayUnit !== 'ms') {
            parts.push(hit[REC.MS].toFixed(3) + ' ms');
        }
        if (Number.isFinite(hit[REC.MARGIN]) && Math.abs(hit[REC.MARGIN] - 1) > 1e-4) {
            parts.push(t('marginScale') + ' ' + formatMarginScale(hit[REC.MARGIN]));
        }
        if (hit[REC.BPM] !== null && hit[REC.SPEED] !== null && hit[REC.PITCH] !== null) {
            const trim = value => Number(value.toFixed(2)).toString();
            const effectiveBpm = hit[REC.BPM] * hit[REC.SPEED] * hit[REC.PITCH];
            parts.push('BPM ' + trim(effectiveBpm) + ' (' + trim(hit[REC.BPM]) + '×' + trim(hit[REC.SPEED]) + '×' + trim(hit[REC.PITCH]) + ')');
        }
        if (parts.length > 0) lines.push(parts.join(' · '));
    }

    showChartTooltip(el, title, color, lines);
    positionChartTooltip(el, context);
}

// Halo pass first, core pass second: compositing one line at a time would let a
// later halo wash out an earlier core, which is backwards for a spectrum. The
// hovered line gets a brighter halo and a wider core, giving the tooltip an
// obvious anchor in a dense strip.
const MISS_SPECTRUM_PLUGIN = {
    id: 'missSpectrum',
    afterDatasetsDraw(chart) {
        const dataset = chart.data.datasets[0];
        const meta = chart.getDatasetMeta(0);
        const area = chart.chartArea;
        if (!dataset || !meta || !area) return;

        const data = dataset.data;
        const ctx = chart.ctx;

        ctx.save();
        ctx.beginPath();
        ctx.rect(area.left, area.top, area.width, area.height);
        ctx.clip();
        ctx.lineCap = 'butt';

        meta.data.forEach((bar, index) => {
            const miss = data[index] && data[index].miss;
            if (!miss || !Number.isFinite(bar.x)) return;
            const active = bar.active === true;
            ctx.strokeStyle = withAlpha(miss.color, active ? 0.3 : 0.14);
            ctx.lineWidth = active ? 10 : 4;
            ctx.beginPath();
            ctx.moveTo(bar.x, area.top);
            ctx.lineTo(bar.x, area.bottom);
            ctx.stroke();
        });

        meta.data.forEach((bar, index) => {
            const miss = data[index] && data[index].miss;
            if (!miss || !Number.isFinite(bar.x)) return;
            const active = bar.active === true;
            ctx.strokeStyle = miss.color;
            ctx.lineWidth = active ? 2.6 : 1.3;
            ctx.globalAlpha = active ? 1 : 0.9;
            ctx.beginPath();
            ctx.moveTo(bar.x, area.top);
            ctx.lineTo(bar.x, area.bottom);
            ctx.stroke();
        });

        ctx.restore();
    }
};

function renderMissChart() {
    if (globalOffsets.length === 0) return;

    const unit = getUnit();
    const filterContainer = document.getElementById('missFilterContainer');
    if (filterContainer) filterContainer.style.display = 'flex';

    const useHitBasis = getMissUseHitBasis();
    const useTimeline = !useHitBasis && hasTimelineData();
    const timeSpan = useTimeline ? getMissTimeSpan(globalOffsets) : null;
    const basisEl = document.getElementById('missBasis');
    if (basisEl) basisEl.innerText = useTimeline ? t('missRelTime') : t('missRelHit');

    const points = buildMissPoints(globalOffsets, useTimeline);
    const totalHits = globalOffsets.length;

    const statsEl = document.getElementById('missStats');
    if (statsEl) {
        const early = points.filter(point => point.type === 0 || point.type === 1 || point.type === 2).length;
        const late = points.filter(point => point.type === 6 || point.type === 7 || point.type === 8).length;
        const valued = points.map(point => point.value).filter(Number.isFinite);
        const meanAbs = valued.length > 0
            ? valued.reduce((sum, value) => sum + Math.abs(value), 0) / valued.length
            : null;
        const rate = totalHits > 0 ? (points.length / totalHits) * 100 : 0;
        const meanText = meanAbs === null
            ? '-'
            : meanAbs.toFixed(displayUnit === 'deg' ? 3 : 2) + unit;
        statsEl.innerHTML = ''
            + '<div class="stat-tile"><div class="label">' + t('missTotal') + '</div>'
            + '<div class="value">' + points.length.toLocaleString() + '</div></div>'
            + '<div class="stat-tile"><div class="label">' + t('missRate') + '</div>'
            + '<div class="value">' + rate.toFixed(1) + '%</div></div>'
            + '<div class="stat-tile"><div class="label">' + t('biasEarly') + '</div>'
            + '<div class="value">' + early.toLocaleString() + '</div></div>'
            + '<div class="stat-tile"><div class="label">' + t('biasLate') + '</div>'
            + '<div class="value">' + late.toLocaleString() + '</div></div>'
            + '<div class="stat-tile"><div class="label">' + t('missMeanAbs') + '</div>'
            + '<div class="value">' + meanText + '</div></div>';
    }

    // Only the judgments that actually occur are named, in the page's usual
    // display order, so the legend doubles as a count of what broke the streak.
    const counts = new Map();
    points.forEach(point => counts.set(point.type, (counts.get(point.type) || 0) + 1));
    const legendEl = document.getElementById('missLegend');
    if (legendEl) {
        const items = getDisplayOrder()
            .filter(type => counts.has(type))
            .map(type => {
                const definition = getMarginDefinition(type);
                return '<span class="legend-item"><span class="swatch" style="background-color: '
                    + definition.color + ';"></span>' + definition.label + ' '
                    + counts.get(type).toLocaleString() + '</span>';
            });
        legendEl.innerHTML = items.length > 0
            ? '<span class="legend-title">' + t('missLegendTitle') + '</span>' + items.join('')
            : '';
    }

    const emptyEl = document.getElementById('missEmpty');
    if (emptyEl) emptyEl.hidden = points.length > 0;

    hideMissTooltip();
    if (missChart) { missChart.destroy(); missChart = null; }

    const ctx = document.getElementById('missChart').getContext('2d');
    missChart = new Chart(ctx, {
        type: 'bar',
        data: {
            datasets: [{
                // The bar is only a hit target: 12px wide and full height, drawn
                // transparent. The visible 1.3px line is painted by the plugin.
                data: points.map(point => ({ x: point.position, y: 1, miss: point })),
                barThickness: 12,
                backgroundColor: 'rgba(0, 0, 0, 0)',
                borderWidth: 0
            }]
        },
        options: {
            indexAxis: 'x',
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: 'nearest', intersect: true },
            layout: { padding: { top: 6, right: 10, bottom: 0, left: 10 } },
            scales: {
                x: {
                    type: 'linear',
                    min: 0,
                    max: 100,
                    grid: { color: 'rgba(255, 255, 255, 0.05)', drawTicks: false },
                    border: { color: '#333' },
                    ticks: {
                        color: '#bbb',
                        maxTicksLimit: 11,
                        // The scale stays 0-100 so the strip always spans the whole
                        // run; only the labels change with the basis. Time mode
                        // names the moment, hit mode the hit number.
                        callback: value => {
                            if (timeSpan && timeSpan.span > 0) {
                                return formatMissTickTime(timeSpan.start + (value / 100) * timeSpan.span);
                            }
                            if (!useTimeline) {
                                return Math.round(1 + (value / 100) * (totalHits - 1)).toLocaleString();
                            }
                            return Math.round(value) + '%';
                        }
                    }
                },
                y: { display: false, min: 0, max: 1 }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: false,
                    external: context => updateMissTooltip(context, totalHits)
                },
                zoom: {
                    pan: { enabled: true, mode: 'x' },
                    zoom: {
                        wheel: { enabled: true, speed: 0.08 },
                        pinch: { enabled: true },
                        mode: 'x'
                    },
                    limits: { x: { min: 0, max: 100, minRange: 1 } }
                }
            }
        },
        plugins: [MISS_SPECTRUM_PLUGIN]
    });
}
