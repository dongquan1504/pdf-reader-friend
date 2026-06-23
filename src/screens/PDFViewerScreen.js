/**
 * PDFViewerScreen
 *
 * Renders PDF using PDF.js inside a WebView — works in Expo Go (no native code needed).
 * PDF.js scripts are loaded from cdnjs CDN (requires internet on first load).
 *
 * Flow:
 *  1. Read the PDF file as base64  (expo-file-system/legacy)
 *  2. Mount WebView with PDF.js HTML template
 *  3. WebView signals "ready" once PDF.js scripts finish loading
 *  4. Inject base64 data → PDF.js renders each page as a canvas
 */
import { useNavigation, useRoute } from "@react-navigation/native";
import * as FileSystem from "expo-file-system/legacy";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import { useTheme } from "../context/ThemeContext";
import * as OcrCacheService from "../services/OcrCacheService";
import * as OcrKeyService from "../services/OcrKeyService";
import * as ProgressService from "../services/ProgressService";
import {
  getPageText,
  getStats,
  initExtractor,
  isPageGarbled,
  isScannedPDF,
  setPageOCR,
  setPageText,
} from "../services/TextExtractorService";
import * as TTSService from "../services/TTSService";
import { Event as RNTPEvent, State as RNTPState, useTrackPlayerEvents } from "react-native-track-player";

// Listen to RNTP remote-control events (lock screen / notification buttons)
// This must be at module level so it wires up as soon as the screen mounts.
const RNTP_EVENTS = [RNTPEvent.PlaybackState, RNTPEvent.RemotePlay, RNTPEvent.RemotePause, RNTPEvent.RemoteStop, RNTPEvent.RemoteNext, RNTPEvent.RemotePrevious];

// PDF.js viewer HTML — PDF data is injected later via injectJavaScript
const VIEWER_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #525659; }
    #msg {
      color: #fff; text-align: center; padding: 32px 16px;
      font-family: sans-serif; font-size: 15px; line-height: 1.6;
    }
    #container { display: flex; flex-direction: column; align-items: center; padding: 8px; gap: 8px; }
    .page-wrap { width: 100%; box-shadow: 0 2px 10px rgba(0,0,0,0.5); background: #fff; }
    canvas { width: 100%; height: auto; display: block; }
  </style>
</head>
<body>
  <div id="msg">Loading PDF.js...</div>
  <div id="container"></div>

  <script>
    function post(obj) {
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(obj));
    }
    window.addEventListener('error', function(e) {
      post({ type: 'error', message: 'Script error: ' + (e.message || 'unknown') });
    });
    window.addEventListener('unhandledrejection', function(e) {
      var msg = e.reason && e.reason.message ? e.reason.message : String(e.reason || 'unknown');
      post({ type: 'error', message: 'Unhandled: ' + msg });
    });
  </script>

  <script type="module">
    import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/legacy/build/pdf.min.mjs';

    function post(obj) {
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(obj));
    }

    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/legacy/build/pdf.worker.min.mjs';

    window.renderPDF = function(b64) {
      document.getElementById('msg').textContent = 'Rendering...';
      try {
        var raw = atob(b64);
        var buf = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);

        pdfjsLib.getDocument({
          data: buf,
          cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/standard_fonts/'
        }).promise.then(function(pdf) {
          var total = pdf.numPages;
          document.getElementById('msg').style.display = 'none';
          post({ type: 'loaded', pages: total });

          var container = document.getElementById('container');
          var _canvases = {};
          window._canvasRefs = _canvases;

          // Tap-to-read: user taps any part of a page to start TTS from that position
          container.addEventListener('click', function(e) {
            var wraps = container.children;
            for (var i = 0; i < wraps.length; i++) {
              var top = wraps[i].offsetTop;
              var bot = top + wraps[i].offsetHeight;
              if (e.pageY >= top && e.pageY <= bot) {
                var pct = (e.pageY - top) / wraps[i].offsetHeight;
                post({ type: 'pageTap', page: i + 1, yPercent: pct });
                return;
              }
            }
          });

          var textDoneCount = 0;
          var renderAllDone = false;
          function onTextPageDone() {
            textDoneCount++;
            if (renderAllDone && textDoneCount === total) post({ type: 'extractComplete' });
          }

          function isGarbled(text) {
            if (!text || text.length < 50) return false;
            var viet = 0;
            for (var i = 0; i < text.length; i++) {
              var c = text.charCodeAt(i);
              if ((c >= 0x1E00 && c <= 0x1EFF) || (c >= 0x0100 && c <= 0x024F)) viet++;
            }
            return viet / text.length < 0.04;
          }

          function extractText(page, pageNum) {
            page.getTextContent().then(function(tc) {
              var text = tc.items.map(function(item) { return item.str; })
                           .join(' ').replace(/ +/g, ' ').trim();
              post({ type: 'text', page: pageNum, text: text, garbled: isGarbled(text) });
              onTextPageDone();
            }).catch(function() {
              post({ type: 'text', page: pageNum, text: '', garbled: false });
              onTextPageDone();
            });
          }

          (function renderNext(n) {
            if (n > total) {
              renderAllDone = true;
              if (textDoneCount === total) post({ type: 'extractComplete' });
              return;
            }
            pdf.getPage(n).then(function(page) {
              var dpr = window.devicePixelRatio || 1;
              var vp0 = page.getViewport({ scale: 1 });
              var cssScale = (window.innerWidth - 16) / vp0.width;
              var vp = page.getViewport({ scale: cssScale * dpr });

              var wrap = document.createElement('div');
              wrap.className = 'page-wrap';
              var canvas = document.createElement('canvas');
              canvas.width = vp.width;
              canvas.height = vp.height;
              canvas.style.width  = (vp.width  / dpr) + 'px';
              canvas.style.height = (vp.height / dpr) + 'px';
              wrap.appendChild(canvas);
              container.appendChild(wrap);
              _canvases[n] = canvas;

              extractText(page, n);

              page.render({ canvasContext: canvas.getContext('2d'), viewport: vp })
                .promise.then(function() {
                  post({ type: 'page', current: n, total: total });
                  renderNext(n + 1);
                }).catch(function(e) {
                  post({ type: 'error', message: 'Page ' + n + ': ' + e.message });
                  renderNext(n + 1);
                });
            }).catch(function(e) {
              post({ type: 'error', message: 'Page ' + n + ': ' + e.message });
              onTextPageDone();
              renderNext(n + 1);
            });
          })(1);

          var _visPg = 1;
          window.addEventListener('scroll', function() {
            var wraps = container.children;
            var mid = window.scrollY + window.innerHeight / 2;
            var best = 1;
            var bestDist = 1e9;
            for (var i = 0; i < wraps.length; i++) {
              var ctr = wraps[i].offsetTop + wraps[i].offsetHeight / 2;
              var dist = Math.abs(ctr - mid);
              if (dist < bestDist) { bestDist = dist; best = i + 1; }
            }
            if (best !== _visPg) { _visPg = best; post({ type: 'visible', page: best }); }
          }, { passive: true });

        }).catch(function(e) {
          document.getElementById('msg').textContent = 'Error: ' + e.message;
          post({ type: 'error', message: e.message });
        });
      } catch(e) {
        post({ type: 'error', message: e.message });
      }
    };

    window.getPageImage = function(pageNum) {
      var canvas = window._canvasRefs && window._canvasRefs[pageNum];
      if (!canvas) {
        post({ type: 'pageImage', page: pageNum, data: null, error: 'canvas not ready' });
        return;
      }
      var maxW = 1024;
      var scale = canvas.width > maxW ? maxW / canvas.width : 1;
      var tmp = document.createElement('canvas');
      tmp.width  = Math.floor(canvas.width  * scale);
      tmp.height = Math.floor(canvas.height * scale);
      tmp.getContext('2d').drawImage(canvas, 0, 0, tmp.width, tmp.height);
      var data = tmp.toDataURL('image/jpeg', 0.92).replace(/^data:image[/]jpeg;base64,/, '');
      post({ type: 'pageImage', page: pageNum, data: data });
    };

    window.scrollToPage = function(n) {
      var wraps = document.getElementById('container').children;
      if (n >= 1 && n <= wraps.length) {
        wraps[n - 1].scrollIntoView({ behavior: 'smooth' });
      }
    };

    post({ type: 'ready' });
  </script>
</body>
</html>`;

// Strip leading/trailing page numbers and short running headers from TTS text.
// Handles patterns like: "42 content..." / "...content 42" / "Title 42 content..."
function cleanTextForTTS(text) {
  if (!text || text.length < 80) return text;
  let s = text.trim();
  // Remove leading standalone page number: "42 Lorem ipsum..."
  s = s.replace(/^\d{1,4}\s+/, "");
  // Remove leading short header that contains a digit (e.g. "Chapter 1. content")
  const leadMatch = s.match(/^(.{1,70}[.!?])\s+/);
  if (leadMatch) {
    const lead = leadMatch[1].trim();
    if (
      lead.length < 70 &&
      (/\d/.test(lead) || lead.split(/\s+/).length <= 4)
    ) {
      s = s.slice(leadMatch[0].length);
    }
  }
  // Remove trailing standalone page number: "...content 42"
  s = s.replace(/\s+\d{1,4}\s*$/, "");
  // Remove trailing short footer after last sentence end
  const lastEnd = Math.max(
    s.lastIndexOf(". "),
    s.lastIndexOf("! "),
    s.lastIndexOf("? "),
  );
  if (lastEnd > 0 && s.length - lastEnd < 80) {
    const tail = s.slice(lastEnd + 2).trim();
    const wc = tail.split(/\s+/).filter(Boolean).length;
    if (tail.length > 0 && (/\d/.test(tail) || wc <= 3)) {
      s = s.slice(0, lastEnd + 1);
    }
  }
  return s.trim();
}

// OCR.space API key is managed by OcrKeyService (see src/services/OcrKeyService.js).
// Add more keys from Settings to avoid hitting the 25k/month limit on a single key.

export default function PDFViewerScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { uri } = route.params ?? {};
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Header right: voice settings icon
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => navigation.navigate("VoiceSettings")}
          style={{ padding: 8, marginRight: -4 }}
          activeOpacity={0.7}
        >
          <Text style={{ fontSize: 20 }}>{"\uD83C\uDFA4"}</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  const webviewRef = useRef(null);
  const [base64Data, setBase64Data] = useState(null);
  const [fileLoading, setFileLoading] = useState(true);
  const [webviewReady, setWebviewReady] = useState(false);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [error, setError] = useState(null);
  // Phase 3 — text extraction state
  const [extractedCount, setExtractedCount] = useState(0);
  const [extractDone, setExtractDone] = useState(false);
  const [scannedPDF, setScannedPDF] = useState(false);
  // visiblePage = page currently in viewport (updated by scroll events from WebView)
  const [visiblePage, setVisiblePage] = useState(1);
  // Phase 4 — TTS state
  const [ttsState, setTtsState] = useState("idle");
  const [ttsChunk, setTtsChunk] = useState("");
  const [ttsRate, setTtsRate] = useState(1.0);
  // OCR state
  const [ocrStatus, setOcrStatus] = useState(null); // null | 'Dang nhan dang chu...'
  const pendingOCRResolve = useRef(null); // resolve fn for current getPageImage call
  const ocrBusyRef = useRef(false); // prevent concurrent OCR calls
  // Phase 5 — reading progress
  const progressDebounceRef = useRef(null);
  const currentChunkRef = useRef(0); // tracks chunk index of active TTS
  const ttsProgressTimerRef = useRef(null); // debounce for TTS chunk saves
  const totalPagesRef = useRef(0); // mirrors totalPages for stale-closure-safe access in TTS callbacks

  // Keep totalPagesRef in sync (avoids stale-closure issues inside TTS callbacks)
  useEffect(() => {
    totalPagesRef.current = totalPages;
  }, [totalPages]);

  // Save progress whenever app goes to background (screen off / switch app)
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (
        (next === "background" || next === "inactive") &&
        uri &&
        totalPages &&
        visiblePage > 0
      ) {
        ProgressService.saveProgress(
          uri,
          route.params?.fileName ?? "",
          visiblePage,
          totalPages,
          currentChunkRef.current,
        );
      }
    });
    return () => sub.remove();
  }, [uri, totalPages, visiblePage]);

  // Phase 5 — save progress whenever visible page changes (debounced 2s)
  useEffect(() => {
    if (!uri || !totalPages || visiblePage < 1) return;
    if (progressDebounceRef.current) clearTimeout(progressDebounceRef.current);
    progressDebounceRef.current = setTimeout(() => {
      // When scrolling manually, reset chunk to 0 for that page
      currentChunkRef.current = 0;
      ProgressService.saveProgress(
        uri,
        route.params?.fileName ?? "",
        visiblePage,
        totalPages,
        0,
      );
    }, 2000);
    return () => clearTimeout(progressDebounceRef.current);
  }, [visiblePage, uri, totalPages]);

  // Minimum pages extracted before enabling Read button
  const MIN_PAGES_TO_READ = 20;
  // Button enabled when: enough pages extracted AND current visible page is ready
  const canRead =
    !scannedPDF &&
    totalPages > 0 &&
    extractedCount >= Math.min(MIN_PAGES_TO_READ, totalPages) &&
    extractedCount >= visiblePage;

  // Step 1 — read PDF as base64
  useEffect(() => {
    if (!uri) {
      setError("No file URI provided.");
      setFileLoading(false);
      return;
    }
    // Reset extraction state when a new file is opened
    setExtractedCount(0);
    setExtractDone(false);
    setScannedPDF(false);
    (async () => {
      try {
        const b64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        setBase64Data(b64);
      } catch (e) {
        setError("Could not read file: " + e.message);
      } finally {
        setFileLoading(false);
      }
    })();
  }, [uri]);

  // Step 2 — inject PDF once both file data AND WebView are ready
  useEffect(() => {
    if (base64Data && webviewReady && webviewRef.current) {
      webviewRef.current.injectJavaScript(
        `window.renderPDF(${JSON.stringify(base64Data)}); void 0;`,
      );
    }
  }, [base64Data, webviewReady]);

  function onMessage(event) {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === "ready") setWebviewReady(true);
      if (msg.type === "loaded") {
        setTotalPages(msg.pages);
        initExtractor(msg.pages);
        // Load all previously OCR'd pages from cache so we never re-request them
        OcrCacheService.loadAllForFile(uri, msg.pages).then((cached) => {
          cached.forEach((text, pageNum) => {
            setPageOCR(pageNum, text);
          });
          if (cached.size > 0) {
            console.log(
              "[OcrCache] pre-loaded " + cached.size + " cached pages",
            );
          }
        });
        // Phase 5 — offer to resume from last reading position
        ProgressService.loadProgress(uri).then((prog) => {
          if (prog && prog.currentPage > 1 && prog.currentPage <= msg.pages) {
            Alert.alert(
              "Tiep tuc doc?",
              "Ban da doc den trang " + prog.currentPage + "/" + msg.pages,
              [
                { text: "Bat dau lai", style: "cancel" },
                {
                  text: "Tiep tuc (trang " + prog.currentPage + ")",
                  onPress: () => {
                    webviewRef.current?.injectJavaScript(
                      "window.scrollToPage(" + prog.currentPage + "); void 0;",
                    );
                    // Auto-start TTS from the exact chunk that was saved
                    const savedChunk = prog.chunkIndex || 0;
                    setTimeout(() => {
                      handlePlay({
                        page: prog.currentPage,
                        chunkIndex: savedChunk,
                      });
                    }, 800);
                  },
                },
              ],
            );
          }
        });
      }
      if (msg.type === "page") setCurrentPage(msg.current);
      if (msg.type === "visible") setVisiblePage(msg.page);
      if (msg.type === "pageTap") {
        // User tapped on a page — start reading from that vertical position
        handlePlay({ page: msg.page, yPercent: msg.yPercent || 0 });
      }
      if (msg.type === "text") {
        setPageText(msg.page, msg.text, msg.garbled === true);
        setExtractedCount((prev) => {
          const next = prev + 1;
          // Detect scan PDF early after 10 pages (don’t wait for all 297)
          if (next === 10) setScannedPDF(isScannedPDF());
          return next;
        });
      }
      if (msg.type === "pageImage") {
        console.log(
          "[OCR] pageImage received page=" +
            msg.page +
            " hasData=" +
            !!msg.data +
            " err=" +
            (msg.error || ""),
        );
        if (pendingOCRResolve.current) {
          const fn = pendingOCRResolve.current;
          pendingOCRResolve.current = null;
          fn(msg.data || "");
        }
      }
      if (msg.type === "extractComplete") {
        setExtractDone(true);
        setScannedPDF(isScannedPDF());
        const stats = getStats();
        console.log("[TextExtractor] Done:", stats);
      }
      if (msg.type === "error") setError(msg.message);
    } catch {
      /* ignore malformed messages */
    }
  }

  // Stop TTS when navigating away
  useEffect(() => {
    return () => TTSService.stop();
  }, []);

  // Wire RNTP remote-control events (lock screen / notification buttons)
  // RemotePause / RemotePlay mirror the in-app pause/resume buttons.
  // RemoteNext / RemotePrevious skip to the adjacent page.
  useTrackPlayerEvents(RNTP_EVENTS, async (event) => {
    if (event.type === RNTPEvent.RemotePause || (
      event.type === RNTPEvent.PlaybackState && event.state === RNTPState.Paused
      && TTSService.getState() === "playing"
    )) {
      TTSService.pause();
      setTtsState("paused");
    } else if (event.type === RNTPEvent.RemotePlay || (
      event.type === RNTPEvent.PlaybackState && event.state === RNTPState.Playing
      && TTSService.getState() === "paused"
    )) {
      TTSService.resume();
      setTtsState("playing");
    } else if (event.type === RNTPEvent.RemoteStop) {
      TTSService.stop();
      setTtsState("idle");
      setTtsChunk("");
    } else if (event.type === RNTPEvent.RemoteNext) {
      // Skip to next page
      const nextPage = visiblePage + 1;
      if (nextPage <= totalPagesRef.current) {
        TTSService.stop();
        webviewRef.current?.injectJavaScript("window.scrollToPage(" + nextPage + "); void 0;");
        setTimeout(() => handlePlay({ page: nextPage }), 400);
      }
    } else if (event.type === RNTPEvent.RemotePrevious) {
      // Go back to previous page
      const prevPage = visiblePage - 1;
      if (prevPage >= 1) {
        TTSService.stop();
        webviewRef.current?.injectJavaScript("window.scrollToPage(" + prevPage + "); void 0;");
        setTimeout(() => handlePlay({ page: prevPage }), 400);
      }
    }
  });

  // ── Get canvas JPEG from WebView as base64 string ──────────────────────
  function requestPageImage(page) {
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        pendingOCRResolve.current = null;
        console.warn("[OCR] getPageImage timeout for page=" + page);
        resolve("");
      }, 15000);
      pendingOCRResolve.current = (data) => {
        clearTimeout(t);
        resolve(data || "");
      };
      console.log("[OCR] injecting getPageImage(" + page + ")");
      webviewRef.current?.injectJavaScript(
        "window.getPageImage(" + page + "); void 0;",
      );
    });
  }

  // ── OCR.space REST API ───────────────────────────────────────────────
  // Engine 2 + language "vnm" = correct Vietnamese diacritics.
  // Requires free registered key from ocr.space/OCRAPI (not demo "helloworld").
  async function callOCRSpace(page, base64Jpeg) {
    const apiKey = await OcrKeyService.getActiveKey();
    if (!apiKey) {
      console.warn("[OCR] no active key available");
      return { text: "", error: "QUOTA" };
    }
    console.log(
      "[OCR] calling OCR.space page=" + page + " imageLen=" + base64Jpeg.length,
    );
    const body = new FormData();
    body.append("base64Image", "data:image/jpeg;base64," + base64Jpeg);
    body.append("language", "vnm"); // Vietnamese in OCR.space = "vnm" not "vie"
    body.append("OCREngine", "2"); // Engine 2 = OmniPage, best Vietnamese support
    body.append("isOverlayRequired", "false");
    body.append("detectOrientation", "true");
    body.append("scale", "true");
    const res = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      headers: { apikey: apiKey },
      body,
    });
    const json = await res.json();
    console.log(
      "[OCR] response: IsErrored=" +
        json?.IsErroredOnProcessing +
        " exitCode=" +
        json?.OCRExitCode,
    );
    if (json?.IsErroredOnProcessing) {
      const msgs = Array.isArray(json.ErrorMessage)
        ? json.ErrorMessage
        : [String(json.ErrorMessage ?? "unknown")];
      const errMsg = msgs.join(", ");
      console.warn("[OCR] API error: " + errMsg);
      const isQuota =
        res.status === 429 ||
        errMsg.toLowerCase().includes("limit") ||
        errMsg.toLowerCase().includes("quota") ||
        errMsg.toLowerCase().includes("maximum");
      if (isQuota) {
        const nextKey = await OcrKeyService.markQuotaExceeded(apiKey);
        console.log(
          "[OCR] quota exceeded on key, next key:",
          nextKey ? "found" : "none",
        );
      }
      return { text: "", error: isQuota ? "QUOTA" : errMsg };
    }
    const text = json?.ParsedResults?.[0]?.ParsedText?.trim() ?? "";
    console.log(
      "[OCR] result page=" +
        page +
        " len=" +
        text.length +
        " preview: " +
        text.slice(0, 80),
    );
    return { text, error: null };
  }

  // ── Top-level OCR function — called directly from handlePlay ─────────────
  async function doOCRForPage(page) {
    // Check cache first — skip API call entirely if already OCR'd
    const cached = await OcrCacheService.loadOCR(uri, page);
    if (cached !== null) {
      console.log("[OCR] cache hit for page=" + page);
      setPageOCR(page, cached);
      return cached;
    }

    if (ocrBusyRef.current) {
      console.log("[OCR] busy, waiting for current request...");
      await new Promise((r) => setTimeout(r, 300));
    }
    ocrBusyRef.current = true;
    setOcrStatus("Dang nhan dang chu...");
    try {
      const base64 = await requestPageImage(page);
      if (!base64) {
        console.warn("[OCR] no canvas data for page=" + page + ", OCR aborted");
        return "";
      }
      const { text, error } = await callOCRSpace(page, base64);
      if (text) {
        setPageOCR(page, text);
        // Save to cache so this page is never re-requested
        OcrCacheService.saveOCR(uri, page, text);
        return text;
      }
      if (error === "QUOTA") {
        setOcrStatus("OCR: het luot. Them key moi trong Cai dat.");
        await new Promise((r) => setTimeout(r, 3500));
      } else if (error) {
        setOcrStatus("OCR loi: " + error.slice(0, 60));
        await new Promise((r) => setTimeout(r, 2500));
      } else {
        setOcrStatus("OCR khong nhan dang duoc chu");
        await new Promise((r) => setTimeout(r, 2000));
      }
      return "";
    } catch (e) {
      console.error("[OCR] doOCRForPage error:", e.message);
      setOcrStatus("OCR loi: " + e.message.slice(0, 40));
      await new Promise((r) => setTimeout(r, 2000));
      return "";
    } finally {
      ocrBusyRef.current = false;
      setOcrStatus(null);
    }
  }

  // ── Background pre-fetch for next page ────────────────────────────────────────
  // Runs silently (no UI spinner) so the next page is ready when auto-continue fires.
  async function prefetchNextPage(nextPage) {
    if (!uri || nextPage < 1 || nextPage > totalPagesRef.current) return;
    // Text already good? Nothing to do.
    const existing = getPageText(nextPage);
    if (existing && existing.trim().length >= 5 && !isPageGarbled(nextPage)) {
      console.log("[Prefetch] page " + nextPage + " already ready");
      return;
    }
    // Check OCR cache before hitting the API
    const cached = await OcrCacheService.loadOCR(uri, nextPage);
    if (cached !== null) {
      setPageOCR(nextPage, cached);
      console.log("[Prefetch] cache hit page=" + nextPage);
      return;
    }
    // Need real OCR — skip if busy (current page is still being OCR'd)
    if (ocrBusyRef.current) {
      console.log("[Prefetch] OCR busy, skipping page=" + nextPage);
      return;
    }
    if (!isPageGarbled(nextPage) && existing && existing.trim().length >= 5)
      return;
    // Silent OCR — don't touch ocrStatus state
    ocrBusyRef.current = true;
    console.log("[Prefetch] starting silent OCR for page=" + nextPage);
    try {
      const base64 = await requestPageImage(nextPage);
      if (!base64) return;
      const { text } = await callOCRSpace(nextPage, base64);
      if (text) {
        setPageOCR(nextPage, text);
        OcrCacheService.saveOCR(uri, nextPage, text);
        console.log("[Prefetch] done page=" + nextPage + " len=" + text.length);
      }
    } catch (e) {
      console.log("[Prefetch] error:", e.message);
    } finally {
      ocrBusyRef.current = false;
    }
  }

  // ── TTS handlers ─────────────────────────────────────────────────────────────

  // handlePlay({ page?, yPercent?, chunkIndex? })
  //   page:       which page to read (default: visiblePage)
  //   yPercent:   0-1 vertical tap position → maps to chunk index
  //   chunkIndex: explicit chunk to start from (overrides yPercent)
  async function handlePlay({ page: overridePage, yPercent, chunkIndex } = {}) {
    try {
      const page = overridePage ?? visiblePage;
      console.log("[TTS] handlePlay START page=" + page);
      const text0 = getPageText(page);
      const garbled0 = isPageGarbled(page);
      const state0 = TTSService.getState();
      console.log(
        "[TTS] handlePlay page=" +
          page +
          " textLen=" +
          (text0 ? text0.length : 0) +
          " garbled=" +
          garbled0 +
          " ttsState=" +
          state0,
      );

      let text = text0;
      if (!text || text.trim().length < 5) {
        console.log("[TTS] abort: no text for page", page);
        return;
      }

      if (garbled0) {
        console.log("[TTS] garbled page, running OCR...");
        const ocrText = await doOCRForPage(page);
        console.log(
          "[TTS] OCR result len=" +
            (ocrText ? ocrText.length : 0) +
            " preview=" +
            (ocrText ? ocrText.slice(0, 60) : "EMPTY"),
        );
        if (ocrText) text = ocrText;
      }

      if (!text || text.trim().length < 5) {
        console.log("[TTS] abort: text empty after OCR");
        return;
      }

      // Remove page numbers / running headers before speaking
      const cleanedText = cleanTextForTTS(text);

      // Pre-fetch next two pages NOW — doOCRForPage above has already
      // released ocrBusyRef, so page N+1 can start immediately.
      // Page N+2 waits 3 s so the two fetches don't overlap.
      // This ensures both pages are cached before TTS finishes page N
      // even if the screen turns off mid-reading.
      prefetchNextPage(page + 1);
      const prefetchTimer = setTimeout(() => prefetchNextPage(page + 2), 3000);

      // Determine starting chunk
      let startIdx = 0;
      if (chunkIndex != null && chunkIndex > 0) {
        startIdx = chunkIndex;
      } else if (yPercent != null && yPercent > 0) {
        const allChunks = TTSService.splitTextToChunks(cleanedText);
        startIdx = Math.max(0, Math.floor(yPercent * allChunks.length));
      }

      console.log(
        "[TTS] calling speak, startIdx=" +
          startIdx +
          " textPreview=" +
          cleanedText.slice(0, 80),
      );
      // Update lock-screen / notification metadata for the current page
      TTSService.updateNotification(
        route.params?.fileName ?? "PDF Reader Friend",
        "Trang " + page + "/" + totalPagesRef.current,
      );
      TTSService.speak(cleanedText, {
        startChunkIndex: startIdx,
        onChunkChange: (chunk, idx) => {
          setTtsChunk(chunk);
          currentChunkRef.current = idx;
          // Save progress with current chunk index (debounced)
          if (ttsProgressTimerRef.current)
            clearTimeout(ttsProgressTimerRef.current);
          ttsProgressTimerRef.current = setTimeout(() => {
            ProgressService.saveProgress(
              uri,
              route.params?.fileName ?? "",
              page,
              totalPages,
              idx,
            );
          }, 1500);
        },
        onDone: () => {
          console.log("[TTS] onDone page=" + page);
          clearTimeout(prefetchTimer);
          currentChunkRef.current = 0;
          ProgressService.saveProgress(
            uri,
            route.params?.fileName ?? "",
            page,
            totalPagesRef.current,
            0,
          );
          const nextPage = page + 1;
          if (nextPage <= totalPagesRef.current) {
            // Auto-continue: scroll to next page then start reading it
            webviewRef.current?.injectJavaScript(
              "window.scrollToPage(" + nextPage + "); void 0;",
            );
            setTtsChunk("");
            // Small delay lets the scroll animation begin before TTS init
            setTimeout(() => handlePlay({ page: nextPage }), 400);
          } else {
            // Last page — stop
            setTtsState("idle");
            setTtsChunk("");
          }
        },
        onStateChange: (s) => {
          console.log("[TTS] stateChange ->", s);
          setTtsState(s);
        },
      });
      console.log(
        "[TTS] speak() called, chunks=" + TTSService.getTotalChunks(),
      );
    } catch (err) {
      console.error("[TTS] handlePlay ERROR:", err?.message ?? err);
    }
  }

  function handlePause() {
    TTSService.pause();
  }

  function handleResume() {
    TTSService.resume();
  }

  function handleStop() {
    TTSService.stop();
    setTtsChunk("");
  }

  function cycleRate() {
    const steps = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
    const next = steps[(steps.indexOf(ttsRate) + 1) % steps.length];
    setTtsRate(next);
    TTSService.setRate(next);
  }

  // ─────────────────────────────────────────────────────────────────────────────

  const showOverlay = fileLoading || (!webviewReady && !error);

  return (
    <View style={styles.container}>
      {/* Loading overlay */}
      {showOverlay && !error && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.overlayText}>
            {fileLoading ? "Reading file…" : "Loading PDF.js…"}
          </Text>
        </View>
      )}

      {/* Full-screen error */}
      {error && !webviewReady && (
        <View style={styles.errorFull}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* WebView always mounted so CDN scripts load in background */}
      <WebView
        ref={webviewRef}
        source={{ html: VIEWER_HTML, baseUrl: "https://cdnjs.cloudflare.com" }}
        style={styles.webview}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        originWhitelist={["*"]}
        mixedContentMode="always"
      />

      {/* TTS chunk display — shows the sentence currently being read */}
      {ttsChunk.length > 0 && (
        <View style={styles.chunkBar}>
          <Text style={styles.chunkText} numberOfLines={3}>
            {ttsChunk}
          </Text>
        </View>
      )}

      {/* OCR status bar */}
      {ocrStatus !== null && (
        <View
          style={[
            styles.ocrBar,
            ocrStatus.startsWith("OCR") && { backgroundColor: "#B91C1C" },
          ]}
        >
          {!ocrStatus.startsWith("OCR") && (
            <ActivityIndicator
              size="small"
              color="#fff"
              style={{ marginRight: 8 }}
            />
          )}
          <Text style={styles.ocrBarText} numberOfLines={2}>
            {ocrStatus.startsWith("OCR") ? ocrStatus : "Dang nhan dang chu..."}
          </Text>
        </View>
      )}

      {/* Bottom TTS control bar */}
      <View style={styles.controlBar}>
        {/* Page counter */}
        <View style={styles.pageCounter}>
          <Text style={styles.pageCounterText}>
            {totalPages > 0 ? `${visiblePage} / ${totalPages}` : "—"}
          </Text>
        </View>

        {/* Play / Pause / Resume button */}
        {ttsState === "idle" && ocrStatus !== null && (
          // OCR in progress — show spinner instead of button so user knows it’s working
          <View style={[styles.ttsBtn, styles.ttsBtnPrimary]}>
            <ActivityIndicator size="small" color="#fff" />
          </View>
        )}
        {ttsState === "idle" && ocrStatus === null && (
          <TouchableOpacity
            style={[
              styles.ttsBtn,
              styles.ttsBtnPrimary,
              !canRead && styles.ttsBtnDisabled,
            ]}
            onPress={() => {
              console.log("[TTS] onPress fired canRead=" + canRead);
              handlePlay();
            }}
            disabled={!canRead}
          >
            <Text style={styles.ttsBtnText}>▶ Đọc</Text>
          </TouchableOpacity>
        )}
        {ttsState === "playing" && (
          <TouchableOpacity
            style={[styles.ttsBtn, styles.ttsBtnPrimary]}
            onPress={handlePause}
          >
            <Text style={styles.ttsBtnText}>⏸ Dừng</Text>
          </TouchableOpacity>
        )}
        {ttsState === "paused" && (
          <TouchableOpacity
            style={[styles.ttsBtn, styles.ttsBtnPrimary]}
            onPress={handleResume}
          >
            <Text style={styles.ttsBtnText}>▶ Tiếp</Text>
          </TouchableOpacity>
        )}

        {/* Stop button — only when active */}
        {ttsState !== "idle" && (
          <TouchableOpacity
            style={[styles.ttsBtn, styles.ttsBtnStop]}
            onPress={handleStop}
          >
            <Text style={styles.ttsBtnText}>⏹</Text>
          </TouchableOpacity>
        )}

        {/* Speed button */}
        <TouchableOpacity style={styles.rateBtn} onPress={cycleRate}>
          <Text style={styles.rateBtnText}>{ttsRate}x</Text>
        </TouchableOpacity>
      </View>

      {/* Phase 3 — text extraction status (compact, shown until fully done) */}
      {!extractDone && totalPages > 0 && (
        <View style={styles.extractBar}>
          {extractedCount < Math.min(MIN_PAGES_TO_READ, totalPages) && (
            <ActivityIndicator
              size="small"
              color={colors.primary}
              style={{ marginRight: 8 }}
            />
          )}
          <Text style={styles.extractText}>
            {extractedCount < Math.min(MIN_PAGES_TO_READ, totalPages)
              ? `Trích xuất text: ${extractedCount} / ${totalPages}…`
              : `◀ Đang đọc trang ${visiblePage} • nền: ${extractedCount}/${totalPages} trang`}
          </Text>
        </View>
      )}
      {extractDone && scannedPDF && (
        <View style={[styles.extractBar, styles.extractBarWarn]}>
          <Text style={styles.extractWarnText}>
            {"📷 Scan PDF — không có lớp text. OCR chưa hỗ trợ."}
          </Text>
        </View>
      )}
      {extractDone && !scannedPDF && (
        <View style={[styles.extractBar, styles.extractBarOk]}>
          <Text style={styles.extractOkText}>
            {"✅ Đã trích xuất text (" +
              extractedCount +
              " trang) — sẵn sàng TTS"}
          </Text>
        </View>
      )}
    </View>
  );
}

function makeStyles(c) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: "#525659" },

    overlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: c.overlayBg,
      alignItems: "center",
      justifyContent: "center",
      zIndex: 10,
    },
    overlayText: { marginTop: 12, fontSize: 14, color: c.textSecondary },

    errorFull: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: c.background,
      alignItems: "center",
      justifyContent: "center",
      padding: 32,
      zIndex: 10,
    },
    errorIcon: { fontSize: 40, marginBottom: 12 },
    errorText: {
      fontSize: 14,
      color: c.error,
      textAlign: "center",
      lineHeight: 22,
    },

    webview: { flex: 1 },

    // TTS chunk display
    chunkBar: {
      backgroundColor: c.primaryLight,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    chunkText: {
      fontSize: 13,
      color: c.text,
      lineHeight: 20,
      fontStyle: "italic",
    },

    ocrBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#7C3AED",
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    ocrBarText: { fontSize: 13, color: "#fff", fontWeight: "600" },

    // TTS control bar
    controlBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: c.surface,
      borderTopWidth: 1,
      borderTopColor: c.border,
      paddingHorizontal: 16,
      paddingVertical: 12,
      paddingBottom: 20,
    },
    pageCounter: {
      backgroundColor: c.background,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: c.border,
      marginRight: "auto",
    },
    pageCounterText: { fontSize: 13, fontWeight: "600", color: c.text },

    ttsBtn: {
      borderRadius: 10,
      paddingHorizontal: 16,
      paddingVertical: 9,
    },
    ttsBtnPrimary: { backgroundColor: c.primary },
    ttsBtnStop: { backgroundColor: c.error },
    ttsBtnDisabled: { backgroundColor: c.border },
    ttsBtnText: { fontSize: 14, fontWeight: "700", color: "#fff" },

    rateBtn: {
      backgroundColor: c.background,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderWidth: 1,
      borderColor: c.border,
    },
    rateBtnText: { fontSize: 12, fontWeight: "700", color: c.text },

    // Phase 3 — extraction status
    extractBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 16,
      paddingVertical: 8,
      backgroundColor: c.background,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    extractBarWarn: { backgroundColor: c.extractWarnBg },
    extractBarOk: { backgroundColor: c.extractOkBg },
    extractText: { fontSize: 12, color: c.textSecondary },
    extractWarnText: {
      fontSize: 12,
      color: c.extractWarnText,
      textAlign: "center",
    },
    extractOkText: {
      fontSize: 12,
      color: c.extractOkText,
      textAlign: "center",
    },
  });
}
