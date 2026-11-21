// charts-forensics.js -- opt-in panels for deeper timing analysis.
//
// Every chart here is opt-in (defaultVisible: false): they answer a narrow
// question and would otherwise push the main charts below the fold. The whole
// module works from computeForensicMetrics() in stats-timing.js, cached against
// the current player's record array, so opening three panels does not repeat the
// expensive passes.

let forensicHurstChart = null;
let forensicSpectrumChart = null;
let forensicFatigueChart = null;
let forensicCompensationChart = null;
let forensicStabilityChart = null;
let forensicCompareChart = null;

const FORENSIC_COMPARE_LIMIT = 4000;

// records/unit/metrics -- keyed by array identity, so a new import or a player
// switch invalidates it without any explicit reset.
let forensicCache = { records: null, unit: null, metrics: null };
let forensicCompare = null;

function fmtNumber(value, digits) {
    return Number.isFinite(value) ? value.toFixed(digits === undefined ? 2 : digits) : '—';
}

function fmtPercent(value, digits) {
    return Number.isFinite(value) ? (value * 100).toFixed(digits === undefined ? 1 : digits) + '%' : '—';
}

function getForensicRecords() {
    return globalPlayers[activePlayer] || globalOffsets || [];
}

function getForensicMetrics() {
    const records = getForensicRecords();
    if (forensicCache.records === records && forensicCache.unit === displayUnit && forensicCache.metrics) {
        return forensicCache.metrics;
    }
    const metrics = computeForensicMetrics(records);
    forensicCache = { records, unit: displayUnit, metrics };
    return metrics;
}

function getForensicUnit(metrics) {
    return metrics && metrics.isMs ? 'ms' : getUnit().trim();
}

// --- Hurst / DFA -----------------------------------------------------------

function renderHurstChart() {
    const metrics = getForensicMetrics();
    const statsEl = document.getElementById('hurstStats');
    if (statsEl) {
        statsEl.innerHTML = '';
        const tiles = [
            ['hurstExponent', fmtNumber(metrics.hurst && metrics.hurst.h, 3)],
            ['hurstR2', fmtNumber(metrics.hurst && metrics.hurst.r2, 3)],
            ['dfaAlpha', fmtNumber(metrics.dfa && metrics.dfa.alpha, 3)],
            ['dfaR2', fmtNumber(metrics.dfa && metrics.dfa.r2, 3)]
        ];
        tiles.forEach(([key, value]) => {
            statsEl.insertAdjacentHTML('beforeend',
                '<div class="stat-tile"><div class="label">' + t(key)
                + '</div><div class="value">' + value + '</div></div>');
        });
    }

    const noteEl = document.getElementById('hurstNote');

    if (forensicHurstChart) {
        forensicHurstChart.destroy();
        forensicHurstChart = null;
    }
    const canvas = document.getElementById('hurstChart');
    if (!canvas) return;

    const hurstPoints = (metrics.hurst && metrics.hurst.points) || [];
    const dfaPoints = (metrics.dfa && metrics.dfa.points) || [];
    const datasets = [];

    const fitLine = (points, keyX, keyY, slope, color) => {
        if (points.length < 2 || !Number.isFinite(slope)) return null;
        let sx = 0, sy = 0;
        points.forEach(point => { sx += point[keyX]; sy += point[keyY]; });
        const intercept = sy / points.length - slope * sx / points.length;
        const minX = points[0][keyX];
        const maxX = points[points.length - 1][keyX];
        return {
            label: '',
            data: [{ x: minX, y: slope * minX + intercept }, { x: maxX, y: slope * maxX + intercept }],
            borderColor: color,
            borderDash: [6, 4],
            borderWidth: 2,
            pointRadius: 0,
            showLine: true,
            fill: false
        };
    };

    if (hurstPoints.length) {
        datasets.push({
            label: t('hurstLegendHurst'),
            data: hurstPoints.map(point => ({ x: point.logSize, y: point.logRs })),
            borderColor: '#4fc3f7',
            backgroundColor: '#4fc3f7',
            pointRadius: 3,
            showLine: true,
            borderWidth: 2,
            tension: 0
        });
        const fit = fitLine(hurstPoints, 'logSize', 'logRs', metrics.hurst.h, 'rgba(79, 195, 247, 0.55)');
        if (fit) datasets.push(fit);
    }
    if (dfaPoints.length) {
        datasets.push({
            label: t('hurstLegendDfa'),
            data: dfaPoints.map(point => ({ x: point.logSize, y: point.logFluctuation })),
            borderColor: '#d958ff',
            backgroundColor: '#d958ff',
            pointRadius: 3,
            showLine: true,
            borderWidth: 2,
            tension: 0
        });
        const fit = fitLine(dfaPoints, 'logSize', 'logFluctuation', metrics.dfa.alpha, 'rgba(217, 88, 255, 0.55)');
        if (fit) datasets.push(fit);
    }

    if (!datasets.length) {
        if (noteEl) noteEl.textContent = t('hurstNotEnough') + ' ' + t('hurstNote');
        return;
    }
    if (noteEl) noteEl.textContent = t('hurstNote');

    forensicHurstChart = new Chart(canvas.getContext('2d'), {
        type: 'scatter',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: t('hurstX'), color: CHART_COLORS.axisTitle },
                    grid: { color: CHART_COLORS.grid },
                    ticks: { color: CHART_COLORS.axisTick }
                },
                y: {
                    title: { display: true, text: t('hurstY'), color: CHART_COLORS.axisTitle },
                    grid: { color: CHART_COLORS.grid },
                    ticks: { color: CHART_COLORS.axisTick }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: CHART_COLORS.legend, boxWidth: 12, font: { size: 13 }, padding: 14 }
                },
                tooltip: {
                    callbacks: {
                        label: context => context.dataset.label
                            ? context.dataset.label + ': ' + context.parsed.x.toFixed(2) + ', ' + context.parsed.y.toFixed(3)
                            : ''
                    }
                }
            }
        }
    });
}

// --- spectrum --------------------------------------------------------------

function downsampleSpectrum(bins, limit) {
    if (bins.length <= limit) return bins;
    const step = bins.length / limit;
    const out = [];
    for (let i = 0; i < limit; i++) {
        const start = Math.floor(i * step);
        const end = Math.max(start + 1, Math.floor((i + 1) * step));
        let best = bins[start];
        for (let j = start + 1; j < end; j++) {
            if (bins[j].amp > best.amp) best = bins[j];
        }
        out.push(best);
    }
    return out;
}

function renderSpectrumChart() {
    const metrics = getForensicMetrics();
    const spectrum = metrics.spectrum;
    const unit = getForensicUnit(metrics);
    const statsEl = document.getElementById('spectrumStats');
    if (statsEl) {
        statsEl.innerHTML = '';
        const tiles = [
            ['spectrumDominant', spectrum && spectrum.dominantPeriod !== null ? fmtNumber(spectrum.dominantPeriod, 0) + ' ' + t('spectrumPeriodUnit') : '—'],
            ['spectrumShare', fmtPercent(spectrum && spectrum.peakShare, 1)],
            ['spectrumFlatness', fmtNumber(spectrum && spectrum.flatness, 3)],
            ['spectrumPeaks', spectrum && spectrum.peaks ? String(spectrum.peaks.length) : '0']
        ];
        tiles.forEach(([key, value]) => {
            statsEl.insertAdjacentHTML('beforeend',
                '<div class="stat-tile"><div class="label">' + t(key)
                + '</div><div class="value">' + value + '</div></div>');
        });
    }
    const noteEl = document.getElementById('spectrumNote');
    if (noteEl) noteEl.textContent = t('spectrumNote');

    if (forensicSpectrumChart) {
        forensicSpectrumChart.destroy();
        forensicSpectrumChart = null;
    }
    const canvas = document.getElementById('spectrumChart');
    if (!canvas || !spectrum || !spectrum.bins.length) return;

    const bins = downsampleSpectrum(spectrum.bins, 320);
    forensicSpectrumChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            datasets: [{
                label: t('spectrumLegend'),
                data: bins.map(bin => ({ x: bin.period, y: bin.amp })),
                backgroundColor: 'rgba(160, 255, 78, 0.55)',
                borderColor: 'rgba(160, 255, 78, 0.9)',
                borderWidth: 1,
                barPercentage: 1.0,
                categoryPercentage: 1.0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: t('spectrumX'), color: CHART_COLORS.axisTitle },
                    grid: { color: CHART_COLORS.grid },
                    ticks: { color: CHART_COLORS.axisTick }
                },
                y: {
                    title: { display: true, text: t('spectrumY') + ' (' + unit + ')', color: CHART_COLORS.axisTitle },
                    grid: { color: CHART_COLORS.grid },
                    ticks: { color: CHART_COLORS.axisTick },
                    beginAtZero: true
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: context => t('spectrumX') + ' ' + context.parsed.x + ' · ' + context.parsed.y.toFixed(3) + ' ' + unit
                    }
                }
            }
        }
    });
}

// --- combo fatigue ---------------------------------------------------------

function renderFatigueChart() {
    const metrics = getForensicMetrics();
    const fatigue = metrics.fatigue;
    const unit = getForensicUnit(metrics);
    const statsEl = document.getElementById('fatigueStats');
    if (statsEl) {
        statsEl.innerHTML = '';
        const tiles = [
            ['fatigueSlope', fatigue && fatigue.slope !== null ? fmtNumber(fatigue.slope, 3) + ' ' + unit + '/100' : '—'],
            ['fatigueR2', fmtNumber(fatigue && fatigue.r2, 3)],
            ['fatigueMaxCombo', fatigue ? String(fatigue.maxCombo) : '0'],
            ['fatigueBins', fatigue && fatigue.bins ? String(fatigue.bins.length) : '0']
        ];
        tiles.forEach(([key, value]) => {
            statsEl.insertAdjacentHTML('beforeend',
                '<div class="stat-tile"><div class="label">' + t(key)
                + '</div><div class="value">' + value + '</div></div>');
        });
    }
    const noteEl = document.getElementById('fatigueNote');
    if (noteEl) noteEl.textContent = t('fatigueNote');

    if (forensicFatigueChart) {
        forensicFatigueChart.destroy();
        forensicFatigueChart = null;
    }
    const canvas = document.getElementById('fatigueChart');
    if (!canvas || !fatigue || !fatigue.bins.length) return;

    forensicFatigueChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            datasets: [{
                label: t('fatigueLegend'),
                data: fatigue.bins.map(bin => ({ x: bin.midpoint, y: bin.sigma })),
                borderColor: '#ffb74d',
                backgroundColor: 'rgba(255, 183, 77, 0.18)',
                borderWidth: 2,
                pointRadius: 3,
                tension: 0.25,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: t('fatigueX'), color: CHART_COLORS.axisTitle },
                    grid: { color: CHART_COLORS.grid },
                    ticks: { color: CHART_COLORS.axisTick }
                },
                y: {
                    title: { display: true, text: t('fatigueY') + ' (' + unit + ')', color: CHART_COLORS.axisTitle },
                    grid: { color: CHART_COLORS.grid },
                    ticks: { color: CHART_COLORS.axisTick },
                    beginAtZero: true
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: context => t('fatigueX') + ' ' + context.parsed.x + ' · σ ' + context.parsed.y.toFixed(3) + ' ' + unit
                    }
                }
            }
        }
    });
}

// --- detrended lag-1 compensation -----------------------------------------

function renderCompensationChart() {
    const metrics = getForensicMetrics();
    const lag1 = metrics.lag1;
    const statsEl = document.getElementById('compensationStats');
    if (statsEl) {
        statsEl.innerHTML = '';
        const tiles = [
            ['compensationRho', fmtNumber(lag1 && lag1.rho, 3)],
            ['compensationWindow', lag1 && lag1.window ? String(lag1.window) : '—'],
            ['compensationPairs', lag1 ? String(lag1.pairs) : '0'],
            ['compensationChunks', lag1 && lag1.profile ? String(lag1.profile.length) : '0']
        ];
        tiles.forEach(([key, value]) => {
            statsEl.insertAdjacentHTML('beforeend',
                '<div class="stat-tile"><div class="label">' + t(key)
                + '</div><div class="value">' + value + '</div></div>');
        });
    }
    const noteEl = document.getElementById('compensationNote');
    if (noteEl) noteEl.textContent = t('compensationNote');

    if (forensicCompensationChart) {
        forensicCompensationChart.destroy();
        forensicCompensationChart = null;
    }
    const canvas = document.getElementById('compensationChart');
    if (!canvas || !lag1 || !lag1.profile.length) return;

    const annotations = {
        zeroLine: {
            type: 'line',
            yMin: 0,
            yMax: 0,
            borderColor: CHART_COLORS.bandLine,
            borderWidth: 1,
            borderDash: [4, 4]
        }
    };
    if (Number.isFinite(lag1.rho)) {
        annotations.meanLine = {
            type: 'line',
            yMin: lag1.rho,
            yMax: lag1.rho,
            borderColor: '#ffb74d',
            borderWidth: 1.5,
            borderDash: [6, 4],
            label: {
                display: true,
                content: 'ρ₁ = ' + lag1.rho.toFixed(3),
                position: 'end',
                backgroundColor: CHART_COLORS.meanLabelBg,
                color: '#fff',
                font: { size: 10 }
            }
        };
    }

    forensicCompensationChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            datasets: [{
                label: t('compensationLegend'),
                data: lag1.profile.map(point => ({ x: point.hit, y: point.rho })),
                borderColor: '#4fc3f7',
                backgroundColor: 'rgba(79, 195, 247, 0.16)',
                borderWidth: 2,
                pointRadius: 2,
                tension: 0.15,
                fill: true,
                spanGaps: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: t('compensationX'), color: CHART_COLORS.axisTitle },
                    grid: { color: CHART_COLORS.grid },
                    ticks: { color: CHART_COLORS.axisTick }
                },
                y: {
                    title: { display: true, text: t('compensationY'), color: CHART_COLORS.axisTitle },
                    grid: { color: CHART_COLORS.grid },
                    ticks: { color: CHART_COLORS.axisTick }
                }
            },
            plugins: {
                legend: { display: false },
                annotation: { annotations }
            }
        }
    });
}

// --- rolling UR ------------------------------------------------------------

function renderStabilityChart() {
    const metrics = getForensicMetrics();
    const rolling = computeRollingUr(getForensicRecords(), 100);
    const values = rolling.points.filter(point => point !== null);
    const statsEl = document.getElementById('stabilityStats');
    if (statsEl) {
        statsEl.innerHTML = '';
        const meanUr = values.reduce((sum, point) => sum + point.ur, 0) / (values.length || 1);
        const maxUr = values.reduce((max, point) => Math.max(max, point.ur), 0);
        const tiles = [
            ['stabilityMeanUr', values.length ? fmtNumber(meanUr, 2) : '—'],
            ['stabilityMaxUr', values.length ? fmtNumber(maxUr, 2) : '—'],
            ['stabilityWindow', String(rolling.window)],
            ['stabilityUnit', rolling.isMs ? 'ms' : getForensicUnit(metrics)]
        ];
        tiles.forEach(([key, value]) => {
            statsEl.insertAdjacentHTML('beforeend',
                '<div class="stat-tile"><div class="label">' + t(key)
                + '</div><div class="value">' + value + '</div></div>');
        });
    }
    const noteEl = document.getElementById('stabilityNote');
    if (noteEl) noteEl.textContent = t('stabilityNote');

    if (forensicStabilityChart) {
        forensicStabilityChart.destroy();
        forensicStabilityChart = null;
    }
    const canvas = document.getElementById('stabilityChart');
    if (!canvas || !values.length) return;

    forensicStabilityChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            datasets: [{
                label: t('stabilityLegend'),
                data: rolling.points.filter(point => point !== null).map(point => ({ x: point.hit, y: point.ur })),
                borderColor: '#a0ff4e',
                backgroundColor: 'rgba(160, 255, 78, 0.12)',
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.2,
                fill: true,
                spanGaps: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: t('stabilityX'), color: CHART_COLORS.axisTitle },
                    grid: { color: CHART_COLORS.grid },
                    ticks: { color: CHART_COLORS.axisTick }
                },
                y: {
                    title: { display: true, text: t('stabilityY'), color: CHART_COLORS.axisTitle },
                    grid: { color: CHART_COLORS.grid },
                    ticks: { color: CHART_COLORS.axisTick },
                    beginAtZero: true
                }
            },
            plugins: {
                legend: { display: false },
                annotation: {
                    annotations: {
                        urLine: {
                            type: 'line',
                            yMin: 10,
                            yMax: 10,
                            borderColor: 'rgba(242, 102, 77, 0.6)',
                            borderWidth: 1.5,
                            borderDash: [6, 4],
                            label: {
                                display: true,
                                content: 'UR 10',
                                position: 'end',
                                backgroundColor: 'rgba(242, 102, 77, 0.65)',
                                color: '#fff',
                                font: { size: 10 }
                            }
                        }
                    }
                }
            }
        }
    });
}

// --- two-replay comparison -------------------------------------------------

function subsetEvenly(list, limit) {
    if (list.length <= limit) return list;
    const step = list.length / limit;
    const out = [];
    for (let i = 0; i < limit; i++) out.push(list[Math.floor(i * step)]);
    return out;
}

function computeComparison(primary, secondary) {
    const a = forensicSeries(primary);
    const b = forensicSeries(secondary);
    const n = Math.min(a.length, b.length);
    if (n < 20) return null;

    const pairs = [];
    let sumA = 0, sumB = 0, sumAB = 0, sumAA = 0, sumBB = 0;
    let sumAbs = 0, opposite = 0, withinTolerance = 0, exact = 0;
    let pooledSumSq = 0;
    let count = 0;

    for (let i = 0; i < n; i++) {
        const x = a[i];
        const y = b[i];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        pairs.push({ x, y });
        sumA += x; sumB += y;
        sumAB += x * y; sumAA += x * x; sumBB += y * y;
        sumAbs += Math.abs(x - y);
        if ((x < 0) !== (y < 0)) opposite++;
        pooledSumSq += x * x + y * y;
        count++;
    }
    if (count < 20) return null;

    const meanA = sumA / count;
    const meanB = sumB / count;
    const varA = sumAA / count - meanA * meanA;
    const varB = sumBB / count - meanB * meanB;
    const corr = varA > 0 && varB > 0
        ? (sumAB / count - meanA * meanB) / Math.sqrt(varA * varB)
        : null;
    const pooledSigma = Math.sqrt(pooledSumSq / (2 * count));
    const tolerance = Math.max(0.5, pooledSigma * 0.05);

    pairs.forEach(pair => {
        const diff = Math.abs(pair.x - pair.y);
        if (diff <= tolerance) withinTolerance++;
        if (diff <= 0.001) exact++;
    });

    return {
        count,
        corr,
        meanAbs: sumAbs / count,
        tolerance,
        withinTolerance: withinTolerance / count,
        exact: exact / count,
        opposite: opposite / count
    };
}

function renderCompareStats(result) {
    const statsEl = document.getElementById('compareStats');
    const noteEl = document.getElementById('compareNote');
    if (!statsEl) return;

    statsEl.innerHTML = '';
    if (!result) {
        if (noteEl) noteEl.textContent = t('compareNeedFile');
        return;
    }

    const tiles = [
        ['compareOverlap', String(result.count)],
        ['compareCorr', fmtNumber(result.corr, 3)],
        ['compareMeanAbs', fmtNumber(result.meanAbs, 3) + ' ' + (getForensicMetrics().isMs ? 'ms' : getUnit().trim())],
        ['compareTolerance', fmtPercent(result.withinTolerance, 1)],
        ['compareExact', fmtPercent(result.exact, 2)],
        ['compareOpposite', fmtPercent(result.opposite, 1)]
    ];
    tiles.forEach(([key, value]) => {
        statsEl.insertAdjacentHTML('beforeend',
            '<div class="stat-tile"><div class="label">' + t(key)
            + '</div><div class="value">' + value + '</div></div>');
    });

    if (noteEl) {
        noteEl.textContent = t('compareNote').replace('{tol}', result.tolerance.toFixed(2));
    }
}

function drawComparisonChart() {
    if (forensicCompareChart) {
        forensicCompareChart.destroy();
        forensicCompareChart = null;
    }
    const canvas = document.getElementById('compareChart');
    if (!canvas) return;

    const primary = getForensicRecords();
    const secondary = forensicCompare ? forensicCompare.records : null;
    const result = secondary ? computeComparison(primary, secondary) : null;
    renderCompareStats(result);
    if (!result) return;

    const a = forensicSeries(primary);
    const b = forensicSeries(secondary);
    const n = Math.min(a.length, b.length);
    const points = [];
    for (let i = 0; i < n; i++) {
        if (Number.isFinite(a[i]) && Number.isFinite(b[i])) points.push({ x: a[i], y: b[i] });
    }
    const shown = subsetEvenly(points, FORENSIC_COMPARE_LIMIT);
    const values = points.flatMap(point => [point.x, point.y]);
    const min = values.reduce((m, v) => Math.min(m, v), Infinity);
    const max = values.reduce((m, v) => Math.max(m, v), -Infinity);
    const unit = getForensicMetrics().isMs ? 'ms' : getUnit().trim();

    forensicCompareChart = new Chart(canvas.getContext('2d'), {
        type: 'scatter',
        data: {
            datasets: [
                {
                    label: t('compareScatter'),
                    data: shown,
                    backgroundColor: 'rgba(79, 195, 247, 0.6)',
                    pointRadius: 2
                },
                {
                    label: t('compareIdentity'),
                    data: [{ x: min, y: min }, { x: max, y: max }],
                    borderColor: 'rgba(255, 183, 77, 0.85)',
                    borderWidth: 1.5,
                    borderDash: [6, 4],
                    pointRadius: 0,
                    showLine: true,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: t('compareX') + ' (' + unit + ')', color: CHART_COLORS.axisTitle },
                    grid: { color: CHART_COLORS.grid },
                    ticks: { color: CHART_COLORS.axisTick }
                },
                y: {
                    type: 'linear',
                    title: { display: true, text: t('compareY') + ' (' + unit + ')', color: CHART_COLORS.axisTitle },
                    grid: { color: CHART_COLORS.grid },
                    ticks: { color: CHART_COLORS.axisTick }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: CHART_COLORS.legend, boxWidth: 12, font: { size: 13 }, padding: 14 }
                }
            }
        }
    });
}

async function loadComparisonFile(file) {
    if (!file) return;
    const nameEl = document.getElementById('forensicCompareName');
    if (nameEl) nameEl.textContent = t('compareLoading');

    try {
        const data = await readLogFile(file);
        const slotCount = Math.max(data.playerCount, 1);
        const rawPlayers = [];
        for (let id = 0; id < slotCount; id++) rawPlayers.push(data.players[id] || null);
        const isAngle = data.header.isAngle === true;
        const players = buildRecordsForStreams(rawPlayers, isAngle, isAngle ? 'deg' : 'ms');
        // Compare the same player slot on both logs; fall back to the first one
        // when the second log has fewer players than the one on screen.
        const comparePlayer = Math.min(Math.max(activePlayer, 0), players.length - 1);
        forensicCompare = { fileName: file.name, records: players[comparePlayer] || [] };
        if (nameEl) nameEl.textContent = file.name;
        drawComparisonChart();
    } catch (err) {
        forensicCompare = null;
        if (nameEl) nameEl.textContent = '';
        alert(t('parseFailed') + '\n' + err.message);
        renderCompareStats(null, '');
    }
}

function ensureCompareControls() {
    const input = document.getElementById('forensicCompareInput');
    if (!input || input.dataset.bound === '1') return;
    input.dataset.bound = '1';
    input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (file) loadComparisonFile(file);
    });
}

function renderCompareChart() {
    ensureCompareControls();
    const nameEl = document.getElementById('forensicCompareName');
    if (forensicCompare && nameEl) nameEl.textContent = forensicCompare.fileName;
    drawComparisonChart();
}

// --- cleanup ---------------------------------------------------------------

function clearForensicPanels() {
    [forensicHurstChart, forensicSpectrumChart, forensicFatigueChart,
        forensicCompensationChart, forensicStabilityChart, forensicCompareChart]
        .forEach(chart => { if (chart) chart.destroy(); });

    forensicHurstChart = null;
    forensicSpectrumChart = null;
    forensicFatigueChart = null;
    forensicCompensationChart = null;
    forensicStabilityChart = null;
    forensicCompareChart = null;

    forensicCache = { records: null, unit: null, metrics: null };
    forensicCompare = null;

    ['hurstStats', 'spectrumStats', 'fatigueStats',
        'compensationStats', 'stabilityStats', 'compareStats']
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '';
        });

    ['hurstNote', 'spectrumNote', 'fatigueNote', 'compensationNote',
        'stabilityNote', 'compareNote']
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '';
        });

    const nameEl = document.getElementById('forensicCompareName');
    if (nameEl) nameEl.textContent = '';
    const input = document.getElementById('forensicCompareInput');
    if (input) input.value = '';
}
