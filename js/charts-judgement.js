// charts-judgement.js -- the stat cards, XACC, the judgment distribution strip and
// the combo strip.

function calculateStaticStats() {
    const totalHits = globalOffsets.length;
    const validOffsets = globalOffsets.map(item => item[0]).filter(val => !isNaN(val));
    // UR is defined in milliseconds, so it comes from the ms column regardless
    // of which unit the page is currently plotting. An angle log without per-hit
    // BPM has no ms column and therefore no UR.
    const msOffsets = globalOffsets.map(item => item[REC.MS]).filter(val => Number.isFinite(val));

    const urCard = document.getElementById('urCard');

    if (urCard) {
        urCard.style.display = msOffsets.length > 0 ? 'block' : 'none';
    }

    globalAvg = totalHits > 0 ? (validOffsets.reduce((a, b) => a + b, 0) / totalHits) : 0;

    if (totalHits > 0) {
        const variance = validOffsets.reduce((sum, val) => sum + Math.pow(val - globalAvg, 2), 0) / totalHits;
        globalStdDev = Math.sqrt(variance);

        if (msOffsets.length > 0) {
            const msMean = msOffsets.reduce((a, b) => a + b, 0) / msOffsets.length;
            const msVariance = msOffsets.reduce((sum, val) => sum + Math.pow(val - msMean, 2), 0) / msOffsets.length;
            document.getElementById('statUR').innerText = (Math.sqrt(msVariance) * 10).toFixed(2);
        } else {
            document.getElementById('statUR').innerText = '-';
        }
    } else {
        globalStdDev = 0;
        document.getElementById('statUR').innerText = '-';
    }

    for (let i = 0; i <= 15; i++) globalCounts[i] = 0;
    globalOffsets.forEach(item => {
        const marginType = item[1];
        if (globalCounts[marginType] !== undefined) globalCounts[marginType]++;
    });

    updateRatioDisplay();

    const failMissSum = globalCounts[10] + globalCounts[11] + globalCounts[13] + globalCounts[15];
    
    const judgementsArray = [
        failMissSum,  
        globalCounts[0],     
        globalCounts[1],     
        globalCounts[2],     
        (globalCounts[3] || 0) + (globalCounts[4] || 0) + (globalCounts[5] || 0) + (globalCounts[12] || 0),
        globalCounts[6],
        (globalCounts[7] || 0) + (globalCounts[8] || 0)
    ];
    
    const xacc = calcXACC(judgementsArray);
    const maxCombo = computePerfectRuns(globalOffsets).reduce((max, run) => Math.max(max, run.length), 0);

    document.getElementById('statTotal').innerText = totalHits.toLocaleString();
    document.getElementById('statMaxCombo').innerText = maxCombo.toString();
    document.getElementById('xaccValue').innerText = `XACC: ${(xacc * 100).toFixed(2)}%`;
}

// "Hits of interest" vs everything else. Auto hits count towards both ratios
// because they are judged as Perfect by the game.
function formatRatio(numerator, total) {
    if (numerator === 0) return '0:1';
    const denominator = total - numerator;
    if (denominator === 0) return '∞:1';
    const value = numerator / denominator;
    return `${Number.isInteger(value) ? value : value.toFixed(2)}:1`;
}

// Both ratios are always on screen: P ratio (Perfect through XPerfect) and
// XPerfect ratio (XPerfect only). They share the same denominator, so the two
// cards answer "how often perfect" and "how often flawless" side by side.
function updateRatioDisplay() {
    const ratioEl = document.getElementById('statRatio');
    const xpRatioEl = document.getElementById('statXPRatio');

    if (globalOffsets.length === 0) {
        if (ratioEl) ratioEl.innerText = '-';
        if (xpRatioEl) xpRatioEl.innerText = '-';
        return;
    }

    const perfectCount = (globalCounts[3] || 0) + (globalCounts[5] || 0);
    const xPerfectCount = globalCounts[4] || 0;
    const autoCount = globalCounts[12] || 0;
    const total = globalOffsets.length;

    if (ratioEl) {
        ratioEl.innerText = formatRatio(perfectCount + xPerfectCount + autoCount, total);
    }
    if (xpRatioEl) {
        xpRatioEl.innerText = formatRatio(xPerfectCount + autoCount, total);
    }
}

function calcXACC(judgements) {
    if (judgements.length !== 7 || judgements.reduce((a, b) => a + b, 0) === 0) {
        return 0.0;
    }
    const total = judgements.reduce((a, b) => a + b, 0);
    const keys = ["failMiss", "tooEarly", "early", "ePerfect", "perfect", "lPerfect", "late"];
    
    let weightedSum = 0;
    for (let i = 0; i < 7; i++) {
        weightedSum += judgements[i] * JD_WEIGHTS[keys[i]];
    }
    return weightedSum / total;
}

function renderXaccChart() {
    const filterContainer = document.getElementById('xaccFilterContainer');
    if (filterContainer) filterContainer.style.display = 'flex';

    // Only hits that carry a weight get a point. Midspin (and any other
    // judgment getXaccWeight() has no weight for) has no accuracy to contribute,
    // so plotting a null there would cut the running line for a hit that cannot
    // move it: the curve simply steps over such a hit.
    const xaccLabels = [];
    const xaccData = [];
    let runningWeightedSum = 0;
    let runningCount = 0;
    const useHitAxis = document.getElementById('xaccUseHitCheckbox')?.checked === true;
    const useTimeline = !useHitAxis && hasTimelineData();

    globalOffsets.forEach((item, index) => {
        const weight = getXaccWeight(item[1]);
        if (weight === null) return;

        runningWeightedSum += weight;
        runningCount++;
        xaccLabels.push(getChartX(item, index, useHitAxis));
        xaccData.push((runningWeightedSum / runningCount) * 100);
    });

    const ctx = document.getElementById('xaccChart').getContext('2d');
    if (xaccChart) xaccChart.destroy();
    xaccChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: xaccLabels,
            datasets: [{
                label: 'XACC (%)',
                data: xaccData,
                borderColor: CHART_COLORS.xaccLine,
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 5,
                fill: true,
                backgroundColor: CHART_COLORS.xaccFill
            }]
        },
        options: {
            responsive: true,
            animation: false,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: CHART_COLORS.legend, boxWidth: 12, font: { size: 14 }, padding: 15 }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false, 
                    callbacks: {
                        title: function() {
                            return '';
                        },
                        label: function(context) {
                            const axisLabel = useTimeline ? t('timeX') : t('keyX');
                            return axisLabel + ' ' + context.label + ': ' + context.raw.toFixed(3) + '%';
                        }
                    }
                }
            },
            scales: {
                y: { 
                    max: 100,
                    ticks: { 
                        color: CHART_COLORS.axisTick,
                        callback: function(value) {
                            return value.toFixed(2) + '%';
                        }
                    },
                    grid: { color: CHART_COLORS.grid }
                },
                x: {
                    title: { display: true, text: useTimeline ? t('timeX') : t('keyX'), color: CHART_COLORS.axisTitle },
                    ticks: { color: CHART_COLORS.axisTick },
                    grid: { color: CHART_COLORS.grid }
                }
            }
        }
    });
}

// One bar instead of a pie: the strip is split in proportion to how often each
// judgment appeared, and the legend under it carries the exact counts. A bar
// keeps neighbouring ratios comparable at a glance, which a pie makes hard.
function renderJudgementStrip() {
    const stripEl = document.getElementById('judgementStrip');
    const legendEl = document.getElementById('judgementLegend');
    if (!stripEl || !legendEl) return;

    stripEl.innerHTML = '';
    legendEl.innerHTML = '';

    const groups = [
        { label: 'Too Early', count: globalCounts[0] || 0, color: getMarginColor(0, '#FF0000') },
        { label: 'Very Early/Late', count: (globalCounts[1] || 0) + (globalCounts[7] || 0), color: getMarginColor(1, '#FF6F4E') },
        { label: 'Early/Late Perfect', count: (globalCounts[2] || 0) + (globalCounts[6] || 0), color: getMarginColor(2, '#A0FF4E') },
        { label: 'Perfect', count: (globalCounts[3] || 0) + (globalCounts[5] || 0), color: getMarginColor(3, '#60FF4E') },
        { label: 'XPerfect', count: globalCounts[4] || 0, color: getMarginColor(4, '#4DCCFF') },
        { label: 'Auto', count: globalCounts[12] || 0, color: getMarginColor(12, '#FFFFFF') },
        { label: 'Multipress', count: globalCounts[9] || 0, color: getMarginColor(9, '#00FFED') },
        { label: 'Overload/Miss', count: (globalCounts[10] || 0) + (globalCounts[11] || 0) + (globalCounts[13] || 0) + (globalCounts[15] || 0), color: getMarginColor(10, '#D958FF') }
    ].filter(group => group.count > 0);

    const total = groups.reduce((sum, group) => sum + group.count, 0);
    stripEl.setAttribute('aria-label', t('pieTitle'));
    if (total === 0) return;

    groups.forEach(group => {
        const percentText = (group.count / total * 100).toFixed(1) + '%';

        const segment = document.createElement('div');
        segment.className = 'judgement-segment';
        segment.style.flexGrow = String(group.count);
        segment.style.background = group.color;
        segment.title = group.label + ': ' + percentText + ' (' + group.count.toLocaleString() + ')';
        stripEl.appendChild(segment);

        const item = document.createElement('span');
        item.className = 'judgement-legend-item';

        const swatch = document.createElement('span');
        swatch.className = 'swatch';
        swatch.style.background = group.color;

        const name = document.createElement('span');
        name.className = 'legend-name';
        name.textContent = group.label;

        const percent = document.createElement('span');
        percent.className = 'legend-pct';
        percent.textContent = percentText;

        const count = document.createElement('span');
        count.className = 'legend-count';
        count.textContent = '(' + group.count.toLocaleString() + ')';

        item.append(swatch, name, percent, count);
        legendEl.appendChild(item);
    });
}

// Streak length -> ramp step. sqrt rather than linear: streak lengths are long
// tailed, and a linear mapping would drop every ordinary run into the dimmest
// step as soon as one long run exists.
function getComboBin(length, maxLength) {
    if (!(maxLength > 0)) return 0;
    return Math.min(getComboRamp().length - 1, Math.floor(getComboRamp().length * Math.sqrt(length / maxLength)));
}

// The legend is derived from the same mapping instead of hard-coded ranges, so
// it always names the lengths each step actually covers for this play.
function buildComboLegend(maxLength) {
    const entries = [];

    for (let length = 1; length <= maxLength; length++) {
        const bin = getComboBin(length, maxLength);
        const last = entries[entries.length - 1];
        if (last && last.bin === bin) last.end = length;
        else entries.push({ bin: bin, start: length, end: length });
    }

    return entries;
}

function renderComboChart() {
    if (globalOffsets.length === 0) return;

    const filterContainer = document.getElementById('comboFilterContainer');
    if (filterContainer) filterContainer.style.display = 'flex';

    const useHitAxis = document.getElementById('comboUseHitCheckbox')?.checked === true;
    const useTimeline = !useHitAxis && hasTimelineData();

    // Records without a timestamp fall back to their hit number, which can move
    // the x value backwards. Clamp instead of letting a segment end up with a
    // negative span.
    const xs = [];
    let previousX = -Infinity;
    for (let i = 0; i < globalOffsets.length; i++) {
        let x = getChartX(globalOffsets[i], i, useHitAxis);
        if (!(x > previousX)) x = previousX + (useHitAxis ? 1 : 0.001);
        xs.push(x);
        previousX = x;
    }

    // Right edge of a segment: the next hit's position. The last segment has no
    // successor to borrow from, so extrapolate with the local spacing.
    const endOf = (index) => {
        if (index < xs.length) return xs[index];
        const last = xs.length - 1;
        const spacing = last > 0 ? xs[last] - xs[last - 1] : 1;
        return xs[last] + (spacing > 0 ? spacing : 1);
    };

    const runs = computePerfectRuns(globalOffsets);
    const maxRun = runs.reduce((max, run) => Math.max(max, run.length), 0);

    const segments = buildComboSegments(runs, globalOffsets.length);

    const statsEl = document.getElementById('comboStats');
    if (statsEl) {
        const average = runs.length > 0 ? runs.reduce((sum, run) => sum + run.length, 0) / runs.length : 0;
        statsEl.innerHTML = `
            <div class="stat-tile">
                <div class="label">${t('comboStreakCount')}</div>
                <div class="value">${runs.length}</div>
            </div>
            <div class="stat-tile">
                <div class="label">${t('comboLongest')}</div>
                <div class="value">${maxRun}</div>
            </div>
            <div class="stat-tile">
                <div class="label">${t('comboAverage')}</div>
                <div class="value">${average.toFixed(1)}</div>
            </div>
        `;
    }

    const legendEl = document.getElementById('comboLegend');
    if (legendEl) {
        const entries = buildComboLegend(maxRun).map(entry => `
            <span class="legend-item">
                <span class="swatch" style="background-color: ${getComboRamp()[entry.bin]};"></span>
                ${entry.start === entry.end ? entry.start : `${entry.start}-${entry.end}`}
            </span>
        `);
        legendEl.innerHTML = `
            <span class="legend-title">${t('comboLength')}</span>
            ${entries.join('')}
            <span class="legend-item legend-break">
                <span class="swatch" style="background-color: ${getComboBreakColor()};"></span>
                ${t('comboBreak')}
            </span>
        `;
    }

    if (comboChart) comboChart.destroy();

    const ctx = document.getElementById('comboChart').getContext('2d');
    const xMin = xs[0];
    const xMax = endOf(xs.length);
    // Only the right edge is padded: padding the left would put a tick at a
    // negative timestamp, and the first block reads fine flush to the axis.
    const padding = (xMax - xMin) * 0.01 || 1;

    comboChart = new Chart(ctx, {
        type: 'bar',
        data: {
            // A single category: the strip is one row, and every datum has to
            // name this same label or the category scale grows a row per datum.
            labels: ['combo'],
            datasets: [{
                data: segments.map(segment => ({
                    x: [xs[segment.start], endOf(segment.end)],
                    y: 'combo',
                    segment: segment
                })),
                // One colour per block. Chart.js only reads per-datum colours
                // from an array here, not from properties on the data objects.
                backgroundColor: segments.map(segment => segment.isRun
                    ? getComboRamp()[getComboBin(segment.length, maxRun)]
                    : getComboBreakColor()),
                // Surface-coloured 2px border: without the seam two adjacent
                // runs of similar length read as one long band.
                borderColor: CHART_COLORS.surface,
                borderWidth: 2,
                barPercentage: 1.0,
                categoryPercentage: 1.0
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: 'nearest', intersect: true },
            layout: {
                padding: { top: 6, right: 8, bottom: 0, left: 8 }
            },
            scales: {
                x: {
                    type: 'linear',
                    min: xMin,
                    max: xMax + padding,
                    title: { display: true, text: useTimeline ? t('timeX') : t('keyX'), color: CHART_COLORS.axisTitle },
                    grid: { color: CHART_COLORS.grid },
                    ticks: { color: CHART_COLORS.axisTick, maxTicksLimit: 12 }
                },
                y: { display: false }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const segment = context.raw.segment;
                            const lines = [
                                `${segment.isRun ? t('comboRun') : t('comboBreak')}: ${segment.length}`,
                                `${t('keyX')} ${segment.start + 1}-${segment.end}`
                            ];

                            const from = globalOffsets[segment.start][5];
                            const to = globalOffsets[Math.min(segment.end, globalOffsets.length - 1)][5];
                            if (Number.isFinite(from) && Number.isFinite(to)) {
                                lines.push(`${t('timeX')}: ${from.toFixed(0)} ~ ${to.toFixed(0)}`);
                            }

                            return lines;
                        }
                    }
                }
            }
        }
    });
}
