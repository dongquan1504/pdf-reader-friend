/**
 * OcrCacheService
 *
 * Persists OCR results so pages are NEVER re-submitted to OCR.space
 * if they have been recognized before.
 *
 * Key format:  ocr_<fileHash>_p<pageNum>
 *   fileHash = last path segment + underscore + total URI length
 *   (no crypto needed — just needs to be unique per file)
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

// In-memory per-file cache so we don't hit AsyncStorage on every getPageText call
const _memCache = new Map(); // "fileHash_pageNum" => text

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Derive a short, stable, filesystem-safe hash from a URI. */
function hashUri(fileUri) {
  const name = fileUri.split("/").pop() || "unknown";
  // Remove special chars, keep alphanumeric + dot, truncate
  const safe = name.replace(/[^a-zA-Z0-9.]/g, "_").slice(0, 40);
  return safe + "_" + fileUri.length;
}

function cacheKey(fileUri, pageNum) {
  return "ocr_" + hashUri(fileUri) + "_p" + pageNum;
}

function memKey(fileUri, pageNum) {
  return hashUri(fileUri) + "_" + pageNum;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Save OCR result for one page.
 * Also writes to in-memory cache so subsequent loads are instant.
 */
export async function saveOCR(fileUri, pageNum, text) {
  const mk = memKey(fileUri, pageNum);
  _memCache.set(mk, text);
  try {
    await AsyncStorage.setItem(cacheKey(fileUri, pageNum), text);
  } catch (e) {
    console.warn("[OcrCache] save failed:", e.message);
  }
}

/**
 * Load cached OCR text for one page.
 * Returns the text string, or null if not cached.
 */
export async function loadOCR(fileUri, pageNum) {
  const mk = memKey(fileUri, pageNum);
  if (_memCache.has(mk)) return _memCache.get(mk);
  try {
    const val = await AsyncStorage.getItem(cacheKey(fileUri, pageNum));
    if (val !== null) {
      _memCache.set(mk, val);
      return val;
    }
  } catch {}
  return null;
}

/**
 * Load ALL cached OCR pages for a file at once.
 * Returns a Map<pageNum (number), text (string)>.
 *
 * Uses AsyncStorage.multiGet for efficiency.
 * Call this on file open to pre-populate TextExtractorService.
 *
 * @param {string} fileUri
 * @param {number} totalPages
 */
export async function loadAllForFile(fileUri, totalPages) {
  const results = new Map();
  if (!totalPages || totalPages <= 0) return results;

  const keys = [];
  for (let p = 1; p <= totalPages; p++) {
    keys.push(cacheKey(fileUri, p));
  }

  try {
    const pairs = await AsyncStorage.multiGet(keys);
    pairs.forEach(([key, value]) => {
      if (value !== null) {
        // Extract page number from key suffix "_p<n>"
        const match = key.match(/_p(\d+)$/);
        if (match) {
          const page = parseInt(match[1], 10);
          results.set(page, value);
          _memCache.set(memKey(fileUri, page), value);
        }
      }
    });
  } catch (e) {
    console.warn("[OcrCache] loadAll failed:", e.message);
  }

  return results;
}

/**
 * Delete all cached OCR entries for a file (e.g. if user wants to re-OCR).
 *
 * @param {string} fileUri
 * @param {number} totalPages
 */
export async function clearForFile(fileUri, totalPages) {
  if (!totalPages) return;
  const keys = [];
  for (let p = 1; p <= totalPages; p++) {
    const mk = memKey(fileUri, p);
    _memCache.delete(mk);
    keys.push(cacheKey(fileUri, p));
  }
  try {
    await AsyncStorage.multiRemove(keys);
  } catch (e) {
    console.warn("[OcrCache] clear failed:", e.message);
  }
}

/**
 * How many pages are already cached for a file.
 * Useful to show "X pages cached" in UI.
 */
export async function cachedPageCount(fileUri, totalPages) {
  if (!totalPages) return 0;
  const keys = [];
  for (let p = 1; p <= totalPages; p++) keys.push(cacheKey(fileUri, p));
  try {
    const pairs = await AsyncStorage.multiGet(keys);
    return pairs.filter(([, v]) => v !== null).length;
  } catch {
    return 0;
  }
}
