// charts-judgement.js -- the stat cards, XACC, the judgment pie and the combo
// strip.

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

function updateRatioDisplay() {
    if (globalOffsets.length === 0) {
        document.getElementById('statRatio').innerText = '-';
        return;
    }

    const showXPerf = document.getElementById('toggleXPerfectRatio').checked;

    const perfectCount = (globalCounts[3] || 0) + (globalCounts[5] || 0);
    const xPerfectCount = globalCounts[4] || 0;
    const autoCount = globalCounts[12] || 0;

    let numerator = 0; 
    
    if (showXPerf) {
        numerator = xPerfectCount + autoCount;
    } else {
        numerator = perfectCount + xPerfectCount + autoCount;
    }
    const denominator = globalOffsets.length - numerator;

    if (numerator === 0) {
        document.getElementById('statRatio').innerText = '0:1';
    } else if (denominator === 0) {
        document.getElementById('statRatio').innerText = '∞:1';
    } else {
        const ratioVal = numerator / denominator;
        const formattedVal = Number.isInteger(ratioVal) ? ratioVal.toString() : ratioVal.toFixed(2);
        document.getElementById('statRatio').innerText = `${formattedVal}:1`;
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

    const xaccData = [];
    let runningWeightedSum = 0;
    let runningCount = 0;
    const validTypes = DISPLAY_ORDER;
    const useHitAxis = document.getElementById('xaccUseHitCheckbox')?.checked === true;
    const useTimeline = !useHitAxis && hasTimelineData();

    globalOffsets.forEach((item) => {
        const type = item[1];
        if (validTypes.includes(type)) {
            const weight = getXaccWeight(type);
            if (weight === null) {
                xaccData.push(null);
                return;
            }
            
            runningWeightedSum += weight;
            runningCount++;
            xaccData.push((runningWeightedSum / runningCount) * 100);
        } else {
            xaccData.push(null);
        }
    });

    const ctx = document.getElementById('xaccChart').getContext('2d');
    if (xaccChart) xaccChart.destroy();
    xaccChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: globalOffsets.map((item, i) => getChartX(item, i, useHitAxis)),
            datasets: [{
                label: 'XACC (%)',
                data: xaccData,
                borderColor: '#4FC3F7',
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 5,
                fill: true,
                backgroundColor: 'rgba(79, 195, 247, 0.15)'
            }]
        },
        options: {
            responsive: true,
            animation: false,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: '#fff', boxWidth: 12, font: { size: 14 }, padding: 15 }
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
                        color: '#bbb',
                        callback: function(value) {
                            return value.toFixed(2) + '%';
                        }
                    },
                    grid: { color: '#252525' }
                },
                x: {
                    title: { display: true, text: useTimeline ? t('timeX') : t('keyX'), color: '#aaa' },
                    ticks: { color: '#bbb' },
                    grid: { color: '#252525' }
                }
            }
        }
    });
}

function renderPieChart() {
    if (globalOffsets.length === 0) return;

    const ctx = document.getElementById('distributionPieChart').getContext('2d');
    if (pieChart) pieChart.destroy();

    const rawGroups = {
        'Too Early': { count: globalCounts[0], color: '#FF0000' },
        'Very Early/Late': { count: (globalCounts[1] || 0) + (globalCounts[7] || 0), color: '#FF6F4E' },
        'Early/Late Perfect': { count: (globalCounts[2] || 0) + (globalCounts[6] || 0), color: '#A0FF4E' },
        'Perfect': { count: (globalCounts[3] || 0) + (globalCounts[5] || 0), color: '#60FF4E' },
        'XPerfect': { count: globalCounts[4] || 0, color: '#4DCCFF' },
        'Auto': { count: globalCounts[12] || 0, color: '#FFFFFF' },
        'Multipress': { count: globalCounts[9] || 0, color: '#00FFED' },
        'Overload/Miss': { count: (globalCounts[10] || 0) + (globalCounts[11] || 0) + (globalCounts[13] || 0) + (globalCounts[15] || 0), color: '#D958FF' }
    };

    const groups = {};
    Object.keys(rawGroups).forEach(key => {
        if ((key === 'XPerfect' || key === 'Auto') && rawGroups[key].count === 0) return;
        groups[key] = rawGroups[key];
    });

    const labels = Object.keys(groups);
    const dataCounts = labels.map(l => groups[l].count);
    const backgroundColors = labels.map(l => groups[l].color);

    pieChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: dataCounts,
                backgroundColor: backgroundColors
            }]
        },
        options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { color: '#fff' } }
            }
        }
    });
}

// Streak length -> ramp step. sqrt rather than linear: streak lengths are long
// tailed, and a linear mapping would drop every ordinary run into the dimmest
// step as soon as one long run exists.
function getComboBin(length, maxLength) {
    if (!(maxLength > 0)) return 0;
    return Math.min(COMBO_RAMP.length - 1, Math.floor(COMBO_RAMP.length * Math.sqrt(length / maxLength)));
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
                <span class="swatch" style="background-color: ${COMBO_RAMP[entry.bin]};"></span>
                ${entry.start === entry.end ? entry.start : `${entry.start}-${entry.end}`}
            </span>
        `);
        legendEl.innerHTML = `
            <span class="legend-title">${t('comboLength')}</span>
            ${entries.join('')}
            <span class="legend-item legend-break">
                <span class="swatch" style="background-color: ${COMBO_BREAK_COLOR};"></span>
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
                    ? COMBO_RAMP[getComboBin(segment.length, maxRun)]
                    : COMBO_BREAK_COLOR),
                // Surface-coloured 2px border: without the seam two adjacent
                // runs of similar length read as one long band.
                borderColor: '#0a0a0a',
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
                    title: { display: true, text: useTimeline ? t('timeX') : t('keyX'), color: '#aaa' },
                    grid: { color: '#252525' },
                    ticks: { color: '#bbb', maxTicksLimit: 12 }
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
