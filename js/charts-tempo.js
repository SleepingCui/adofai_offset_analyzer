// charts-tempo.js -- BPM series and segment table, the floor index chart, and
// the previous-vs-next return map.

function isBpmHitAxis() {
    return document.getElementById('bpmUseHitCheckbox')?.checked === true;
}

// Effective BPM per hit -- the floor's BPM already scaled by speed and pitch,
// which is the value the judgment bands and the ms/deg conversion work from.
// Records from logs without the v8/v9 hit context borrow the header value, so
// an older log draws one flat line instead of nothing.
//
// Three companion series make the multiplier visible instead of baked in: the
// raw BPM, and speed / pitch themselves (read on the right-hand axis). They all
// share one x axis, so a tempo change can be traced to the factor that caused
// it.
function getHeaderBpmFallbacks() {
    const bpm = Number(currentMetaData && currentMetaData.bpm);
    const speed = Number(currentMetaData && currentMetaData.speed);
    const pitch = Number(currentMetaData && currentMetaData.pitch);
    return {
        bpm: bpm > 0 ? bpm : null,
        speed: speed > 0 ? speed : 1,
        pitch: pitch > 0 ? pitch : 1
    };
}

function buildBpmSeries(useHitAxis) {
    const fallback = getHeaderBpmFallbacks();
    const fallbackEffective = headerEffectiveBpm();
    const series = { effective: [], raw: [], speed: [], pitch: [] };

    globalOffsets.forEach((item, index) => {
        const x = getChartX(item, index, useHitAxis);
        if (!Number.isFinite(x)) return;

        const effective = recordEffectiveBpm(item) || fallbackEffective;
        if (effective > 0) series.effective.push({ x, y: effective });

        // Null when the log predates the context and the header has no BPM:
        // an empty series is more honest than an invented tempo.
        const raw = Number.isFinite(item[REC.BPM]) ? item[REC.BPM] : fallback.bpm;
        if (raw > 0) series.raw.push({ x, y: raw });

        const speed = Number.isFinite(item[REC.SPEED]) && item[REC.SPEED] > 0
            ? item[REC.SPEED]
            : fallback.speed;
        series.speed.push({ x, y: speed });

        const pitch = Number.isFinite(item[REC.PITCH]) && item[REC.PITCH] > 0
            ? item[REC.PITCH]
            : fallback.pitch;
        series.pitch.push({ x, y: pitch });
    });

    return series;
}

// Consecutive hits that share an effective BPM, in play order. Unlike the band
// segmenter this keeps record indices, because the segment table reports on the
// hits inside each stretch rather than only shading them.
function buildBpmSegments(records) {
    const fallback = headerEffectiveBpm();
    const segments = [];

    records.forEach((item, index) => {
        const bpm = recordEffectiveBpm(item) || fallback;
        if (!(bpm > 0)) return;

        const last = segments[segments.length - 1];
        if (last && !bpmDiffers(bpm, last.bpm)) {
            last.endIndex = index;
        } else {
            segments.push({ bpm, startIndex: index, endIndex: index });
        }
    });

    return segments;
}

// Per-segment scoreboard: mean in the page's current unit, UR in milliseconds
// (the unit UR is defined in), Perfect rate and early/late bias.
function computeBpmSegmentStats(segment, records) {
    const slice = records.slice(segment.startIndex, segment.endIndex + 1);
    const values = slice.map(item => item[0]).filter(value => !isNaN(value));
    const msValues = slice.map(item => item[REC.MS]).filter(value => Number.isFinite(value));
    const perfect = slice.reduce(
        (count, item) => count + (isPerfectFamilyCode(item[REC.JUDGE]) ? 1 : 0), 0);

    const mean = values.length > 0
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : null;

    let ur = null;
    if (msValues.length > 0) {
        const msMean = msValues.reduce((sum, value) => sum + value, 0) / msValues.length;
        const msVariance = msValues.reduce((sum, value) => sum + (value - msMean) ** 2, 0) / msValues.length;
        ur = Math.sqrt(msVariance) * 10;
    }

    let bias = null;
    if (mean !== null) {
        if (Math.abs(mean) < 1e-9) bias = 'even';
        else bias = mean < 0 ? 'early' : 'late';
    }

    return {
        hits: slice.length,
        mean,
        ur,
        perfectRate: slice.length > 0 ? perfect / slice.length : null,
        bias
    };
}

// A log with a change every few hits would produce a table taller than the page
// is; the cap keeps the DOM bounded and the note says what was left out.
const BPM_SEGMENT_TABLE_MAX = 200;

function renderBpmSegmentTable(segments, records, unit) {
    const container = document.getElementById('bpmSegments');
    if (!container) return;

    if (segments.length === 0) {
        container.innerHTML = '';
        return;
    }

    const shown = segments.slice(0, BPM_SEGMENT_TABLE_MAX);
    const rows = shown.map(segment => {
        const stats = computeBpmSegmentStats(segment, records);
        const first = records[segment.startIndex];
        const last = records[segment.endIndex];
        const range = `${getRecordHitNumber(first)}-${getRecordHitNumber(last)}`;
        const format = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : '-';
        const biasKey = stats.bias === 'early' ? 'biasEarly'
            : stats.bias === 'late' ? 'biasLate' : 'biasEven';
        const biasClass = stats.bias === 'early' ? 'bias-early'
            : stats.bias === 'late' ? 'bias-late' : '';

        return `
            <tr>
                <td>${range}</td>
                <td>${segment.bpm.toFixed(2)}</td>
                <td>${stats.hits}</td>
                <td>${format(stats.mean)}${unit}</td>
                <td>${format(stats.ur)}</td>
                <td>${stats.perfectRate === null ? '-' : (stats.perfectRate * 100).toFixed(1) + '%'}</td>
                <td class="${biasClass}">${stats.bias ? t(biasKey) : '-'}</td>
            </tr>`;
    }).join('');

    const note = segments.length > shown.length
        ? `<div class="bpm-segments-note">${t('bpmSegTruncated')
            .replace('{count}', segments.length)
            .replace('{shown}', shown.length)}</div>`
        : '';

    container.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>${t('bpmSegRange')}</th>
                    <th>${t('bpmSegBpm')}</th>
                    <th>${t('bpmSegHits')}</th>
                    <th>${t('bpmSegMean')}</th>
                    <th>${t('bpmSegUR')}</th>
                    <th>${t('bpmSegPerfect')}</th>
                    <th>${t('bpmSegBias')}</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
        ${note}`;
}

// Vertical guides on the offset charts at every BPM change, so a dip in the
// scatter or the rolling mean can be checked against a tempo change at a
// glance. A chart that changes faster than the eye can follow gets no guides
// rather than a wall of lines.
const BPM_MARKER_MAX = 60;

function buildBpmChangeMarkers(records, useHitAxis) {
    const fallback = headerEffectiveBpm();
    const annotations = {};
    let previous = null;
    let count = 0;

    for (let index = 0; index < records.length; index++) {
        const bpm = recordEffectiveBpm(records[index]) || fallback;
        if (!(bpm > 0)) continue;

        if (previous !== null && bpmDiffers(bpm, previous)) {
            const x = getChartX(records[index], index, useHitAxis);
            if (!Number.isFinite(x)) {
                previous = bpm;
                continue;
            }
            if (count >= BPM_MARKER_MAX) return {};

            count++;
            annotations[`bpmChange${count}`] = {
                type: 'line',
                xMin: x,
                xMax: x,
                borderColor: 'rgba(79, 195, 247, 0.4)',
                borderWidth: 1,
                borderDash: [4, 4]
            };
        }

        previous = bpm;
    }

    return annotations;
}

// Float-epsilon comparison: a constant-BPM run can still carry tiny per-hit
// differences, and those must not read as tempo changes. Same tolerance the
// band segmenter uses.
function bpmDiffers(a, b) {
    return Math.abs(a - b) > Math.max(1e-6, Math.max(Math.abs(a), Math.abs(b)) * 1e-6);
}

function renderBpmChart() {
    if (globalOffsets.length === 0) return;

    const filterContainer = document.getElementById('bpmFilterContainer');
    if (filterContainer) filterContainer.style.display = 'flex';

    const useHitAxis = isBpmHitAxis();
    const useTimeline = !useHitAxis && hasTimelineData();
    const unit = getUnit();
    const series = buildBpmSeries(useHitAxis);
    const segments = buildBpmSegments(globalOffsets);

    const statsEl = document.getElementById('bpmStats');
    if (statsEl) {
        // reduce, not Math.min(...values): a long run would blow the argument
        // limit of a spread call.
        const minBpm = series.effective.reduce((min, point) => Math.min(min, point.y), Infinity);
        const maxBpm = series.effective.reduce((max, point) => Math.max(max, point.y), -Infinity);
        const format = value => Number.isFinite(value) ? value.toFixed(2) : '-';

        statsEl.innerHTML = `
            <div class="stat-tile">
                <div class="label">${t('bpmMin')}</div>
                <div class="value">${format(minBpm)}</div>
            </div>
            <div class="stat-tile">
                <div class="label">${t('bpmMax')}</div>
                <div class="value">${format(maxBpm)}</div>
            </div>
            <div class="stat-tile">
                <div class="label">${t('bpmChanges')}</div>
                <div class="value">${Math.max(0, segments.length - 1)}</div>
            </div>
        `;
    }

    renderBpmSegmentTable(segments, globalOffsets, unit);

    const showRaw = document.getElementById('bpmRawCheckbox')?.checked === true;
    const showSpeed = document.getElementById('bpmSpeedCheckbox')?.checked === true;
    const showPitch = document.getElementById('bpmPitchCheckbox')?.checked === true;

    const datasets = [{
        label: t('bpmEffective'),
        data: series.effective,
        borderColor: '#4FC3F7',
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        // BPM holds until the floor changes it; a diagonal would suggest a
        // gradual tempo slide the level does not have.
        stepped: 'after',
        fill: false
    }];

    if (showRaw) {
        datasets.push({
            label: t('bpmRaw'),
            data: series.raw,
            borderColor: '#A0FF4E',
            borderWidth: 1.5,
            pointRadius: 0,
            pointHoverRadius: 4,
            stepped: 'after',
            fill: false
        });
    }

    // The multipliers live on the right-hand axis: they are in the 0.5-4 range,
    // and sharing the BPM axis would flatten both series to the baseline.
    if (showSpeed) {
        datasets.push({
            label: t('speed'),
            data: series.speed,
            yAxisID: 'y1',
            borderColor: '#ffb74d',
            borderWidth: 1.5,
            borderDash: [5, 4],
            pointRadius: 0,
            pointHoverRadius: 4,
            stepped: 'after',
            fill: false
        });
    }

    if (showPitch) {
        datasets.push({
            label: t('pitch'),
            data: series.pitch,
            yAxisID: 'y1',
            borderColor: '#d958ff',
            borderWidth: 1.5,
            borderDash: [5, 4],
            pointRadius: 0,
            pointHoverRadius: 4,
            stepped: 'after',
            fill: false
        });
    }

    const scales = {
        x: {
            type: 'linear',
            title: { display: true, text: useTimeline ? t('timeX') : t('keyX'), color: '#aaa' },
            grid: { color: '#252525' },
            ticks: { color: '#bbb', maxTicksLimit: 12 }
        },
        y: {
            title: { display: true, text: t('bpm'), color: '#aaa' },
            grid: { color: '#252525' },
            ticks: { color: '#bbb' }
        }
    };

    if (showSpeed || showPitch) {
        scales.y1 = {
            position: 'right',
            title: { display: true, text: t('bpmFactor'), color: '#aaa' },
            grid: { drawOnChartArea: false },
            ticks: { color: '#bbb', callback: value => `${value}×` }
        };
    }

    if (bpmChart) bpmChart.destroy();

    const ctx = document.getElementById('bpmChart').getContext('2d');
    bpmChart = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: 'index', intersect: false },
            scales,
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: '#fff', boxWidth: 12, font: { size: 14 }, padding: 15 }
                },
                tooltip: {
                    callbacks: {
                        title: items => items.length > 0
                            ? `${useTimeline ? t('timeX') : t('keyX')} ${items[0].parsed.x.toFixed(0)}`
                            : '',
                        label: context => {
                            const factor = context.dataset.yAxisID === 'y1' ? '×' : '';
                            return `${context.dataset.label}: ${context.parsed.y.toFixed(2)}${factor}`;
                        }
                    }
                }
            }
        }
    });
}

// Consecutive hits sharing a floor id. In ADOFAI a floor can carry more than
// one planet, and those hits are logged back to back under the same id -- so a
// group of two or more is exactly the chord / multipress case. A record with no
// context (old logs, floor -1) breaks the current group instead of joining it.
function buildFloorGroups(records) {
    const groups = [];
    let current = null;

    records.forEach((item, index) => {
        const floorId = item[REC.FLOOR];
        if (!(floorId >= 0)) {
            current = null;
            return;
        }

        if (current && current.floorId === floorId) {
            current.endIndex = index;
            current.records.push(item);
        } else {
            current = { floorId, startIndex: index, endIndex: index, records: [item] };
            groups.push(current);
        }
    });

    return groups;
}

function renderFloorChart() {
    if (globalOffsets.length === 0) return;

    const unit = getUnit();
    const groups = buildFloorGroups(globalOffsets);
    const chords = [];

    groups.forEach(group => {
        const values = group.records.map(item => item[0]).filter(value => !isNaN(value));
        if (values.length < 2) return;

        const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
        const spread = Math.max(...values) - Math.min(...values);
        chords.push({ floorId: group.floorId, size: values.length, mean, spread });
    });

    // Sorted copy for the median; chords themselves stay floor-ordered so the
    // chart's x axis reads like the level.
    const sortedSpreads = chords.map(chord => chord.spread).sort((a, b) => a - b);
    const medianSpread = sortedSpreads.length > 0
        ? (sortedSpreads.length % 2 === 0
            ? (sortedSpreads[sortedSpreads.length / 2 - 1] + sortedSpreads[sortedSpreads.length / 2]) / 2
            : sortedSpreads[Math.floor(sortedSpreads.length / 2)])
        : null;
    const worst = chords.reduce(
        (max, chord) => max === null || chord.spread > max.spread ? chord : max, null);
    const hasContext = groups.length > 0;

    const statsEl = document.getElementById('floorStats');
    if (statsEl) {
        const format = value => Number.isFinite(value) ? value.toFixed(2) + unit : '-';
        statsEl.innerHTML = `
            <div class="stat-tile">
                <div class="label">${t('floorGroups')}</div>
                <div class="value">${hasContext ? groups.length : '-'}</div>
            </div>
            <div class="stat-tile">
                <div class="label">${t('floorChords')}</div>
                <div class="value">${chords.length}</div>
            </div>
            <div class="stat-tile">
                <div class="label">${t('floorMedianSpread')}</div>
                <div class="value">${format(medianSpread)}</div>
            </div>
            <div class="stat-tile">
                <div class="label">${t('floorMaxSpread')}</div>
                <div class="value">${format(worst === null ? null : worst.spread)}</div>
            </div>
        `;
    }

    const noteEl = document.getElementById('floorNote');
    if (noteEl) {
        if (!hasContext) {
            noteEl.innerText = t('floorNoContext');
            noteEl.style.display = 'block';
        } else if (chords.length === 0) {
            noteEl.innerText = t('floorNone');
            noteEl.style.display = 'block';
        } else {
            noteEl.style.display = 'none';
        }
    }

    if (floorChart) floorChart.destroy();

    const ctx = document.getElementById('floorChart').getContext('2d');
    floorChart = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: t('floorSpread'),
                data: chords.map(chord => ({ x: chord.floorId, y: chord.spread, chord })),
                backgroundColor: 'rgba(217, 88, 255, 0.75)',
                borderColor: '#d958ff',
                pointRadius: 3,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: 'nearest', intersect: true },
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: t('floorLabel'), color: '#aaa' },
                    grid: { color: '#252525' },
                    ticks: { color: '#bbb', maxTicksLimit: 12 }
                },
                y: {
                    title: { display: true, text: t('floorSpread') + ` (${unit.trim()})`, color: '#aaa' },
                    grid: { color: '#252525' },
                    ticks: { color: '#bbb' }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: context => {
                            const chord = context.raw.chord;
                            const signedMean = chord.mean >= 0 ? '+' : '';
                            return [
                                `${t('floorLabel')} ${chord.floorId}`,
                                `${t('floorGroupSize')}: ${chord.size}`,
                                `${t('floorSpread')}: ${chord.spread.toFixed(2)}${unit}`,
                                `${t('floorMean')}: ${signedMean}${chord.mean.toFixed(2)}${unit}`
                            ];
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
