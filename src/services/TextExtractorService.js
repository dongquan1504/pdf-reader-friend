/**
 * TextExtractorService
 *
 * Module-level singleton that stores text extracted from PDF pages.
 * PDF.js extracts text from text-layer PDFs (machine-made PDFs).
 * Scan PDFs (photos of documents) will have empty/short text → detected as scanned.
 *
 * Used by:
 *  - PDFViewerScreen (writes extracted text via setPageText)
 *  - TTSService (Phase 4) reads text via getPageText / getTextRange
 */

// Minimum character count to consider a page as "has real text"
const MIN_TEXT_LEN = 15;

// Internal storage — module-level (survives re-renders, reset on new file)
let _texts = new Map(); // pageNum (1-based) → string from getTextContent()
let _ocrTexts = new Map(); // pageNum → string from Tesseract OCR (authoritative when present)
let _garbled = new Set(); // pages where getTextContent() produced garbled output
let _totalPages = 0;

// ─── Write API (called from PDFViewerScreen) ──────────────────────────────────

export function initExtractor(totalPages) {
  _texts = new Map();
  _ocrTexts = new Map();
  _garbled = new Set();
  _totalPages = totalPages;
}

/**
 * Store extracted text for a single page.
 * @param {number} pageNum - 1-based page index
 * @param {string} text    - extracted text string (may be empty for scan pages)
 */
export function setPageText(pageNum, text, garbled = false) {
  _texts.set(pageNum, text ?? "");
  if (garbled) _garbled.add(pageNum);
}

/** Store OCR result for a page (overrides garbled getTextContent result) */
export function setPageOCR(pageNum, text) {
  _ocrTexts.set(pageNum, text ?? "");
  _garbled.delete(pageNum); // OCR resolved the garbled issue
}

export function isPageGarbled(pageNum) {
  return _garbled.has(pageNum) && !_ocrTexts.has(pageNum);
}

// ─── Read API (used by Phase 4 TTS) ──────────────────────────────────────────

/**
 * Get the extracted text for a single page.
 * Returns empty string if page not yet extracted or is a scan page.
 */
export function getPageText(pageNum) {
  // OCR result takes priority over garbled getTextContent
  if (_ocrTexts.has(pageNum)) return _ocrTexts.get(pageNum);
  return _texts.get(pageNum) ?? "";
}

/**
 * Get concatenated text from a range of pages.
 * Skips pages with no text (scan pages).
 * @param {number} fromPage - 1-based start page (inclusive)
 * @param {number} toPage   - 1-based end page (inclusive)
 */
export function getTextRange(fromPage, toPage) {
  const chunks = [];
  for (let i = fromPage; i <= toPage; i++) {
    const t = (_texts.get(i) ?? "").trim();
    if (t.length >= MIN_TEXT_LEN) chunks.push(t);
  }
  return chunks.join("\n\n");
}

/**
 * Get all extracted text from the entire document.
 */
export function getAllText() {
  return getTextRange(1, _totalPages);
}

// ─── Detection ────────────────────────────────────────────────────────────────

/**
 * Detect whether the PDF is a scan (no text layer).
 * Checks first 10 extracted pages to decide early (before full extraction).
 * A PDF is considered scanned if >70% of sampled pages have < MIN_TEXT_LEN chars.
 */
export function isScannedPDF() {
  if (_texts.size === 0) return false;
  const sampleSize = Math.min(_texts.size, 10);
  let emptyCount = 0;
  for (let i = 1; i <= sampleSize; i++) {
    if ((_texts.get(i) ?? "").trim().length < MIN_TEXT_LEN) emptyCount++;
  }
  return emptyCount / sampleSize > 0.7;
}

/**
 * Snapshot of current extraction state — useful for debugging and UI.
 */
export function getStats() {
  let emptyPages = 0;
  _texts.forEach((text) => {
    if (text.trim().length < MIN_TEXT_LEN) emptyPages++;
  });
  return {
    extractedPages: _texts.size,
    totalPages: _totalPages,
    emptyPages,
    hasText: _texts.size > 0 && !isScannedPDF(),
    isScanned: isScannedPDF(),
  };
}
