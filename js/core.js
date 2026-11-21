// core.js -- global state, judgment tables, the chart registry, and the
// language / unit / metadata plumbing. Loaded first: the other files read
// these globals while they run.
//
// app.js was split into the plain scripts in this folder. They are not
// modules -- every file shares one global scope, and index.html lists them
// in load order, which is also the dependency order.

function getPreferredLanguage() {
    const navLang = (navigator.language || navigator.userLanguage || '').toLowerCase();
    
    if (navLang.startsWith('zh')) return 'zh';
    if (navLang.startsWith('ko') || navLang.startsWith('kr')) return 'kr';
    if (navLang.startsWith('en')) return 'en';
    
    return 'en'; 
}

let currentLang = getPreferredLanguage();

// Native names: the language picker should read the same whichever language is
// currently active, so these are not translated.
const LANGUAGE_LABELS = { zh: '中文', en: 'English', kr: '한국어' };
let currentMetaData = null;
let metaExpanded = false;
let minOffsetFilter = null;5
let maxOffsetFilter = null;
let ignoreOutliers = false;
let pointSize = 2;

// ---- Theme -------------------------------------------------------------
// The palette itself lives in style.css. Chart.js paints into a canvas and
// cannot read custom properties, so the handful of colors it needs are mirrored
// into CHART_COLORS here and refreshed whenever the theme changes.
const THEME_STORAGE_KEY = 'adofai-theme';

function readThemePreference() {
    try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY);
        if (stored === 'light' || stored === 'dark') return stored;
    } catch (err) {
        // Private mode / blocked storage: fall through to the OS preference.
    }
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark';
}

let currentTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';

// Dark values double as fallbacks for the first paint, before style.css has been
// read back, and for any token a browser refuses to resolve.
const CHART_COLORS = {
    axisTitle: '#aaa',
    axisTick: '#bbb',
    grid: '#252525',
    gridStrong: '#232323',
    legend: '#ffffff',
    zeroLine: 'rgba(255, 255, 255, 0.75)',
    bandLine: 'rgba(255, 255, 255, 0.35)',
    bandFill: 'rgba(255, 255, 255, 0.06)',
    bandZero: 'rgba(255, 255, 255, 0.25)',
    cellBorder: 'rgba(0, 0, 0, 0.55)',
    markerBg: 'rgba(235, 248, 255, 0.95)',
    markerBorder: 'rgba(10, 10, 10, 0.9)',
    xaccLine: '#4fc3f7',
    xaccFill: 'rgba(79, 195, 247, 0.15)',
    bandStroke: 'rgba(79, 195, 247, 0.45)',
    bandTint: 'rgba(79, 195, 247, 0.14)',
    meanLine: '#ffb74d',
    meanLabelBg: 'rgba(230, 124, 11, 0.8)',
    bpmLine: '#4fc3f7',
    seriesGreen: '#a0ff4e',
    seriesPurple: '#d958ff',
    seriesPurpleFill: 'rgba(217, 88, 255, 0.75)',
    spectrumGrid: 'rgba(255, 255, 255, 0.06)',
    spectrumBorder: '#333333',
    bandRed: 'rgba(242, 102, 77, 0.10)',
    bandYellow: 'rgba(255, 217, 51, 0.12)',
    bandGreen: 'rgba(64, 230, 89, 0.14)',
    bandBlue: 'rgba(77, 204, 255, 0.14)',
    surface: '#0a0a0a'
};

const CHART_TOKEN_MAP = {
    axisTitle: '--chart-axis-title',
    axisTick: '--chart-axis-tick',
    grid: '--chart-grid',
    gridStrong: '--chart-grid-strong',
    legend: '--chart-legend',
    zeroLine: '--chart-zero-line',
    bandLine: '--chart-band-line',
    bandFill: '--chart-band-fill',
    bandZero: '--chart-band-zero',
    cellBorder: '--chart-cell-border',
    markerBg: '--chart-marker-bg',
    markerBorder: '--chart-marker-border',
    xaccLine: '--chart-xacc-line',
    xaccFill: '--chart-xacc-fill',
    bandStroke: '--chart-band-stroke',
    bandTint: '--chart-band-tint',
    meanLine: '--chart-mean-line',
    meanLabelBg: '--chart-mean-label-bg',
    bpmLine: '--chart-bpm-line',
    seriesGreen: '--chart-series-green',
    seriesPurple: '--chart-series-purple',
    seriesPurpleFill: '--chart-series-purple-fill',
    spectrumGrid: '--chart-spectrum-grid',
    spectrumBorder: '--chart-spectrum-border',
    bandRed: '--chart-band-red',
    bandYellow: '--chart-band-yellow',
    bandGreen: '--chart-band-green',
    bandBlue: '--chart-band-blue',
    surface: '--chart-surface'
};

function refreshChartColors() {
    const styles = getComputedStyle(document.documentElement);
    Object.keys(CHART_TOKEN_MAP).forEach(key => {
        const value = styles.getPropertyValue(CHART_TOKEN_MAP[key]).trim();
        if (value) CHART_COLORS[key] = value;
    });
}

function refreshThemeToggle(theme) {
    const toggle = document.getElementById('themeToggle');
    if (!toggle) return;
    const isLight = (theme || currentTheme) === 'light';
    const label = t('themeToggle');
    toggle.setAttribute('aria-pressed', String(isLight));
    toggle.title = label;
    toggle.setAttribute('aria-label', label);
}

function setTheme(theme, persist) {
    const next = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    currentTheme = next;
    if (persist !== false) {
        try {
            localStorage.setItem(THEME_STORAGE_KEY, next);
        } catch (err) {
            // Storage blocked: the choice lasts for this page view only.
        }
    }
    refreshThemeToggle(next);
    refreshChartColors();
    // Every render function destroys and rebuilds its chart, so a re-render is
    // all it takes for the canvases to pick up the new palette.
    if (globalOffsets.length > 0) updateAllCharts();
}

function toggleTheme() {
    setTheme(currentTheme === 'light' ? 'dark' : 'light', true);
}


function t(key) {
    return (I18N_STRINGS[currentLang] && I18N_STRINGS[currentLang][key]) || key;
}

function getUnit() {
    return displayUnit === 'deg' ? '°' : ' ms';
}

function updateMetaInfo() {
    const summaryEl = document.getElementById('metaSummary');
    const detailsEl = document.getElementById('metaDetails');
    const toggleEl = document.getElementById('metaToggle');
    // Keyed off the import, not off the selected player: a player who logged no
    // hits must not hide the picker that switches back to one who did.
    if (!currentMetaData || globalPlayers.length === 0) {
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
        updateUnitControl();
        return;
    }

    const truncatedSuffix = currentMetaData.truncated ? ` ${t('truncatedSuffix')}` : '';

    if (summaryEl) {
        // The picker only exists for logs that actually hold several players,
        // which keeps the single player case exactly as it was. Each option
        // carries its own hit count: that is how a player tells which entry is
        // theirs when the log names them by number alone.
        const playerPicker = currentMetaData.playerCount > 1 ? `
            <div class="player-select-row">
                <select id="playerSelect" class="lang-select" aria-label="${t('playerLabel')}">
                    ${globalPlayers.map((records, id) => `
                        <option value="${id}"${id === activePlayer ? ' selected' : ''}>${t('playerLabel')} ${id + 1} (${records.length.toLocaleString()})</option>
                    `).join('')}
                </select>
            </div>` : '';

        summaryEl.innerHTML = `
            <strong>${t('songName')}:</strong> ${currentMetaData.songName || 'Unknown'}<br>
            <strong>${t('levelPath')}:</strong> ${currentMetaData.levelPath || 'Unknown'}
            ${playerPicker}
        `;

        // Re-attached on every render: the summary above is rebuilt from
        // scratch, so a listener added once would be discarded with it.
        const playerSelect = document.getElementById('playerSelect');
        if (playerSelect) {
            playerSelect.addEventListener('change', e => setActivePlayer(e.target.value));
        }
    }
    if (detailsEl) {
        const playerNote = currentMetaData.playerCount > 1
            ? ` (${t('playerLabel')} ${activePlayer + 1}/${currentMetaData.playerCount})`
            : '';
        // How many of this player's hits actually carry the v8/v9 context. Zero
        // is not an error -- it is what every older log looks like -- so it is
        // reported as "none" rather than hidden.
        const contextCount = globalOffsets.reduce(
            (count, item) => count + (item[REC.BPM] !== null ? 1 : 0), 0);
        const contextText = contextCount > 0
            ? `${contextCount.toLocaleString()} / ${globalOffsets.length.toLocaleString()}`
            : t('contextNone');
        detailsEl.innerHTML = `
            <div><strong>${t('formatVersion')}:</strong> ${currentMetaData.versionText || 'Unknown'}${truncatedSuffix}</div>
            <div><strong>${t('analysisTime')}:</strong> ${currentMetaData.timestamp ? new Date(currentMetaData.timestamp * 1000).toLocaleString() : 'Unknown'}</div>
            <div><strong>${t('judgeVersion')}:</strong> ${currentMetaData.judgeCodeVersion ? `v${currentMetaData.judgeCodeVersion}` : t('legacyMode')}</div>
            <div><strong>${t('hitMarginVersion')}:</strong> ${currentMetaData.hitMarginVersion ?? 'Unknown'}</div>
            <div><strong>${t('difficulty')}:</strong> ${getDifficultyLabel(getLogDifficulty())}</div>
            <div><strong>${t('marginScale')}:</strong> ${formatMarginScale(dominantMarginScale(globalOffsets))}</div>
            <div><strong>${t('bpm')}:</strong> ${currentMetaData.bpm ?? 'Unknown'}</div>
            <div><strong>${t('speed')}:</strong> ${currentMetaData.speed ?? 'Unknown'}</div>
            <div><strong>${t('pitch')}:</strong> ${currentMetaData.pitch ?? 'Unknown'}</div>
            <div><strong>${t('valueMode')}:</strong> ${displayUnit === 'deg' ? 'Angle (°)' : 'Timing (ms)'}</div>
            <div><strong>${t('contextCoverage')}:</strong> ${contextText}</div>
            <div><strong>${t('playerCount')}:</strong> ${currentMetaData.playerCount}</div>
            <div><strong>${t('recordCount')}:</strong> ${globalOffsets.length.toLocaleString()}${playerNote}</div>
            ${currentMetaData.truncated ? `<div class="meta-warning">${t('truncatedWarning')}</div>` : ''}
        `;
        detailsEl.hidden = !metaExpanded;
    }
    if (toggleEl) {
        toggleEl.disabled = false;
        toggleEl.innerText = metaExpanded ? t('hideDetails') : t('showDetails');
        toggleEl.setAttribute('aria-expanded', String(metaExpanded));
    }

    updateUnitControl();
}

// Keeps the unit selector in step with what the loaded log can actually
// produce. The native unit is always available; the other one needs the v8/v9
// per-hit context on every record, so a partially contextualised log cannot
// offer it without mixing units inside one chart.
function updateUnitControl() {
    const control = document.getElementById('unitControl');
    const select = document.getElementById('unitSelect');
    if (!control || !select) return;

    const hasLog = currentMetaData !== null;
    control.hidden = !hasLog;
    if (!hasLog) return;

    select.value = displayUnit;
    const msOption = select.querySelector('option[value="ms"]');
    const degOption = select.querySelector('option[value="deg"]');
    if (msOption) msOption.disabled = !unitAvailability.ms;
    if (degOption) degOption.disabled = !unitAvailability.deg;
}

function buildPlayerRecords(unit) {
    return globalRawPlayers.map(stream => stream
        ? processOffsetRecords(stream.tuples, stream.timeFirst, { isAngle: logIsAngle, unit })
        : []);
}

function computeUnitAvailability(players) {
    let canMs = true;
    let canDeg = true;
    let sawValue = false;

    players.forEach(records => {
        records.forEach(item => {
            if (!Number.isFinite(item[REC.NATIVE])) return;
            sawValue = true;
            if (!Number.isFinite(item[REC.MS])) canMs = false;
            if (!Number.isFinite(item[REC.ANGLE])) canDeg = false;
        });
    });

    // An empty run has no unit to convert; offer its native one.
    if (!sawValue) return { ms: !logIsAngle, deg: logIsAngle };
    return { ms: canMs, deg: canDeg };
}

function setDisplayUnit(unit) {
    if (unit !== 'ms' && unit !== 'deg') return;
    if (unit === displayUnit || !unitAvailability[unit]) {
        updateUnitControl();
        return;
    }

    displayUnit = unit;
    globalPlayers = buildPlayerRecords(unit);
    globalOffsets = globalPlayers[activePlayer] || [];

    // The range filter holds numbers in the previous unit.
    minOffsetFilter = null;
    maxOffsetFilter = null;
    const minInput = document.getElementById('minOffsetInput');
    const maxInput = document.getElementById('maxOffsetInput');
    if (minInput) minInput.value = '';
    if (maxInput) maxInput.value = '';

    activeRange = null;
    invalidateSelection();

    updateMetaInfo();
    calculateStaticStats();
    updateAllCharts();
}

function setLanguage(lang) {
    if (!I18N_STRINGS[lang]) return;
    currentLang = lang;

    // The toolbar button and its popover options mirror the active language.
    const langLabel = document.getElementById('langToggleLabel');
    if (langLabel) {
        langLabel.innerText = LANGUAGE_LABELS[lang] || lang;
    }
    document.querySelectorAll('.lang-option').forEach(option => {
        option.setAttribute('aria-selected', String(option.dataset.lang === lang));
    });

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (I18N_STRINGS[lang][key]) {
            el.innerText = I18N_STRINGS[lang][key];
        }
    });

    // Icon-only controls carry their label in title/aria-label instead of text.
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        if (I18N_STRINGS[lang][key]) {
            el.title = I18N_STRINGS[lang][key];
            el.setAttribute('aria-label', I18N_STRINGS[lang][key]);
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

// Light-theme judgment colors. The dark table is tuned for a black chart
// surface: Perfect green and Auto white vanish on white, so these keep the same
// semantic hues at a print-safe darkness.
const MARGIN_LIGHT_COLORS = {
    0: '#c62828', 1: '#d84315', 2: '#558b2f', 3: '#2e7d32', 4: '#0277bd',
    5: '#2e7d32', 6: '#558b2f', 7: '#d84315', 8: '#c62828', 9: '#00838f',
    10: '#8e24aa', 11: '#8e24aa', 12: '#546e7a', 13: '#8e24aa',
    14: '#616161', 15: '#8e24aa'
};

function getMarginColor(type, fallback) {
    if (currentTheme === 'light' && MARGIN_LIGHT_COLORS[type]) return MARGIN_LIGHT_COLORS[type];
    const definition = isGame34Log() ? MARGIN_MAP[type] : LEGACY_MARGIN_MAP[type];
    return (definition && definition.color) || fallback || '#FFFFFF';
}

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
// The records of the player currently being analysed. Every chart, the stat
// cards and the selection read this one array, so a log with several players is
// handled by pointing it at another already-built array -- see setActivePlayer().
let globalOffsets = [];
// One record array per player, index = the player id the log used. A log holds
// one entry here even in the single player case, so nothing downstream needs a
// separate "is this a co-op log" path.
let globalPlayers = [];
// The parsed streams the records above were built from, kept so the values can
// be rebuilt in the other unit (ms or degrees) without re-reading the file.
let globalRawPlayers = [];
let logIsAngle = false;
// What every chart plots on the y axis: 'ms' or 'deg'. Logs record one of the
// two natively; the per-hit context added in v8/v9 lets us compute the other.
let displayUnit = 'ms';
// Which of the two units can be produced for every hit of the loaded log. The
// unit selector disables the one that cannot, because a chart that silently
// plots a mix of milliseconds and degrees is worse than one that offers less.
let unitAvailability = { ms: true, deg: false };
let activePlayer = 0;
let globalAvg = 0;
let globalStdDev = 0;
let globalCounts = {};
let myChart = null;
let xaccChart = null;
let distributionChart = null;
let comboChart = null;
let missChart = null;
let rollingChart = null;
let bpmChart = null;
let floorChart = null;
let returnChart = null;
let deltaChart = null;
let acfChart = null;
let heatmapChart = null;

// Every chart on the page, in the order they appear, so the config menu, the
// render pass and "clear" all work off one list. The detailed analysis charts
// are opt-in: they answer narrower questions and would push the main charts
// below the fold. Visibility is per session -- the page keeps no state between
// loads.
//
// Beyond `render`, an entry may carry two optional hooks:
//   consumesRange -- read getActiveRecords() instead of globalOffsets, and be
//                    re-rendered when the selection changes. A chart that hosts
//                    the brush (the scatter plot) must leave this off: it stays
//                    on the whole run and draws the range as an overlay, or the
//                    brush would collapse the chart it is drawn on.
//   onClear       -- own cleanup, called by clearData(). Registering it is what
//                    retires a module's hardcoded block in clearData().
// The four original charts below predate the selection layer and still clear
// themselves in clearData(); everything registered after them owns its cleanup.
const CHART_SECTIONS = [
    { key: 'scatter', sectionId: 'sectionScatter', titleKey: 'scatterTitle', defaultVisible: true, render: () => renderScatterChart() },
    {
        key: 'miss', sectionId: 'sectionMiss', titleKey: 'missTitle', defaultVisible: true,
        render: () => renderMissChart(),
        onClear: () => {
            if (missChart) { missChart.destroy(); missChart = null; }
            hideMissTooltip();
            const statsEl = document.getElementById('missStats');
            if (statsEl) statsEl.innerHTML = '';
            const legendEl = document.getElementById('missLegend');
            if (legendEl) legendEl.innerHTML = '';
            const emptyEl = document.getElementById('missEmpty');
            if (emptyEl) emptyEl.hidden = true;
            const filterEl = document.getElementById('missFilterContainer');
            if (filterEl) filterEl.style.display = 'none';
        }
    },
    {
        key: 'heatmap', sectionId: 'sectionHeatmap', titleKey: 'heatmapTitle', defaultVisible: false,
        // Range-aware like the delta module: the cells describe the stretch on
        // screen, and a pair at the seam would otherwise measure a step across
        // two runs. The heatmap is a density, so unlike the scatter it cannot
        // also host the brush -- the overlay would be lost in the cloud.
        consumesRange: true,
        render: () => renderHeatmapChart(),
        onClear: () => {
            if (heatmapChart) { heatmapChart.destroy(); heatmapChart = null; }
            const statsEl = document.getElementById('heatmapStats');
            if (statsEl) statsEl.innerHTML = '';
            const filterEl = document.getElementById('heatmapFilterContainer');
            if (filterEl) filterEl.style.display = 'none';
            const badgeEl = document.getElementById('heatmapAxisCropBadge');
            if (badgeEl) badgeEl.style.display = 'none';
            const barEl = document.getElementById('heatmapScaleBar');
            if (barEl) barEl.style.background = '';
        }
    },
    { key: 'rolling', sectionId: 'sectionRolling', titleKey: 'rollingTitle', defaultVisible: false, render: () => renderRollingChart() },
    { key: 'bpm', sectionId: 'sectionBpm', titleKey: 'bpmTitle', defaultVisible: false, render: () => renderBpmChart() },
    { key: 'floor', sectionId: 'sectionFloor', titleKey: 'floorTitle', defaultVisible: false, render: () => renderFloorChart() },
    { key: 'returnMap', sectionId: 'sectionReturn', titleKey: 'returnTitle', defaultVisible: false, render: () => renderReturnChart() },
    {
        key: 'acf', sectionId: 'sectionAcf', titleKey: 'acfTitle', defaultVisible: false,
        // Sits next to the return map on purpose: that one is this chart's lag 1,
        // and the two agree there by construction.
        consumesRange: true,
        render: () => renderAcfChart(),
        onClear: () => {
            if (acfChart) { acfChart.destroy(); acfChart = null; }
            const statsEl = document.getElementById('acfStats');
            if (statsEl) statsEl.innerHTML = '';
            const noteEl = document.getElementById('acfNote');
            if (noteEl) { noteEl.innerText = ''; noteEl.style.display = 'none'; }
        }
    },
    { key: 'distribution', sectionId: 'sectionDistribution', titleKey: 'distTitle', defaultVisible: true, render: () => renderDistributionChart() },
    {
        key: 'delta', sectionId: 'sectionDelta', titleKey: 'deltaTitle', defaultVisible: false,
        // The first range-aware module: it pairs neighbours *within the
        // selection*, so a delta at the seam is never computed across the
        // boundary of what the user asked to look at.
        consumesRange: true,
        render: () => renderDeltaChart(),
        onClear: () => {
            if (deltaChart) { deltaChart.destroy(); deltaChart = null; }
            const statsEl = document.getElementById('deltaStats');
            if (statsEl) statsEl.innerHTML = '';
            const badgeEl = document.getElementById('deltaAxisCropBadge');
            if (badgeEl) badgeEl.style.display = 'none';
        }
    },
    { key: 'pie', sectionId: 'sectionPie', titleKey: 'pieTitle', defaultVisible: true, render: () => renderJudgementStrip() },
    { key: 'xacc', sectionId: 'sectionXacc', titleKey: 'xaccTitle', defaultVisible: true, render: () => renderXaccChart() },
    { key: 'combo', sectionId: 'sectionCombo', titleKey: 'comboTitle', defaultVisible: false, render: () => renderComboChart() }
];
CHART_SECTIONS.forEach(entry => { entry.visible = entry.defaultVisible; });
const DEFAULT_CHART_ORDER = CHART_SECTIONS.map(entry => entry.key);

// TimingShow writes the game difficulty into every log header (JSON v9, binary
// v10) as 0 lenient / 1 normal / 2 strict, or -1 when the run did not say. The
// judgment bands read it to pick the threshold BPM, so it is surfaced here for
// both the panel and the bands.
const DIFFICULTY_LABEL_KEYS = ['difficultyLenient', 'difficultyNormal', 'difficultyStrict'];

function getLogDifficulty() {
    const difficulty = currentMetaData ? Number(currentMetaData.difficulty) : DIFFICULTY_UNKNOWN;
    return Number.isInteger(difficulty) && difficulty >= 0 && difficulty <= DIFFICULTY_STRICT
        ? difficulty
        : DIFFICULTY_UNKNOWN;
}

function getDifficultyLabel(difficulty) {
    return Number.isInteger(difficulty) && difficulty >= 0 && difficulty < DIFFICULTY_LABEL_KEYS.length
        ? t(DIFFICULTY_LABEL_KEYS[difficulty])
        : t('difficultyUnknown');
}

// The scale is untouched on most logs, so the unit carries the meaning: 1x stays
// 1x instead of growing three trailing zeros.
function formatMarginScale(scale) {
    const value = Number.isFinite(scale) && scale > 0 ? scale : 1;
    return Number(value.toFixed(3)).toString() + '×';
}

function isGame34Log() {
    const version = currentMetaData && currentMetaData.hitMarginVersion;
    return String(version || '').toLowerCase() === 'game34' || Number(version) === 2;
}

function getMarginDefinition(type) {
    const definition = isGame34Log() ? MARGIN_MAP[type] : LEGACY_MARGIN_MAP[type];
    if (!definition) return { label: 'Unknown', color: getMarginColor(type, '#FFFFFF') };
    if (isGame34Log() && type === 3) {
        return { label: 'PerfectMinus', color: getMarginColor(type, definition.color) };
    }
    return { label: definition.label, color: getMarginColor(type, definition.color) };
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

// Light ramp: a pale tint would disappear on white, so the same ordinal ramp runs
// the other way -- pale green against white, dark green at the top.
const COMBO_RAMP_LIGHT = ['#a5d6a7', '#81c784', '#66bb6a', '#4caf50', '#43a047', '#2e7d32'];

function getComboRamp() {
    return currentTheme === 'light' ? COMBO_RAMP_LIGHT : COMBO_RAMP;
}

function getComboBreakColor() {
    return currentTheme === 'light' ? '#d0d7de' : COMBO_BREAK_COLOR;
}


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
    if (key === 'scatter' && !visible) setScatterSettingsOpen(false);
}

// One place decides what is on screen. A chart section shows only when the user
// asked for it *and* there is something to plot; everything that reports on a
// run -- stat cards, judgment counts, the charts -- plus the controls that need
// something to act on, only exist once there is data. Without it the page is
// the title, the language selector and one centred prompt.
function updatePageState() {
    const hasData = globalOffsets.length > 0;
    // Two questions, not one: whether a log is loaded at all, and whether the
    // selected player put any hits in it. A player who never hit anything
    // leaves the header -- and with it the player picker -- in place, so the
    // way back to the other players does not vanish with the data.
    const hasLog = globalPlayers.length > 0;

    const emptyEl = document.getElementById('emptyState');
    if (emptyEl) emptyEl.hidden = hasLog;

    // Lets the stylesheet drop the header divider when it holds nothing but the
    // language selector.
    document.body.classList.toggle('is-empty', !hasLog);

    // An empty run has nothing to reset, clear, describe or re-import from the
    // header: the prompt in the middle carries the import button instead.
    ['metaInfo', 'fileInputWrapper']
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) el.hidden = !hasLog;
        });

    ['statsGrid', 'marginCountsBox', 'chartsContainer', 'resetZoom', 'clearData']
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) el.hidden = !hasData;
        });

    CHART_SECTIONS.forEach(entry => {
        const section = document.getElementById(entry.sectionId);
        if (section) section.hidden = !hasData || !entry.visible;
    });
    if (!hasData) setScatterSettingsOpen(false);
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
    if (!panel) return;

    panel.hidden = !open;
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
}

function setScatterSettingsOpen(open) {
    const panel = document.getElementById('scatterSettingsPanel');
    const toggle = document.getElementById('scatterSettingsToggle');
    if (!panel) return;

    panel.hidden = !open;
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
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
