// charts-timing.js -- where the offsets landed (distribution), how far each
// hit moved from the previous one (delta) and the autocorrelation chart.

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

function renderDeltaChart() {
    // The active selection, not globalOffsets: this module is range-aware, and
    // pairing up neighbours across the edge of a selection would report a step
    // the user did not ask about -- the seam between two regions is not a step
    // in anyone's timing.
    const records = getActiveRecords();
    if (records.length === 0) return;

    const unit = getUnit();
    const deltas = buildDeltas(records);
    const stats = computeDeltaStats(deltas);
    const histogramData = binValues(deltas, 60, calculateRobustValueRange(deltas));

    // A selection holding only one tap, or a run whose offsets are all
    // non-numeric, yields no bins. The plot is empty then, so fall back to a
    // placeholder axis -- same treatment as the distribution chart.
    const hasBins = histogramData.length > 0;
    const xMin = hasBins ? histogramData[0].start : 0;
    const xMax = hasBins ? histogramData[histogramData.length - 1].end : 1;

    const statsEl = document.getElementById('deltaStats');
    if (statsEl) {
        statsEl.innerHTML = `
            <div class="stat-tile">
                <div class="label">${t('deltaPairs')}</div>
                <div class="value">${stats ? stats.count : 0}</div>
            </div>
            <div class="stat-tile">
                <div class="label">${t('deltaMeanAbs')}</div>
                <div class="value" style="color: #ffffff;">${stats ? stats.meanAbs.toFixed(2) + unit : '-'}</div>
            </div>
            <div class="stat-tile">
                <div class="label">${t('deltaMedianAbs')}</div>
                <div class="value" style="color: #ffffff;">${stats ? stats.medianAbs.toFixed(2) + unit : '-'}</div>
            </div>
            <div class="stat-tile">
                <div class="label">${t('deltaMean')}</div>
                <div class="value" style="color: #ffffff;">${stats ? (stats.mean >= 0 ? '+' : '') + stats.mean.toFixed(2) + unit : '-'}</div>
            </div>
            <div class="stat-tile">
                <div class="label">${t('deltaStdDev')}</div>
                <div class="value" style="color: #ffffff;">${stats ? stats.stdDev.toFixed(2) + unit : '-'}</div>
            </div>
        `;
    }

    // Steps the robust axis left outside, reported rather than silently clipped
    // -- same behaviour as the distribution chart's badge.
    const outsideCount = deltas.reduce((count, value) =>
        (value < xMin || value > xMax) ? count + 1 : count, 0);
    const badgeEl = document.getElementById('deltaAxisCropBadge');
    if (badgeEl) {
        if (outsideCount > 0) {
            badgeEl.innerText = (t('axisClipped') || '')
                .replace('{min}', xMin.toFixed(1))
                .replace('{max}', xMax.toFixed(1))
                .replace('{unit}', unit)
                .replace('{count}', outsideCount);
            badgeEl.style.display = 'block';
        } else {
            badgeEl.style.display = 'none';
        }
    }

    if (deltaChart) deltaChart.destroy();

    const ctx = document.getElementById('deltaChart').getContext('2d');

    const annotationsConfig = {
        // Zero reads as "this hit landed where the previous one did": the spike
        // a run makes when it is not correcting at all, and the line the
        // histogram's asymmetry is measured against.
        zeroLine: {
            type: 'line',
            xMin: 0, xMax: 0,
            borderColor: 'rgba(255, 255, 255, 0.75)',
            borderWidth: 1.5,
            label: {
                display: true,
                content: 'Δ = 0',
                position: 'start',
                backgroundColor: 'rgba(0,0,0,0.6)',
                color: '#fff',
                font: { size: 10 }
            }
        }
    };

    if (stats) {
        annotationsConfig.meanLine = {
            type: 'line',
            xMin: stats.mean, xMax: stats.mean,
            borderColor: '#ffb74d',
            borderWidth: 2,
            borderDash: [5, 5],
            label: {
                display: true,
                content: `μΔ = ${stats.mean >= 0 ? '+' : ''}${stats.mean.toFixed(2)}${unit}`,
                position: 'end',
                backgroundColor: 'rgba(230, 124, 11, 0.8)',
                color: '#fff',
                font: { size: 10, weight: 'bold' },
                yAdjust: -10
            }
        };
    }

    // Indigo, to keep this histogram from reading as the offset distribution's
    // green one when both are on screen -- the two axes carry different units of
    // meaning even though both are milliseconds.
    deltaChart = new Chart(ctx, {
        type: 'bar',
        data: {
            datasets: [{
                label: t('deltaTitle'),
                data: histogramData.map(bin => ({ x: bin.center, y: bin.count })),
                backgroundColor: 'rgba(121, 134, 203, 0.6)',
                borderColor: 'rgba(121, 134, 203, 0.85)',
                borderWidth: 1,
                barPercentage: 1.0,
                categoryPercentage: 1.0
            }]
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
                    title: { display: true, text: t('deltaX') + ` (${unit.trim()})`, color: '#aaa' },
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
                // One series: the section title names it, so no legend box.
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${t('frequency')}: ${context.raw.y}`;
                        }
                    }
                },
                annotation: { annotations: annotationsConfig }
            }
        }
    });
}

function renderAcfChart() {
    // The active selection, like the delta module: a correlation is a property of
    // the stretch being looked at, and a lag that reached outside it would be
    // measuring a different run.
    const records = getActiveRecords();
    if (records.length === 0) return;

    const results = computeAutocorrelation(records);
    const lag1 = results.length > 0 ? results[0] : null;
    const strongest = getStrongestAcfLag(results);

    const statsEl = document.getElementById('acfStats');
    if (statsEl) {
        statsEl.innerHTML = `
            <div class="stat-tile">
                <div class="label">${t('acfPairs')}</div>
                <div class="value">${lag1 ? lag1.pairs : 0}</div>
            </div>
            <div class="stat-tile">
                <div class="label">${t('acfLag1')}</div>
                <div class="value" style="color: #ffffff;">${lag1 && lag1.r !== null ? lag1.r.toFixed(3) : '-'}</div>
            </div>
            <div class="stat-tile">
                <div class="label">${t('acfStrongest')}</div>
                <div class="value" style="color: #ffffff;">${strongest ? `lag ${strongest.lag}` : '-'}</div>
            </div>
            <div class="stat-tile">
                <div class="label">${t('acfStrongest')} r</div>
                <div class="value" style="color: #ffffff;">${strongest ? strongest.r.toFixed(3) : '-'}</div>
            </div>
        `;
    }

    // Fifty lags are fifty chances for one to cross its band on noise alone, and
    // at 5% that is two or three of them. Said out loud next to the plot, because
    // a reader who finds a single spike at lag 34 has no way to know that from
    // the picture.
    const noteEl = document.getElementById('acfNote');
    if (noteEl) {
        noteEl.innerText = results.length > 0 ? t('acfMultiTest') : '';
        noteEl.style.display = results.length > 0 ? 'block' : 'none';
    }

    if (acfChart) acfChart.destroy();

    const ctx = document.getElementById('acfChart').getContext('2d');

    const bandHalfWidth = (entry) => getAcfBandHalfWidth(entry.pairs);
    const maxAbsR = results.reduce((max, entry) =>
        entry.r === null ? max : Math.max(max, Math.abs(entry.r)), 0);
    const maxBand = results.reduce((max, entry) => {
        const halfWidth = bandHalfWidth(entry);
        return halfWidth === null ? max : Math.max(max, halfWidth);
    }, 0);

    // A full +/-1 axis would squash every real autocorrelation in timing data into
    // the middle and leave the band a hairline on the zero line. The window is
    // whatever the data and the band actually occupy, floored at +/-0.2 so a flat
    // run does not blow a 0.01 wobble up to full height, and capped at +/-1
    // because a correlation cannot leave it.
    const span = Math.min(1, Math.max(0.2, maxAbsR * 1.3, maxBand * 1.3));

    acfChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: results.map(entry => String(entry.lag)),
            datasets: [
                {
                    label: t('acfTitle'),
                    data: results.map(entry => entry.r),
                    backgroundColor: 'rgba(0, 188, 212, 0.7)',
                    borderColor: 'rgba(0, 188, 212, 0.9)',
                    borderWidth: 1,
                    barPercentage: 0.7,
                    categoryPercentage: 1.0,
                    order: 2
                },
                {
                    label: t('acfBand'),
                    data: results.map(entry => bandHalfWidth(entry)),
                    type: 'line',
                    borderColor: 'rgba(255, 255, 255, 0.35)',
                    borderWidth: 1,
                    borderDash: [4, 4],
                    pointRadius: 0,
                    fill: false,
                    order: 0
                },
                {
                    // Second half of the band, filled towards the first: one
                    // shaded funnel rather than two loose lines. Kept out of the
                    // legend and the tooltip, which would otherwise name the same
                    // band twice.
                    label: t('acfBand'),
                    data: results.map(entry => {
                        const halfWidth = bandHalfWidth(entry);
                        return halfWidth === null ? null : -halfWidth;
                    }),
                    type: 'line',
                    borderColor: 'rgba(255, 255, 255, 0.35)',
                    borderWidth: 1,
                    borderDash: [4, 4],
                    pointRadius: 0,
                    fill: { target: 1 },
                    backgroundColor: 'rgba(255, 255, 255, 0.06)',
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
                    title: { display: true, text: t('acfX'), color: '#aaa' },
                    grid: { color: '#252525' },
                    ticks: {
                        color: '#bbb',
                        // The labels are already the lag numbers; this only thins
                        // them out when 50 ticks would collide.
                        maxTicksLimit: 12
                    }
                },
                y: {
                    min: -span,
                    max: span,
                    title: { display: true, text: t('returnCorr'), color: '#aaa' },
                    grid: { color: '#252525' },
                    ticks: { color: '#bbb', callback: function(value) { return value.toFixed(2); } }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: '#fff',
                        boxWidth: 12,
                        font: { size: 14 },
                        padding: 15,
                        filter: (item) => item.datasetIndex !== 2
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    filter: (item) => item.datasetIndex !== 2,
                    callbacks: {
                        title: (items) => `lag ${items[0].label}`,
                        label: (context) => {
                            if (context.datasetIndex === 0) {
                                return context.parsed.y === null || context.parsed.y === undefined
                                    ? t('acfPairs') + ': 0'
                                    : `${t('returnCorr')}: ${context.parsed.y.toFixed(3)}`;
                            }
                            return `${t('acfBand')}: ±${Math.abs(context.parsed.y).toFixed(3)}`;
                        },
                        afterLabel: (context) => {
                            const entry = results[context.dataIndex];
                            return context.datasetIndex === 0 && entry
                                ? `${t('acfPairs')}: ${entry.pairs}`
                                : '';
                        }
                    }
                },
                annotation: {
                    annotations: {
                        // Sign boundary: a bar above it means the two lags move
                        // together, below it means each undoes the other.
                        zeroR: {
                            type: 'line',
                            yMin: 0, yMax: 0,
                            borderColor: 'rgba(255, 255, 255, 0.25)',
                            borderWidth: 1
                        }
                    }
                }
            }
        }
    });
}
