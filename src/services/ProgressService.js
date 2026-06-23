/**
 * ProgressService
 *
 * Saves and restores per-file reading position.
 * Key format: reading_progress_<safeFileName>_<uriLength>
 *
 * Schema stored per file:
 *   { fileUri, fileName, currentPage, totalPages, lastRead: timestamp }
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

function makeKey(fileUri) {
  const name = (fileUri.split("/").pop() || "unknown")
    .replace(/[^a-zA-Z0-9]/g, "_")
    .slice(0, 40);
  return "reading_progress_" + name + "_" + fileUri.length;
}

/**
 * Save the current reading position for a file.
 */
export async function saveProgress(
  fileUri,
  fileName,
  currentPage,
  totalPages,
  chunkIndex = 0,
) {
  if (!fileUri || currentPage < 1) return;
  const data = {
    fileUri,
    fileName,
    currentPage,
    totalPages,
    chunkIndex,
    lastRead: Date.now(),
  };
  try {
    await AsyncStorage.setItem(makeKey(fileUri), JSON.stringify(data));
  } catch {}
}

/**
 * Load saved progress for a file.
 * Returns the saved data object, or null if none exists.
 */
export async function loadProgress(fileUri) {
  if (!fileUri) return null;
  try {
    const raw = await AsyncStorage.getItem(makeKey(fileUri));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Remove saved progress for a file (e.g., user starts over).
 */
export async function clearProgress(fileUri) {
  if (!fileUri) return;
  try {
    await AsyncStorage.removeItem(makeKey(fileUri));
  } catch {}
}

/**
 * Batch-load progress for multiple files (used by HomeScreen list).
 * Returns a Map<fileUri, progressData>.
 */
export async function loadProgressForFiles(fileUris) {
  const results = new Map();
  if (!fileUris || fileUris.length === 0) return results;
  const keys = fileUris.map(makeKey);
  try {
    const pairs = await AsyncStorage.multiGet(keys);
    pairs.forEach(([, val], i) => {
      if (val) {
        try {
          results.set(fileUris[i], JSON.parse(val));
        } catch {}
      }
    });
  } catch {}
  return results;
}
