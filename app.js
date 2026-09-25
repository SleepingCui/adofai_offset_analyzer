function getPreferredLanguage() {
    const navLang = (navigator.language || navigator.userLanguage || '').toLowerCase();
    
    if (navLang.startsWith('zh')) return 'zh';
    if (navLang.startsWith('ko') || navLang.startsWith('kr')) return 'kr';
    if (navLang.startsWith('en')) return 'en';
    
    return 'en'; 
}

let currentLang = getPreferredLanguage();
let currentMetaData = null;
let metaExpanded = false;
let minOffsetFilter = null;
let maxOffsetFilter = null;
let ignoreOutliers = false;
let pointSize = 3;

function t(key) {
    return (I18N_STRINGS[currentLang] && I18N_STRINGS[currentLang][key]) || key;
}

function getUnit() {
    return (currentMetaData && currentMetaData.isAngle) ? '°' : ' ms';
}

function updateMetaInfo() {
    const metaEl = document.getElementById('metaInfo');
    const summaryEl = document.getElementById('metaSummary');
    const detailsEl = document.getElementById('metaDetails');
    const toggleEl = document.getElementById('metaToggle');
    if (!currentMetaData || globalOffsets.length === 0) {
        if (summaryEl) summaryEl.innerText = t('waitingImport');
        if (detailsEl) {
            detailsEl.innerHTML = '';
            detailsEl.hidden = true;
        }
        if (toggleEl) {
            toggleEl.disabled = true;
            toggleEl.innerText = t('showDetails');
            toggleEl.setAttribute('aria-expanded', 'false');
        }
        return;
    }

    if (summaryEl) {
        summaryEl.innerHTML = `
            <strong>${t('songName')}:</strong> ${currentMetaData.songName || 'Unknown'}<br>
            <strong>${t('levelPath')}:</strong> ${currentMetaData.levelPath || 'Unknown'}
        `;
    }
    if (detailsEl) {
        detailsEl.innerHTML = `
            <div><strong>${t('formatVersion')}:</strong> ${currentMetaData.versionText || 'Unknown'}</div>
            <div><strong>${t('analysisTime')}:</strong> ${currentMetaData.timestamp ? new Date(currentMetaData.timestamp * 1000).toLocaleString() : 'Unknown'}</div>
            <div><strong>${t('judgeVersion')}:</strong> ${currentMetaData.judgeCodeVersion ? `v${currentMetaData.judgeCodeVersion}` : t('legacyMode')}</div>
            <div><strong>${t('hitMarginVersion')}:</strong> ${currentMetaData.hitMarginVersion ?? 'Unknown'}</div>
            <div><strong>${t('bpm')}:</strong> ${currentMetaData.bpm ?? 'Unknown'}</div>
            <div><strong>${t('speed')}:</strong> ${currentMetaData.speed ?? 'Unknown'}</div>
            <div><strong>${t('pitch')}:</strong> ${currentMetaData.pitch ?? 'Unknown'}</div>
            <div><strong>${t('valueMode')}:</strong> ${currentMetaData.isAngle ? 'Angle' : 'Timing'}</div>
            <div><strong>${t('recordCount')}:</strong> ${globalOffsets.length.toLocaleString()}</div>
        `;
        detailsEl.hidden = !metaExpanded;
    }
    if (toggleEl) {
        toggleEl.disabled = false;
        toggleEl.innerText = metaExpanded ? t('hideDetails') : t('showDetails');
        toggleEl.setAttribute('aria-expanded', String(metaExpanded));
    }
}

function setLanguage(lang) {
    if (!I18N_STRINGS[lang]) return;
    currentLang = lang;

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (I18N_STRINGS[lang][key]) {
            el.innerText = I18N_STRINGS[lang][key];
        }
    });

    updateMetaInfo();
    renderChartConfigList();

    if (globalOffsets.length > 0) {
        updateAllCharts();
    }
}

// TimingShow judgeCode mapping.  Legacy logs are normalized to this mapping
// during import, so all charts can use one semantic code set.
const MARGIN_MAP = {
    0: { label: 'TooEarly', color: '#FF0000' },
    1: { label: 'VeryEarly', color: '#FF6F4E' },
    2: { label: 'EarlyPerfect', color: '#A0FF4E' },
    // Code 3 is version-dependent: Legacy uses Perfect, Game34 uses PerfectMinus.
    3: { label: 'Perfect', color: '#60FF4E' },
    4: { label: 'XPerfect', color: '#4DCCFF' },
    5: { label: 'PerfectPlus', color: '#60FF4E' },
    6: { label: 'LatePerfect', color: '#A0FF4E' },
    7: { label: 'VeryLate', color: '#FF6F4E' },
    8: { label: 'TooLate', color: '#FF0000' },
    9: { label: 'Multipress', color: '#00FFED' },
    10: { label: 'FailMiss', color: '#D958FF' },
    11: { label: 'FailOverload', color: '#D958FF' },
    12: { label: 'Auto', color: '#FFFFFF' },
    13: { label: 'OverPress', color: '#D958FF' },
    14: { label: 'Midspin', color: '#888888' },
    15: { label: 'FailedFloor', color: '#D958FF' }
};

const DISPLAY_ORDER = [9, 0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
const LEGACY_MARGIN_MAP = {
    0: { label: 'TooEarly', color: '#FF0000' },
    1: { label: 'VeryEarly', color: '#FF6F4E' },
    2: { label: 'EarlyPerfect', color: '#A0FF4E' },
    3: { label: 'Perfect', color: '#60FF4E' },
    4: { label: 'XPerfect', color: '#4DCCFF' },
    6: { label: 'LatePerfect', color: '#A0FF4E' },
    7: { label: 'VeryLate', color: '#FF6F4E' },
    8: { label: 'TooLate', color: '#FF0000' },
    9: { label: 'Multipress', color: '#00FFED' },
    10: { label: 'FailMiss', color: '#D958FF' },
    11: { label: 'FailOverload', color: '#D958FF' },
    12: { label: 'Auto', color: '#FFFFFF' },
    13: { label: 'OverPress', color: '#D958FF' }
};
const LEGACY_DISPLAY_ORDER = [9, 0, 1, 2, 4, 3, 6, 7, 8, 10, 11, 12, 13];
let showDynamicAvg = false;

const JD_WEIGHTS = {
    "failMiss": 0.0,
    "tooEarly": 0.2,
    "early": 0.4,
    "ePerfect": 0.75,
    "perfect": 1.0,
    "xPerfect": 1.0, 
    "auto": 1.0,
    "lPerfect": 0.75,
    "late": 0.4
};
let globalOffsets = [];
let globalAvg = 0;
let globalStdDev = 0;
let globalCounts = {};
let myChart = null;
let xaccChart = null;
let distributionChart = null;
let pieChart = null;
let comboChart = null;
let rollingChart = null;
let returnChart = null;

// Every chart on the page, in the order they appear, so the config menu, the
// render pass and "clear" all work off one list. The detailed analysis charts
// are opt-in: they answer narrower questions and would push the main charts
// below the fold. Visibility is per session -- the page keeps no state between
// loads.
const CHART_SECTIONS = [
    { key: 'scatter', sectionId: 'sectionScatter', titleKey: 'scatterTitle', defaultVisible: true, render: () => renderScatterChart() },
    { key: 'rolling', sectionId: 'sectionRolling', titleKey: 'rollingTitle', defaultVisible: false, render: () => renderRollingChart() },
    { key: 'returnMap', sectionId: 'sectionReturn', titleKey: 'returnTitle', defaultVisible: false, render: () => renderReturnChart() },
    { key: 'distribution', sectionId: 'sectionDistribution', titleKey: 'distTitle', defaultVisible: true, render: () => renderDistributionChart() },
    { key: 'pie', sectionId: 'sectionPie', titleKey: 'pieTitle', defaultVisible: true, render: () => renderPieChart() },
    { key: 'xacc', sectionId: 'sectionXacc', titleKey: 'xaccTitle', defaultVisible: true, render: () => renderXaccChart() },
    { key: 'combo', sectionId: 'sectionCombo', titleKey: 'comboTitle', defaultVisible: false, render: () => renderComboChart() }
];
CHART_SECTIONS.forEach(entry => { entry.visible = entry.defaultVisible; });
const DEFAULT_CHART_ORDER = CHART_SECTIONS.map(entry => entry.key);

function isGame34Log() {
    const version = currentMetaData && currentMetaData.hitMarginVersion;
    return String(version || '').toLowerCase() === 'game34' || Number(version) === 2;
}

function getMarginDefinition(type) {
    const definition = isGame34Log() ? MARGIN_MAP[type] : LEGACY_MARGIN_MAP[type];
    if (!definition) return { label: 'Unknown', color: '#FFFFFF' };
    if (isGame34Log() && type === 3) {
        return { label: 'PerfectMinus', color: definition.color };
    }
    return definition;
}

function getDisplayOrder() {
    return isGame34Log() ? DISPLAY_ORDER : LEGACY_DISPLAY_ORDER;
}

function normalizeLegacyJudgeCode(rawCode) {
    const legacyMap = {
        0: 0, 1: 1, 2: 2, 3: 3, 4: 6, 5: 7, 6: 8,
        7: 9, 8: 10, 9: 11, 10: 12, 11: 13, 12: 4
    };
    return Object.prototype.hasOwnProperty.call(legacyMap, rawCode) ? legacyMap[rawCode] : -1;
}

function isPerfectFamilyCode(type) {
    return [2, 3, 4, 5, 6].includes(type);
}

function isNormalPerfectCode(type) {
    return type === 3 || type === 5;
}

// Codes that keep a Perfect streak alive. Auto counts because it is a perfect
// hit by definition -- and because the max-combo counter already counts it, so
// the streak strip and the "Max Combo" card report the same longest run.
function isStreakHitCode(type) {
    return isPerfectFamilyCode(type) || type === 12;
}

// Sequential ramp for the streak strip, dim -> bright, top step anchored on the
// Perfect green already used elsewhere. Checked as an ordinal ramp against the
// strip surface (#0a0a0a): lightness rises monotonically across the steps, so
// the streak length stays readable for readers who cannot separate the hues.
const COMBO_RAMP = ['#3a6b34', '#408738', '#45a43a', '#4cc23f', '#52e043', '#60ff4e'];
const COMBO_BREAK_COLOR = '#333';

// -> [{ startIndex, endIndex, length }], one entry per unbroken run of hits
// that keep the streak alive.
function computePerfectRuns(offsets) {
    const runs = [];
    let start = -1;

    for (let i = 0; i < offsets.length; i++) {
        if (isStreakHitCode(offsets[i][1])) {
            if (start < 0) start = i;
        } else if (start >= 0) {
            runs.push({ startIndex: start, endIndex: i - 1, length: i - start });
            start = -1;
        }
    }

    if (start >= 0) {
        runs.push({ startIndex: start, endIndex: offsets.length - 1, length: offsets.length - start });
    }

    return runs;
}

// Segments tile the whole play: every run, plus the gap that broke the streak
// before it. `end` is exclusive, so a segment covers records [start, end).
// Kept apart from the drawing code so the tiling can be checked on its own.
function buildComboSegments(runs, totalHits) {
    const segments = [];
    let cursor = 0;

    runs.forEach(run => {
        if (run.startIndex > cursor) {
            segments.push({ start: cursor, end: run.startIndex, length: run.startIndex - cursor, isRun: false });
        }
        segments.push({ start: run.startIndex, end: run.endIndex + 1, length: run.length, isRun: true });
        cursor = run.endIndex + 1;
    });

    if (cursor < totalHits) {
        segments.push({ start: cursor, end: totalHits, length: totalHits - cursor, isRun: false });
    }

    return segments;
}

function getChartSection(key) {
    return CHART_SECTIONS.find(entry => entry.key === key);
}

function setChartVisible(key, visible) {
    const entry = getChartSection(key);
    if (!entry || entry.visible === visible) return;

    entry.visible = visible;
    const section = document.getElementById(entry.sectionId);
    if (section) section.hidden = !visible || globalOffsets.length === 0;

    // Chart.js sizes itself off its container, so a chart built while its
    // section was hidden comes back as a 0x0 canvas. Always (re)render after
    // the section is on screen again.
    if (visible) entry.render();
}

// One place decides what is on screen. A chart section shows only when the user
// asked for it *and* there is something to plot; everything that reports on a
// run -- stat cards, judgment counts, the charts -- plus the controls that need
// something to act on, only exist once there is data. Without it the page is
// the title, the language selector and one centred prompt.
function updatePageState() {
    const hasData = globalOffsets.length > 0;

    const emptyEl = document.getElementById('emptyState');
    if (emptyEl) emptyEl.hidden = hasData;

    // Lets the stylesheet drop the header divider when it holds nothing but the
    // language selector.
    document.body.classList.toggle('is-empty', !hasData);

    // An empty run has nothing to reset, clear, describe or re-import from the
    // header: the prompt in the middle carries the import button instead.
    ['statsGrid', 'marginCountsBox', 'chartsContainer', 'resetZoom', 'clearData', 'metaInfo', 'fileInputWrapper']
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) el.hidden = !hasData;
        });

    CHART_SECTIONS.forEach(entry => {
        const section = document.getElementById(entry.sectionId);
        if (section) section.hidden = !hasData || !entry.visible;
    });
}

// The registry is also the page order: re-appending the sections in registry
// order moves them (appendChild moves an existing element, it does not copy).
function applyChartOrder() {
    const container = document.getElementById('chartsContainer');
    if (!container) return;

    CHART_SECTIONS.forEach(entry => {
        const section = document.getElementById(entry.sectionId);
        if (section) container.appendChild(section);
    });
}

function moveChartSection(key, delta) {
    const index = CHART_SECTIONS.findIndex(entry => entry.key === key);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= CHART_SECTIONS.length) return;

    const moved = CHART_SECTIONS.splice(index, 1)[0];
    CHART_SECTIONS.splice(target, 0, moved);

    applyChartOrder();
    renderChartConfigList();
}

function resetChartOrder() {
    CHART_SECTIONS.sort((a, b) => DEFAULT_CHART_ORDER.indexOf(a.key) - DEFAULT_CHART_ORDER.indexOf(b.key));
    applyChartOrder();
}

function setChartConfigOpen(open) {
    const panel = document.getElementById('chartConfigPanel');
    const toggle = document.getElementById('chartConfigToggle');
    if (!panel || !toggle) return;

    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
}

function renderChartConfigList() {
    const listEl = document.getElementById('chartConfigList');
    if (!listEl) return;

    const chevron = up => '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"'
        + ' stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        + `<path d="${up ? 'M2 6.5 5 3.5l3 3' : 'M2 3.5 5 6.5l3-3'}"/></svg>`;

    // A row is not one big <label>: a click on a nested button would toggle the
    // checkbox as well.
    listEl.innerHTML = CHART_SECTIONS.map((entry, index) => `
        <div class="chart-config-item">
            <label class="chart-config-check">
                <input type="checkbox" data-chart-key="${entry.key}" ${entry.visible ? 'checked' : ''}>
                <span>${t(entry.titleKey)}</span>
            </label>
            <button type="button" class="chart-config-arrow" data-move-key="${entry.key}" data-move-delta="-1"
                ${index === 0 ? 'disabled' : ''} title="${t('moveUp')}" aria-label="${t('moveUp')}">${chevron(true)}</button>
            <button type="button" class="chart-config-arrow" data-move-key="${entry.key}" data-move-delta="1"
                ${index === CHART_SECTIONS.length - 1 ? 'disabled' : ''} title="${t('moveDown')}" aria-label="${t('moveDown')}">${chevron(false)}</button>
        </div>
    `).join('');

    listEl.querySelectorAll('input[data-chart-key]').forEach(input => {
        input.addEventListener('change', () => setChartVisible(input.dataset.chartKey, input.checked));
    });

    listEl.querySelectorAll('button[data-move-key]').forEach(button => {
        button.addEventListener('click', () => moveChartSection(button.dataset.moveKey, Number(button.dataset.moveDelta)));
    });
}

// Trailing-window statistics for the drift chart. Every entry is aligned with
// globalOffsets; null means that record contributed no point (a non-numeric
// offset, or nothing in the window yet). The window expands until it is full
// and slides after that, so the line starts at the first usable hit.
function computeRollingStats(offsets, windowSize) {
    const size = windowSize > 0 ? windowSize : 1;
    const meanData = [];
    const upperData = [];
    const lowerData = [];
    const window = [];
    let sum = 0;
    let sumSquares = 0;

    offsets.forEach(item => {
        const value = item[0];
        if (!isNaN(value)) {
            window.push(value);
            sum += value;
            sumSquares += value * value;
            if (window.length > size) {
                const dropped = window.shift();
                sum -= dropped;
                sumSquares -= dropped * dropped;
            }
        }

        if (window.length === 0) {
            meanData.push(null);
            upperData.push(null);
            lowerData.push(null);
            return;
        }

        const mean = sum / window.length;
        // Population sigma, same convention as calculateStatistics(): the page
        // reports one kind of sigma everywhere.
        const sigma = Math.sqrt(Math.max(0, sumSquares / window.length - mean * mean));

        meanData.push(mean);
        upperData.push(mean + sigma);
        lowerData.push(mean - sigma);
    });

    return { meanData, upperData, lowerData };
}

// First and last quarter of the run. Their difference is the headline answer to
// "did I drift?", which a cumulative average cannot show: late in a long play
// the cumulative mean barely moves any more.
function computeDriftStats(offsets) {
    const values = offsets.map(item => item[0]).filter(value => !isNaN(value));
    if (values.length === 0) return { headMean: null, tailMean: null, drift: null };

    const quarter = Math.max(1, Math.floor(values.length * 0.25));
    const head = values.slice(0, quarter);
    const tail = values.slice(-quarter);
    const headMean = head.reduce((a, b) => a + b, 0) / head.length;
    const tailMean = tail.reduce((a, b) => a + b, 0) / tail.length;

    return { headMean: headMean, tailMean: tailMean, drift: tailMean - headMean };
}

// Judgments that are not the player's own tap timing: misses, overloads,
// overpresses, autoplay and midspins. Pairing a tap with one of those measures
// the gap between two unrelated presses, not a correction.
const NON_TAP_CODES = [10, 11, 12, 13, 14, 15];

function isTapRecord(item) {
    return !isNaN(item[0]) && !NON_TAP_CODES.includes(item[1]);
}

// (previous tap, current tap) pairs. Only records that are neighbours in the
// list count: with a miss in between the two taps are not neighbours in time
// either, so the chain breaks there.
function buildReturnPairs(offsets) {
    const pairs = [];

    for (let i = 1; i < offsets.length; i++) {
        if (!isTapRecord(offsets[i - 1]) || !isTapRecord(offsets[i])) continue;
        pairs.push({ previous: offsets[i - 1][0], current: offsets[i][0], hit: i + 1 });
    }

    return pairs;
}

// Pearson r between consecutive offsets. Negative means each hit tends to undo
// the previous one (overcorrection), positive means offsets carry over.
function computeCorrelation(pairs) {
    const count = pairs.length;
    if (count < 2) return null;

    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, sumYY = 0;
    pairs.forEach(pair => {
        sumX += pair.previous;
        sumY += pair.current;
        sumXY += pair.previous * pair.current;
        sumXX += pair.previous * pair.previous;
        sumYY += pair.current * pair.current;
    });

    const meanX = sumX / count;
    const meanY = sumY / count;
    const sigmaX = Math.sqrt(Math.max(0, sumXX / count - meanX * meanX));
    const sigmaY = Math.sqrt(Math.max(0, sumYY / count - meanY * meanY));
    if (!(sigmaX > 0) || !(sigmaY > 0)) return null;

    return (sumXY / count - meanX * meanY) / (sigmaX * sigmaY);
}

function getReturnVerdictKey(correlation) {
    if (correlation === null) return null;
    if (correlation < -0.3) return 'returnOvercorrect';
    if (correlation > 0.3) return 'returnDrift';
    return 'returnIndependent';
}

// Both axes of the return map share one symmetric limit so that the y = x
// diagonal is really 45 degrees and the quadrants read straight. The limit is a
// robust high quantile: one freak hit must not squash the cloud into the centre.
function getSymmetricOffsetLimit(pairs) {
    const magnitudes = [];
    pairs.forEach(pair => {
        magnitudes.push(Math.abs(pair.previous), Math.abs(pair.current));
    });
    if (magnitudes.length === 0) return 1;

    magnitudes.sort((a, b) => a - b);
    const index = Math.min(magnitudes.length - 1, Math.floor(magnitudes.length * 0.98));
    return Math.max(magnitudes[index], 1);
}

function getXaccWeight(type) {
    if (type === 0) return JD_WEIGHTS.tooEarly;
    if (type === 1) return JD_WEIGHTS.early;
    if (type === 2) return JD_WEIGHTS.ePerfect;
    if (type === 3 || type === 4 || type === 5) return JD_WEIGHTS.perfect;
    if (type === 6) return JD_WEIGHTS.lPerfect;
    if (type === 7 || type === 8) return JD_WEIGHTS.late;
    if ([10, 11, 13, 15].includes(type)) return JD_WEIGHTS.failMiss;
    if (type === 12) return JD_WEIGHTS.auto;
    return null;
}


function calculateOutlierBounds(offsets) {
    const validValues = offsets.map(item => item[0]).filter(val => !isNaN(val)).sort((a, b) => a - b);
    if (validValues.length === 0) return { lowerBound: -Infinity, upperBound: Infinity };

    const q1Index = Math.floor(validValues.length * 0.25);
    const q3Index = Math.floor(validValues.length * 0.75);
    const q1 = validValues[q1Index];
    const q3 = validValues[q3Index];
    const iqr = q3 - q1;

    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;

    return { lowerBound, upperBound };
}

function gaussianPDF(x, mean, stdDev) {
    const coefficient = 1 / (stdDev * Math.sqrt(2 * Math.PI));
    const exponent = -0.5 * Math.pow((x - mean) / stdDev, 2);
    return coefficient * Math.exp(exponent);
}

function calculateStatistics() {
    const validOffsets = globalOffsets.map(item => item[0]).filter(val => !isNaN(val));
    const n = validOffsets.length;
    
    if (n === 0) return { mean: 0, stdDev: 0 };
    
    const mean = validOffsets.reduce((a, b) => a + b, 0) / n;
    const variance = validOffsets.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);
    
    return { mean, stdDev };
}

// Axis range for the distribution histogram: median +/- 4 robust sigma, with
// robust sigma = IQR / 1.349.  Taking the raw min/max lets a handful of extreme
// hits stretch the axis until the bulk of the data collapses into one or two
// bins -- exactly the part the histogram exists to show.  On a clean run nothing
// lies beyond 4 sigma, so this degrades to the full data range: the axis is only
// ever cropped when there really is something far outside.
function calculateRobustAxisRange(offsets) {
    const validValues = offsets.map(item => item[0]).filter(val => !isNaN(val)).sort((a, b) => a - b);
    if (validValues.length === 0) return null;

    const quantile = (q) => {
        const pos = (validValues.length - 1) * q;
        const lower = Math.floor(pos);
        const upper = Math.ceil(pos);
        if (lower === upper) return validValues[lower];
        return validValues[lower] + (validValues[upper] - validValues[lower]) * (pos - lower);
    };

    const dataMin = validValues[0];
    const dataMax = validValues[validValues.length - 1];
    const median = quantile(0.5);
    const robustSigma = (quantile(0.75) - quantile(0.25)) / 1.349;

    if (!(robustSigma > 0)) {
        // More than half the hits share one offset: keep the full range rather
        // than collapsing the axis onto a single value.
        return { min: dataMin, max: dataMax };
    }

    return {
        min: Math.max(median - 4 * robustSigma, dataMin),
        max: Math.min(median + 4 * robustSigma, dataMax)
    };
}

function createHistogramData(offsets, binCount = 60, axisRange = null) {
    const validOffsets = offsets.map(item => item[0]).filter(val => !isNaN(val));
    if (validOffsets.length === 0) return [];

    let min, max;
    if (axisRange) {
        min = axisRange.min;
        max = axisRange.max;
    } else {
        min = Math.min(...validOffsets);
        max = Math.max(...validOffsets);
    }

    const padding = (max - min) * 0.05;
    const extendedMin = min - padding;
    const extendedMax = max + padding;
    const range = extendedMax - extendedMin;
    const binWidth = range === 0 ? 1 : range / binCount;

    const bins = [];
    for (let i = 0; i < binCount; i++) {
        const binStart = extendedMin + i * binWidth;
        const binEnd = binStart + binWidth;
        const binCenter = (binStart + binEnd) / 2;
        bins.push({
            start: binStart,
            end: binEnd,
            center: binCenter,
            count: 0
        });
    }

    validOffsets.forEach(offset => {
        // Off-axis: skip instead of clamping, otherwise every extreme hit would
        // pile into the first/last bin and fake a spike.  The count is reported
        // next to the chart instead.
        if (offset < extendedMin || offset > extendedMax) return;
        let binIndex = Math.floor((offset - extendedMin) / binWidth);
        if (binIndex >= binCount) binIndex = binCount - 1;
        if (binIndex < 0) binIndex = 0;
        bins[binIndex].count++;
    });

    return bins;
}

function renderDistributionChart() {
    if (globalOffsets.length === 0) return;
    
    const unit = getUnit();
    const stats = calculateStatistics();
    globalStdDev = stats.stdDev;
    
    const histogramData = createHistogramData(globalOffsets, 60, calculateRobustAxisRange(globalOffsets));
    // An import whose offsets are all non-numeric yields no bins; the plot is
    // empty in that case, so fall back to a placeholder axis.
    const hasBins = histogramData.length > 0;
    const xMin = hasBins ? histogramData[0].start : 0;
    const xMax = hasBins ? histogramData[histogramData.length - 1].end : 1;

    // Points the cropped axis left off the histogram. Everything else on this
    // chart (mu, sigma, skew, kurtosis, the +/-1sigma lines) still uses the full
    // data set, so the badge is the only place this is visible.
    const outsideCount = globalOffsets.reduce((count, item) => {
        const value = item[0];
        return (!isNaN(value) && (value < xMin || value > xMax)) ? count + 1 : count;
    }, 0);
    const axisCropBadge = document.getElementById('distAxisCropBadge');
    if (axisCropBadge) {
        if (outsideCount > 0) {
            axisCropBadge.innerText = (t('axisClipped') || `轴已裁剪至 {min} ~ {max}{unit}（{count} 个点超出范围）`)
                .replace('{min}', xMin.toFixed(1))
                .replace('{max}', xMax.toFixed(1))
                .replace('{unit}', unit)
                .replace('{count}', outsideCount);
            axisCropBadge.style.display = 'block';
        } else {
            axisCropBadge.style.display = 'none';
        }
    }

    const normalCurveData = [];
    if (globalStdDev > 0) {
        const step = (xMax - xMin) / 200;

        const maxCount = Math.max(...histogramData.map(bin => bin.count), 1);
        const scaleFactor = maxCount / gaussianPDF(globalAvg, globalAvg, globalStdDev);
        
        for (let x = xMin; x <= xMax; x += step) {
            normalCurveData.push({
                x: x,
                y: gaussianPDF(x, globalAvg, globalStdDev) * scaleFactor
            });
        }
    }
    
    const distStatsContainer = document.getElementById('distributionStats');
    distStatsContainer.innerHTML = `
        <div class="stat-tile">
            <div class="label">${t('mean')}</div>
            <div class="value" style="color: #ffffff;">${globalAvg.toFixed(2)}${unit}</div>
        </div>
        <div class="stat-tile">
            <div class="label">${t('stdDev')}</div>
            <div class="value" style="color: #ffffff;">${globalStdDev.toFixed(2)}${unit}</div>
        </div>
        <div class="stat-tile">
            <div class="label">${t('skewness')}</div>
            <div class="value" style="color: #ffffff;" id="skewnessValue">-</div>
        </div>
        <div class="stat-tile">
            <div class="label">${t('kurtosis')}</div>
            <div class="value" style="color: #ffffff;" id="kurtosisValue">-</div>
        </div>
    `;
    
    const validOffsets = globalOffsets.map(item => item[0]).filter(val => !isNaN(val));
    if (validOffsets.length > 0 && globalStdDev > 0) {
        const n = validOffsets.length;
        const mean = globalAvg;
        
        const skewness = validOffsets.reduce((sum, val) => sum + Math.pow((val - mean) / globalStdDev, 3), 0) / n;
        document.getElementById('skewnessValue').textContent = skewness.toFixed(3);
        
        const kurtosis = validOffsets.reduce((sum, val) => sum + Math.pow((val - mean) / globalStdDev, 4), 0) / n - 3;
        document.getElementById('kurtosisValue').textContent = kurtosis.toFixed(3);
    }
    
    if (distributionChart) {
        distributionChart.destroy();
    }
    
    const ctx = document.getElementById('distributionChart').getContext('2d');

    const annotationsConfig = {
        meanLine: {
            type: 'line',
            xMin: globalAvg,
            xMax: globalAvg,
            borderColor: '#ffb74d',
            borderWidth: 2,
            borderDash: [5, 5],
            label: {
                display: true,
                content: `μ = ${globalAvg.toFixed(2)}${unit}`,
                position: 'start',
                backgroundColor: 'rgba(230, 124, 11, 0.8)',
                color: '#fff',
                font: { size: 10, weight: 'bold' },
                yAdjust: -10
            }
        }
    };
    
    if (globalStdDev > 0) {
        annotationsConfig.oneSigmaPlus = {
            type: 'line',
            xMin: globalAvg + globalStdDev,
            xMax: globalAvg + globalStdDev,
            borderColor: 'rgba(79, 195, 247, 0.6)',
            borderWidth: 1.5,
            borderDash: [3, 3],
            label: {
                display: true,
                content: `+1σ`,
                position: 'start',
                backgroundColor: 'rgba(79, 195, 247, 0.7)',
                color: '#fff',
                font: { size: 9 },
                yAdjust: -10
            }
        };
        
        annotationsConfig.oneSigmaMinus = {
            type: 'line',
            xMin: globalAvg - globalStdDev,
            xMax: globalAvg - globalStdDev,
            borderColor: 'rgba(79, 195, 247, 0.6)',
            borderWidth: 1.5,
            borderDash: [3, 3],
            label: {
                display: true,
                content: `-1σ`,
                position: 'start',
                backgroundColor: 'rgba(79, 195, 247, 0.7)',
                color: '#fff',
                font: { size: 9 },
                yAdjust: -10
            }
        };
    }
    
    distributionChart = new Chart(ctx, {
        type: 'bar',
        data: {
            datasets: [
                {
                    label: t('offsetDist'),
                    data: histogramData.map(bin => ({ x: bin.center, y: bin.count })),
                    backgroundColor: 'rgba(76, 175, 80, 0.6)',
                    borderColor: 'rgba(76, 175, 80, 0.8)',
                    borderWidth: 1,
                    order: 2,
                    barPercentage: 1.0,
                    categoryPercentage: 1.0,
                },
                {
                    label: t('normalFit'),
                    data: normalCurveData,
                    type: 'line',
                    borderColor: '#ffb74d',
                    borderWidth: 2.5,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.4,
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            layout: {
                padding: { top: 25, right: 15, bottom: 5, left: 15 }
            },
            scales: {
                x: {
                    type: 'linear',
                    min: xMin,
                    max: xMax,
                    title: { display: true, text: t('offsetX') + ` (${unit.trim()})`, color: '#aaa' },
                    grid: { color: '#252525' },
                    ticks: { 
                        color: '#bbb',
                        maxTicksLimit: 10,
                        callback: function(value) { return value.toFixed(1); }
                    }
                },
                y: {
                    title: { display: true, text: t('frequency'), color: '#aaa' },
                    grid: { color: '#252525' },
                    ticks: { color: '#bbb' },
                    beginAtZero: true
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: '#fff', boxWidth: 12, font: { size: 14 }, padding: 15 }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            if (context.datasetIndex === 0) {
                                return `${t('frequency')}: ${context.raw.y}`;
                            } else {
                                return `${t('normalFitValue')}: ${context.raw.y.toFixed(2)}`;
                            }
                        }
                    }
                },
                annotation: { annotations: annotationsConfig }
            }
        }
    });
}

function renderScatterChart() {
    if (globalOffsets.length === 0) return;
    
    const filterContainer = document.getElementById('scatterFilterContainer');
    if (filterContainer) filterContainer.style.display = 'flex';

    const unit = getUnit();
    const unit1 = document.getElementById('rangeUnit1');
    const unit2 = document.getElementById('rangeUnit2');
    if (unit1) unit1.innerText = unit.trim();
    if (unit2) unit2.innerText = unit.trim();

    const { lowerBound, upperBound } = calculateOutlierBounds(globalOffsets);
    const useHitAxis = document.getElementById('scatterUseHitCheckbox')?.checked === true;
    const useTimeline = !useHitAxis && hasTimelineData();
    const numContainer = document.getElementById('pureNumbersContainer');
    numContainer.innerHTML = '';
    getDisplayOrder().forEach(type => {
        const count = globalCounts[type] || 0;
        if ((type === 12 || type === 10) && count === 0) return;

        const span = document.createElement('span');
        span.className = 'pure-number';
        const definition = getMarginDefinition(type);
        span.style.color = definition.color;
        span.title = definition.label;

        const label = document.createElement('span');
        label.className = 'pure-number-label';
        label.innerText = definition.label;

        const value = document.createElement('span');
        value.className = 'pure-number-value';
        value.innerText = count;

        span.appendChild(label);
        span.appendChild(value);
        numContainer.appendChild(span);
    });

    const datasetsMap = {};
    getDisplayOrder().forEach(i => {
        if ((i === 12 || i === 10) && (!globalCounts[i] || globalCounts[i] === 0)) return;
        
        const definition = getMarginDefinition(i);
        datasetsMap[i] = {
            label: definition.label,
            data: [],
            borderColor: definition.color,
            backgroundColor: definition.color + 'CC',
            pointRadius: pointSize,
            pointHoverRadius: pointSize * 2,
            showLine: false,
            parsing: false,
            normalized: true
        };
    });

    let ignoredCount = 0;
    let inRangeCount = 0;

    for (let index = 0; index < globalOffsets.length; index++) {
        const item = globalOffsets[index];
        const yValue = item[0];
        const marginType = item[1];
        const isOutlier = (yValue < lowerBound || yValue > upperBound);
        // Counted independently of the outlier filter: this badge reports the
        // range filter alone, mirroring how ignoredCountBadge reports outliers.
        const withinRange = !(minOffsetFilter !== null && yValue < minOffsetFilter)
            && !(maxOffsetFilter !== null && yValue > maxOffsetFilter);
        if (withinRange && !isNaN(yValue)) inRangeCount++;

        if (ignoreOutliers && isOutlier) {
            ignoredCount++;
            continue;
        }

        if (!withinRange) continue;

        if (datasetsMap[marginType]) {
            datasetsMap[marginType].data.push({
                x: getChartX(item, index, useHitAxis),
                y: yValue
            });
        }
    }

    const badgeEl = document.getElementById('ignoredCountBadge');
    if (badgeEl) {
        if (ignoreOutliers && ignoredCount > 0) {
            badgeEl.innerText = (t('ignoredCount') || `已隐藏 ${ignoredCount} 个点`).replace('{count}', ignoredCount);
            badgeEl.style.display = 'inline-block';
        } else {
            badgeEl.style.display = 'none';
        }
    }

    const rangeBadgeEl = document.getElementById('inRangeCountBadge');
    if (rangeBadgeEl) {
        if (minOffsetFilter !== null || maxOffsetFilter !== null) {
            rangeBadgeEl.innerText = (t('inRangeCount') || `范围内 ${inRangeCount} 个点`).replace('{count}', inRangeCount);
            rangeBadgeEl.style.display = 'inline-block';
        } else {
            rangeBadgeEl.style.display = 'none';
        }
    }

    const finalDatasets = Object.values(datasetsMap);

    if (globalOffsets.length > 0) {
        const avgLineData = [];
        let runningSum = 0;
        let runningCount = 0;

        for (let index = 0; index < globalOffsets.length; index++) {
            const yValue = globalOffsets[index][0];
            if (!isNaN(yValue)) {
                if (ignoreOutliers && (yValue < lowerBound || yValue > upperBound)) continue;
                if (minOffsetFilter !== null && yValue < minOffsetFilter) continue;
                if (maxOffsetFilter !== null && yValue > maxOffsetFilter) continue;

                runningSum += yValue;
                runningCount++;
                avgLineData.push({ x: getChartX(globalOffsets[index], index, useHitAxis), y: runningSum / runningCount });
            }
        }

        finalDatasets.push({
            label: 'Avg',
            type: 'line',
            data: avgLineData,
            borderColor: '#ffb74d',
            borderWidth: 2,
            pointRadius: 0,
            fill: false,
            tension: 0.1,
            showLine: true,
            hidden: showDynamicAvg 
        });
    }
    
    if (myChart) {
        myChart.destroy();
    }

    const ctx = document.getElementById('scatterChart').getContext('2d');
    
    myChart = new Chart(ctx, {
        type: 'scatter',
        data: { datasets: finalDatasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            spanGaps: true,
            layout: {
                padding: {
                    bottom: 40
                }
            },
            scales: {
                x: {
                    title: { display: true, text: useTimeline ? t('timeX') : t('keyX'), color: '#aaa' },
                    grid: { color: '#252525' },
                    ticks: { color: '#bbb' }
                },
                y: {
                    title: { display: true, text: t('offsetX') + ` (${unit.trim()})`, color: '#aaa' },
                    grid: { color: '#252525' },
                    ticks: { color: '#bbb' }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: '#fff', boxWidth: 12, font: { size: 14 }, padding: 15 }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const point = context.raw;
                            const xText = useTimeline ? `${point.x.toFixed(1)} ms` : point.x;
                            return `${xText}: ${point.y.toFixed(4)}${unit} (${context.dataset.label})`;
                        }
                    }
                },
                zoom: {
                    pan: { enabled: true, mode: 'xy', threshold: 5 },
                    zoom: {
                        wheel: { enabled: true, speed: 0.08 },
                        pinch: { enabled: true },
                        mode: 'xy'
                    }
                },
                annotation: {
                    annotations: {
                        line0ms: {
                            type: 'line',
                            yMin: 0,
                            yMax: 0,
                            borderColor: 'rgba(255, 255, 255, 0.75)',
                            borderWidth: 1.5,
                            label: {
                                display: true,
                                content: `0${unit}`,
                                position: 'start',
                                backgroundColor: 'rgba(0,0,0,0.6)',
                                color: '#fff',
                                font: { size: 10 }
                            }
                        },
                        lineAvg: {
                            type: 'line',
                            yMin: globalAvg,
                            yMax: globalAvg,
                            borderColor: '#ffb74d',
                            borderWidth: 2,
                            borderDash: [5, 5],
                            label: {
                                display: true,
                                content: `Avg: ${globalAvg >= 0 ? '+' : ''}${globalAvg.toFixed(2)}${unit}`,
                                position: 'end',
                                backgroundColor: 'rgba(230, 124, 11, 0.8)',
                                color: '#fff',
                                font: { size: 10, weight: 'bold' }
                            }
                        }
                    }
                }
            }
        }
    });
}

function calculateStaticStats() {
    const totalHits = globalOffsets.length;
    const validOffsets = globalOffsets.map(item => item[0]).filter(val => !isNaN(val));
    
    const isAngle = currentMetaData && currentMetaData.isAngle;
    const urCard = document.getElementById('urCard');

    if (urCard) {
        urCard.style.display = isAngle ? 'none' : 'block';
    }

    globalAvg = totalHits > 0 ? (validOffsets.reduce((a, b) => a + b, 0) / totalHits) : 0;
    
    if (totalHits > 0) {
        const variance = validOffsets.reduce((sum, val) => sum + Math.pow(val - globalAvg, 2), 0) / totalHits;
        globalStdDev = Math.sqrt(variance);
        
        if (!isAngle) {
            const ur = globalStdDev * 10;
            document.getElementById('statUR').innerText = ur.toFixed(2);
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

function isRollingHitAxis() {
    return document.getElementById('rollingUseHitCheckbox')?.checked === true;
}

function getRollingWindowSize() {
    const slider = document.getElementById('rollingWindowSlider');
    const size = slider ? parseInt(slider.value, 10) : NaN;
    return Number.isFinite(size) && size > 0 ? size : 50;
}

// Rolling series -> chart points. Split out from the renderer so the window
// slider can refresh the series in place instead of rebuilding the chart.
function buildRollingPoints(rolling, useHitAxis) {
    const toPoints = values => values.reduce((points, value, index) => {
        if (value !== null) points.push({ x: getChartX(globalOffsets[index], index, useHitAxis), y: value });
        return points;
    }, []);

    return {
        upper: toPoints(rolling.upperData),
        mean: toPoints(rolling.meanData),
        lower: toPoints(rolling.lowerData)
    };
}

function renderRollingChart() {
    if (globalOffsets.length === 0) return;

    const filterContainer = document.getElementById('rollingFilterContainer');
    if (filterContainer) filterContainer.style.display = 'flex';

    const unit = getUnit();
    const useHitAxis = isRollingHitAxis();
    const useTimeline = !useHitAxis && hasTimelineData();
    const points = buildRollingPoints(computeRollingStats(globalOffsets, getRollingWindowSize()), useHitAxis);

    const drift = computeDriftStats(globalOffsets);
    const statsEl = document.getElementById('rollingStats');
    if (statsEl) {
        const format = value => value === null ? '-' : `${value.toFixed(2)}${unit}`;
        const signed = drift.drift === null ? '-' : `${drift.drift >= 0 ? '+' : ''}${drift.drift.toFixed(2)}${unit}`;
        statsEl.innerHTML = `
            <div class="stat-tile">
                <div class="label">${t('rollingHeadMean')}</div>
                <div class="value">${format(drift.headMean)}</div>
            </div>
            <div class="stat-tile">
                <div class="label">${t('rollingTailMean')}</div>
                <div class="value">${format(drift.tailMean)}</div>
            </div>
            <div class="stat-tile">
                <div class="label">${t('rollingDrift')}</div>
                <div class="value">${signed}</div>
            </div>
        `;
    }

    if (rollingChart) rollingChart.destroy();

    const ctx = document.getElementById('rollingChart').getContext('2d');
    rollingChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: t('rollingBand'),
                    data: points.upper,
                    borderColor: 'rgba(79, 195, 247, 0.45)',
                    borderWidth: 1,
                    pointRadius: 0,
                    // Filled down to the -1 sigma dataset, which is entry 2.
                    fill: { target: 2 },
                    backgroundColor: 'rgba(79, 195, 247, 0.14)'
                },
                {
                    label: t('rollingMean'),
                    data: points.mean,
                    borderColor: '#ffb74d',
                    borderWidth: 2,
                    pointRadius: 0,
                    fill: false
                },
                {
                    // Exists to give the band a lower edge; the legend filter
                    // below keeps its empty label out of the legend.
                    label: '',
                    data: points.lower,
                    borderColor: 'rgba(79, 195, 247, 0.45)',
                    borderWidth: 1,
                    pointRadius: 0,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: useTimeline ? t('timeX') : t('keyX'), color: '#aaa' },
                    grid: { color: '#252525' },
                    ticks: { color: '#bbb', maxTicksLimit: 12 }
                },
                y: {
                    title: { display: true, text: t('offsetX') + ` (${unit.trim()})`, color: '#aaa' },
                    grid: { color: '#252525' },
                    ticks: { color: '#bbb' }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: '#fff', boxWidth: 12, font: { size: 14 }, padding: 15,
                        filter: item => item.text !== ''
                    }
                },
                tooltip: {
                    callbacks: {
                        title: items => items.length > 0
                            ? `${useTimeline ? t('timeX') : t('keyX')} ${items[0].parsed.x.toFixed(0)}`
                            : '',
                        label: context => context.dataset.label
                            ? `${context.dataset.label}: ${context.parsed.y.toFixed(2)}${unit}`
                            : null
                    }
                },
                annotation: {
                    annotations: {
                        line0ms: {
                            type: 'line',
                            yMin: 0,
                            yMax: 0,
                            borderColor: 'rgba(255, 255, 255, 0.75)',
                            borderWidth: 1.5,
                            label: {
                                display: true,
                                content: `0${unit}`,
                                position: 'start',
                                backgroundColor: 'rgba(0,0,0,0.6)',
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

function renderReturnChart() {
    if (globalOffsets.length === 0) return;

    const unit = getUnit();
    const pairs = buildReturnPairs(globalOffsets);
    const correlation = computeCorrelation(pairs);
    const verdictKey = getReturnVerdictKey(correlation);
    const limit = getSymmetricOffsetLimit(pairs);

    const statsEl = document.getElementById('returnStats');
    if (statsEl) {
        statsEl.innerHTML = `
            <div class="stat-tile">
                <div class="label">${t('returnPairs')}</div>
                <div class="value">${pairs.length}</div>
            </div>
            <div class="stat-tile">
                <div class="label">${t('returnCorr')}</div>
                <div class="value">${correlation === null ? '-' : correlation.toFixed(3)}</div>
            </div>
            <div class="stat-tile">
                <div class="label">${t('returnVerdict')}</div>
                <div class="value">${verdictKey ? t(verdictKey) : '-'}</div>
            </div>
        `;
    }

    // Points the robust axis limit left outside, reported rather than silently
    // clipped -- same behaviour as the distribution chart's axis badge.
    const outside = pairs.reduce((count, pair) =>
        (Math.abs(pair.previous) > limit || Math.abs(pair.current) > limit) ? count + 1 : count, 0);
    const badgeEl = document.getElementById('returnAxisCropBadge');
    if (badgeEl) {
        if (outside > 0) {
            badgeEl.innerText = (t('axisClipped') || '')
                .replace('{min}', (-limit).toFixed(1))
                .replace('{max}', limit.toFixed(1))
                .replace('{unit}', unit)
                .replace('{count}', outside);
            badgeEl.style.display = 'block';
        } else {
            badgeEl.style.display = 'none';
        }
    }

    if (returnChart) returnChart.destroy();

    const ctx = document.getElementById('returnChart').getContext('2d');
    returnChart = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: t('returnTitle'),
                // normalized is deliberately not set: x is the previous offset,
                // which is not sorted.
                data: pairs.map(pair => ({ x: pair.previous, y: pair.current, hit: pair.hit })),
                backgroundColor: 'rgba(79, 195, 247, 0.55)',
                pointRadius: 3,
                pointHoverRadius: 6,
                showLine: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: {
                x: {
                    type: 'linear',
                    min: -limit,
                    max: limit,
                    title: { display: true, text: `${t('returnX')} (${unit.trim()})`, color: '#aaa' },
                    grid: { color: '#252525' },
                    ticks: { color: '#bbb' }
                },
                y: {
                    type: 'linear',
                    min: -limit,
                    max: limit,
                    title: { display: true, text: t('offsetX') + ` (${unit.trim()})`, color: '#aaa' },
                    grid: { color: '#252525' },
                    ticks: { color: '#bbb' }
                }
            },
            plugins: {
                // One series: the section title names it, so no legend box.
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: context => {
                            const pair = context.raw;
                            return `${t('keyX')} ${pair.hit}: ${pair.x.toFixed(2)} → ${pair.y.toFixed(2)}${unit}`;
                        }
                    }
                },
                annotation: {
                    annotations: {
                        diagonal: {
                            type: 'line',
                            xMin: -limit, xMax: limit, yMin: -limit, yMax: limit,
                            borderColor: 'rgba(255, 255, 255, 0.25)',
                            borderWidth: 1,
                            borderDash: [6, 6],
                            label: {
                                display: true,
                                content: 'y = x',
                                position: 'end',
                                backgroundColor: 'rgba(0,0,0,0.6)',
                                color: '#fff',
                                font: { size: 10 }
                            }
                        },
                        zeroX: {
                            type: 'line',
                            xMin: 0, xMax: 0, yMin: -limit, yMax: limit,
                            borderColor: 'rgba(255, 255, 255, 0.25)',
                            borderWidth: 1
                        },
                        zeroY: {
                            type: 'line',
                            yMin: 0, yMax: 0, xMin: -limit, xMax: limit,
                            borderColor: 'rgba(255, 255, 255, 0.25)',
                            borderWidth: 1
                        }
                    }
                }
            }
        }
    });
}

document.getElementById('resetZoom').addEventListener('click', () => {
    if (myChart) {
        myChart.resetZoom();
    }
});

function clearData() {
    globalOffsets = [];
    globalAvg = 0;
    globalStdDev = 0;
    globalCounts = {};
    currentMetaData = null;
    metaExpanded = false;
    minOffsetFilter = null;
    maxOffsetFilter = null;
    ignoreOutliers = false;

    const filterContainer = document.getElementById('scatterFilterContainer');
    if (filterContainer) filterContainer.style.display = 'none';
    const xaccFilterContainer = document.getElementById('xaccFilterContainer');
    if (xaccFilterContainer) xaccFilterContainer.style.display = 'none';
    const comboFilterContainer = document.getElementById('comboFilterContainer');
    if (comboFilterContainer) comboFilterContainer.style.display = 'none';
    const rollingFilterContainer = document.getElementById('rollingFilterContainer');
    if (rollingFilterContainer) rollingFilterContainer.style.display = 'none';

    const minInput = document.getElementById('minOffsetInput');
    const maxInput = document.getElementById('maxOffsetInput');
    if (minInput) minInput.value = '';
    if (maxInput) maxInput.value = '';

    const checkbox = document.getElementById('ignoreOutliersCheckbox');
    if (checkbox) checkbox.checked = false;

    const scatterUseHitCheckbox = document.getElementById('scatterUseHitCheckbox');
    if (scatterUseHitCheckbox) scatterUseHitCheckbox.checked = false;
    const xaccUseHitCheckbox = document.getElementById('xaccUseHitCheckbox');
    if (xaccUseHitCheckbox) xaccUseHitCheckbox.checked = false;
    const comboUseHitCheckbox = document.getElementById('comboUseHitCheckbox');
    if (comboUseHitCheckbox) comboUseHitCheckbox.checked = false;
    const rollingUseHitCheckbox = document.getElementById('rollingUseHitCheckbox');
    if (rollingUseHitCheckbox) rollingUseHitCheckbox.checked = false;

    const badgeEl = document.getElementById('ignoredCountBadge');
    if (badgeEl) badgeEl.style.display = 'none';

    const distAxisCropBadge = document.getElementById('distAxisCropBadge');
    if (distAxisCropBadge) distAxisCropBadge.style.display = 'none';

    for (let i = 0; i <= 15; i++) globalCounts[i] = 0;

    document.getElementById('statTotal').innerText = '-';
    document.getElementById('statMaxCombo').innerText = '-';
    document.getElementById('xaccValue').innerText = 'XACC: -';
    document.getElementById('pureNumbersContainer').innerHTML = '';
    document.getElementById('distributionStats').innerHTML = '';
    const comboStatsEl = document.getElementById('comboStats');
    if (comboStatsEl) comboStatsEl.innerHTML = '';
    const comboLegendEl = document.getElementById('comboLegend');
    if (comboLegendEl) comboLegendEl.innerHTML = '';
    const rollingStatsEl = document.getElementById('rollingStats');
    if (rollingStatsEl) rollingStatsEl.innerHTML = '';
    const returnStatsEl = document.getElementById('returnStats');
    if (returnStatsEl) returnStatsEl.innerHTML = '';
    const returnAxisCropBadge = document.getElementById('returnAxisCropBadge');
    if (returnAxisCropBadge) returnAxisCropBadge.style.display = 'none';
    document.getElementById('jsonFile').value = '';
    document.getElementById('statUR').innerText = '-';
    document.getElementById('statRatio').innerText = '-';

    updateMetaInfo();

    if (myChart) { myChart.destroy(); myChart = null; }
    if (xaccChart) { xaccChart.destroy(); xaccChart = null; }
    if (distributionChart) { distributionChart.destroy(); distributionChart = null; }
    if (pieChart) { pieChart.destroy(); pieChart = null; }
    if (comboChart) { comboChart.destroy(); comboChart = null; }
    if (rollingChart) { rollingChart.destroy(); rollingChart = null; }
    if (returnChart) { returnChart.destroy(); returnChart = null; }

    // Back to the empty state: no data, no chart frames.
    updatePageState();
}

document.getElementById('clearData').addEventListener('click', clearData);

function updateAllCharts() {
    // Sections are shown before anything renders: Chart.js sizes itself off its
    // container, so rendering into a hidden one would leave a 0x0 canvas behind.
    updatePageState();

    CHART_SECTIONS.forEach(entry => {
        if (entry.visible) entry.render();
    });
}

function processOffsets(offsets) {
    return processOffsetRecords(offsets, false);
}

function processOffsetRecords(offsets, timeFirst) {
    return offsets.map((item, index) => {
        const timeMs = timeFirst && item[0] != null ? Number(item[0]) : null;
        const valueIndex = timeFirst ? 1 : 0;
        const rawIndex = timeFirst ? 2 : 1;
        const judgeIndex = timeFirst ? 3 : 2;
        const xpIndex = timeFirst ? 4 : 3;
        const value = Number(item[valueIndex]);
        const rawCode = item.length > rawIndex && item[rawIndex] != null ? Number(item[rawIndex]) : null;
        const hasJudgeCode = item.length > judgeIndex && item[judgeIndex] != null;
        const judgeCode = hasJudgeCode ? Number(item[judgeIndex]) : normalizeLegacyJudgeCode(rawCode);
        const isXP = item.length > xpIndex && Boolean(item[xpIndex]);
        return [value, judgeCode, rawCode, isXP, index, Number.isFinite(timeMs) && timeMs >= 0 ? timeMs : null];
    });
}

function hasTimelineData() {
    return globalOffsets.some(item => Number.isFinite(item[5]) && item[5] >= 0);
}

function getRecordX(item, index) {
    return Number.isFinite(item[5]) && item[5] >= 0 ? item[5] : index + 1;
}

function getChartX(item, index, useHitAxis) {
    return useHitAxis ? index + 1 : getRecordX(item, index);
}

function readString(view, offset) {
    let length = 0;
    let shift = 0;
    do {
        const b = view[offset++];
        length |= (b & 0x7F) << shift;
        shift += 7;
    } while (view[offset - 1] & 0x80);
    
    const str = new TextDecoder().decode(
        new Uint8Array(view.buffer, view.byteOffset + offset, length)
    );
    return { str, newOffset: offset + length };
}

function parseV1(view, offset) {
    const dv = new DataView(view.buffer, view.byteOffset);
    const offsets = [];
    while (offset + 12 <= view.byteLength) {
        const timing = dv.getFloat64(offset, true);
        const marginCode = dv.getInt32(offset + 8, true);
        offsets.push([Math.round(timing * 10000) / 10000, marginCode]);
        offset += 12;
    }
    return offsets;
}

function parseV2(view, offset) {
    const dv = new DataView(view.buffer, view.byteOffset);
    const offsets = [];
    let prevTimingBits = 0n;
    while (offset < view.byteLength) {
        try {
            if (offset + 8 > view.byteLength) break;
            const xorBits = dv.getBigInt64(offset, true);
            offset += 8;

            const actualBits = xorBits ^ prevTimingBits;
            prevTimingBits = actualBits;
            
            const buffer = new ArrayBuffer(8);
            const view64 = new DataView(buffer);
            view64.setBigInt64(0, actualBits, true);
            const timing = view64.getFloat64(0, true);
            
            const readVarInt = (zigZag) => {
                let result = 0;
                let shift = 0;
                let bytesRead = 0;
                let byte;
                do {
                    if (offset >= view.byteLength) throw new Error('Unexpected EOF while reading VarInt');
                    byte = view[offset++];
                    result += (byte & 0x7F) * Math.pow(2, shift);
                    shift += 7;
                    bytesRead++;
                    if (bytesRead > 5) throw new Error('VarInt exceeds maximum 5 bytes');
                } while (byte & 0x80);
                return zigZag ? ((result >>> 1) ^ -(result & 1)) : result;
            };

            const marginCode = readVarInt(true);
            offsets.push([Math.round(timing * 10000) / 10000, marginCode]);
        } catch (e) {
            console.warn('Error parsing at offset', offset, ':', e.message);
            break;
        }
    }
    return offsets;
}

function parseV5(view, offset) {
    return parseV5Records(view, offset, false);
}

function parseV7(view, offset) {
    return parseV5Records(view, offset, true);
}

function parseV5Records(view, offset, compactXor) {
    const dv = new DataView(view.buffer, view.byteOffset);
    const offsets = [];
    let prevTimeBits = 0n;
    let prevValueBits = 0n;

    const readZigZagVarInt = () => {
        let result = 0;
        let shift = 0;
        let byte;
        let count = 0;
        do {
            if (offset >= view.byteLength) throw new Error('Unexpected EOF while reading v5 VarInt');
            byte = view[offset++];
            result += (byte & 0x7F) * Math.pow(2, shift);
            shift += 7;
            count++;
            if (count > 5) throw new Error('v5 VarInt exceeds maximum 5 bytes');
        } while (byte & 0x80);
        return (result >>> 1) ^ -(result & 1);
    };

    const readXorBits = (previousBits) => {
        if (!compactXor) {
            if (offset + 8 > view.byteLength) throw new Error('Truncated v5 double');
            const xorBits = dv.getBigInt64(offset, true);
            offset += 8;
            return xorBits ^ previousBits;
        }

        if (offset >= view.byteLength) throw new Error('Unexpected EOF while reading v7 double control');
        const control = view[offset++];
        if (control === 0) return previousBits;
        if ((control & 0x80) === 0) throw new Error('Invalid v7 double control byte');

        const leadingBytes = (control >>> 4) & 0x07;
        const significantBytes = control & 0x0F;
        if (significantBytes < 1 || significantBytes > 8 || leadingBytes + significantBytes > 8)
            throw new Error('Invalid v7 double byte range');

        const trailingBytes = 8 - leadingBytes - significantBytes;
        let xorBits = 0n;
        if (offset + significantBytes > view.byteLength)
            throw new Error('Truncated v7 double payload');
        for (let i = 0; i < significantBytes; i++) {
            xorBits |= BigInt(view[offset++]) << BigInt(8 * (trailingBytes + i));
        }
        return xorBits ^ previousBits;
    };

    while (offset < view.byteLength) {
        const timeBits = readXorBits(prevTimeBits);
        prevTimeBits = timeBits;

        const valueBits = readXorBits(prevValueBits);
        prevValueBits = valueBits;

        const timeBuffer = new ArrayBuffer(8);
        const timeView = new DataView(timeBuffer);
        timeView.setBigInt64(0, timeBits, true);
        const timeMs = timeView.getFloat64(0, true);

        const valueBuffer = new ArrayBuffer(8);
        const valueView = new DataView(valueBuffer);
        valueView.setBigInt64(0, valueBits, true);
        const value = valueView.getFloat64(0, true);
        const rawMarginCode = readZigZagVarInt();
        const judgeCode = readZigZagVarInt();
        if (offset >= view.byteLength) throw new Error(`Truncated v${compactXor ? 7 : 5} XPerfect flag`);
        const isXP = view[offset++] !== 0;
        offsets.push([Math.round(timeMs * 1000) / 1000, Math.round(value * 10000) / 10000, rawMarginCode, judgeCode, isXP]);
    }
    return offsets;
}

function parseTlogData(decompressed) {
    const view = new Uint8Array(decompressed);
    const dv = new DataView(decompressed.buffer, decompressed.byteOffset);
    let offset = 0;
    
    const magic = new TextDecoder().decode(view.slice(offset, offset + 4));
    if (magic !== 'TSMZ') {
        throw new Error('Invalid file format magic: ' + magic);
    }
    offset += 4;
    
    const version = view[offset++];
    const timestamp = dv.getBigInt64(offset, true);
    offset += 8;
    const { str: songName, newOffset: o1 } = readString(view, offset);
    const { str: levelPath, newOffset: o2 } = readString(view, o1);
    offset = o2;

    let bpm = null, speed = null, pitch = null, isAngle = false;
    if (version >= 4) {
        bpm = dv.getFloat64(offset, true); offset += 8;
        speed = dv.getFloat64(offset, true); offset += 8;
        pitch = dv.getFloat64(offset, true); offset += 8;
        isAngle = view[offset++] === 1;
    } else if (version === 3) {
        isAngle = view[offset++] === 1;
    }

    let offsets;
    let hitMarginVersion = null;
    let judgeCodeVersion = null;
    if (version >= 5) {
        if (offset + 2 > view.byteLength) throw new Error('Missing v5 format metadata');
        hitMarginVersion = view[offset++];
        judgeCodeVersion = view[offset++];
        offsets = version >= 7 ? parseV7(view, offset) : parseV5(view, offset);
    } else if (version === 1) offsets = parseV1(view, offset);
    else if (version >= 2) offsets = parseV2(view, offset);
    else throw new Error(`Unsupported tlog version: ${version}`);

    return {
        songName: songName || '',
        levelPath: levelPath || '',
        timestamp: Number(timestamp),
        bpm,
        speed,
        pitch,
        versionText: version >= 5 ? `TimingShow binary v${version}` : (version === 1 ? '1.8.2- (v1)' : `1.9.0+ (v${version})`),
        isAngle: isAngle,
        hitMarginVersion,
        judgeCodeVersion,
        offsets: processOffsetRecords(offsets, true)
    };
}

async function LoadFile(file) {
    if (!file) return;

    try {
        const fileName = file.name.toLowerCase();
        let data = null;

        if (fileName.endsWith('.json')) {
            const text = await file.text();
            const parsed = JSON.parse(text);
            
            if (!parsed.offsets) {
                alert(t('invalidJson'));
                return;
            }

            let parsedOffsets = [];
            let versionText = "Unknown";

            if (Array.isArray(parsed.offsets)) {
                parsedOffsets = parsed.offsets;
                versionText = parsed.formatVersion >= 5 ? `TimingShow JSON v${parsed.formatVersion}` : "Legacy JSON array";
            } else if (typeof parsed.offsets === 'object' && parsed.offsets !== null) {
                const sortedKeys = Object.keys(parsed.offsets).sort((a, b) => parseInt(a) - parseInt(b));
                parsedOffsets = sortedKeys.map(key => [parsed.offsets[key].v, parsed.offsets[key].j]);
                versionText = "Legacy JSON object";
            } else {
                alert(t('unknownFormat'));
                return;
            }

            data = {
                offsets: processOffsetRecords(parsedOffsets, parsed.formatVersion >= 6),
                versionText: versionText,
                songName: parsed.songName,
                levelPath: parsed.levelPath,
                timestamp: parsed.timestamp,
                bpm: parsed.bpm ?? null,
                speed: parsed.speed ?? null,
                pitch: parsed.pitch ?? null,
                isAngle: parsed.isAngle === true,
                hitMarginVersion: parsed.hitMarginVersion || null,
                judgeCodeVersion: parsed.judgeCodeVersion || null
            };
        } else if (fileName.endsWith('.crpl2')) {
            if (typeof Crpl2 === 'undefined') {
                throw new Error('concrpl2.js library is not loaded!');
            }
            const arrayBuffer = await file.arrayBuffer();
            const { json } = await Crpl2.toTimingshow(arrayBuffer, file.name);
            const parsed = JSON.parse(json);

            data = {
                offsets: processOffsets(parsed.offsets),
                versionText: 'CRPL2',
                songName: parsed.songName,
                levelPath: parsed.levelPath,
                timestamp: parsed.timestamp / 1000,
                bpm: null,
                speed: null,
                pitch: null,
                isAngle: true,
                hitMarginVersion: null,
                judgeCodeVersion: null
            };
        } else {
            const arrayBuffer = await file.arrayBuffer();
            let fileData = new Uint8Array(arrayBuffer);
            const isGzip = fileName.endsWith('.gz') || (fileData.length > 2 && fileData[0] === 0x1F && fileData[1] === 0x8B);
            if (isGzip) {
                if (typeof pako === 'undefined') {
                    throw new Error('pako library is not loaded!');
                }
                fileData = pako.ungzip(fileData);
            }

            data = parseTlogData(fileData);
        }

        globalOffsets = data.offsets;
        currentMetaData = {
            versionText: data.versionText,
            songName: data.songName,
            levelPath: data.levelPath,
            timestamp: data.timestamp,
            bpm: data.bpm ?? null,
            speed: data.speed ?? null,
            pitch: data.pitch ?? null,
            isAngle: data.isAngle,
            hitMarginVersion: data.hitMarginVersion || null,
            judgeCodeVersion: data.judgeCodeVersion || null
        };

        updateMetaInfo();
        calculateStaticStats();
        updateAllCharts();

    } catch (err) {
        alert(t('parseFailed') + '\n' + err.message);
        console.error(err);
    }
}

function handleRangeInput() {
    let minVal = parseFloat(document.getElementById('minOffsetInput').value);
    let maxVal = parseFloat(document.getElementById('maxOffsetInput').value);

    if (!isNaN(minVal) && !isNaN(maxVal) && minVal > maxVal) {
        [minVal, maxVal] = [maxVal, minVal];
    }

    minOffsetFilter = isNaN(minVal) ? null : minVal;
    maxOffsetFilter = isNaN(maxVal) ? null : maxVal;

    renderScatterChart();
}

document.getElementById('minOffsetInput')?.addEventListener('input', handleRangeInput);
document.getElementById('maxOffsetInput')?.addEventListener('input', handleRangeInput);

document.getElementById('ignoreOutliersCheckbox')?.addEventListener('change', (e) => {
    ignoreOutliers = e.target.checked;
    renderScatterChart();
});

document.getElementById('scatterUseHitCheckbox')?.addEventListener('change', () => {
    renderScatterChart();
});

document.getElementById('pointSizeSlider')?.addEventListener('input', (e) => {
    pointSize = parseInt(e.target.value, 10) || 1;

    const valueEl = document.getElementById('pointSizeValue');
    if (valueEl) valueEl.innerText = `${pointSize} px`;

    // Update the live chart in place: rebuilding the datasets on every slider
    // step would be too slow for large logs.
    if (!myChart) {
        renderScatterChart();
        return;
    }
    myChart.data.datasets.forEach(ds => {
        if (ds.type === 'line') return; // Avg line has no points
        ds.pointRadius = pointSize;
        ds.pointHoverRadius = pointSize * 2;
    });
    myChart.update('none');
});

document.getElementById('xaccUseHitCheckbox')?.addEventListener('change', () => {
    renderXaccChart();
});

document.getElementById('comboUseHitCheckbox')?.addEventListener('change', () => {
    renderComboChart();
});

document.getElementById('rollingUseHitCheckbox')?.addEventListener('change', () => {
    renderRollingChart();
});

document.getElementById('rollingWindowSlider')?.addEventListener('input', (e) => {
    const valueEl = document.getElementById('rollingWindowValue');
    if (valueEl) valueEl.innerText = e.target.value;

    if (!rollingChart) {
        renderRollingChart();
        return;
    }

    // Refresh the three series in place: rebuilding 10k-point datasets on every
    // slider step would be too slow to drag.
    const points = buildRollingPoints(
        computeRollingStats(globalOffsets, getRollingWindowSize()),
        isRollingHitAxis()
    );
    rollingChart.data.datasets[0].data = points.upper;
    rollingChart.data.datasets[1].data = points.mean;
    rollingChart.data.datasets[2].data = points.lower;
    rollingChart.update('none');
});

document.getElementById('chartConfigToggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    setChartConfigOpen(document.getElementById('chartConfigPanel')?.hidden === true);
});

document.getElementById('chartConfigShowAll')?.addEventListener('click', () => {
    CHART_SECTIONS.forEach(entry => setChartVisible(entry.key, true));
    renderChartConfigList();
});

document.getElementById('emptyImport')?.addEventListener('click', () => {
    document.getElementById('jsonFile').click();
});

document.getElementById('chartConfigReset')?.addEventListener('click', () => {
    CHART_SECTIONS.forEach(entry => setChartVisible(entry.key, entry.defaultVisible));
    resetChartOrder();
    renderChartConfigList();
});

// The menu closes on an outside click or Escape, the way a corner popover is
// expected to behave. The check goes through composedPath, not contains(): the
// reorder buttons rebuild the list they live in, so by the time the click
// bubbles here the target is already detached and contains() would report an
// outside click, folding the panel shut on every reorder.
document.addEventListener('click', (e) => {
    const config = document.getElementById('chartConfig');
    if (config && !e.composedPath().includes(config)) setChartConfigOpen(false);
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setChartConfigOpen(false);
});

document.getElementById('btnResetRange')?.addEventListener('click', () => {
    const minInput = document.getElementById('minOffsetInput');
    const maxInput = document.getElementById('maxOffsetInput');
    if (minInput) minInput.value = '';
    if (maxInput) maxInput.value = '';
    
    minOffsetFilter = null;
    maxOffsetFilter = null;

    renderScatterChart();
});

document.getElementById('jsonFile').addEventListener('change', function(e) {
    LoadFile(e.target.files[0]);
});

document.getElementById('langSelect').addEventListener('change', function(e) {
    setLanguage(e.target.value);
});

document.getElementById('toggleXPerfectRatio').addEventListener('change', () => {
    updateRatioDisplay();
});

['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    document.body.addEventListener(eventName, e => e.preventDefault(), false);
});

document.body.addEventListener('drop', function(e) {
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length > 0) {
        LoadFile(dt.files[0]);
    }
});

async function loadSourceFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const source = params.get('source');
    if (!source) return;

    try {
        const sourceUrl = new URL(source);
        const isLoopback = sourceUrl.protocol === 'http:' &&
            (sourceUrl.hostname === '127.0.0.1' || sourceUrl.hostname === 'localhost');
        if (!isLoopback) throw new Error('Only loopback sources are allowed');

        const response = await fetch(sourceUrl.toString(), { cache: 'no-store' });
        if (!response.ok) throw new Error(`Bridge returned HTTP ${response.status}`);

        const blob = await response.blob();
        const fileName = params.get('name') || 'timingshow.log';
        await LoadFile(new File([blob], fileName, { type: blob.type || 'application/octet-stream' }));

        // Keep the page URL shareable and prevent accidental re-import on refresh.
        const cleanUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({}, document.title, cleanUrl);
    } catch (error) {
        console.error('Automatic log import failed:', error);
        alert(`${t('autoImportFailed')}\n${error.message}`);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const langSelect = document.getElementById('langSelect');
    if (langSelect) {
        langSelect.value = currentLang;
    }
    const metaToggle = document.getElementById('metaToggle');
    if (metaToggle) {
        metaToggle.addEventListener('click', () => {
            metaExpanded = !metaExpanded;
            updateMetaInfo();
        });
    }
    setLanguage(currentLang);
    updatePageState();
    loadSourceFromUrl();
});
