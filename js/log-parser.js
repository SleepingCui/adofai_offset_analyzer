// log-parser.js -- decoders that turn a timeshow .log into raw hit tuples:
// binary v1/v2, JSON (including truncated), and gzip.

// ---------------------------------------------------------------------------
// Log parsing
//
// Two on-disk shapes (TimingShow JSON and the TSMZ binary), one result:
//
//   {
//     header:      { songName, levelPath, timestamp, bpm, speed, pitch, isAngle,
//                    formatVersion, versionText, hitMarginVersion, judgeCodeVersion },
//     players:     [ { tuples, timeFirst }, ... ]   // index = playerId
//     playerCount: int,
//     truncated:   bool
//   }
//
// `players` is a list rather than a single stream because a multi-player log
// holds several independent runs of hits: hit numbering, "the previous hit" and
// every lag statistic only mean something inside one player's stream, so the
// players are kept apart all the way to the UI (see setActivePlayer).
//
// Both formats are appended to while the game plays, so a crash -- or reading
// the file while the game still holds it open -- leaves a half-written tail.
// Neither loader fails on that: each stops at the last complete record and
// reports `truncated`, because analysing everything up to the crash beats
// analysing nothing.
// ---------------------------------------------------------------------------

// Thrown by the readers below when a record runs past the end of the buffer. It
// travels as a value, not an Error: it means "the file ended here", not "the
// file is broken", and only the loader that owns the read loop catches it.
const TRUNCATED = Symbol('log-truncated');

const HIT_MARGIN_VERSIONS = { 1: 'Legacy', 2: 'Game34' };

// The binary header stores the hit margin table as a byte where JSON stores its
// name; both end up as the name, which is what isGame34Log() reads.
function hitMarginVersionText(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value || null;
    return HIT_MARGIN_VERSIONS[value] ?? 'Unknown';
}

function bitsToDouble(bits) {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setBigInt64(0, bits, true);
    return view.getFloat64(0, true);
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

// 1.8.2-: fixed-size records of a raw double and an int32 margin code, and no
// song time at all -- the first column is the offset itself, as in every format
// up to v4.
function parseV1(view, offset) {
    const dv = new DataView(view.buffer, view.byteOffset);
    const tuples = [];
    while (offset + 12 <= view.byteLength) {
        const timing = dv.getFloat64(offset, true);
        const marginCode = dv.getInt32(offset + 8, true);
        tuples.push([Math.round(timing * 10000) / 10000, marginCode]);
        offset += 12;
    }
    // v1 records are fixed width, so anything left over is a half-written one.
    return { tuples, truncated: offset !== view.byteLength };
}

// 1.9.0+: the offset as a running XOR against the previous record's bits, then
// a ZigZag varint margin code.
function parseV2(view, offset) {
    const dv = new DataView(view.buffer, view.byteOffset);
    const tuples = [];
    let prevTimingBits = 0n;

    const readZigZagVarInt = () => {
        let result = 0;
        let shift = 0;
        let bytesRead = 0;
        let byte;
        do {
            if (offset >= view.byteLength) throw TRUNCATED;
            byte = view[offset++];
            result += (byte & 0x7F) * Math.pow(2, shift);
            shift += 7;
            bytesRead++;
            if (bytesRead > 5) throw new Error('VarInt exceeds maximum 5 bytes');
        } while (byte & 0x80);
        return (result >>> 1) ^ -(result & 1);
    };

    try {
        while (offset < view.byteLength) {
            if (offset + 8 > view.byteLength) throw TRUNCATED;
            const xorBits = dv.getBigInt64(offset, true);
            offset += 8;

            const actualBits = xorBits ^ prevTimingBits;
            prevTimingBits = actualBits;
            const timing = bitsToDouble(actualBits);
            const marginCode = readZigZagVarInt();
            tuples.push([Math.round(timing * 10000) / 10000, marginCode]);
        }
    } catch (err) {
        if (err !== TRUNCATED) throw err;
        return { tuples, truncated: true };
    }
    return { tuples, truncated: false };
}

// Records of a v5+ TSMZ stream, grouped by the player they belong to.
//
// The two XOR chains are kept across the whole loop, including across players:
// they are the writer's history of the previous record's bit pattern, and a v8
// stream does not restart them per player. `hasPlayerId` is the v8 byte that
// leads each record; without it (v5..v7) every record is player 0's.
// `hasHitContext` is the v9 tail -- four float32 fields plus a floor-id varint
// -- that must be consumed in step or the next record starts at the wrong byte.
function parseBinaryRecords(view, offset, options) {
    const compactXor = options.compactXor;
    const hasPlayerId = options.hasPlayerId;
    const hasHitContext = options.hasHitContext;
    const dv = new DataView(view.buffer, view.byteOffset);
    const streams = [];
    let prevTimeBits = 0n;
    let prevValueBits = 0n;

    const readByte = () => {
        if (offset >= view.byteLength) throw TRUNCATED;
        return view[offset++];
    };

    const readFloat32 = () => {
        if (offset + 4 > view.byteLength) throw TRUNCATED;
        const value = dv.getFloat32(offset, true);
        offset += 4;
        return value;
    };

    const readZigZagVarInt = () => {
        let result = 0;
        let shift = 0;
        let byte;
        let count = 0;
        do {
            byte = readByte();
            result += (byte & 0x7F) * Math.pow(2, shift);
            shift += 7;
            count++;
            if (count > 5) throw new Error('v5 VarInt exceeds maximum 5 bytes');
        } while (byte & 0x80);
        return (result >>> 1) ^ -(result & 1);
    };

    const readXorBits = (previousBits) => {
        if (!compactXor) {
            if (offset + 8 > view.byteLength) throw TRUNCATED;
            const xorBits = dv.getBigInt64(offset, true);
            offset += 8;
            return xorBits ^ previousBits;
        }

        const control = readByte();
        if (control === 0) return previousBits;
        if ((control & 0x80) === 0) throw new Error('Invalid v7 double control byte');

        const leadingBytes = (control >>> 4) & 0x07;
        const significantBytes = control & 0x0F;
        if (significantBytes < 1 || significantBytes > 8 || leadingBytes + significantBytes > 8)
            throw new Error('Invalid v7 double byte range');

        const trailingBytes = 8 - leadingBytes - significantBytes;
        let xorBits = 0n;
        for (let i = 0; i < significantBytes; i++) {
            xorBits |= BigInt(readByte()) << BigInt(8 * (trailingBytes + i));
        }
        return xorBits ^ previousBits;
    };

    // Streams are created on demand, so a player id above the header's count
    // still lands somewhere instead of being dropped.
    const streamFor = (playerId) => {
        while (streams.length <= playerId) streams.push([]);
        return streams[playerId];
    };

    try {
        while (offset < view.byteLength) {
            const playerId = hasPlayerId ? readByte() : 0;
            const timeBits = readXorBits(prevTimeBits);
            prevTimeBits = timeBits;
            const valueBits = readXorBits(prevValueBits);
            prevValueBits = valueBits;

            const timeMs = bitsToDouble(timeBits);
            const value = bitsToDouble(valueBits);
            const rawMarginCode = readZigZagVarInt();
            const judgeCode = readZigZagVarInt();
            const isXP = readByte() !== 0;

            // v9 appends the hit context: angle, the floor's BPM/speed/pitch at
            // the moment of the hit, and the floor id. The tuple keeps the JSON
            // v8 column order so both loaders hand processOffsetRecords() the
            // same shape. Missing context is written as float NaN / -1.
            const angleDeg = hasHitContext ? readFloat32() : NaN;
            const hitBpm = hasHitContext ? readFloat32() : NaN;
            const hitSpeed = hasHitContext ? readFloat32() : NaN;
            const hitPitch = hasHitContext ? readFloat32() : NaN;
            const floorId = hasHitContext ? readZigZagVarInt() : -1;

            streamFor(playerId).push([
                Math.round(timeMs * 1000) / 1000,
                Math.round(value * 10000) / 10000,
                rawMarginCode,
                judgeCode,
                isXP,
                angleDeg,
                hitBpm,
                hitSpeed,
                hitPitch,
                floorId
            ]);
        }
    } catch (err) {
        if (err !== TRUNCATED) throw err;
        return { streams, truncated: true };
    }
    return { streams, truncated: false };
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

    let players = [];
    let playerCount = 1;
    let hitMarginVersion = null;
    let judgeCodeVersion = null;
    let truncated = false;

    if (version >= 5) {
        if (offset + 2 > view.byteLength) throw new Error('Missing v5 format metadata');
        hitMarginVersion = view[offset++];
        judgeCodeVersion = view[offset++];

        // v8 heads the file with the player total and leads every record with
        // the player it belongs to; v5..v7 hold a single player and say so with
        // neither. A header count of 0 is the writer's "unknown", read as one.
        let declaredPlayers = 1;
        if (version >= 8) {
            const declared = view[offset++];
            declaredPlayers = declared > 0 ? declared : 1;
        }

        // v9 appends the per-hit context (angle, hit BPM/speed/pitch, floor id)
        // to every record. It has to be consumed here even though no chart reads
        // it: otherwise those bytes become the next record's player id and the
        // whole stream misaligns.
        const records = parseBinaryRecords(view, offset, {
            compactXor: version >= 7,
            hasPlayerId: version >= 8,
            hasHitContext: version >= 9
        });
        truncated = records.truncated;

        // The header count wins over the ids actually seen, so a player who
        // never hit anything still gets a (empty) slot under their own number.
        playerCount = Math.max(declaredPlayers, records.streams.length, 1);
        players = [];
        for (let id = 0; id < playerCount; id++) {
            players.push({ tuples: records.streams[id] || [], timeFirst: true });
        }
    } else if (version === 1) {
        const records = parseV1(view, offset);
        truncated = records.truncated;
        players = [{ tuples: records.tuples, timeFirst: false }];
    } else if (version >= 2) {
        const records = parseV2(view, offset);
        truncated = records.truncated;
        players = [{ tuples: records.tuples, timeFirst: false }];
    } else {
        throw new Error(`Unsupported tlog version: ${version}`);
    }

    return {
        header: {
            songName: songName || '',
            levelPath: levelPath || '',
            timestamp: Number(timestamp),
            bpm,
            speed,
            pitch,
            versionText: version >= 5 ? `TimingShow binary v${version}` : (version === 1 ? '1.8.2- (v1)' : `1.9.0+ (v${version})`),
            isAngle: isAngle,
            hitMarginVersion: hitMarginVersionText(hitMarginVersion),
            judgeCodeVersion
        },
        players,
        playerCount,
        truncated
    };
}

// ---------------------------------------------------------------------------
// JSON logs
// ---------------------------------------------------------------------------

const OFFSETS_KEY_PREFIX = 'offsets_';

// The fields every TimingShow JSON log opens with, in the order it writes them.
// Seeing any of them is what tells a TimingShow log apart from some other
// JSON file that merely happens to parse.
const HEADER_FIELDS = [
    'songName', 'levelPath', 'timestamp', 'bpm', 'speed', 'pitch', 'isAngle',
    'formatVersion', 'hitMarginVersion', 'judgeCodeVersion'
];

// v7 files one array per player under `offsets_<N>`; the bare `offsets` of the
// older single-player logs is player 0. Both spellings can appear in one file.
function isOffsetsKey(key) {
    if (key === 'offsets') return true;
    if (!key.startsWith(OFFSETS_KEY_PREFIX)) return false;
    return /^\d+$/.test(key.slice(OFFSETS_KEY_PREFIX.length));
}

function offsetsKeyPlayerId(key) {
    if (key === 'offsets') return 0;
    const playerNumber = parseInt(key.slice(OFFSETS_KEY_PREFIX.length), 10);
    return playerNumber >= 1 ? playerNumber - 1 : 0;
}

// The oldest logs key the offsets by hit number, holding { v: value, j: margin }
// per hit instead of an array of tuples.
function isLegacyOffsetsObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function legacyOffsetsTuples(offsets) {
    return Object.keys(offsets)
        .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
        .map(key => [offsets[key].v, offsets[key].j]);
}

// Trims a half-written JSON log back to its last complete value and closes the
// containers left open, so the records the writer had already flushed can still
// be read. Returns null when there is no complete value to cut back to.
//
// The walk below tracks what the next significant character has to be, because
// only a position where a *value* ended is a safe cut: cutting after a key, or
// mid-number, would produce something that is not JSON at all.
function repairTruncatedJson(text) {
    const open = [];         // closers for the containers still open, innermost last
    let expect = 'value';    // 'value' | 'key' | 'colon' | 'comma'
    let lastEnd = -1;        // index just past the last complete value
    let lastOpen = null;     // `open` as it was at lastEnd
    let inString = false;
    let escaped = false;

    const markComplete = (end) => {
        lastEnd = end;
        lastOpen = open.slice();
    };

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') {
                inString = false;
                if (expect === 'key') expect = 'colon';
                else { expect = 'comma'; markComplete(i + 1); }
            }
            continue;
        }

        if (ch === '"') { inString = true; continue; }

        if (ch === '{' || ch === '[') {
            open.push(ch === '{' ? '}' : ']');
            expect = ch === '{' ? 'key' : 'value';
            continue;
        }

        if (ch === '}' || ch === ']') {
            open.pop();
            expect = 'comma';
            markComplete(i + 1);
            continue;
        }

        if (ch === ':') { expect = 'value'; continue; }
        if (ch === ',') { expect = open[open.length - 1] === '}' ? 'key' : 'value'; continue; }
        if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') continue;

        // Anything else starts a scalar (number, true, false, null). Its end is
        // only known from the delimiter that follows it.
        if (expect !== 'value') break;

        let end = i;
        while (end < text.length && !',:]}" \t\r\n'.includes(text[end])) end++;
        if (end === text.length) break;   // ran off the end mid-scalar
        expect = 'comma';
        markComplete(end);
        i = end - 1;
    }

    if (lastEnd < 0) return null;
    return text.slice(0, lastEnd) + lastOpen.reverse().join('');
}

// Reads a TimingShow JSON log: v8 (`offsets_1..N`, one array per player, ten
// columns per hit), v7 (same keys, five columns) and the older single-player
// layouts alike. Returns null when the file holds no offsets at all, which is
// what "not one of ours" looks like.
function readJsonLog(text) {
    const source = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    let parsed;
    let truncated = false;

    try {
        parsed = JSON.parse(source);
    } catch (err) {
        // A log read while the game is still writing it ends mid-value. The
        // repair keeps the records that did make it to disk; if there are none
        // to keep, the original error is the honest answer.
        const repaired = repairTruncatedJson(source);
        if (repaired === null) throw err;
        parsed = JSON.parse(repaired);
        truncated = true;
    }

    const players = [];
    let sawNumberedKey = false;
    Object.keys(parsed).forEach(key => {
        if (!isOffsetsKey(key)) return;
        const value = parsed[key];
        const playerId = offsetsKeyPlayerId(key);
        if (key !== 'offsets') sawNumberedKey = true;

        if (Array.isArray(value)) {
            // v7 entries are [timeMs, value, raw, judge, isXPerfect] and v8
            // appends [angle, bpm, speed, pitch, floorId]; v5 logs kept the
            // same five, and from v6 on the tuple leads with the song time.
            // Extra columns are read by processOffsetRecords(), not here.
            const timeFirst = key !== 'offsets' || Number(parsed.formatVersion) >= 6;
            players[playerId] = { tuples: value, timeFirst };
        } else if (isLegacyOffsetsObject(value)) {
            players[playerId] = { tuples: legacyOffsetsTuples(value), timeFirst: false };
        }
    });

    // A JSON log is written in two halves -- the header at session start, the
    // player arrays when it closes -- so a session that crashed before closing
    // is a header with no offsets at all. That is a truncated log, not a
    // foreign file: only a file with neither is one we cannot read.
    if (players.length === 0 && !HEADER_FIELDS.some(field => field in parsed)) return null;

    const formatVersion = Number.isFinite(Number(parsed.formatVersion)) ? Number(parsed.formatVersion) : null;
    let versionText = 'Legacy JSON array';

    if (sawNumberedKey || (formatVersion !== null && formatVersion >= 5)) {
        versionText = formatVersion === null ? 'TimingShow JSON' : `TimingShow JSON v${formatVersion}`;
    } else if (isLegacyOffsetsObject(parsed.offsets)) {
        versionText = 'Legacy JSON object';
    }

    return {
        header: {
            songName: parsed.songName,
            levelPath: parsed.levelPath,
            timestamp: parsed.timestamp,
            bpm: parsed.bpm ?? null,
            speed: parsed.speed ?? null,
            pitch: parsed.pitch ?? null,
            isAngle: parsed.isAngle === true,
            versionText,
            hitMarginVersion: hitMarginVersionText(parsed.hitMarginVersion),
            judgeCodeVersion: parsed.judgeCodeVersion || null
        },
        players,
        playerCount: players.length,
        truncated
    };
}

// Unwraps a gzipped binary log, and says whether the stream it came from was
// finished.
//
// A log read while the game is still writing it ends in a half-flushed deflate
// block, and pako's one-shot ungzip answers that with `undefined` rather than an
// error -- it throws only for bytes that are genuinely wrong, and it verifies
// the gzip trailer (CRC and length) itself, so nothing here needs to. The
// streaming inflator keeps what it did decode, so the run so far stays readable
// and the caller marks it truncated.
function gunzipLog(bytes) {
    const oneShot = pako.ungzip(bytes);
    if (oneShot) return { bytes: oneShot, truncated: false };

    const inflator = new pako.Inflate();
    inflator.push(bytes, true);

    // pako only hands an output buffer over as a chunk once it is full. The
    // rest -- everything written since the last full buffer -- is handed over
    // when the stream *ends*, which is the part that never arrived; it is still
    // sitting in the inflator's own output buffer.
    const pieces = (inflator.chunks || []).slice();
    const buffer = inflator.strm;
    if (buffer && buffer.next_out > 0) pieces.push(buffer.output.subarray(0, buffer.next_out));

    const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
    if (total === 0) {
        // The deflate block boundary landed inside the missing tail, so there
        // is nothing to read. Better a plain failure than half a record.
        throw new Error(inflator.err ? String(inflator.err) : 'gzip stream is incomplete');
    }

    const inflated = new Uint8Array(total);
    let at = 0;
    pieces.forEach(piece => { inflated.set(piece, at); at += piece.length; });
    return { bytes: inflated, truncated: true };
}
