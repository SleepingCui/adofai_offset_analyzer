// app.js -- file loading, page lifecycle (clear / re-render everything) and
// all DOM event wiring. Loaded last, after every chart and parser above it.

document.getElementById('resetZoom').addEventListener('click', () => {
    if (myChart) {
        myChart.resetZoom();
    }
    if (missChart) {
        missChart.resetZoom();
    }
});

function clearData() {
    globalOffsets = [];
    globalPlayers = [];
    globalRawPlayers = [];
    logIsAngle = false;
    displayUnit = 'ms';
    unitAvailability = { ms: true, deg: false };
    activePlayer = 0;
    globalAvg = 0;
    globalStdDev = 0;
    globalCounts = {};
    currentMetaData = null;
    metaExpanded = false;
    minOffsetFilter = null;
    maxOffsetFilter = null;
    ignoreOutliers = false;

    // The selection is derived from the run and dies with it. Dropped here
    // rather than left to the next import to invalidate, so that anything
    // reading the range on an empty page sees "whole run" instead of a stale
    // span of hit numbers.
    activeRange = null;
    invalidateSelection();

    // Give the modules their own cleanup before the hardcoded block below runs.
    // The original charts still clear themselves further down, and each one
    // gives up its block as it moves onto the hook.
    CHART_SECTIONS.forEach(entry => {
        if (typeof entry.onClear === 'function') entry.onClear();
    });

    const filterContainer = document.getElementById('scatterFilterContainer');
    if (filterContainer) filterContainer.style.display = 'none';
    const xaccFilterContainer = document.getElementById('xaccFilterContainer');
    if (xaccFilterContainer) xaccFilterContainer.style.display = 'none';
    const comboFilterContainer = document.getElementById('comboFilterContainer');
    if (comboFilterContainer) comboFilterContainer.style.display = 'none';
    const rollingFilterContainer = document.getElementById('rollingFilterContainer');
    if (rollingFilterContainer) rollingFilterContainer.style.display = 'none';
    const bpmFilterContainer = document.getElementById('bpmFilterContainer');
    if (bpmFilterContainer) bpmFilterContainer.style.display = 'none';
    const bpmSegmentsEl = document.getElementById('bpmSegments');
    if (bpmSegmentsEl) bpmSegmentsEl.innerHTML = '';
    const floorNoteEl = document.getElementById('floorNote');
    if (floorNoteEl) {
        floorNoteEl.innerText = '';
        floorNoteEl.style.display = 'none';
    }

    const minInput = document.getElementById('minOffsetInput');
    const maxInput = document.getElementById('maxOffsetInput');
    if (minInput) minInput.value = '';
    if (maxInput) maxInput.value = '';

    const checkbox = document.getElementById('ignoreOutliersCheckbox');
    if (checkbox) checkbox.checked = false;

    const scatterUseHitCheckbox = document.getElementById('scatterUseHitCheckbox');
    if (scatterUseHitCheckbox) scatterUseHitCheckbox.checked = false;
    const scatterShowBandsCheckbox = document.getElementById('scatterShowBandsCheckbox');
    if (scatterShowBandsCheckbox) scatterShowBandsCheckbox.checked = true;
    const scatterDynamicBandsCheckbox = document.getElementById('scatterDynamicBandsCheckbox');
    if (scatterDynamicBandsCheckbox) scatterDynamicBandsCheckbox.checked = false;
    const scatterShowHitDetailsCheckbox = document.getElementById('scatterShowHitDetailsCheckbox');
    if (scatterShowHitDetailsCheckbox) scatterShowHitDetailsCheckbox.checked = false;
    syncDynamicBandsVisibility();
    const xaccUseHitCheckbox = document.getElementById('xaccUseHitCheckbox');
    if (xaccUseHitCheckbox) xaccUseHitCheckbox.checked = true;
    const comboUseHitCheckbox = document.getElementById('comboUseHitCheckbox');
    if (comboUseHitCheckbox) comboUseHitCheckbox.checked = false;
    const missUseHitCheckbox = document.getElementById('missUseHitCheckbox');
    if (missUseHitCheckbox) missUseHitCheckbox.checked = false;
    const rollingUseHitCheckbox = document.getElementById('rollingUseHitCheckbox');
    if (rollingUseHitCheckbox) rollingUseHitCheckbox.checked = false;
    const bpmUseHitCheckbox = document.getElementById('bpmUseHitCheckbox');
    if (bpmUseHitCheckbox) bpmUseHitCheckbox.checked = false;
    const bpmRawCheckbox = document.getElementById('bpmRawCheckbox');
    if (bpmRawCheckbox) bpmRawCheckbox.checked = false;
    const bpmSpeedCheckbox = document.getElementById('bpmSpeedCheckbox');
    if (bpmSpeedCheckbox) bpmSpeedCheckbox.checked = false;
    const bpmPitchCheckbox = document.getElementById('bpmPitchCheckbox');
    if (bpmPitchCheckbox) bpmPitchCheckbox.checked = false;
    const scatterBpmMarksCheckbox = document.getElementById('scatterBpmMarksCheckbox');
    if (scatterBpmMarksCheckbox) scatterBpmMarksCheckbox.checked = false;
    const rollingBpmMarksCheckbox = document.getElementById('rollingBpmMarksCheckbox');
    if (rollingBpmMarksCheckbox) rollingBpmMarksCheckbox.checked = false;

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
    const bpmStatsEl = document.getElementById('bpmStats');
    if (bpmStatsEl) bpmStatsEl.innerHTML = '';
    const floorStatsEl = document.getElementById('floorStats');
    if (floorStatsEl) floorStatsEl.innerHTML = '';
    const returnStatsEl = document.getElementById('returnStats');
    if (returnStatsEl) returnStatsEl.innerHTML = '';
    const returnAxisCropBadge = document.getElementById('returnAxisCropBadge');
    if (returnAxisCropBadge) returnAxisCropBadge.style.display = 'none';
    document.getElementById('jsonFile').value = '';
    document.getElementById('statUR').innerText = '-';
    document.getElementById('statRatio').innerText = '-';

    updateMetaInfo();

    hideScatterTooltip();
    hideMissTooltip();
    if (myChart) { myChart.destroy(); myChart = null; }
    if (xaccChart) { xaccChart.destroy(); xaccChart = null; }
    if (distributionChart) { distributionChart.destroy(); distributionChart = null; }
    if (pieChart) { pieChart.destroy(); pieChart = null; }
    if (comboChart) { comboChart.destroy(); comboChart = null; }
    if (rollingChart) { rollingChart.destroy(); rollingChart = null; }
    if (bpmChart) { bpmChart.destroy(); bpmChart = null; }
    if (floorChart) { floorChart.destroy(); floorChart = null; }
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

async function LoadFile(file) {
    if (!file) return;

    try {
        const fileName = file.name.toLowerCase();
        let data = null;

        if (fileName.endsWith('.json')) {
            data = readJsonLog(await file.text());
            if (!data) {
                alert(t('unknownFormat'));
                return;
            }
        } else if (fileName.endsWith('.crpl2')) {
            if (typeof Crpl2 === 'undefined') {
                throw new Error('concrpl2.js library is not loaded!');
            }
            const arrayBuffer = await file.arrayBuffer();
            const { json } = await Crpl2.toTimingshow(arrayBuffer, file.name);
            const parsed = JSON.parse(json);

            data = {
                header: {
                    songName: parsed.songName,
                    levelPath: parsed.levelPath,
                    // CRPL2 stamps milliseconds where TimingShow stamps seconds.
                    timestamp: parsed.timestamp / 1000,
                    bpm: null,
                    speed: null,
                    pitch: null,
                    isAngle: true,
                    versionText: 'CRPL2',
                    hitMarginVersion: null,
                    judgeCodeVersion: null
                },
                players: [{ tuples: parsed.offsets, timeFirst: false }],
                playerCount: 1,
                truncated: false
            };
        } else {
            const arrayBuffer = await file.arrayBuffer();
            let fileData = new Uint8Array(arrayBuffer);
            const isGzip = fileName.endsWith('.gz') || (fileData.length > 2 && fileData[0] === 0x1F && fileData[1] === 0x8B);
            let gzipTruncated = false;
            if (isGzip) {
                if (typeof pako === 'undefined') {
                    throw new Error('pako library is not loaded!');
                }
                const unwrapped = gunzipLog(fileData);
                fileData = unwrapped.bytes;
                gzipTruncated = unwrapped.truncated;
            }

            data = parseTlogData(fileData);
            if (gzipTruncated) data.truncated = true;
        }

        // The raw streams are kept so the records can be rebuilt in the other
        // unit. processOffsetRecords numbers the hits of the stream it is given,
        // so the pass has to run per player: a shared pass would carry the hit
        // axis across players and make the second player's first hit look like a
        // continuation of the first's. At least one slot even when the file
        // names none: a log cut off before the first player array is still worth
        // showing -- its header, and the note that it was truncated -- and the
        // panel is driven by there being a log at all rather than by records
        // existing.
        const slotCount = Math.max(data.playerCount, 1);
        globalRawPlayers = [];
        for (let id = 0; id < slotCount; id++) {
            globalRawPlayers.push(data.players[id] || null);
        }
        logIsAngle = data.header.isAngle === true;

        // Logs start in their native unit. The other one is offered only when
        // every hit can be converted; see computeUnitAvailability().
        displayUnit = logIsAngle ? 'deg' : 'ms';
        globalPlayers = buildPlayerRecords(displayUnit);
        unitAvailability = computeUnitAvailability(globalPlayers);
        if (!unitAvailability[displayUnit]) {
            displayUnit = displayUnit === 'ms' ? 'deg' : 'ms';
            globalPlayers = buildPlayerRecords(displayUnit);
        }
        activePlayer = 0;
        globalOffsets = globalPlayers[0];

        // Hit numbers from the previous file mean nothing against this one, and
        // a stale range is invisible when it goes wrong: every range-aware chart
        // would simply come up empty and the import would look like it failed.
        activeRange = null;
        invalidateSelection();

        currentMetaData = {
            versionText: data.header.versionText,
            songName: data.header.songName,
            levelPath: data.header.levelPath,
            timestamp: data.header.timestamp,
            bpm: data.header.bpm ?? null,
            speed: data.header.speed ?? null,
            pitch: data.header.pitch ?? null,
            isAngle: data.header.isAngle,
            hitMarginVersion: data.header.hitMarginVersion || null,
            judgeCodeVersion: data.header.judgeCodeVersion || null,
            playerCount: data.playerCount,
            truncated: data.truncated === true
        };

        updateMetaInfo();
        calculateStaticStats();
        updateAllCharts();

    } catch (err) {
        alert(t('parseFailed') + '\n' + err.message);
        console.error(err);
    }
}

// Which player the page is analysing. Switching is a re-point of globalOffsets
// at another array built during import: every chart, the stat cards and the
// selection read that one variable, so nothing else has to know a player can
// change.
function setActivePlayer(playerId) {
    const id = Math.round(Number(playerId));
    if (!Number.isFinite(id) || id < 0 || id >= globalPlayers.length || id === activePlayer) return;

    activePlayer = id;
    globalOffsets = globalPlayers[id];

    // A hit number identifies a hit inside one player's stream; kept across the
    // switch it would silently select a different set of hits.
    activeRange = null;
    invalidateSelection();

    updateMetaInfo();
    calculateStaticStats();
    updateAllCharts();
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

// The dynamic-band switch only means something while the bands themselves are
// drawn, so it is hidden with them.
function syncDynamicBandsVisibility() {
    const showBands = document.getElementById('scatterShowBandsCheckbox');
    const label = document.getElementById('dynamicBandsLabel');
    if (!label) return;
    label.style.display = showBands && showBands.checked ? 'flex' : 'none';
}

document.getElementById('scatterShowBandsCheckbox')?.addEventListener('change', () => {
    syncDynamicBandsVisibility();
    renderScatterChart();
});

document.getElementById('scatterDynamicBandsCheckbox')?.addEventListener('change', () => {
    renderScatterChart();
});

syncDynamicBandsVisibility();

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

document.getElementById('missUseHitCheckbox')?.addEventListener('change', () => {
    renderMissChart();
});

document.getElementById('rollingUseHitCheckbox')?.addEventListener('change', () => {
    renderRollingChart();
});

document.getElementById('rollingBpmMarksCheckbox')?.addEventListener('change', () => {
    renderRollingChart();
});

document.getElementById('scatterBpmMarksCheckbox')?.addEventListener('change', () => {
    renderScatterChart();
});

document.getElementById('bpmUseHitCheckbox')?.addEventListener('change', () => {
    renderBpmChart();
});

['bpmRawCheckbox', 'bpmSpeedCheckbox', 'bpmPitchCheckbox'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
        renderBpmChart();
    });
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
    setScatterSettingsOpen(false);
    setChartConfigOpen(document.getElementById('chartConfigPanel')?.hidden === true);
});

document.getElementById('scatterSettingsToggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    setChartConfigOpen(false);
    setScatterSettingsOpen(document.getElementById('scatterSettingsPanel')?.hidden === true);
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

document.addEventListener('click', (e) => {
    const anchor = document.getElementById('scatterSettingsAnchor');
    const panel = document.getElementById('scatterSettingsPanel');
    if (!anchor || !panel || panel.hidden) return;
    if (!e.composedPath().includes(anchor)) setScatterSettingsOpen(false);
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        setChartConfigOpen(false);
        setScatterSettingsOpen(false);
    }
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

document.getElementById('unitSelect')?.addEventListener('change', function(e) {
    setDisplayUnit(e.target.value);
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
