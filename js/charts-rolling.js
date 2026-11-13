// charts-rolling.js -- rolling average offset across the run.

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

    // The zero guide always exists; tempo-change guides join it only when the
    // switch asks for them, sharing the same annotation container.
    const annotations = {
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
    };

    if (document.getElementById('rollingBpmMarksCheckbox')?.checked === true) {
        Object.assign(annotations, buildBpmChangeMarkers(globalOffsets, useHitAxis));
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
                    annotations
                }
            }
        }
    });
}
