// stats.js -- pure statistics over offset records: rolling means, drifts,
// deltas, autocorrelation, histogram binning, outlier bounds. No DOM and no
// Chart.js in here.

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

// -> one signed number per adjacent tap pair: how far this hit landed from where
// the previous one did.
//
// Same adjacency rule as buildReturnPairs above, so the pair count here and the
// "pairs" tile on the return map always describe the same set of steps. It
// answers a different question than the return map does: the return map asks
// whether the previous offset predicts the next one, this asks how large a step
// the timing actually took -- a run can track its previous hit closely and still
// take large steps, and the other way round.
//
// Plain numbers rather than { delta, hit } records: the histogram bins values,
// and a bar's tooltip describes a bin rather than a hit, so the hit number would
// be carried for nothing on runs with tens of thousands of pairs.
function buildDeltas(records) {
    const deltas = [];

    for (let i = 1; i < records.length; i++) {
        if (!isTapRecord(records[i - 1]) || !isTapRecord(records[i])) continue;
        deltas.push(records[i][REC.VALUE] - records[i - 1][REC.VALUE]);
    }

    return deltas;
}

// -> { count, mean, meanAbs, medianAbs, stdDev }, or null when there is nothing
// to pair up -- a single hit, or a selection holding only one tap.
//
// meanAbs is the headline: the average size of a step, direction ignored. The
// signed mean is a different question -- it is the bias of the corrections, so a
// run that corrects constantly in both directions can have a large meanAbs and a
// mean of zero. Both are worth a tile because either one alone reads as "good
// timing". sigma is the population standard deviation, matching
// calculateStatistics() on the offsets.
function computeDeltaStats(deltas) {
    const count = deltas.length;
    if (count === 0) return null;

    let sum = 0;
    let sumAbs = 0;
    for (let i = 0; i < count; i++) {
        sum += deltas[i];
        sumAbs += Math.abs(deltas[i]);
    }

    const mean = sum / count;
    const meanAbs = sumAbs / count;

    let sumSquares = 0;
    for (let i = 0; i < count; i++) sumSquares += Math.pow(deltas[i] - mean, 2);

    // The plain median of the magnitudes, not a quantile like the axis range
    // uses: medianAbs sits next to meanAbs and has to be the same kind of
    // average, or the gap between the two says nothing.
    const magnitudes = deltas.map(value => Math.abs(value)).sort((a, b) => a - b);
    const mid = magnitudes.length >> 1;
    const medianAbs = magnitudes.length % 2
        ? magnitudes[mid]
        : (magnitudes[mid - 1] + magnitudes[mid]) / 2;

    return { count, mean, meanAbs, medianAbs, stdDev: Math.sqrt(sumSquares / count) };
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

// Contiguous stretches of tap records, as inclusive index pairs. This is the
// series every lag in the autocorrelation reaches along: a miss, auto or
// midspin in between means the two taps are not neighbours in time, so the
// series has a hole there and no lag may step across it. Same hole the return
// map's pairs stop at, which is what keeps the two modules' lag 1 identical.
function buildTapRuns(records) {
    const runs = [];
    let first = -1;

    for (let i = 0; i < records.length; i++) {
        if (isTapRecord(records[i])) {
            if (first < 0) first = i;
        } else if (first >= 0) {
            runs.push({ first, last: i - 1 });
            first = -1;
        }
    }

    if (first >= 0) runs.push({ first, last: records.length - 1 });

    return runs;
}

// How far the autocorrelation looks. Enough to catch a repeating input pattern a
// few bars long -- the thing the module exists to find -- and short enough that
// the longest lag still has most of the run left to pair against.
const ACF_MAX_LAG = 50;

// Correlations closer together than this are the same number as far as any
// reader is concerned, so a tie goes to the earlier lag. Without it a perfectly
// periodic run reports whichever of its period and its harmonics happened to
// land one float higher -- measured: for a 12-hit period-4 pattern, the period's
// r came out exactly 1 while a harmonic's came out 1 + 2e-16, and the tile named
// the harmonic. That is a property of the arithmetic, not of the run.
const ACF_TIE_EPSILON = 1e-9;

// -> [{ lag, r, pairs }] for lags 1..maxLag, or [] when the series is too short
// to say anything. r is null when that lag had too few pairs, or when the values
// there are all identical and a correlation has no meaning.
//
// Per lag, the two vectors (x_i) and (x_i+lag) are correlated against each
// other, each standardised by its own mean and sigma -- the same estimator
// computeCorrelation() uses for the return map. Lag 1 therefore reports the same
// number as the return map's r: this module is that one number widened to every
// lag, not a different statistic that would leave the two disagreeing on screen.
//
// The payoff is that the confidence band is exact rather than borrowed: under no
// correlation, a Pearson r over n pairs has standard error 1/sqrt(n-1), so
// 1.96/sqrt(n-1) is the band this statistic actually has. Because n shrinks with
// the lag, so does the band's width -- the funnel in the plot is the honest
// version of the flat band a textbook ACF plot draws.
function computeAutocorrelation(records, maxLag = ACF_MAX_LAG) {
    const runs = buildTapRuns(records);
    const total = runs.reduce((sum, run) => sum + (run.last - run.first + 1), 0);

    // Below three points no lag can produce the two pairs a correlation needs.
    if (total < 3) return [];

    const results = [];

    for (let lag = 1; lag <= maxLag; lag++) {
        let pairs = 0;
        let sumA = 0, sumB = 0, sumAB = 0, sumAA = 0, sumBB = 0;

        runs.forEach(run => {
            for (let i = run.first; i + lag <= run.last; i++) {
                const a = records[i][REC.VALUE];
                const b = records[i + lag][REC.VALUE];
                pairs++;
                sumA += a;
                sumB += b;
                sumAB += a * b;
                sumAA += a * a;
                sumBB += b * b;
            }
        });

        if (pairs < 2) {
            results.push({ lag, r: null, pairs });
            continue;
        }

        const meanA = sumA / pairs;
        const meanB = sumB / pairs;
        const sigmaA = Math.sqrt(Math.max(0, sumAA / pairs - meanA * meanA));
        const sigmaB = Math.sqrt(Math.max(0, sumBB / pairs - meanB * meanB));
        const sigmaProduct = sigmaA * sigmaB;

        results.push({
            lag,
            r: sigmaProduct > 0 ? (sumAB / pairs - meanA * meanB) / sigmaProduct : null,
            pairs
        });
    }

    return results;
}

// -> the 95% half-width of the band at one lag, or null where there is no r to
// test. null when a lag holds fewer than three pairs: the standard error is
// 1/sqrt(n-1), which says nothing at n <= 2.
function getAcfBandHalfWidth(pairs) {
    return pairs > 2 ? 1.96 / Math.sqrt(pairs - 1) : null;
}

// -> the lag furthest from the band, ignoring lag 1: { lag, r, band } or null
// when nothing beyond lag 1 stands out. Lag 1 is excluded because adjacent hits
// tracking each other is the baseline the return map already reports, not a
// finding -- the interesting lags are the ones further out, where a peak means a
// repeating pattern rather than momentum.
//
// Asking for a lag that actually crosses its band is deliberate: the largest |r|
// at a far lag is usually a small number, and reporting "strongest lag: 37,
// r = 0.03" would look like a result while saying nothing.
function getStrongestAcfLag(results) {
    let best = null;

    results.forEach(entry => {
        if (entry.lag < 2 || entry.r === null) return;
        const halfWidth = getAcfBandHalfWidth(entry.pairs);
        if (halfWidth === null || Math.abs(entry.r) <= halfWidth) return;
        if (!best || Math.abs(entry.r) > Math.abs(best.r) + ACF_TIE_EPSILON) {
            best = { lag: entry.lag, r: entry.r, band: halfWidth };
        }
    });

    return best;
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

// Axis range for a histogram of the offsets themselves. The rule lives in
// calculateRobustValueRange(); this is the record-shaped entry point for it.
function calculateRobustAxisRange(offsets) {
    return calculateRobustValueRange(offsets.map(item => item[0]));
}

// Median +/- 4 robust sigma, with robust sigma = IQR / 1.349.  Taking the raw
// min/max lets a handful of extreme values stretch the axis until the bulk of
// the data collapses into one or two bins -- exactly the part the histogram
// exists to show.  On a clean run nothing lies beyond 4 sigma, so this degrades
// to the full data range: the axis is only ever cropped when there really is
// something far outside.
//
// Plain numbers rather than records, so a derived series (the delta histogram)
// can be charted with the same rule as the offsets they came from.
function calculateRobustValueRange(values) {
    const validValues = values.filter(val => !isNaN(val)).sort((a, b) => a - b);
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

// Bins the offsets of a record list. See binValues() for the binning itself.
function createHistogramData(offsets, binCount = 60, axisRange = null) {
    return binValues(offsets.map(item => item[0]), binCount, axisRange);
}

// -> [{ start, end, center, count }], at most binCount bins, covering axisRange
// when one is given and the data's own extent otherwise.
//
// Plain numbers rather than records, so a derived series (the delta histogram)
// reuses the same binning as the offsets it was computed from.
function binValues(values, binCount = 60, axisRange = null) {
    const validOffsets = values.filter(val => !isNaN(val));
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
