/**
 * OcrKeyService
 *
 * Manages a pool of OCR.space API keys.
 * - Rotates to next key automatically when current key hits quota
 * - Persists keys + quota state in AsyncStorage
 * - User can add/remove keys from SettingsScreen
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "ocr_key_pool";

// ── Built-in keys (dev can add more keys here) ────────────────────────────────
// Register free keys at https://ocr.space/OCRAPI — 25,000 requests/month each.
// App auto-rotates to next key when current one hits the monthly limit.
const DEFAULT_KEYS = [
  { key: "K85805800188957", label: "Key 1", quotaExceeded: false },
  { key: "K84632824288957", label: "Key 2", quotaExceeded: false },
  { key: "K89698554788957",  label: "Key 3", quotaExceeded: false },
];

// Set of built-in key values — used to mark them as non-deletable in UI
const BUILTIN_KEY_VALUES = new Set(DEFAULT_KEYS.map((k) => k.key));

let _pool = null; // loaded lazily

// ── Internal helpers ──────────────────────────────────────────────────────────

async function load() {
  if (_pool !== null) return;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    _pool = raw ? JSON.parse(raw) : DEFAULT_KEYS;
  } catch {
    _pool = DEFAULT_KEYS;
  }
}

async function persist() {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(_pool));
  } catch {}
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the first non-quota-exceeded key, or null if all keys are exhausted.
 */
export async function getActiveKey() {
  await load();
  const active = _pool.find((k) => !k.quotaExceeded);
  return active ? active.key : null;
}

/**
 * Mark a key as quota-exceeded and rotate to the next available key.
 * Returns the new active key, or null if all exhausted.
 */
export async function markQuotaExceeded(key) {
  await load();
  const entry = _pool.find((k) => k.key === key);
  if (entry) {
    entry.quotaExceeded = true;
    await persist();
    console.log("[OcrKey] key quota exceeded, rotating:", key);
  }
  return getActiveKey();
}

/**
 * Reset all quota flags (e.g. at start of new month).
 */
export async function resetAllQuotas() {
  await load();
  _pool.forEach((k) => (k.quotaExceeded = false));
  await persist();
}

/**
 * Add a new key to the pool. Noop if already exists.
 * @param {string} key   - OCR.space API key
 * @param {string} label - display label
 */
export async function addKey(key, label = "") {
  await load();
  if (_pool.find((k) => k.key === key)) return false; // already exists
  _pool.push({
    key,
    label: label || "Key " + (_pool.length + 1),
    quotaExceeded: false,
    isBuiltin: false,
  });
  await persist();
  return true;
}

/**
 * Remove a key from the pool.
 */
export async function removeKey(key) {
  await load();
  _pool = _pool.filter((k) => k.key !== key);
  await persist();
}

/**
 * Returns a copy of all keys with their status.
 * Each entry has an extra `isBuiltin` flag (true = pre-installed, cannot delete).
 */
export async function listKeys() {
  await load();
  return _pool.map((k) => ({ ...k, isBuiltin: BUILTIN_KEY_VALUES.has(k.key) }));
}

/**
 * Returns the count of available (non-exhausted) keys.
 */
export async function availableKeyCount() {
  await load();
  return _pool.filter((k) => !k.quotaExceeded).length;
}
