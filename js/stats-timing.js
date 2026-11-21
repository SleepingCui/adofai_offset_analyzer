// stats-timing.js -- timing statistics for the opt-in analysis panels.
// Pure functions over offset records / plain value arrays: no DOM and no
// Chart.js in here, so the numbers can be checked without a browser.
//
// The functions cover the deeper timing measures used by the panels:
// detrended lag-1 compensation, Hurst R/S, DFA, FFT spectrum, Shapiro-Wilk,
// combo fatigue, return-map axes, and rolling UR. Every one returns null (or a
// null field) when the run is too short to support it -- a missing answer is
// better than a confident one computed from ten hits.

// Heavy passes are capped. Sampling is evenly spaced so the whole run stays
// represented; at these lengths the difference from the full series is far
// smaller than the effects the tests are looking for.
const FORENSIC_SAMPLE_LIMIT = 32768;
const SHAPIRO_SAMPLE_LIMIT = 5000;

function finiteValues(values) {
    return values.filter(value => Number.isFinite(value));
}

// Milliseconds when the log carries the v8/v9 context, the native offset
// otherwise. Every forensic number is therefore on one scale whichever unit the
// charts are currently drawing, which is what makes the thresholds comparable
// between an angle log and a millisecond one.
function forensicUsesMs(records) {
    return records.length > 0 && records.every(item => Number.isFinite(item[REC.MS]));
}

function forensicOffsetValue(item, useMs) {
    const wantMs = useMs === undefined ? Number.isFinite(item[REC.MS]) : useMs;
    return wantMs && Number.isFinite(item[REC.MS]) ? item[REC.MS] : item[REC.VALUE];
}

// One scale for the whole run: a log where only some records carry the v8/v9
// millisecond column would otherwise mix milliseconds with native offsets.
function forensicSeries(records) {
    const useMs = forensicUsesMs(records);
    return records.map(item => forensicOffsetValue(item, useMs));
}

function meanOf(values) {
    if (values.length === 0) return null;
    let sum = 0;
    for (let i = 0; i < values.length; i++) sum += values[i];
    return sum / values.length;
}

function populationSigma(values, mean) {
    if (values.length === 0) return null;
    const mu = mean === undefined ? meanOf(values) : mean;
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
        const d = values[i] - mu;
        sum += d * d;
    }
    return Math.sqrt(sum / values.length);
}

function pearsonArrays(xs, ys) {
    const n = Math.min(xs.length, ys.length);
    if (n < 2) return null;

    let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) {
        const x = xs[i], y = ys[i];
        sx += x; sy += y; sxy += x * y; sxx += x * x; syy += y * y;
    }
    const mx = sx / n, my = sy / n;
    const vx = sxx / n - mx * mx;
    const vy = syy / n - my * my;
    if (!(vx > 0) || !(vy > 0)) return null;
    return (sxy / n - mx * my) / Math.sqrt(vx * vy);
}

// Evenly spaced subsample. Used only by the long-series estimators.
function subsample(values, limit) {
    if (values.length <= limit) return values;
    const stride = values.length / limit;
    const out = new Array(limit);
    for (let i = 0; i < limit; i++) out[i] = values[Math.floor(i * stride)];
    return out;
}

// ---------------------------------------------------------------------------
// Detrending
// ---------------------------------------------------------------------------

// Least-squares line removed. Used by the spectrum, where a slow drift would
// otherwise put all the power in the first bin.
function linearDetrend(values) {
    const n = values.length;
    if (n < 2) return { values: values.slice(), slope: 0, intercept: n ? values[0] : 0 };

    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) {
        sx += i; sy += values[i]; sxy += i * values[i]; sxx += i * i;
    }
    const denom = n * sxx - sx * sx;
    const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
    const intercept = (sy - slope * sx) / n;

    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = values[i] - (intercept + slope * i);
    return { values: out, slope, intercept };
}

// Centred moving average with a partial window at both ends (prefix sums, so
// the pass is O(n) whatever the window). This is the high-pass half of the
// compensation test: subtracting it keeps hit-to-hit corrections and removes
// the slow wander that would otherwise dominate lag 1.
function centeredMovingAverage(values, windowSize) {
    const n = values.length;
    const out = new Array(n).fill(null);
    if (n === 0) return out;

    const half = Math.max(0, Math.floor(windowSize / 2));
    const prefix = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + values[i];

    for (let i = 0; i < n; i++) {
        const start = Math.max(0, i - half);
        const end = Math.min(n, i + half + 1);
        out[i] = (prefix[end] - prefix[start]) / (end - start);
    }
    return out;
}

function detrendByMovingAverage(values, windowSize) {
    const average = centeredMovingAverage(values, windowSize);
    return values.map((value, i) => value - average[i]);
}

// ---------------------------------------------------------------------------
// Lag-1 compensation (detrended)
// ---------------------------------------------------------------------------

// A strong summary after UR: successive taps often overcorrect, so the
// detrended lag-1 correlation tends to sit around -0.2..-0.4. Independent
// jitter has no memory and lands near 0.
//
// The profile is the same number computed in chunks along the run, for the
// chart that asks whether the compensation changes with the chart's rhythm.
function computeLag1Compensation(records, options = {}) {
    const values = forensicSeries(records);
    const n = values.length;
    if (n < 20) return { rho: null, pairs: 0, window: 0, profile: [], n };

    const window = Math.max(5, Math.min(101, Math.round(n * 0.04) | 1));
    const residuals = detrendByMovingAverage(values, window);

    let pairs = 0, sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
    for (let i = 1; i < n; i++) {
        const a = residuals[i - 1], b = residuals[i];
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        pairs++;
        sx += a; sy += b; sxy += a * b; sxx += a * a; syy += b * b;
    }

    let rho = null;
    if (pairs >= 3) {
        const mx = sx / pairs, my = sy / pairs;
        const vx = sxx / pairs - mx * mx;
        const vy = syy / pairs - my * my;
        if (vx > 0 && vy > 0) rho = (sxy / pairs - mx * my) / Math.sqrt(vx * vy);
    }

    // Chunked profile. Each chunk gets its own short moving average so a drift
    // inside the chunk is removed before its lag-1 is measured.
    const profile = [];
    const chunkSize = Math.max(120, Math.min(800, Math.round(n / 24)));
    for (let start = 0; start + chunkSize <= n; start += chunkSize) {
        const chunk = values.slice(start, start + chunkSize);
        const chunkWindow = Math.max(5, Math.min(51, Math.round(chunk.length * 0.1) | 1));
        const chunkResiduals = detrendByMovingAverage(chunk, chunkWindow);
        let count = 0, csx = 0, csy = 0, csxy = 0, csxx = 0, csyy = 0;
        for (let i = 1; i < chunkResiduals.length; i++) {
            const a = chunkResiduals[i - 1], b = chunkResiduals[i];
            if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
            count++;
            csx += a; csy += b; csxy += a * b; csxx += a * a; csyy += b * b;
        }
        let chunkRho = null;
        if (count >= 3) {
            const mx = csx / count, my = csy / count;
            const vx = csxx / count - mx * mx;
            const vy = csyy / count - my * my;
            if (vx > 0 && vy > 0) chunkRho = (csxy / count - mx * my) / Math.sqrt(vx * vy);
        }
        const middle = Math.min(records.length - 1, start + Math.floor(chunkSize / 2));
        profile.push({
            hit: Number.isFinite(records[middle][REC.INDEX]) ? records[middle][REC.INDEX] + 1 : middle + 1,
            rho: chunkRho,
            count
        });
    }

    return { rho, pairs, window, profile, n };
}

// ---------------------------------------------------------------------------
// Hurst exponent (R/S)
// ---------------------------------------------------------------------------

// Classic rescaled-range analysis. A random walk or white timing noise gives
// H around 0.5; stronger long-range correlation pushes it above 0.6.
// The fit is over log(R/S) vs log(block size), using all complete blocks at each
// scale so one outlier block cannot set the exponent.
function computeHurstRS(values) {
    const series = subsample(finiteValues(values), FORENSIC_SAMPLE_LIMIT);
    const n = series.length;
    if (n < 32) return { h: null, r2: null, points: [], n };

    const sizes = [];
    let size = 8;
    while (size <= n / 2) {
        const rounded = Math.floor(size);
        if (sizes[sizes.length - 1] !== rounded) sizes.push(rounded);
        size *= 1.6;
    }
    if (sizes.length < 3) return { h: null, r2: null, points: [], n };

    const points = [];
    sizes.forEach(blockSize => {
        const blocks = Math.floor(n / blockSize);
        if (blocks < 2) return;

        let sumLog = 0;
        let used = 0;
        for (let b = 0; b < blocks; b++) {
            const start = b * blockSize;
            const end = start + blockSize;
            let mean = 0;
            for (let i = start; i < end; i++) mean += series[i];
            mean /= blockSize;

            let cumulative = 0;
            let min = Infinity;
            let max = -Infinity;
            let sumSq = 0;
            for (let i = start; i < end; i++) {
                const d = series[i] - mean;
                cumulative += d;
                if (cumulative < min) min = cumulative;
                if (cumulative > max) max = cumulative;
                sumSq += d * d;
            }
            const range = max - min;
            const sigma = Math.sqrt(sumSq / blockSize);
            if (!(sigma > 0) || !(range > 0)) continue;

            sumLog += Math.log10(range / sigma);
            used++;
        }

        if (used > 0) {
            points.push({
                blockSize,
                rs: Math.pow(10, sumLog / used),
                logSize: Math.log10(blockSize),
                logRs: sumLog / used,
                blocks: used
            });
        }
    });

    if (points.length < 3) return { h: null, r2: null, points, n };

    let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
    points.forEach(point => {
        sx += point.logSize; sy += point.logRs;
        sxy += point.logSize * point.logRs;
        sxx += point.logSize * point.logSize;
        syy += point.logRs * point.logRs;
    });
    const count = points.length;
    const denom = count * sxx - sx * sx;
    if (denom === 0) return { h: null, r2: null, points, n };

    const h = (count * sxy - sx * sy) / denom;
    const intercept = (sy - h * sx) / count;

    let residual = 0, total = 0;
    const meanY = sy / count;
    points.forEach(point => {
        const fit = h * point.logSize + intercept;
        residual += Math.pow(point.logRs - fit, 2);
        total += Math.pow(point.logRs - meanY, 2);
    });

    return {
        h,
        r2: total > 0 ? 1 - residual / total : null,
        points,
        n
    };
}

// ---------------------------------------------------------------------------
// Detrended fluctuation analysis
// ---------------------------------------------------------------------------

// DFA alpha. White noise gives about 0.5; long-range correlation pushes it
// above 0.6. The profile is the cumulative sum of the mean-removed series, and
// each box is detrended with its own least-squares line before the RMS residual
// is taken.
function computeDFA(values) {
    const series = subsample(finiteValues(values), FORENSIC_SAMPLE_LIMIT);
    const n = series.length;
    if (n < 64) return { alpha: null, r2: null, points: [], n };

    let mean = 0;
    for (let i = 0; i < n; i++) mean += series[i];
    mean /= n;

    const profile = new Float64Array(n);
    let running = 0;
    for (let i = 0; i < n; i++) {
        running += series[i] - mean;
        profile[i] = running;
    }

    const sizes = [];
    let size = 8;
    while (size <= n / 4) {
        const rounded = Math.floor(size);
        if (sizes[sizes.length - 1] !== rounded) sizes.push(rounded);
        size *= 1.6;
    }
    if (sizes.length < 3) return { alpha: null, r2: null, points: [], n };

    const points = [];
    sizes.forEach(boxSize => {
        const boxes = Math.floor(n / boxSize);
        if (boxes < 2) return;

        let sumSq = 0;
        for (let b = 0; b < boxes; b++) {
            const start = b * boxSize;
            // Least-squares line through box local index vs profile value.
            let sx = 0, sy = 0, sxy = 0, sxx = 0;
            for (let i = 0; i < boxSize; i++) {
                const x = i;
                const y = profile[start + i];
                sx += x; sy += y; sxy += x * y; sxx += x * x;
            }
            const denom = boxSize * sxx - sx * sx;
            const slope = denom === 0 ? 0 : (boxSize * sxy - sx * sy) / denom;
            const intercept = (sy - slope * sx) / boxSize;
            for (let i = 0; i < boxSize; i++) {
                const d = profile[start + i] - (intercept + slope * i);
                sumSq += d * d;
            }
        }

        const fluctuation = Math.sqrt(sumSq / (boxes * boxSize));
        if (fluctuation > 0) {
            points.push({
                boxSize,
                fluctuation,
                logSize: Math.log10(boxSize),
                logFluctuation: Math.log10(fluctuation),
                boxes
            });
        }
    });

    if (points.length < 3) return { alpha: null, r2: null, points, n };

    let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
    points.forEach(point => {
        sx += point.logSize; sy += point.logFluctuation;
        sxy += point.logSize * point.logFluctuation;
        sxx += point.logSize * point.logSize;
        syy += point.logFluctuation * point.logFluctuation;
    });
    const count = points.length;
    const denom = count * sxx - sx * sx;
    if (denom === 0) return { alpha: null, r2: null, points, n };

    const alpha = (count * sxy - sx * sy) / denom;
    const intercept = (sy - alpha * sx) / count;

    let residual = 0, total = 0;
    const meanY = sy / count;
    points.forEach(point => {
        const fit = alpha * point.logSize + intercept;
        residual += Math.pow(point.logFluctuation - fit, 2);
        total += Math.pow(point.logFluctuation - meanY, 2);
    });

    return {
        alpha,
        r2: total > 0 ? 1 - residual / total : null,
        points,
        n
    };
}

// ---------------------------------------------------------------------------
// FFT spectrum
// ---------------------------------------------------------------------------

function fftRadix2(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            let t = re[i]; re[i] = re[j]; re[j] = t;
            t = im[i]; im[i] = im[j]; im[j] = t;
        }
    }

    for (let len = 2; len <= n; len <<= 1) {
        const angle = -2 * Math.PI / len;
        const wLenRe = Math.cos(angle);
        const wLenIm = Math.sin(angle);
        const half = len >> 1;
        for (let i = 0; i < n; i += len) {
            let wRe = 1;
            let wIm = 0;
            for (let j = 0; j < half; j++) {
                const uRe = re[i + j];
                const uIm = im[i + j];
                const vRe = re[i + j + half] * wRe - im[i + j + half] * wIm;
                const vIm = re[i + j + half] * wIm + im[i + j + half] * wRe;
                re[i + j] = uRe + vRe;
                im[i + j] = uIm + vIm;
                re[i + j + half] = uRe - vRe;
                im[i + j + half] = uIm - vIm;
                const nextRe = wRe * wLenRe - wIm * wLenIm;
                wIm = wRe * wLenIm + wIm * wLenRe;
                wRe = nextRe;
            }
        }
    }
}

// Period is measured in hits: a peak at 12 means the timing error repeats every
// twelve taps. The mean and a linear drift are removed first, and a Hann window
// keeps the ends from leaking a broad skirt across the spectrum.
function computeSpectrum(values, options = {}) {
    const series = subsample(finiteValues(values), 65536);
    const n = series.length;
    if (n < 64) {
        return { bins: [], peaks: [], dominantPeriod: null, dominantAmp: null, peakShare: null, flatness: null, n };
    }

    const detrended = linearDetrend(series).values;
    let fftSize = 1;
    while (fftSize < n) fftSize <<= 1;
    fftSize = Math.min(fftSize, 65536);

    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);
    let windowSum = 0;
    for (let i = 0; i < n; i++) {
        const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
        windowSum += w;
        re[i] = detrended[i] * w;
    }
    if (windowSum === 0) windowSum = 1;

    fftRadix2(re, im);

    const maxPeriod = Math.max(3, Math.min(1024, Math.floor(n / 2)));
    const bins = [];
    for (let period = 2; period <= maxPeriod; period++) bins.push({ period, amp: 0 });

    // Raw peaks are taken from FFT bins so a period between two integer buckets
    // is not flattened onto both of them.
    const raw = [];
    const nyquist = fftSize >> 1;
    for (let k = 1; k <= nyquist; k++) {
        const amplitude = 2 * Math.sqrt(re[k] * re[k] + im[k] * im[k]) / windowSum;
        const period = fftSize / k;
        if (period < 2 || period > maxPeriod) continue;
        raw.push({ k, period, amplitude });
        const bucket = Math.round(period);
        if (bucket >= 2 && bucket <= maxPeriod) {
            const index = bucket - 2;
            if (amplitude > bins[index].amp) bins[index].amp = amplitude;
        }
    }

    const peaks = [];
    for (let i = 1; i < raw.length - 1; i++) {
        if (raw[i].amplitude > raw[i - 1].amplitude && raw[i].amplitude >= raw[i + 1].amplitude) {
            peaks.push(raw[i]);
        }
    }
    peaks.sort((a, b) => b.amplitude - a.amplitude);

    const sumAmp = raw.reduce((sum, entry) => sum + entry.amplitude, 0);
    const positive = raw.map(entry => entry.amplitude).filter(amp => amp > 0);
    const geometric = positive.length
        ? Math.exp(positive.reduce((sum, amp) => sum + Math.log(amp), 0) / positive.length)
        : 0;
    const arithmetic = positive.length ? positive.reduce((a, b) => a + b, 0) / positive.length : 0;

    const dominant = peaks[0] || null;
    return {
        bins,
        peaks: peaks.slice(0, 8),
        dominantPeriod: dominant ? dominant.period : null,
        dominantAmp: dominant ? dominant.amplitude : null,
        peakShare: dominant && sumAmp > 0 ? dominant.amplitude / sumAmp : null,
        flatness: arithmetic > 0 ? geometric / arithmetic : null,
        n
    };
}

// ---------------------------------------------------------------------------
// Shapiro-Wilk
// ---------------------------------------------------------------------------

// Acklam's inverse normal CDF.
function normalQuantile(p) {
    if (!(p > 0) || !(p < 1)) return p <= 0 ? -Infinity : Infinity;
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
        1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
        6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
        -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
        3.754408661907416e+00];
    const low = 0.02425;
    const high = 1 - low;

    if (p < low) {
        const q = Math.sqrt(-2 * Math.log(p));
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
            / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p <= high) {
        const q = p - 0.5;
        const r = q * q;
        return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
            / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    }
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
        / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

function normalCdf(z) {
    const x = Math.abs(z);
    const t = 1 / (1 + 0.2316419 * x);
    const density = 0.3989422804014327 * Math.exp(-x * x / 2);
    const tail = density * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937
        + t * (-1.821255978 + t * 1.330274429))));
    return z >= 0 ? 1 - tail : tail;
}

// Royston's AS R94 approximation, the algorithm R's shapiro.test uses. A high
// p means the sample is hard to distinguish from normal; the value is reported
// as-is, because a genuinely Gaussian series can also produce a high p.
function computeShapiroWilk(values) {
    const sample = subsample(finiteValues(values), SHAPIRO_SAMPLE_LIMIT);
    const n = sample.length;
    if (n < 12) return { w: null, p: null, n };

    const sorted = sample.slice().sort((a, b) => a - b);
    const mean = sorted.reduce((a, b) => a + b, 0) / n;
    let denominator = 0;
    for (let i = 0; i < n; i++) denominator += Math.pow(sorted[i] - mean, 2);
    if (!(denominator > 0)) return { w: null, p: null, n };

    const m = new Array(n);
    let ssumm2 = 0;
    for (let i = 0; i < n; i++) {
        m[i] = normalQuantile((i + 1 - 0.375) / (n + 0.25));
        ssumm2 += m[i] * m[i];
    }
    const root = Math.sqrt(ssumm2);
    const rsn = 1 / Math.sqrt(n);
    const aN = -2.706056 * Math.pow(rsn, 5) + 4.434685 * Math.pow(rsn, 4)
        - 2.071190 * Math.pow(rsn, 3) - 0.147981 * Math.pow(rsn, 2)
        + 0.221157 * rsn + m[n - 1] / root;
    const aN1 = -3.582633 * Math.pow(rsn, 5) + 5.682633 * Math.pow(rsn, 4)
        - 1.752461 * Math.pow(rsn, 3) - 0.293762 * Math.pow(rsn, 2)
        + 0.042981 * rsn + m[n - 2] / root;

    let phi;
    const a = new Array(n).fill(0);
    if (n > 5) {
        phi = (ssumm2 - 2 * m[n - 1] * m[n - 1] - 2 * m[n - 2] * m[n - 2])
            / (1 - 2 * aN * aN - 2 * aN1 * aN1);
        a[0] = aN;
        a[1] = aN1;
        for (let i = 2; i < n / 2; i++) a[i] = m[i] / Math.sqrt(phi);
    } else {
        phi = (ssumm2 - 2 * m[n - 1] * m[n - 1]) / (1 - 2 * aN * aN);
        a[0] = aN;
        for (let i = 1; i < n / 2; i++) a[i] = m[i] / Math.sqrt(phi);
    }

    let numerator = 0;
    for (let i = 0; i < Math.floor(n / 2); i++) {
        numerator += a[i] * (sorted[n - 1 - i] - sorted[i]);
    }
    const w = Math.min(1, Math.max(0, numerator * numerator / denominator));

    let p;
    if (n >= 12) {
        const u = Math.log(n);
        const mu = 0.0038915 * u * u * u - 0.083751 * u * u - 0.31082 * u - 1.5861;
        const sigma = Math.exp(0.0030302 * u * u - 0.082676 * u - 0.4803);
        const safe = Math.min(w, 1 - 1e-12);
        const z = (Math.log(1 - safe) - mu) / sigma;
        p = 1 - normalCdf(z);
    } else {
        const gamma = -2.273 + 0.459 * n;
        const mu = 0.5440 - 0.39978 * n + 0.025054 * n * n - 0.0006714 * n * n * n;
        const sigma = Math.exp(1.3822 - 0.77857 * n + 0.062767 * n * n - 0.0020322 * n * n * n);
        const safe = Math.min(w, 1 - 1e-12);
        const z = (-Math.log(gamma - Math.log(1 - safe)) - mu) / sigma;
        p = 1 - normalCdf(z);
    }

    return {
        w,
        p: Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : null,
        n
    };
}

// ---------------------------------------------------------------------------
// Distribution shape
// ---------------------------------------------------------------------------

function computeDistributionShape(values) {
    const series = finiteValues(values);
    const n = series.length;
    if (n < 3) return { n, mean: null, sigma: null, skewness: null, excessKurtosis: null, rawKurtosis: null, shapiro: null };

    const mean = meanOf(series);
    let m2 = 0, m3 = 0, m4 = 0;
    for (let i = 0; i < n; i++) {
        const d = series[i] - mean;
        const d2 = d * d;
        m2 += d2;
        m3 += d2 * d;
        m4 += d2 * d2;
    }
    m2 /= n; m3 /= n; m4 /= n;
    const sigma = Math.sqrt(m2);
    if (!(sigma > 0)) {
        return { n, mean, sigma, skewness: null, excessKurtosis: null, rawKurtosis: null, shapiro: computeShapiroWilk(series) };
    }

    const skewness = m3 / Math.pow(sigma, 3);
    const excessKurtosis = m4 / Math.pow(sigma, 4) - 3;
    return {
        n,
        mean,
        sigma,
        skewness,
        excessKurtosis,
        rawKurtosis: excessKurtosis + 3,
        shapiro: computeShapiroWilk(series)
    };
}

// ---------------------------------------------------------------------------
// Combo fatigue
// ---------------------------------------------------------------------------

// Sigma against the current streak length. Timing scatter may grow as a streak
// gets longer (tension, fatigue); a flat profile means the two are mostly
// unrelated.
function computeComboFatigue(records) {
    const buckets = new Map();
    const useMs = forensicUsesMs(records);
    let combo = 0;
    let maxCombo = 0;
    let hitCount = 0;

    records.forEach(item => {
        const judge = item[REC.JUDGE];
        if (isStreakHitCode(judge)) {
            combo++;
            if (combo > maxCombo) maxCombo = combo;
        } else {
            combo = 0;
            return;
        }

        // Auto hits keep the streak alive but are not taps to measure.
        if (!isTapRecord(item)) return;
        const value = forensicOffsetValue(item, useMs);
        if (!Number.isFinite(value)) return;

        const start = Math.floor((combo - 1) / 10) * 10 + 1;
        const key = Math.min(start, 201);
        let bucket = buckets.get(key);
        if (!bucket) {
            bucket = { start: key, end: key >= 201 ? Infinity : key + 9, sum: 0, sumSq: 0, count: 0 };
            buckets.set(key, bucket);
        }
        bucket.sum += value;
        bucket.sumSq += value * value;
        bucket.count++;
        hitCount++;
    });

    const bins = [];
    buckets.forEach(bucket => {
        if (bucket.count < 5) return;
        const mean = bucket.sum / bucket.count;
        const sigma = Math.sqrt(Math.max(0, bucket.sumSq / bucket.count - mean * mean));
        bins.push({
            start: bucket.start,
            end: bucket.end,
            midpoint: bucket.start + 4.5,
            mean,
            sigma,
            count: bucket.count
        });
    });
    bins.sort((a, b) => a.start - b.start);

    if (bins.length < 2 || maxCombo < 60) {
        return { bins, slope: null, r2: null, maxCombo, hitCount };
    }

    let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
    bins.forEach(bin => {
        sx += bin.midpoint; sy += bin.sigma;
        sxy += bin.midpoint * bin.sigma;
        sxx += bin.midpoint * bin.midpoint;
        syy += bin.sigma * bin.sigma;
    });
    const count = bins.length;
    const denom = count * sxx - sx * sx;
    if (denom === 0) return { bins, slope: null, r2: null, maxCombo, hitCount };

    const perHit = (count * sxy - sx * sy) / denom;
    const intercept = (sy - perHit * sx) / count;
    let residual = 0, total = 0;
    const meanY = sy / count;
    bins.forEach(bin => {
        const fit = intercept + perHit * bin.midpoint;
        residual += Math.pow(bin.sigma - fit, 2);
        total += Math.pow(bin.sigma - meanY, 2);
    });

    return {
        bins,
        slope: perHit * 100,
        r2: total > 0 ? 1 - residual / total : null,
        maxCombo,
        hitCount
    };
}

// ---------------------------------------------------------------------------
// Return-map axes
// ---------------------------------------------------------------------------

// Rotates consecutive-offset pairs into the diagonal / anti-diagonal basis.
// Pairs with a shared timing offset lie along y = x (small sigma on the
// anti-diagonal); correction spreads the cloud into the anti-diagonal.
function computeReturnAxes(pairs) {
    const count = pairs.length;
    if (count < 3) return { count, sigmaParallel: null, sigmaPerp: null, ratio: null, oppositeShare: null, corr: null };

    let sumU = 0, sumV = 0, sumUU = 0, sumVV = 0, opposite = 0;
    pairs.forEach(pair => {
        const u = (pair.previous + pair.current) / Math.SQRT2;
        const v = (pair.current - pair.previous) / Math.SQRT2;
        sumU += u; sumV += v;
        sumUU += u * u; sumVV += v * v;
        if (pair.previous * pair.current < 0) opposite++;
    });

    const meanU = sumU / count;
    const meanV = sumV / count;
    const sigmaParallel = Math.sqrt(Math.max(0, sumUU / count - meanU * meanU));
    const sigmaPerp = Math.sqrt(Math.max(0, sumVV / count - meanV * meanV));

    return {
        count,
        sigmaParallel,
        sigmaPerp,
        ratio: sigmaParallel > 0 ? sigmaPerp / sigmaParallel : null,
        oppositeShare: opposite / count,
        corr: computeCorrelation(pairs)
    };
}

// ---------------------------------------------------------------------------
// ACF cycle detection
// ---------------------------------------------------------------------------

// Reads the ACF results from stats.js for a periodic component. A peak at P
// that returns at 2P, 3P (and usually alternates sign at P/2) is a repeating
// correction pattern; an irregular peak alone is not. The result is evidence,
// not a verdict -- see the note on multiple testing above the ACF chart.
function computeAcfCycle(results) {
    if (!results || results.length < 6) return null;

    const peaks = [];
    for (let i = 1; i < results.length - 1; i++) {
        const current = results[i];
        if (current.lag < 2 || current.r === null) continue;
        const halfWidth = getAcfBandHalfWidth(current.pairs);
        if (halfWidth === null || current.r <= halfWidth) continue;
        const previous = results[i - 1].r;
        const next = results[i + 1].r;
        if (previous === null || next === null) continue;
        if (current.r >= previous && current.r > next) {
            peaks.push({ lag: current.lag, r: current.r, band: halfWidth });
        }
    }
    if (peaks.length === 0) return { period: null, peakR: null, regularity: 0, negativeHalf: false, peaks: [] };

    peaks.sort((a, b) => b.r - a.r);
    const dominant = peaks[0];

    let matches = 0;
    for (let multiple = 2; multiple <= 4; multiple++) {
        const target = dominant.lag * multiple;
        if (peaks.some(peak => Math.abs(peak.lag - target) <= 1)) matches++;
    }

    const halfLag = Math.round(dominant.lag / 2);
    const halfEntry = results.find(entry => entry.lag === halfLag);
    const negativeHalf = !!(halfEntry && halfEntry.r !== null
        && halfEntry.r < -(getAcfBandHalfWidth(halfEntry.pairs) || 0));

    return {
        period: dominant.lag,
        peakR: dominant.r,
        regularity: matches / 3,
        negativeHalf,
        peaks: peaks.slice(0, 5)
    };
}

// ---------------------------------------------------------------------------
// Rolling UR
// ---------------------------------------------------------------------------

// UR is 10 * sigma of the timing error in milliseconds. This is the local
// version: a trailing window, so the chart can show a steady 8 UR giving way to
// a noisy 20 instead of one number for the whole run. Falls back to the native
// VALUE column for logs without millisecond context, and says which it used.
function computeRollingUr(records, windowSize) {
    const size = Math.max(5, Math.round(windowSize || 100));
    const useMs = forensicUsesMs(records);
    const values = forensicSeries(records);

    const points = [];
    const window = [];
    let sum = 0;
    let sumSq = 0;

    for (let i = 0; i < records.length; i++) {
        const value = values[i];
        if (Number.isFinite(value)) {
            window.push(value);
            sum += value;
            sumSq += value * value;
            if (window.length > size) {
                const dropped = window.shift();
                sum -= dropped;
                sumSq -= dropped * dropped;
            }
        }

        if (window.length < 5) {
            points.push(null);
            continue;
        }
        const mean = sum / window.length;
        const sigma = Math.sqrt(Math.max(0, sumSq / window.length - mean * mean));
        const hit = Number.isFinite(records[i][REC.INDEX]) ? records[i][REC.INDEX] + 1 : i + 1;
        points.push({ hit, ur: sigma * 10, count: window.length });
    }

    return { points, isMs: useMs, window: size };
}

// ---------------------------------------------------------------------------
// One pass for the forensic dashboard
// ---------------------------------------------------------------------------

// Everything the new panels need, computed once and cached by the caller. The
// return map / ACF come from the shared helpers so the panels can never
// disagree with the charts they summarise.
function computeForensicMetrics(records) {
    const n = records.length;
    const isMs = forensicUsesMs(records);
    const values = forensicSeries(records).filter(value => Number.isFinite(value));
    if (values.length < 12) {
        return { n, values, isMs, distribution: null, lag1: null, hurst: null, dfa: null, spectrum: null, fatigue: null, returnAxes: null, acfCycle: null };
    }

    const pairs = buildReturnPairs(records);
    const acf = computeAutocorrelation(records, ACF_MAX_LAG);

    return {
        n,
        values,
        isMs,
        distribution: computeDistributionShape(values),
        lag1: computeLag1Compensation(records),
        hurst: computeHurstRS(values),
        dfa: computeDFA(values),
        spectrum: computeSpectrum(values),
        fatigue: computeComboFatigue(records),
        returnAxes: computeReturnAxes(pairs),
        acfCycle: computeAcfCycle(acf),
        acf,
        pairs
    };
}
