(function (global) {
    "use strict";

    const KEY_STORAGE_KEY = "qwerty";
    const IV_STORAGE_KEY = "potato";

    async function deriveKeyAndIv() {
        const enc = new TextEncoder();
        const keyBuf = await crypto.subtle.digest("SHA-256", enc.encode(KEY_STORAGE_KEY));
        const ivBuf = await crypto.subtle.digest("SHA-256", enc.encode(IV_STORAGE_KEY));
        return {
            keyBytes: new Uint8Array(keyBuf).slice(0, 32),
            ivBytes: new Uint8Array(ivBuf).slice(0, 16)
        };
    }

    function unpadPkcs7(data) {
        const pad = data[data.length - 1];
        if (pad < 1 || pad > 16) return data;
        for (let i = data.length - pad; i < data.length; i++) {
            if (data[i] !== pad) return data;
        }
        return data.slice(0, data.length - pad);
    }

    class BinaryReader {
        constructor(buffer) {
            this.view = new DataView(buffer);
            this.offset = 0;
        }

        readInt32() {
            const val = this.view.getInt32(this.offset, true);
            this.offset += 4;
            return val;
        }

        readBoolean() {
            const val = this.view.getUint8(this.offset) !== 0;
            this.offset += 1;
            return val;
        }

        readUShort() {
            const val = this.view.getUint16(this.offset, true);
            this.offset += 2;
            return val;
        }

        readDouble() {
            const val = this.view.getFloat64(this.offset, true);
            this.offset += 8;
            return val;
        }

        readFloat() {
            const val = this.view.getFloat32(this.offset, true);
            this.offset += 4;
            return val;
        }

        readByte() {
            const val = this.view.getUint8(this.offset);
            this.offset += 1;
            return val;
        }

        readString() {
            let length = 0, shift = 0;
            while (true) {
                const b = this.readByte();
                length |= (b & 0x7F) << shift;
                if ((b & 0x80) === 0) break;
                shift += 7;
            }
            const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length);
            this.offset += length;
            return new TextDecoder().decode(bytes);
        }

        readStringDict() {
            const count = this.readInt32();
            const dict = {};
            for (let i = 0; i < count; i++) {
                dict[this.readString()] = this.readString();
            }
            return dict;
        }

        readBoolDict() {
            const count = this.readInt32();
            const dict = {};
            for (let i = 0; i < count; i++) {
                dict[this.readString()] = this.readBoolean();
            }
            return dict;
        }

        readIntDict() {
            const count = this.readInt32();
            const dict = {};
            for (let i = 0; i < count; i++) {
                dict[this.readString()] = this.readInt32();
            }
            return dict;
        }

        readDoubleDict() {
            const count = this.readInt32();
            const dict = {};
            for (let i = 0; i < count; i++) {
                dict[this.readString()] = this.readDouble();
            }
            return dict;
        }

        readList(fn) {
            const count = this.readInt32();
            const list = [];
            for (let i = 0; i < count; i++) {
                list.push(fn.call(this));
            }
            return list;
        }

        isDone() {
            return this.offset >= this.view.byteLength;
        }
    }

    function parseCreplay(buffer) {
        const r = new BinaryReader(buffer);

        const formatVersion = r.readInt32();
        const s = r.readStringDict();
        const b = r.readBoolDict();
        const i = r.readIntDict();
        const d = r.readDoubleDict();
        const keyCodes = r.readList(r.readUShort);
        const keyPresses = r.readList(r.readInt32);
        const keySongPositions = r.readList(r.readDouble);
        const hitCurrentFloorIDs = r.readList(r.readInt32);
        const hitCurrAngles = r.readList(r.readDouble);
        const hitOverloadCounters = r.readList(r.readFloat);
        const hitCachedAngles = r.readList(r.readDouble);
        const hitTargetExitAngles = r.readList(r.readDouble);
        const hitCurFreeRoamSections = r.readList(r.readInt32);
        const hitFlags = r.readList(r.readByte);

        const n = hitCurrentFloorIDs.length;
        const hitNoFailHits = [];
        const hitIsAutos = [];
        const hitNextFloorAutos = [];
        const hitMidspinInfiniteMargins = [];
        const hitRDCautos = [];

        for (let k = 0; k < n; k++) {
            const f = hitFlags[k];
            hitNoFailHits.push(f & 1 ? 1 : 0);
            hitIsAutos.push(f & 2 ? 1 : 0);
            hitNextFloorAutos.push(f & 4 ? 1 : 0);
            hitMidspinInfiniteMargins.push(f & 8 ? 1 : 0);
            hitRDCautos.push(f & 16 ? 1 : 0);
        }

        return {
            FormatVersion: formatVersion,
            CompactCreplayfile: {
                s, b, i, d,
                keyCodes,
                keyPresses,
                keySongPositions,
                hitCurrentFloorIDs,
                hitCurrAngles,
                hitOverloadCounters,
                hitNoFailHits,
                hitIsAutos,
                hitNextFloorAutos,
                hitCachedAngles,
                hitTargetExitAngles,
                hitMidspinInfiniteMargins,
                hitRDCautos,
                hitCurFreeRoamSections
            }
        };
    }


    async function decryptCrp2(arrayBuffer) {
        const data = new Uint8Array(arrayBuffer);
        if (data.length < 8) throw new Error("File too short");

        const magic = String.fromCharCode(...data.slice(0, 4));
        if (magic !== "CRP2") throw new Error(`Not a CRP2 format: "${magic}"`);

        const ciphertext = data.slice(8);
        const { keyBytes, ivBytes } = await deriveKeyAndIv();
        const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, "AES-CBC", false, ["decrypt"]);
        const plaintext = await crypto.subtle.decrypt({ name: "AES-CBC", iv: ivBytes }, cryptoKey, ciphertext);

        return parseCreplay(unpadPkcs7(new Uint8Array(plaintext)).buffer);
    }


    function angleToOffsetMs(angle, bpm) {
        return bpm && bpm > 0 ? angle * (60000 / (bpm * 2 * Math.PI)) : 0;
    }

    function convertToTimingshow(data, filename) {
        const cr = data.CompactCreplayfile || data;
        const s = cr.s || {};
        const d = cr.d || {};
        const angles = cr.hitCurrAngles || [];
        const bpm = d.bpm || 100;

        let timestamp = 0;
        try {
            const parts = filename.split("___");
            if (parts.length >= 2 && /^\d+$/.test(parts[0])) {
                timestamp = parseInt(parts[0]);
            }
        } catch (e) {}
        timestamp = timestamp || Date.now();

        const offsets = angles.map(a => [
            parseFloat(angleToOffsetMs(a, bpm).toFixed(4)),
            3
        ]);

        const json = JSON.stringify({
            songName: s.song_name || "Unknown",
            levelPath: s.level_path || "",
            timestamp: timestamp,
            version: 2,
            offsets: offsets
        }, null, 2);

        return {
            json: json,
            meta: {
                songName: s.song_name || "Unknown",
                bpm: bpm,
                count: offsets.length
            }
        };
    }

    /**
     * 统一入口：根据文件内容自动识别 CRP2 二进制或 JSON 并转换为 timingshow 格式。
     * @param {ArrayBuffer} arrayBuffer 文件内容
     * @param {string} filename 文件名（用于解析时间戳）
     * @returns {Promise<{json: string, meta: object}>}
     */
    async function toTimingshow(arrayBuffer, filename) {
        let parsedData;
        if (arrayBuffer.byteLength >= 4 &&
            String.fromCharCode(...new Uint8Array(arrayBuffer.slice(0, 4))) === "CRP2") {
            parsedData = await decryptCrp2(arrayBuffer);
        } else {
            parsedData = JSON.parse(new TextDecoder().decode(arrayBuffer));
        }
        return convertToTimingshow(parsedData, filename);
    }

    global.Crpl2 = {
        decryptCrp2,
        parseCreplay,
        convertToTimingshow,
        toTimingshow
    };
})(window);
