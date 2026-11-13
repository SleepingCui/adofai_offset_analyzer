// data.js -- the per-hit record model, the ms/degree conversion, and the
// active range (selection) every chart reads through.

// A tuple column that may be absent (older logs) or null (the JSON writer's
// "unknown"), read as a number. NaN counts as unknown too: binary logs store
// missing hit context as float NaN.
function optionalTupleNumber(item, index) {
    if (item.length <= index || item[index] == null) return null;
    const number = Number(item[index]);
    return Number.isFinite(number) ? number : null;
}

// Angle in degrees <-> timing in milliseconds. The log stores one or the other
// depending on its isAngle flag; the BPM has to be the floor's at the moment of
// the hit (already multiplied by speed and pitch), which is why a per-hit BPM
// is what makes the two units interchangeable.
function angleToMs(angleDeg, bpm) {
    return angleDeg * 60000 / (180 * bpm);
}

function msToAngle(offsetMs, bpm) {
    return offsetMs * 180 * bpm / 60000;
}

// True when all three factors of an effective BPM are usable. The writer emits
// them together, and when any is missing the whole context is unknown.
function hasUsableHitParams(bpm, speed, pitch) {
    return bpm > 0 && speed > 0 && pitch > 0;
}

// Raw parse tuples to records, `timeFirst` telling which column is which: logs
// from binary v5 and JSON v6 on lead with the song time, everything older --
// and CRPL2 -- carries the offset alone.
//
// options.isAngle  the log stores degrees rather than milliseconds
// options.unit     which one the VALUE column should carry: 'ms' or 'deg'
//
// Both are derivable once the v8/v9 hit context exists; without it only the
// log's native unit is available, and the other column stays null.
function processOffsetRecords(offsets, timeFirst, options = {}) {
    const isAngle = options.isAngle === true;
    const unit = options.unit === 'deg' ? 'deg' : 'ms';

    return offsets.map((item, index) => {
        const timeMs = timeFirst && item[0] != null ? Number(item[0]) : null;
        const valueIndex = timeFirst ? 1 : 0;
        const rawIndex = timeFirst ? 2 : 1;
        const judgeIndex = timeFirst ? 3 : 2;
        const xpIndex = timeFirst ? 4 : 3;
        const native = Number(item[valueIndex]);
        const rawCode = item.length > rawIndex && item[rawIndex] != null ? Number(item[rawIndex]) : null;
        const hasJudgeCode = item.length > judgeIndex && item[judgeIndex] != null;
        const judgeCode = hasJudgeCode ? Number(item[judgeIndex]) : normalizeLegacyJudgeCode(rawCode);
        const isXP = item.length > xpIndex && Boolean(item[xpIndex]);
        // Formats from v6 on carry the XPerfect verdict in a column of their own
        // instead of borrowing a judge code the way older logs did (that is what
        // normalizeLegacyJudgeCode maps raw 12 to XPerfect for). Fold it back into
        // the judge code so every chart keeps reading one semantic set: without
        // this, Legacy logs -- which have no native XPerfect judge code -- keep
        // reporting those hits as plain Perfect and the flag is silently ignored.
        const semanticJudge = isXP && isPerfectFamilyCode(judgeCode) ? 4 : judgeCode;
        // JSON v8 / binary v9 append the hit context after isXPerfect:
        // angleDeg, hitBpm, hitSpeed, hitPitch, floorId. Older logs stop at
        // isXPerfect, so every column below is optional.
        const contextIndex = xpIndex + 1;
        const contextAngle = optionalTupleNumber(item, contextIndex);
        const hitBpm = optionalTupleNumber(item, contextIndex + 1);
        const hitSpeed = optionalTupleNumber(item, contextIndex + 2);
        const hitPitch = optionalTupleNumber(item, contextIndex + 3);
        const floorId = optionalTupleNumber(item, contextIndex + 4);
        // JSON v11 / binary v11 append the floor's judgment-window multiplier;
        // older hits stop at the floor id, so this is optional like the rest.
        const marginScale = optionalTupleNumber(item, contextIndex + 5);

        const paramsValid = hasUsableHitParams(hitBpm, hitSpeed, hitPitch);
        const effectiveBpm = paramsValid ? hitBpm * hitSpeed * hitPitch : null;

        // The native angle: for angle logs the stored value already is one (and
        // is the more precise copy); for timing logs it comes from the context.
        let angleDeg = isAngle && Number.isFinite(native) ? native : contextAngle;
        let offsetMs = !isAngle && Number.isFinite(native) ? native : null;

        if (angleDeg !== null && offsetMs === null && effectiveBpm !== null) {
            offsetMs = angleToMs(angleDeg, effectiveBpm);
        }
        if (offsetMs !== null && angleDeg === null && effectiveBpm !== null) {
            angleDeg = msToAngle(offsetMs, effectiveBpm);
        }

        let value = native;
        if (unit === 'ms' && offsetMs !== null) value = offsetMs;
        else if (unit === 'deg' && angleDeg !== null) value = angleDeg;

        return [
            value,
            semanticJudge,
            rawCode,
            isXP,
            index,
            Number.isFinite(timeMs) && timeMs >= 0 ? timeMs : null,
            angleDeg,
            hitBpm,
            hitSpeed,
            hitPitch,
            floorId === null ? -1 : floorId,
            offsetMs,
            native,
            marginScale
        ];
    });
}

// Named columns of a record, so analysis code reads as data instead of as array
// arithmetic. A record is built in processOffsetRecords() above and every
// column is always present, so REC.INDEX and REC.TIME are safe to compare
// against without a length check. ANGLE..MARGIN are the v8/v9/v11 hit context
// and are null (floor -1) when the log predates it; MS and NATIVE are derived,
// and MS is null when the angle cannot be converted (no per-hit BPM).
const REC = {
    VALUE: 0, JUDGE: 1, RAW: 2, XP: 3, INDEX: 4, TIME: 5,
    ANGLE: 6, BPM: 7, SPEED: 8, PITCH: 9, FLOOR: 10,
    MS: 11, NATIVE: 12, MARGIN: 13
};

// The multiplier the game applied to this floor's judgment windows. A log that
// predates the column, and a hit the writer stored without a usable value, both
// mean the untouched window: 1x.
function recordMarginScale(item) {
    const scale = item[REC.MARGIN];
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

// The margin scale the run used most, for the places that describe a whole log
// in one number -- the metadata panel and the unsegmented judgment bands. Logs
// that never touch the scale resolve to 1 by construction.
function dominantMarginScale(records) {
    const counts = new Map();
    let best = 1;
    let bestCount = 0;

    records.forEach(item => {
        const scale = recordMarginScale(item);
        const key = Math.round(scale * 1000) / 1000;
        const count = (counts.get(key) || 0) + 1;
        counts.set(key, count);
        if (count > bestCount) {
            best = key;
            bestCount = count;
        }
    });

    return best;
}

// ---------------------------------------------------------------------------
// Active selection
//
// The one place the page records which part of the run is under analysis.
// activeRange is an inclusive span of *hit numbers* -- the value in REC.INDEX,
// never an array position -- so a range means the same thing whichever control
// produced it, and "Hit 12000-12500" still means those hits after a second
// range is picked on top of it.
//
// Records keep travelling as the same tuples globalOffsets holds, because every
// analysis helper in this file takes that shape (createHistogramData,
// computeRollingStats, buildReturnPairs, computePerfectRuns). Analysis code
// that wants to be range-aware reads getActiveRecords() and gets tuples back,
// so one implementation serves both the whole run and a slice of it.
//
// Nothing consumes the range yet: the charts predate this layer and still read
// globalOffsets directly. They migrate one at a time. A chart the user draws the
// selection *on* -- the scatter plot -- must stay on the whole run and draw the
// range as an overlay, otherwise brushing collapses the very chart being
// brushed; see `consumesRange` on CHART_SECTIONS.
// ---------------------------------------------------------------------------
let activeRange = null;        // null = whole run, { start, end } = inclusive hit numbers
let selectionVersion = 0;      // bumped whenever activeRange or globalOffsets changes
let activeRecordsCache = null; // { version, records, values }: derived data for one version
let selectionRenderPending = false; // a frame is already booked for the charts

// Every change to the selection or to globalOffsets goes through here, so the
// memo above can never outlive the data it was built from. Both assignment
// sites for globalOffsets -- clearData() and LoadFile() -- call it.
function invalidateSelection() {
    selectionVersion++;
    activeRecordsCache = null;
}

function getActiveRange() {
    return activeRange;
}

// Inclusive end, so the count is not off by one: 12000-12500 is 501 hits.
// Counted from the records rather than from the range bounds, so the count can
// never disagree with what getActiveRecords() hands back -- and the whole-run
// case costs nothing, since that is globalOffsets itself.
function getActiveCount() {
    return getActiveRecords().length;
}

// The data entry point for every range-aware module.
function getActiveRecords() {
    const cached = activeRecordsCache;
    if (cached && cached.version === selectionVersion) return cached.records;

    // REC.INDEX is the record's position in globalOffsets by construction (see
    // processOffsetRecords), so a span of hit numbers is always a contiguous
    // slice: no scan, and no per-record copy -- the whole-run case hands back
    // globalOffsets itself.
    const records = activeRange
        ? globalOffsets.slice(activeRange.start, activeRange.end + 1)
        : globalOffsets;

    activeRecordsCache = { version: selectionVersion, records, values: null };
    return records;
}

// Flat numbers for the active selection. Deliberately not called
// getActiveOffsets(): throughout this file "offsets" is the tuple array (see
// the parameter of processOffsetRecords, createHistogramData,
// computeRollingStats, buildReturnPairs), and a function of that name returning
// plain numbers would break the next caller silently.
function getActiveValues() {
    const records = getActiveRecords();
    if (activeRecordsCache.values) return activeRecordsCache.values;

    activeRecordsCache.values = records.map(item => item[REC.VALUE]);
    return activeRecordsCache.values;
}

// The single write point for the selection: a brush on the scatter plot, a click
// on the timeline and a "whole song" button all land here, so clamping and
// fan-out cannot drift apart between them.
//
// `preview: true` is for a drag in flight. Coalescing to a frame is not enough
// on its own -- a preview would still re-run every range-aware analysis once per
// frame, each one a full pass over tens of thousands of hits -- so a preview
// moves the selection and leaves the charts to the commit that follows the
// pointer release, while the caller draws its own cheap live feedback (the
// dragged box, a running hit count).
function setActiveRange(start, end, options) {
    const last = globalOffsets.length - 1;
    let from = Math.round(Number(start));
    let to = Math.round(Number(end));

    // Nothing to select against, or a range that is not two numbers.
    if (last < 0 || !Number.isFinite(from) || !Number.isFinite(to)) {
        clearActiveRange();
        return;
    }

    if (from > to) [from, to] = [to, from];
    activeRange = {
        start: Math.max(0, Math.min(from, last)),
        end: Math.max(0, Math.min(to, last))
    };
    invalidateSelection();

    // A range equal to the one already selected still asks for a re-render: a
    // drag commits with the span it was previewing, and skipping that render
    // would leave the charts a frame behind the selection.
    if (!(options && options.preview)) scheduleSelectionRender();
}

function clearActiveRange() {
    const hadRange = activeRange !== null;
    activeRange = null;
    invalidateSelection();

    if (hadRange) scheduleSelectionRender();
}

// Range-aware charts re-render at most once per frame, and only the ones on
// screen, so a drag that moves the selection sixty times a second still costs one
// analysis pass per frame instead of sixty. The selection summary belongs in the
// same frame, next to the render pass.
function scheduleSelectionRender() {
    if (selectionRenderPending) return;

    // The mark is raised before the frame is asked for and lowered by the
    // callback itself. Storing the handle instead would make the coalescing
    // depend on requestAnimationFrame being asynchronous: a synchronous one (as
    // in the test harness) would let the callback clear the handle and then have
    // the assignment put it straight back, and the fan-out would stop for good
    // without ever failing loudly.
    selectionRenderPending = true;

    requestAnimationFrame(() => {
        selectionRenderPending = false;
        CHART_SECTIONS.forEach(entry => {
            if (entry.consumesRange && entry.visible) entry.render();
        });
    });
}

function hasTimelineData() {
    return globalOffsets.some(item => Number.isFinite(item[REC.TIME]) && item[REC.TIME] >= 0);
}

// Hit numbers come from REC.INDEX, never from the array position: under a
// selection the array begins at the first selected hit, and renumbering from
// there would put the axis, the selection summary and the timeline on three
// different numbering schemes for the same hit.
function getRecordHitNumber(item, index) {
    return Number.isFinite(item[REC.INDEX]) ? item[REC.INDEX] + 1 : index + 1;
}

function getRecordX(item, index) {
    return Number.isFinite(item[REC.TIME]) && item[REC.TIME] >= 0
        ? item[REC.TIME]
        : getRecordHitNumber(item, index);
}

function getChartX(item, index, useHitAxis) {
    return useHitAxis ? getRecordHitNumber(item, index) : getRecordX(item, index);
}
