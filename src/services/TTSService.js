/**
 * TTSService
 *
 * Text-to-Speech singleton using expo-speech (works in Expo Go, no Dev Client needed).
 *
 * Custom pause/resume strategy (expo-speech has no native pause on Android):
 *   - Split text into sentence chunks (~250 chars each)
 *   - Speak chunk by chunk; on each onDone → advance to next chunk
 *   - pause()  → Speech.stop() + save current chunk index
 *   - resume() → Speech.speak() from saved chunk index
 *
 * State machine:  idle ──speak()──▶ playing ──pause()──▶ paused
 *                  ▲                   │                    │
 *                  └──────stop()───────┘◀────resume()───────┘
 */
import * as Speech from "expo-speech";

// ─── Config ───────────────────────────────────────────────────────────────────
const MAX_CHUNK_LEN = 250; // chars; stay well under Android TTS limit
const DEFAULT_LANGUAGE = "vi-VN";

// ─── Module state ─────────────────────────────────────────────────────────────
let _chunks = [];
let _currentIdx = 0;
let _state = "idle"; // 'idle' | 'playing' | 'paused'
let _rate = 1.0;
let _language = DEFAULT_LANGUAGE;
let _voiceId = null; // identifier from Speech.getAvailableVoicesAsync()

// Callbacks set per speak() call
let _onChunkChange = null; // (chunkText, idx, total) → void
let _onDone = null; // () → void
let _onStateChange = null; // (state) → void

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Split text into chunks at sentence boundaries, each ≤ MAX_CHUNK_LEN chars.
 */
function splitChunks(text) {
  // Normalise whitespace first
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  // Split at sentence-ending punctuation — avoid lookbehind (not supported on all Android/Hermes)
  // Strategy: split on whitespace after . ! ? by replacing them with a unique separator first
  const marked = normalized.replace(/([.!?])\s+/g, "$1\x00");
  const sentences = marked.split("\x00").filter(Boolean);

  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    if (current.length === 0) {
      current = sentence;
    } else if (current.length + 1 + sentence.length <= MAX_CHUNK_LEN) {
      current += " " + sentence;
    } else {
      chunks.push(current.trim());
      current = sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  // Safety: if a single sentence is very long, hard-split it
  const result = [];
  for (const chunk of chunks) {
    if (chunk.length <= MAX_CHUNK_LEN) {
      result.push(chunk);
    } else {
      let i = 0;
      while (i < chunk.length) {
        result.push(chunk.slice(i, i + MAX_CHUNK_LEN));
        i += MAX_CHUNK_LEN;
      }
    }
  }
  return result.length > 0 ? result : [normalized];
}

function setState(s) {
  _state = s;
  _onStateChange?.(s);
}

function speakChunk(idx) {
  if (idx >= _chunks.length) {
    console.log("[TTSService] all chunks done");
    setState("idle");
    _onDone?.();
    return;
  }
  _currentIdx = idx;
  _onChunkChange?.(_chunks[idx], idx, _chunks.length);
  console.log(
    "[TTSService] speakChunk idx=" +
      idx +
      " lang=" +
      _language +
      " rate=" +
      _rate +
      " text=" +
      _chunks[idx].slice(0, 40),
  );

  Speech.speak(_chunks[idx], {
    language: _language,
    rate: _rate,
    voice: _voiceId ?? undefined,
    onStart: () => {
      console.log("[TTSService] onStart idx=" + idx);
    },
    onDone: () => {
      console.log("[TTSService] onDone idx=" + idx);
      if (_state === "playing") speakChunk(idx + 1);
    },
    onError: (e) => {
      console.log("[TTSService] onError idx=" + idx, e);
      if (_state === "playing") speakChunk(idx + 1);
    },
    onStopped: () => {
      console.log("[TTSService] onStopped idx=" + idx);
    },
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start reading text from the beginning.
 * @param {string} text - Full text to read
 * @param {object} callbacks
 *   onChunkChange(chunkText, idx, total) — called when each new chunk starts
 *   onDone()                             — called when all chunks finish
 *   onStateChange(state)                 — called on every state transition
 */
export function speak(
  text,
  { onChunkChange, onDone, onStateChange, startChunkIndex = 0 } = {},
) {
  Speech.stop();
  _chunks = splitChunks(text);
  _currentIdx = 0;
  _onChunkChange = onChunkChange ?? null;
  _onDone = onDone ?? null;
  _onStateChange = onStateChange ?? null;

  if (_chunks.length === 0) return;

  const safeStart = Math.max(
    0,
    Math.min(Math.floor(startChunkIndex), _chunks.length - 1),
  );
  setState("playing");
  speakChunk(safeStart);
}

/**
 * Pause: stop speech engine, remember current position.
 * Does nothing if not playing.
 */
export function pause() {
  if (_state !== "playing") return;
  setState("paused");
  Speech.stop();
}

/**
 * Resume from the chunk that was playing when pause() was called.
 * Does nothing if not paused.
 */
export function resume() {
  if (_state !== "paused") return;
  setState("playing");
  speakChunk(_currentIdx);
}

/**
 * Stop completely and reset position.
 */
export function stop() {
  Speech.stop();
  setState("idle");
  _chunks = [];
  _currentIdx = 0;
}

/**
 * Set playback rate.  0.5 (slow) → 2.0 (fast), default 1.0
 * Takes effect on the next chunk; does not restart current speech.
 */
export function setRate(rate) {
  _rate = Math.max(0.1, Math.min(2.0, rate));
}

export function setLanguage(lang) {
  _language = lang;
}

/**
 * Set a specific TTS voice by identifier (from Speech.getAvailableVoicesAsync).
 * Pass null to revert to the system default voice for the current language.
 */
export function setVoiceId(id) {
  _voiceId = id || null;
}

export function getVoiceId() {
  return _voiceId;
}

/**
 * Expose chunk-splitting logic so callers can calculate a start index
 * from a y-percentage without starting actual speech.
 */
export function splitTextToChunks(text) {
  return splitChunks(text);
}

// ─── Read-only accessors ──────────────────────────────────────────────────────

export function getState() {
  return _state;
}

export function getRate() {
  return _rate;
}

/** 0..1 progress within the current text */
export function getProgress() {
  if (_chunks.length === 0) return 0;
  return _currentIdx / _chunks.length;
}

/** The chunk currently being spoken (or last spoken) */
export function getCurrentChunk() {
  return _chunks[_currentIdx] ?? "";
}

export function getTotalChunks() {
  return _chunks.length;
}

export function getCurrentChunkIndex() {
  return _currentIdx;
}
