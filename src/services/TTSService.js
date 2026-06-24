/**
 * TTSService — Text-to-Speech with Android Media Notification
 *
 * Architecture:
 *   - expo-speech        : does the actual audio reading via Android TTS engine
 *   - react-native-track-player (RNTP) : holds the Android MediaSession so the OS
 *     shows a media notification with pause/play/next buttons on lock screen and
 *     notification tray. RNTP plays a very short silent MP3 in a loop to keep the
 *     MediaSession alive; the real speech comes from expo-speech.
 *
 * Remote-control flow:
 *   Lock screen pause button
 *     -> RNTP RemotePause event (TrackPlayerService.js)
 *     -> TrackPlayer.pause()
 *     -> playback-state changes to Paused
 *     -> useTrackPlayerEvents listener in PDFViewerScreen calls TTSService.pause()
 *
 * Chunk-based pause/resume (Android expo-speech has no native pause):
 *   pause()  -> Speech.stop()  + save chunk index + RNTP.pause()
 *   resume() -> Speech.speak() from saved chunk  + RNTP.play()
 */
import * as Speech from "expo-speech";

// Lazy-load RNTP so the app doesn't crash on APKs where the native module
// isn't linked yet (e.g. old builds before RNTP was added to the project).
let TrackPlayer = null;
let AppKilledPlaybackBehavior = null;
let Capability = null;
try {
  const rntp = require("react-native-track-player");
  TrackPlayer = rntp.default;
  AppKilledPlaybackBehavior = rntp.AppKilledPlaybackBehavior;
  Capability = rntp.Capability;
} catch (e) {
  console.warn("[TTSService] RNTP native module unavailable — media notification disabled");
}

// Short silent MP3 to keep RNTP MediaSession alive without audible sound
const SILENT_AUDIO_URL =
  "https://cdn.jsdelivr.net/gh/anars/blank-audio@master/250-milliseconds-of-silence.mp3";

// ─── Config ──────────────────────────────────────────────────────────────────
const MAX_CHUNK_LEN = 250;
const DEFAULT_LANGUAGE = "vi-VN";

// ─── Module state ─────────────────────────────────────────────────────────────
let _chunks = [];
let _currentIdx = 0;
let _state = "idle"; // 'idle' | 'playing' | 'paused'
let _rate = 1.0;
let _language = DEFAULT_LANGUAGE;
let _voiceId = null;
let _playerReady = false;

// Callbacks set per speak() call
let _onChunkChange = null; // (chunkText, idx, total) -> void
let _onDone = null; // () -> void
let _onStateChange = null; // (state) -> void

// ─── RNTP setup ──────────────────────────────────────────────────────────────

export async function setupPlayer() {
  if (_playerReady) return;
  if (!TrackPlayer) return; // native module not available in this build
  try {
    await TrackPlayer.setupPlayer({ autoHandleInterruptions: true });
    await TrackPlayer.updateOptions({
      android: {
        appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
      },
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.Stop,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
      ],
      compactViewCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
      ],
      notificationCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.Stop,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
      ],
    });
    // Seed with a silent track so MediaSession is always valid
    await TrackPlayer.add({
      id: "tts-session",
      url: SILENT_AUDIO_URL,
      title: "PDF Reader Friend",
      artist: "Dang tai...",
      duration: 0.25,
    });
    _playerReady = true;
    console.log("[TTSService] TrackPlayer ready");
  } catch (e) {
    console.warn("[TTSService] setupPlayer error:", e?.message);
  }
}

export async function updateNotification(title, artist) {
  if (!_playerReady) return;
  try {
    await TrackPlayer.updateNowPlayingMetadata({ title, artist });
  } catch (_) {}
}

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
    // Show paused state on notification when reading finishes
    TrackPlayer.pause().catch(() => {});
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
 * Start reading text from the beginning (or from startChunkIndex).
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
  // Tell RNTP we are playing so notification shows pause button
  TrackPlayer.play().catch(() => {});
  speakChunk(safeStart);
}

/**
 * Pause reading. Stops speech engine, remembers current chunk.
 */
export function pause() {
  if (_state !== "playing") return;
  setState("paused");
  Speech.stop();
  TrackPlayer.pause().catch(() => {});
}

/**
 * Resume from the chunk that was paused.
 */
export function resume() {
  if (_state !== "paused") return;
  setState("playing");
  TrackPlayer.play().catch(() => {});
  speakChunk(_currentIdx);
}

/**
 * Stop completely.
 */
export function stop() {
  Speech.stop();
  setState("idle");
  _chunks = [];
  _currentIdx = 0;
  TrackPlayer.pause().catch(() => {});
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
