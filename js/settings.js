// settings.js -- persisted appearance / behaviour / storage preferences and
// the collapsible settings drawer. Loaded after core.js so the chart palette
// helpers already exist, and before history.js so stored history can consult
// these flags while the sidebar is built.

const APP_SETTINGS_KEY = 'adofai-settings-v1';

const DEFAULT_APP_SETTINGS = {
    accent: '',
    rememberCharts: false,
    chartTwoColumns: false,
    autoExpandMeta: false,
    historyEnabled: true,
    storeHistoryFiles: true,
    historyLimit: 50,
    railOpen: true
};

const ACCENT_PRESETS = [
    { value: '', key: 'settingsAccentDefault' },
    { value: '#4caf50', key: 'settingsAccentGreen' },
    { value: '#4fc3f7', key: 'settingsAccentBlue' },
    { value: '#b06cff', key: 'settingsAccentPurple' },
    { value: '#ff9f43', key: 'settingsAccentOrange' },
    { value: '#ef5350', key: 'settingsAccentRed' },
    { value: '#ec6ea8', key: 'settingsAccentPink' },
    { value: '#ffd54f', key: 'settingsAccentYellow' }
];

function readAppSettings() {
    let stored = null;
    try {
        stored = JSON.parse(localStorage.getItem(APP_SETTINGS_KEY) || 'null');
    } catch (err) {
        stored = null;
    }
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
        // First visit: a desktop reader gets the history rail by default; a
        // narrow screen starts with it closed so it does not cover the page.
        return Object.assign({}, DEFAULT_APP_SETTINGS, { railOpen: window.innerWidth > 1100 });
    }
    return Object.assign({}, DEFAULT_APP_SETTINGS, stored);
}

let appSettings = readAppSettings();
let accentRenderTimer = null;
let railResizeTimer = null;

function saveAppSettings(patch, options) {
    const opts = options || {};
    const previous = appSettings;
    appSettings = Object.assign({}, appSettings, patch || {});
    try {
        localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(appSettings));
    } catch (err) {
        // Quota or private mode: keep the choice for this page view.
    }

    applyAppSettings();
    syncSettingsControls();

    if ('rememberCharts' in (patch || {}) && typeof CHART_STATE_KEY !== 'undefined') {
        if (appSettings.rememberCharts) {
            if (typeof saveChartState === 'function') saveChartState();
        } else {
            try { localStorage.removeItem(CHART_STATE_KEY); } catch (err) { /* ignore */ }
        }
    }
    if ('historyLimit' in (patch || {}) && previous.historyLimit !== appSettings.historyLimit
        && typeof enforceHistoryLimit === 'function') {
        enforceHistoryLimit();
    }
    if (!opts.silent && typeof updateStorageSummary === 'function') updateStorageSummary();
}

function applyRailVisibility(railOpen) {
    const wasOpen = document.body.classList.contains('rail-open');
    document.body.classList.toggle('rail-open', railOpen);
    const railToggle = document.getElementById('historyToggle');
    if (railToggle) railToggle.setAttribute('aria-expanded', String(railOpen));
    const railBackdrop = document.getElementById('railBackdrop');
    if (railBackdrop) railBackdrop.hidden = !railOpen;
    if (wasOpen !== !!railOpen) scheduleChartResize();
}

// Opening or closing the rail changes the chart column width. Chart.js sizes
// canvases on window resize, so dispatch one after the CSS transition instead
// of re-rendering every chart (which would also reset zoom).
function scheduleChartResize() {
    if (railResizeTimer) clearTimeout(railResizeTimer);
    railResizeTimer = setTimeout(() => {
        railResizeTimer = null;
        if (typeof globalOffsets !== 'undefined' && globalOffsets.length > 0) {
            window.dispatchEvent(new Event('resize'));
        }
    }, 320);
}

function applyChartColumns() {
    const twoColumns = appSettings.chartTwoColumns === true;
    const changed = document.body.classList.contains('charts-two-column') !== twoColumns;
    document.body.classList.toggle('charts-two-column', twoColumns);
    return changed;
}

function applyAppSettings() {
    const columnsChanged = applyChartColumns();
    applyRailVisibility(appSettings.railOpen !== false);
    applyAccent(appSettings.accent);
    if (columnsChanged) scheduleChartResize();
}

function hexToRgb(hex) {
    const value = String(hex || '').replace('#', '').trim();
    const full = value.length === 3 ? value.split('').map(ch => ch + ch).join('') : value;
    if (!/^[0-9a-f]{6}$/i.test(full)) return null;
    return {
        r: parseInt(full.slice(0, 2), 16),
        g: parseInt(full.slice(2, 4), 16),
        b: parseInt(full.slice(4, 6), 16)
    };
}

function rgbToHex(rgb) {
    const clamp = value => Math.max(0, Math.min(255, Math.round(value)));
    return '#' + [rgb.r, rgb.g, rgb.b].map(value => clamp(value).toString(16).padStart(2, '0')).join('');
}

function mixHex(hex, target, amount) {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;
    return rgbToHex({
        r: rgb.r + (target.r - rgb.r) * amount,
        g: rgb.g + (target.g - rgb.g) * amount,
        b: rgb.b + (target.b - rgb.b) * amount
    });
}

function rgbaFromHex(hex, alpha) {
    const rgb = hexToRgb(hex);
    if (!rgb) return 'rgba(76, 175, 80, ' + alpha + ')';
    return 'rgba(' + rgb.r + ', ' + rgb.g + ', ' + rgb.b + ', ' + alpha + ')';
}

function accentTextColor(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return '#ffffff';
    // Relative luminance: light accents need dark button text to stay legible.
    const channel = value => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const luminance = 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
    return luminance > 0.55 ? '#111111' : '#ffffff';
}

const ACCENT_CSS_VARS = [
    '--accent-color', '--link-color', '--primary-btn-bg', '--primary-btn-hover',
    '--primary-btn-text', '--xacc-color', '--xacc-bg', '--xacc-border',
    '--chart-xacc-line', '--chart-xacc-fill', '--chart-band-stroke',
    '--chart-band-tint', '--chart-bpm-line'
];

function applyAccent(accent, renderCharts) {
    const rootStyle = document.documentElement.style;
    const value = String(accent || '').trim();
    const rgb = value ? hexToRgb(value) : null;

    if (!rgb) {
        ACCENT_CSS_VARS.forEach(name => rootStyle.removeProperty(name));
    } else {
        const base = rgbToHex(rgb);
        const primary = mixHex(base, { r: 0, g: 0, b: 0 }, 0.12);
        const hover = mixHex(base, { r: 0, g: 0, b: 0 }, 0.3);
        rootStyle.setProperty('--accent-color', base);
        rootStyle.setProperty('--link-color', base);
        rootStyle.setProperty('--primary-btn-bg', primary);
        rootStyle.setProperty('--primary-btn-hover', hover);
        rootStyle.setProperty('--primary-btn-text', accentTextColor(base));
        rootStyle.setProperty('--xacc-color', base);
        rootStyle.setProperty('--xacc-bg', rgbaFromHex(base, 0.1));
        rootStyle.setProperty('--xacc-border', rgbaFromHex(base, 0.24));
        rootStyle.setProperty('--chart-xacc-line', base);
        rootStyle.setProperty('--chart-xacc-fill', rgbaFromHex(base, 0.15));
        rootStyle.setProperty('--chart-band-stroke', rgbaFromHex(base, 0.45));
        rootStyle.setProperty('--chart-band-tint', rgbaFromHex(base, 0.14));
        rootStyle.setProperty('--chart-bpm-line', base);
    }

    if (typeof refreshChartColors === 'function') refreshChartColors();

    if (renderCharts && typeof updateAllCharts === 'function' && globalOffsets.length > 0) {
        clearTimeout(accentRenderTimer);
        accentRenderTimer = setTimeout(() => updateAllCharts(), 90);
    }
}

function renderAccentSwatches() {
    const wrap = document.getElementById('accentSwatches');
    if (!wrap) return;
    wrap.innerHTML = '';
    ACCENT_PRESETS.forEach(preset => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'accent-swatch' + (preset.value ? '' : ' accent-swatch-default');
        button.dataset.accent = preset.value;
        button.title = t(preset.key);
        button.setAttribute('aria-label', t(preset.key));
        button.setAttribute('aria-pressed', String((appSettings.accent || '') === preset.value));
        if (preset.value) button.style.background = preset.value;
        if ((appSettings.accent || '') === preset.value) button.classList.add('is-selected');
        wrap.appendChild(button);
    });
}

function syncSettingsControls() {
    document.querySelectorAll('[data-settings-theme]').forEach(button => {
        const active = button.dataset.settingsTheme === currentTheme;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
    });

    const remember = document.getElementById('settingsRememberCharts');
    if (remember) remember.checked = !!appSettings.rememberCharts;
    const twoColumns = document.getElementById('settingsChartTwoColumns');
    if (twoColumns) twoColumns.checked = appSettings.chartTwoColumns === true;
    const autoExpand = document.getElementById('settingsAutoExpandMeta');
    if (autoExpand) autoExpand.checked = !!appSettings.autoExpandMeta;
    const historyEnabled = document.getElementById('settingsHistoryEnabled');
    if (historyEnabled) historyEnabled.checked = appSettings.historyEnabled !== false;
    const storeFiles = document.getElementById('settingsStoreHistoryFiles');
    if (storeFiles) {
        storeFiles.checked = appSettings.storeHistoryFiles !== false;
        storeFiles.disabled = appSettings.historyEnabled === false;
    }
    const limit = document.getElementById('settingsHistoryLimit');
    if (limit) {
        limit.value = String(appSettings.historyLimit);
        limit.disabled = appSettings.historyEnabled === false;
    }

    renderAccentSwatches();
    const custom = document.getElementById('accentCustom');
    if (custom) {
        const fallback = currentTheme === 'light' ? '#2e7d32' : '#4caf50';
        custom.value = hexToRgb(appSettings.accent) ? appSettings.accent : fallback;
    }

    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.setAttribute('aria-pressed', String(currentTheme === 'light'));
    }

    const disabledHint = document.getElementById('historyDisabledHint');
    if (disabledHint) disabledHint.hidden = appSettings.historyEnabled !== false;

    if (typeof updateStorageSummary === 'function') updateStorageSummary();
}

function formatStorageBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
        value /= 1024;
        index += 1;
    }
    return (value >= 100 ? value.toFixed(0) : value.toFixed(value >= 10 ? 1 : 2)) + ' ' + units[index];
}

async function updateStorageSummary() {
    const bar = document.getElementById('settingsStorageBar');
    const text = document.getElementById('settingsStorageText');
    if (!bar || !text) return;

    let usage = null;
    let quota = null;
    if (navigator.storage && typeof navigator.storage.estimate === 'function') {
        try {
            const estimate = await navigator.storage.estimate();
            usage = estimate.usage;
            quota = estimate.quota;
        } catch (err) {
            // Unsized storage is still usable; just show the copy count.
        }
    }

    let copies = 0;
    let copyBytes = 0;
    if (typeof readHistoryEntries === 'function') {
        readHistoryEntries().forEach(entry => {
            if (entry.fileStored) {
                copies += 1;
                copyBytes += Number(entry.size) || 0;
            }
        });
    }

    const parts = [];
    if (Number.isFinite(usage)) parts.push(formatStorageBytes(usage));
    if (Number.isFinite(quota)) parts.push('/ ' + formatStorageBytes(quota));
    const usageText = parts.length
        ? parts.join(' ')
        : t('settingsStorageUnknown');
    const copyText = t('settingsStorageCopies')
        .replace('{count}', String(copies))
        .replace('{size}', formatStorageBytes(copyBytes));
    text.textContent = usageText + ' · ' + copyText;

    if (bar) {
        const ratio = Number.isFinite(usage) && Number.isFinite(quota) && quota > 0
            ? Math.min(1, usage / quota)
            : Math.min(1, copyBytes / (10 * 1024 * 1024));
        bar.style.width = Math.max(1, ratio * 100).toFixed(2) + '%';
    }
}

function setSettingsOpen(open) {
    const panel = document.getElementById('settingsPanel');
    const backdrop = document.getElementById('settingsBackdrop');
    const toggle = document.getElementById('settingsToggle');
    if (!panel) return;
    panel.hidden = !open;
    if (backdrop) backdrop.hidden = !open;
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('settings-open', open);
    if (open) {
        syncSettingsControls();
        updateStorageSummary();
    }
}

function setHistoryRailOpen(open, persist) {
    const next = !!open;
    appSettings.railOpen = next;
    if (persist !== false) {
        try {
            localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(appSettings));
        } catch (err) {
            // Ignore storage failures; the class below still updates.
        }
    }
    applyRailVisibility(next);
}

function initializeSettingsUi() {
    document.getElementById('settingsToggle')?.addEventListener('click', () => {
        setSettingsOpen(document.getElementById('settingsPanel')?.hidden !== false);
    });
    document.getElementById('settingsClose')?.addEventListener('click', () => setSettingsOpen(false));
    document.getElementById('settingsBackdrop')?.addEventListener('click', () => setSettingsOpen(false));

    document.querySelectorAll('[data-settings-theme]').forEach(button => {
        button.addEventListener('click', () => {
            setTheme(button.dataset.settingsTheme, true);
            syncSettingsControls();
        });
    });

    document.getElementById('accentSwatches')?.addEventListener('click', event => {
        const swatch = event.target.closest('[data-accent]');
        if (!swatch) return;
        saveAppSettings({ accent: swatch.dataset.accent });
        applyAccent(appSettings.accent, true);
    });

    document.getElementById('accentCustom')?.addEventListener('input', event => {
        const value = event.target.value;
        appSettings.accent = value;
        applyAccent(value, false);
        renderAccentSwatches();
    });
    document.getElementById('accentCustom')?.addEventListener('change', event => {
        saveAppSettings({ accent: event.target.value });
        applyAccent(appSettings.accent, true);
    });
    document.getElementById('accentReset')?.addEventListener('click', () => {
        saveAppSettings({ accent: '' });
        applyAccent('', true);
    });

    document.getElementById('settingsRememberCharts')?.addEventListener('change', event => {
        saveAppSettings({ rememberCharts: event.target.checked });
    });
    document.getElementById('settingsChartTwoColumns')?.addEventListener('change', event => {
        saveAppSettings({ chartTwoColumns: event.target.checked });
    });
    document.getElementById('settingsAutoExpandMeta')?.addEventListener('change', event => {
        saveAppSettings({ autoExpandMeta: event.target.checked });
    });
    document.getElementById('settingsHistoryEnabled')?.addEventListener('change', event => {
        saveAppSettings({ historyEnabled: event.target.checked });
        if (typeof renderHistorySidebar === 'function') renderHistorySidebar();
    });
    document.getElementById('settingsStoreHistoryFiles')?.addEventListener('change', event => {
        saveAppSettings({ storeHistoryFiles: event.target.checked });
    });
    document.getElementById('settingsHistoryLimit')?.addEventListener('change', event => {
        saveAppSettings({ historyLimit: Number(event.target.value) || 50 });
        if (typeof renderHistorySidebar === 'function') renderHistorySidebar();
    });

    document.getElementById('settingsClearFiles')?.addEventListener('click', () => {
        if (!confirm(t('settingsClearFilesConfirm'))) return;
        if (typeof clearStoredHistoryFiles === 'function') clearStoredHistoryFiles();
    });
    document.getElementById('settingsClearHistory')?.addEventListener('click', () => {
        if (!confirm(t('historyClearConfirm'))) return;
        if (typeof clearHistoryEntries === 'function') clearHistoryEntries();
    });
    document.getElementById('settingsReset')?.addEventListener('click', () => {
        if (!confirm(t('settingsResetConfirm'))) return;
        try { localStorage.removeItem(APP_SETTINGS_KEY); } catch (err) { /* ignore */ }
        appSettings = Object.assign({}, DEFAULT_APP_SETTINGS, { railOpen: window.innerWidth > 1100 });
        if (typeof CHART_STATE_KEY !== 'undefined') {
            try { localStorage.removeItem(CHART_STATE_KEY); } catch (err) { /* ignore */ }
        }
        applyAppSettings();
        syncSettingsControls();
        if (typeof enforceHistoryLimit === 'function') enforceHistoryLimit();
        if (typeof renderHistorySidebar === 'function') renderHistorySidebar();
    });

    document.getElementById('historyToggle')?.addEventListener('click', () => {
        setHistoryRailOpen(!document.body.classList.contains('rail-open'), true);
    });
    document.getElementById('historyRailClose')?.addEventListener('click', () => setHistoryRailOpen(false, true));
    document.getElementById('railBackdrop')?.addEventListener('click', () => setHistoryRailOpen(false, true));

    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        const settingsPanel = document.getElementById('settingsPanel');
        if (settingsPanel && !settingsPanel.hidden) {
            setSettingsOpen(false);
            return;
        }
        if (window.matchMedia('(max-width: 1100px)').matches
            && document.body.classList.contains('rail-open')) {
            setHistoryRailOpen(false, false);
        }
    });

    applyAppSettings();
    syncSettingsControls();
    setHistoryRailOpen(appSettings.railOpen !== false, false);
}

initializeSettingsUi();
