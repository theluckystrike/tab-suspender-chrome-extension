/**
 * Tab Suspender - Settings Page JavaScript
 */

// DOM Elements
const timeoutSlider = document.getElementById('timeout');
const timeoutValue = document.getElementById('timeoutValue');
const memorySlider = document.getElementById('memoryThreshold');
const memoryValue = document.getElementById('memoryValue');
const autoRestore = document.getElementById('autoRestore');
const neverAudio = document.getElementById('neverAudio');
const neverForms = document.getElementById('neverForms');
const neverPinned = document.getElementById('neverPinned');
const neverActive = document.getElementById('neverActive');
const newDomainInput = document.getElementById('newDomain');
const addDomainBtn = document.getElementById('addDomainBtn');
const whitelistList = document.getElementById('whitelistList');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFile = document.getElementById('importFile');
const viewStatsBtn = document.getElementById('viewStatsBtn');
const totalSaved = document.getElementById('totalSaved');
const tabsSuspended = document.getElementById('tabsSuspended');
const toastContainer = document.getElementById('toastContainer');

let settings = {};

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadSettings();
    await loadStats();
    setupEventListeners();
});

// Load settings from storage
async function loadSettings() {
    try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
        settings = response.settings || {};
        updateUI();
    } catch (error) {
        console.error('Failed to load settings:', error);
        showToast('Failed to load settings', 'error');
    }
}

// Update UI with current settings
function updateUI() {
    // Timeout slider
    timeoutSlider.value = settings.suspensionTimeout || 30;
    updateTimeoutDisplay();

    // Memory threshold
    memorySlider.value = settings.memoryThreshold || 80;
    updateMemoryDisplay();

    // Toggle switches
    autoRestore.checked = settings.autoUnsuspendOnFocus !== false;
    neverAudio.checked = settings.neverSuspendAudio !== false;
    neverForms.checked = settings.neverSuspendUnsavedForms !== false;
    neverPinned.checked = settings.suspendPinnedTabs === false;
    neverActive.checked = settings.neverSuspendActiveTab !== false;

    // Whitelist
    renderWhitelist();
}

// Render whitelist items
function renderWhitelist() {
    const domains = settings.whitelistedDomains || [];

    if (domains.length === 0) {
        whitelistList.innerHTML = '<p class="empty-message" style="color: var(--text-tertiary); font-size: 13px; text-align: center; padding: 20px;">No domains whitelisted</p>';
        return;
    }

    whitelistList.innerHTML = domains.map(domain => `
    <div class="whitelist-item" data-domain="${domain}">
      <span class="whitelist-domain">${domain}</span>
      <button class="whitelist-remove" title="Remove">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  `).join('');

    // Add remove handlers
    whitelistList.querySelectorAll('.whitelist-remove').forEach(btn => {
        btn.addEventListener('click', async () => {
            const item = btn.closest('.whitelist-item');
            const domain = item.dataset.domain;
            await removeDomain(domain);
        });
    });
}

// Setup event listeners
function setupEventListeners() {
    // Timeout slider
    timeoutSlider.addEventListener('input', () => {
        updateTimeoutDisplay();
        debouncedSave();
    });

    // Memory threshold
    memorySlider.addEventListener('input', () => {
        updateMemoryDisplay();
        debouncedSave();
    });

    // Toggle switches
    [autoRestore, neverAudio, neverForms, neverPinned, neverActive].forEach(toggle => {
        toggle.addEventListener('change', debouncedSave);
    });

    // Add domain
    addDomainBtn.addEventListener('click', addDomain);
    newDomainInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addDomain();
    });

    // Export/Import
    exportBtn.addEventListener('click', exportSettings);
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', importSettings);

    // View stats
    viewStatsBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('stats-dashboard.html') });
    });
}

// Update timeout display
function updateTimeoutDisplay() {
    const value = parseInt(timeoutSlider.value);
    if (value < 60) {
        timeoutValue.textContent = `${value} min`;
    } else if (value < 1440) {
        timeoutValue.textContent = `${Math.floor(value / 60)} hr`;
    } else {
        timeoutValue.textContent = '24 hr';
    }
}

// Update memory display
function updateMemoryDisplay() {
    memoryValue.textContent = `${memorySlider.value}%`;
}

// Debounced save
let saveTimeout;
function debouncedSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveSettings, 500);
}

// Save settings
async function saveSettings() {
    try {
        const newSettings = {
            suspensionTimeout: parseInt(timeoutSlider.value),
            memoryThreshold: parseInt(memorySlider.value),
            autoUnsuspendOnFocus: autoRestore.checked,
            neverSuspendAudio: neverAudio.checked,
            neverSuspendUnsavedForms: neverForms.checked,
            suspendPinnedTabs: !neverPinned.checked,
            neverSuspendActiveTab: neverActive.checked,
            whitelistedDomains: settings.whitelistedDomains || []
        };

        await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: newSettings });
        settings = { ...settings, ...newSettings };
        showToast('Settings saved', 'success');
    } catch (error) {
        console.error('Failed to save settings:', error);
        showToast('Failed to save settings', 'error');
    }
}

// Add domain to whitelist
async function addDomain() {
    let domain = newDomainInput.value.trim().toLowerCase();

    if (!domain) return;

    // Clean up domain
    domain = domain.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];

    if (settings.whitelistedDomains?.includes(domain)) {
        showToast('Domain already in whitelist', 'error');
        return;
    }

    try {
        await chrome.runtime.sendMessage({ type: 'WHITELIST_DOMAIN', domain });
        settings.whitelistedDomains = settings.whitelistedDomains || [];
        settings.whitelistedDomains.push(domain);
        renderWhitelist();
        newDomainInput.value = '';
        showToast(`Added ${domain} to whitelist`, 'success');
    } catch (error) {
        console.error('Failed to add domain:', error);
        showToast('Failed to add domain', 'error');
    }
}

// Remove domain from whitelist
async function removeDomain(domain) {
    try {
        await chrome.runtime.sendMessage({ type: 'REMOVE_WHITELIST', domain });
        settings.whitelistedDomains = settings.whitelistedDomains.filter(d => d !== domain);
        renderWhitelist();
        showToast(`Removed ${domain} from whitelist`, 'success');
    } catch (error) {
        console.error('Failed to remove domain:', error);
        showToast('Failed to remove domain', 'error');
    }
}

// Export settings
function exportSettings() {
    const data = JSON.stringify(settings, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'tab-suspender-settings.json';
    a.click();

    URL.revokeObjectURL(url);
    showToast('Settings exported', 'success');
}

// Import settings
async function importSettings(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
        const text = await file.text();
        const imported = JSON.parse(text);

        await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: imported });
        settings = { ...settings, ...imported };
        updateUI();
        showToast('Settings imported', 'success');
    } catch (error) {
        console.error('Failed to import settings:', error);
        showToast('Failed to import settings', 'error');
    }

    importFile.value = '';
}

// Load stats
async function loadStats() {
    try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
        totalSaved.textContent = formatBytes(response.totalSaved || 0);
        tabsSuspended.textContent = response.lifetimeTabsSuspended || 0;
    } catch (error) {
        console.error('Failed to load stats:', error);
    }
}

// Format bytes
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Show toast notification
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
