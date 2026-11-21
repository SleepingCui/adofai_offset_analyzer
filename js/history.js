// history.js -- the left history rail. Metadata (one compact record per run)
// lives in localStorage under the key the old in-page table used, so existing
// entries survive the move. The log bytes themselves live in IndexedDB, which
// is what makes "re-analyse this file" possible without asking for it again.

const HISTORY_STORAGE_KEY = 'adofai-timing-history-v1';
const HISTORY_DB_NAME = 'adofai-offset-analyzer-db';
const HISTORY_DB_VERSION = 1;
const HISTORY_FILE_STORE = 'files';

let activeHistoryId = null;
let historyDbPromise = null;
let historyStoring = new Set();
let historyOpening = false;

function createHistoryId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
    }
    return 'h-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function normalizeHistoryEntry(entry, index) {
    const source = entry && (entry.source === 'import' || entry.source === 'server' || entry.source === 'legacy')
        ? entry.source
        : 'legacy';
    return Object.assign({}, entry, {
        id: (entry && entry.id) || ('legacy-' + (entry && entry.at ? entry.at : '0') + '-' + index),
        source,
        fileStored: !!(entry && entry.fileStored),
        size: Number(entry && entry.size) || 0
    });
}

function readHistoryEntries() {
    try {
        const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter(entry => entry && entry.at)
            .map(normalizeHistoryEntry);
    } catch (err) {
        return [];
    }
}

function writeHistoryEntries(entries) {
    const limit = Math.max(1, Number(appSettings.historyLimit) || 50);
    const kept = entries.slice(0, limit);
    try {
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(kept));
    } catch (err) {
        // Quota / private mode: the sidebar still shows this page's entry until
        // the next reload, but nothing else can be done here.
    }
    return kept;
}

function openHistoryDb() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB unavailable'));
    if (historyDbPromise) return historyDbPromise;
    historyDbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(HISTORY_DB_NAME, HISTORY_DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(HISTORY_FILE_STORE)) {
                db.createObjectStore(HISTORY_FILE_STORE, { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
            historyDbPromise = null;
            reject(request.error || new Error('IndexedDB open failed'));
        };
        request.onblocked = () => {
            // Another tab is holding an older version open. Reject so the
            // caller falls back to metadata-only history instead of waiting
            // forever in the "saving" state.
            historyDbPromise = null;
            reject(new Error('IndexedDB open blocked by another tab'));
        };
    });
    return historyDbPromise;
}

async function putHistoryFile(id, file) {
    const db = await openHistoryDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(HISTORY_FILE_STORE, 'readwrite');
        tx.objectStore(HISTORY_FILE_STORE).put({
            id,
            blob: file,
            name: file.name || '',
            type: file.type || '',
            size: Number(file.size) || 0,
            savedAt: Date.now()
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted'));
    });
}

async function getHistoryFile(id) {
    const db = await openHistoryDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(HISTORY_FILE_STORE, 'readonly');
        const request = tx.objectStore(HISTORY_FILE_STORE).get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error('IndexedDB read failed'));
    });
}

async function deleteHistoryFile(id) {
    try {
        const db = await openHistoryDb();
        await new Promise(resolve => {
            const tx = db.transaction(HISTORY_FILE_STORE, 'readwrite');
            tx.objectStore(HISTORY_FILE_STORE).delete(id);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        });
    } catch (err) {
        // A missing database means there is nothing to delete.
    }
}

async function clearHistoryFiles() {
    try {
        const db = await openHistoryDb();
        await new Promise(resolve => {
            const tx = db.transaction(HISTORY_FILE_STORE, 'readwrite');
            tx.objectStore(HISTORY_FILE_STORE).clear();
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        });
    } catch (err) {
        // No database yet: nothing to clear.
    }
    if (typeof updateStorageSummary === 'function') updateStorageSummary();
}

function getHistoryEntry(id) {
    return readHistoryEntries().find(entry => entry.id === id) || null;
}

function updateHistoryEntry(id, patch) {
    const entries = readHistoryEntries();
    const index = entries.findIndex(entry => entry.id === id);
    if (index < 0) return false;
    entries[index] = Object.assign({}, entries[index], patch);
    writeHistoryEntries(entries);
    return true;
}

function setActiveHistoryId(id) {
    activeHistoryId = id || null;
    renderHistorySidebar();
}

function recordHistoryEntry(file, options) {
    const opts = options || {};
    if (appSettings.historyEnabled === false) {
        return;
    }

    const records = typeof getForensicRecords === 'function'
        ? getForensicRecords()
        : (globalOffsets || []);
    if (!records || records.length === 0) return;

    const metrics = typeof getForensicMetrics === 'function' ? getForensicMetrics() : null;
    const acf = metrics && Array.isArray(metrics.acf) ? metrics.acf : [];
    const lag1 = acf.find(item => item.lag === 1);
    const entries = readHistoryEntries();
    const existingIndex = opts.historyId
        ? entries.findIndex(entry => entry.id === opts.historyId)
        : -1;
    const existing = existingIndex >= 0 ? entries[existingIndex] : null;
    const id = opts.historyId || createHistoryId();
    const source = opts.source || (existing && existing.source) || 'import';

    const payload = {
        id,
        at: existing ? existing.at : Date.now(),
        lastOpenedAt: Date.now(),
        source: source === 'server' ? 'server' : (source === 'legacy' ? 'legacy' : 'import'),
        song: (currentMetaData && (currentMetaData.songName || currentMetaData.levelPath))
            || currentLogFileName || '—',
        file: (file && file.name) || currentLogFileName || '',
        hits: metrics && Number.isFinite(metrics.n) ? metrics.n : records.length,
        ur: metrics && metrics.isMs && metrics.distribution
            ? metrics.distribution.sigma * 10
            : null,
        lag1: lag1 && Number.isFinite(lag1.r) ? lag1.r : null,
        hurst: metrics && metrics.hurst ? metrics.hurst.h : null,
        dfa: metrics && metrics.dfa ? metrics.dfa.alpha : null
    };

    let entry;
    if (existing) {
        entry = Object.assign({}, existing, payload, {
            fileStored: existing.fileStored === true,
            size: existing.size || 0
        });
        entries[existingIndex] = entry;
    } else {
        entry = Object.assign({}, payload, { fileStored: false, size: 0 });
        entries.unshift(entry);
    }

    const limit = Math.max(1, Number(appSettings.historyLimit) || 50);
    const dropped = entries.splice(limit);
    dropped.forEach(item => { void deleteHistoryFile(item.id); });
    writeHistoryEntries(entries);
    activeHistoryId = id;
    renderHistorySidebar();

    if (appSettings.storeHistoryFiles !== false && file) {
        historyStoring.add(id);
        renderHistorySidebar();
        putHistoryFile(id, file)
            .then(() => {
                updateHistoryEntry(id, {
                    fileStored: true,
                    size: Number(file.size) || 0,
                    file: file.name || entry.file
                });
            })
            .catch(err => {
                console.warn('History file copy was not stored:', err);
            })
            .finally(() => {
                historyStoring.delete(id);
                renderHistorySidebar();
                if (typeof updateStorageSummary === 'function') updateStorageSummary();
            });
    }
}

function enforceHistoryLimit() {
    const entries = readHistoryEntries();
    const limit = Math.max(1, Number(appSettings.historyLimit) || 50);
    if (entries.length <= limit) return;
    const dropped = entries.splice(limit);
    dropped.forEach(entry => { void deleteHistoryFile(entry.id); });
    writeHistoryEntries(entries);
    renderHistorySidebar();
}

function clearHistoryEntries() {
    try {
        localStorage.removeItem(HISTORY_STORAGE_KEY);
    } catch (err) {
        // Nothing to clear if storage is unavailable.
    }
    activeHistoryId = null;
    void clearHistoryFiles();
    renderHistorySidebar();
    if (typeof updateStorageSummary === 'function') updateStorageSummary();
}

async function clearStoredHistoryFiles() {
    await clearHistoryFiles();
    const entries = readHistoryEntries();
    entries.forEach(entry => {
        entry.fileStored = false;
        entry.size = 0;
    });
    writeHistoryEntries(entries);
    renderHistorySidebar();
    if (typeof updateStorageSummary === 'function') updateStorageSummary();
}

async function openHistoryEntry(id) {
    if (historyOpening) return;
    const entry = getHistoryEntry(id);
    if (!entry) return;
    if (!entry.fileStored) {
        alert(t('historyNoFileHint'));
        return;
    }

    historyOpening = true;
    try {
        const record = await getHistoryFile(id);
        if (!record || !record.blob) {
            updateHistoryEntry(id, { fileStored: false, size: 0 });
            renderHistorySidebar();
            alert(t('historyNoFileHint'));
            return;
        }
        const fileName = record.name || entry.file || 'timingshow.log';
        const file = new File([record.blob], fileName, {
            type: record.type || record.blob.type || 'application/octet-stream',
            lastModified: record.savedAt || Date.now()
        });
        const loaded = await LoadFile(file, {
            source: entry.source === 'server' ? 'server' : 'import',
            historyId: id
        });
        if (loaded === false) return;
        activeHistoryId = id;
        renderHistorySidebar();
        if (window.matchMedia('(max-width: 1100px)').matches) {
            setHistoryRailOpen(false, false);
        }
    } catch (err) {
        console.error('Could not reopen history entry:', err);
        alert(t('historyLoadFailed') + '\n' + err.message);
    } finally {
        historyOpening = false;
    }
}

function historySourceKey(source) {
    if (source === 'server') return 'historySourceServer';
    if (source === 'legacy') return 'historySourceLegacy';
    return 'historySourceImport';
}

function historySourceClass(source) {
    if (source === 'server') return 'source-server';
    if (source === 'legacy') return 'source-legacy';
    return 'source-import';
}

function emptyElement(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
}

function renderHistorySidebar() {
    const list = document.getElementById('historyList');
    const empty = document.getElementById('historyEmpty');
    const count = document.getElementById('historyCount');
    const storage = document.getElementById('historyStorage');
    if (!list) return;

    const entries = readHistoryEntries();
    if (empty) empty.hidden = entries.length > 0;
    if (count) {
        count.textContent = t('historyCount')
            .replace('{count}', String(entries.length))
            .replace('{limit}', String(appSettings.historyLimit));
    }

    list.innerHTML = '';
    entries.forEach(entry => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'history-card';
        card.dataset.historyId = entry.id;
        if (entry.id === activeHistoryId) card.classList.add('is-active');
        if (!entry.fileStored) card.classList.add('has-no-file');
        card.disabled = !entry.fileStored;
        card.setAttribute('aria-current', entry.id === activeHistoryId ? 'true' : 'false');
        card.title = entry.fileStored ? t('historyOpen') : t('historyNoFileHint');

        const top = emptyElement('div', 'history-card-top');
        top.appendChild(emptyElement('span', 'history-source ' + historySourceClass(entry.source), t(historySourceKey(entry.source))));
        top.appendChild(emptyElement('span', 'history-card-date', new Date(entry.at).toLocaleString()));
        card.appendChild(top);

        const name = emptyElement('div', 'history-card-name', entry.file || entry.song || '—');
        name.title = entry.file || entry.song || '';
        card.appendChild(name);

        if (entry.song && entry.song !== entry.file) {
            card.appendChild(emptyElement('div', 'history-card-song', entry.song));
        }

        const stats = emptyElement('div', 'history-card-stats');
        stats.appendChild(emptyElement('span', '', 'UR ' + (Number.isFinite(entry.ur) ? entry.ur.toFixed(2) : '—')));
        stats.appendChild(emptyElement('span', '', t('historyHits') + ' ' + (Number.isFinite(entry.hits) ? entry.hits.toLocaleString() : '—')));
        if (entry.dfa !== null && Number.isFinite(entry.dfa)) {
            stats.appendChild(emptyElement('span', '', 'DFA ' + entry.dfa.toFixed(3)));
        }
        card.appendChild(stats);

        const state = emptyElement('div', 'history-card-state');
        if (entry.id === activeHistoryId) {
            state.textContent = t('historyCurrent');
            state.classList.add('is-current');
        } else if (historyStoring.has(entry.id)) {
            state.textContent = t('historySaving');
        } else if (!entry.fileStored) {
            state.textContent = t('historyNoFile');
        } else {
            state.textContent = t('historyOpen');
        }
        card.appendChild(state);

        list.appendChild(card);
    });

    if (storage) {
        const copies = entries.filter(entry => entry.fileStored);
        const bytes = copies.reduce((sum, entry) => sum + (Number(entry.size) || 0), 0);
        storage.textContent = t('historyStorageSummary')
            .replace('{count}', String(copies.length))
            .replace('{size}', formatStorageBytes(bytes));
    }

    if (typeof renderCompareHistoryOptions === 'function') {
        renderCompareHistoryOptions();
    }
}

function initializeHistoryUi() {
    const list = document.getElementById('historyList');
    if (list) {
        list.addEventListener('click', event => {
            const card = event.target.closest('[data-history-id]');
            if (!card || card.disabled) return;
            openHistoryEntry(card.dataset.historyId);
        });
    }

    document.getElementById('historyClear')?.addEventListener('click', () => {
        if (!confirm(t('historyClearConfirm'))) return;
        clearHistoryEntries();
    });

    document.getElementById('railFileInput')?.addEventListener('change', event => {
        const file = event.target.files && event.target.files[0];
        if (file) LoadFile(file);
        event.target.value = '';
    });

    // Old builds could leave more entries than the current limit; trim once on
    // startup so the count in the rail matches the setting.
    enforceHistoryLimit();
    renderHistorySidebar();
    if (typeof updateStorageSummary === 'function') updateStorageSummary();
}

initializeHistoryUi();
