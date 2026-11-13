// charts-scatter.js -- the main offset-vs-hit scatter plot, plus the judgment
// windows drawn behind it.

// Judgment window bands for the scatter plot. The log header carries the game
// difficulty and every hit carries its floor's margin scale (v11), so the
// bands follow the windows that actually applied: the difficulty caps the pass
// ("too early" / "too late") window and the BPM at which the windows stop
// shrinking, and the margin scale multiplies what is left. This mirrors
// TimingShow's own HitWindowScale, which the game itself does not expose.
const JUDGE_BAND_MIN_WINDOW_MS = 25;
const JUDGE_BAND_XP_MIN_MS = 16.666666;

// Threshold BPM per difficulty tier, as the log stores them (0 lenient, 1
// normal, 2 strict). A tier's threshold is the BPM at which a 60-degree window
// reaches 20000 / threshold ms and stops shrinking, so the frozen pass window
// is 91 / 65 / 40 ms. The game names the first two as 220 and 310, but the
// windows themselves come from the exact values -- 20000 / 310 is 64.5 ms,
// half a millisecond tighter than the 65 the game actually uses.
const DIFFICULTY_THRESHOLD_BPM = [219.78, 307.69, 500];
const DIFFICULTY_DEFAULT = 1;

// A log that does not say which tier it ran on (older logs, CRPL2) is read as
// Normal, the same fallback TimingShow's log replay uses.
function bandDifficulty() {
    const difficulty = Number(currentMetaData && currentMetaData.difficulty);
    return Number.isInteger(difficulty) && difficulty >= 0 && difficulty <= DIFFICULTY_STRICT
        ? difficulty
        : DIFFICULTY_DEFAULT;
}

function bandThresholdBpm() {
    return DIFFICULTY_THRESHOLD_BPM[bandDifficulty()];
}

function bandPassBaseMs() {
    return 20000 / bandThresholdBpm();
}

// max(angle term, frozen base) x margin scale, never below 25 ms. The angle is
// the window's own: 30 degrees for Perfect, 45 for E/L Perfect, 60 for the pass
// edge. The base term is what freezes once the effective BPM passes the
// difficulty's threshold, and it is why harder tiers keep a tighter window at
// the same BPM.
function calcJudgeWindowMs(bpm, angle, baseMs, marginScale) {
    const scale = Number.isFinite(marginScale) && marginScale > 0 ? marginScale : 1;
    const angleTerm = 60000 / bpm * angle / 180;
    return Math.max(Math.max(angleTerm, baseMs) * scale, JUDGE_BAND_MIN_WINDOW_MS);
}

// The effective BPM the bands would have used before per-hit context existed:
// the header's BPM scaled by speed and pitch, or the difficulty threshold when
// the log does not say (old angle logs, CRPL2).
function headerEffectiveBpm() {
    const rawBpm = Number(currentMetaData && currentMetaData.bpm);
    const pitch = Number(currentMetaData && currentMetaData.pitch) > 0 ? Number(currentMetaData.pitch) : 1;
    const speed = Number(currentMetaData && currentMetaData.speed) > 0 ? Number(currentMetaData.speed) : 1;
    return rawBpm > 0 ? rawBpm * pitch * speed : bandThresholdBpm();
}

// The BPM at the moment of one hit, or null when the log has no context for it.
// Speed and pitch already scale the BPM, exactly as the ms/deg conversion does.
function recordEffectiveBpm(record) {
    const bpm = record[REC.BPM];
    const speed = record[REC.SPEED];
    const pitch = record[REC.PITCH];
    return hasUsableHitParams(bpm, speed, pitch) ? bpm * speed * pitch : null;
}

function judgeWindowsForBpm(bpm, marginScale) {
    return {
        perfect: calcJudgeWindowMs(bpm, 30, 20, marginScale),
        elPerfect: calcJudgeWindowMs(bpm, 45, 30, marginScale),
        pass: calcJudgeWindowMs(bpm, 60, bandPassBaseMs(), marginScale),
        xp: Math.max(60000 / bpm * 12.5 / 180 * (marginScale > 0 ? marginScale : 1), JUDGE_BAND_XP_MIN_MS)
    };
}

// A window edge in whatever unit the y axis uses. The window is defined in
// milliseconds, so in degree mode it has to be converted with the same segment
// BPM -- which is why the bands are segmented by BPM instead of using one
// header value.
function bandValue(valueMs, bpm) {
    return displayUnit === 'deg' ? msToAngle(valueMs, bpm) : valueMs;
}

// -> [{ bpm, marginScale, fromX, toX }], one entry per run of consecutive hits
// that share an effective BPM *and* a margin scale -- both change the window,
// so a stretch that changes either needs its own bands. A constant-BPM log is
// one segment, which keeps the old look. Old records without context borrow the
// header BPM and the run's dominant scale, like the bands always did.
const JUDGE_BAND_MAX_SEGMENTS = 60;

function buildJudgeBandSegments(records, useHitAxis) {
    const fallbackBpm = headerEffectiveBpm();
    const segments = [];

    for (let index = 0; index < records.length; index++) {
        const x = getChartX(records[index], index, useHitAxis);
        if (!Number.isFinite(x)) continue;

        const bpm = recordEffectiveBpm(records[index]) || fallbackBpm;
        if (!(bpm > 0)) continue;

        const marginScale = recordMarginScale(records[index]);
        const last = segments[segments.length - 1];
        const sameBpm = last && Math.abs(bpm - last.bpm) <= Math.max(1e-6, last.bpm * 1e-6);
        const sameScale = last && Math.abs(marginScale - last.marginScale) <= 1e-6;
        if (sameBpm && sameScale) {
            last.toX = x;
        } else {
            segments.push({ bpm, marginScale, fromX: x, toX: x });
        }
    }

    // Extend each stretch to where the next one starts, so the bands tile
    // without gaps that would read as unjudged hits.
    for (let i = 0; i < segments.length - 1; i++) {
        segments[i].toX = segments[i + 1].fromX;
    }

    if (segments.length > JUDGE_BAND_MAX_SEGMENTS) {
        // A chart with more changes than bands can carry: fall back to the
        // median BPM and the dominant margin scale over the whole run rather
        // than painting hundreds of boxes.
        const sorted = segments.map(segment => segment.bpm).sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        return [{
            bpm: median,
            marginScale: dominantMarginScale(records),
            fromX: segments[0].fromX,
            toX: segments[segments.length - 1].toX
        }];
    }
    return segments;
}

function buildJudgeBandAnnotations(records, useHitAxis, dynamicBands) {
    const annotations = {};
    // The bands only describe milliseconds when the page can produce them; an
    // angle-only log has no judging window to draw.
    if (!unitAvailability.ms) return annotations;

    // Static bands use the header BPM for the whole run, which is how they have
    // always looked. The opt-in mode splits them by each hit's own BPM, so a
    // chart that changes speed shows the window that actually applied.
    const segments = dynamicBands
        ? buildJudgeBandSegments(records, useHitAxis)
        : [{
            bpm: headerEffectiveBpm(),
            marginScale: dominantMarginScale(records),
            fromX: undefined,
            toX: undefined
        }];

    const addBand = (id, fromX, toX, bpm, fromMs, toMs, color) => {
        const box = {
            type: 'box',
            yMin: bandValue(fromMs, bpm),
            yMax: bandValue(toMs, bpm),
            backgroundColor: color,
            borderWidth: 0,
            // Keep the data points readable on top of the tinted bands.
            drawTime: 'beforeDatasetsDraw'
        };
        // Without bounds the box spans the whole axis, which is what the static
        // bands want.
        if (fromX !== undefined) box.xMin = fromX;
        if (toX !== undefined) box.xMax = toX;
        annotations[id] = box;
    };

    segments.forEach((segment, segmentIndex) => {
        const { bpm, marginScale, fromX, toX } = segment;
        const bands = judgeWindowsForBpm(bpm, marginScale);
        const suffix = `_s${segmentIndex}`;

        // Early/Late outermost, then E/L Perfect, Perfect and finally XPerfect:
        // later annotations paint on top of earlier ones.
        addBand('bandEarlyLateEarly' + suffix, fromX, toX, bpm, -bands.pass, -bands.elPerfect, 'rgba(242, 102, 77, 0.10)');
        addBand('bandEarlyLateLate' + suffix, fromX, toX, bpm, bands.elPerfect, bands.pass, 'rgba(242, 102, 77, 0.10)');
        addBand('bandElPerfectEarly' + suffix, fromX, toX, bpm, -bands.elPerfect, -bands.perfect, 'rgba(255, 217, 51, 0.12)');
        addBand('bandElPerfectLate' + suffix, fromX, toX, bpm, bands.perfect, bands.elPerfect, 'rgba(255, 217, 51, 0.12)');
        addBand('bandPerfect' + suffix, fromX, toX, bpm, -bands.perfect, bands.perfect, 'rgba(64, 230, 89, 0.14)');
        addBand('bandXPerfect' + suffix, fromX, toX, bpm, -bands.xp, bands.xp, 'rgba(77, 204, 255, 0.14)');
    });

    return annotations;
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
    const showBands = document.getElementById('scatterShowBandsCheckbox')?.checked === true;
    const dynamicBands = document.getElementById('scatterDynamicBandsCheckbox')?.checked === true;
    syncDynamicBandsVisibility();
    const annotations = showBands
        ? buildJudgeBandAnnotations(globalOffsets, useHitAxis, dynamicBands)
        : {};

    // Tempo-change guides sit above the bands but share their annotation
    // container, so one rebuild covers both switches.
    if (document.getElementById('scatterBpmMarksCheckbox')?.checked === true) {
        Object.assign(annotations, buildBpmChangeMarkers(globalOffsets, useHitAxis));
    }
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
                y: yValue,
                // Carried so the tooltip can describe this particular hit
                // without a second lookup by hit number.
                hit: item
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
    
    // Bands are added first so the reference lines stay on top of them.
    annotations.line0ms = {
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
    };
    annotations.lineAvg = {
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
    };

    hideScatterTooltip();
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
                    enabled: false,
                    external: context => updateScatterTooltip(context, useTimeline, unit)
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
                    annotations: annotations
                }
            }
        }
    });
}
