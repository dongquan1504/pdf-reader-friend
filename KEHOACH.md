# Kế Hoạch Phát Triển App PDF Reader Friend

> App đọc file PDF bằng giọng nói, hỗ trợ tiếng Việt — React Native + Expo SDK 54 (Android)

---

## Trạng Thái Hiện Tại

| Giai đoạn | Tên                                       | Trạng thái    |
| --------- | ----------------------------------------- | ------------- |
| Phase 1   | Setup, navigation, document picker        | ✅ Hoàn thành |
| Phase 2   | Hiển thị PDF (PDF.js v4 + WebView)        | ✅ Hoàn thành |
| Phase 3   | Trích xuất text song song với render      | ✅ Hoàn thành |
| Phase 3b  | OCR ảnh qua OCR.space Engine 2 + `vnm`    | ✅ Hoàn thành |
| Phase 4   | TTS với pause/resume (expo-speech chunks) | ✅ Hoàn thành |
| Phase 5   | Lưu tiến trình đọc                        | ✅ Hoàn thành |
| Phase 5b  | Chọn điểm bắt đầu đọc (tap-to-read)       | ✅ Hoàn thành |
| Phase 6   | Quản lý giọng đọc                         | ✅ Hoàn thành |
| Phase 7   | Theme sáng/tối                            | ✅ Hoàn thành |
| Phase 8   | OCR key pool + cache text + nhập key      | ✅ Hoàn thành |
| Phase 9   | Build APK                                 | ⬜ Chưa làm   |

---

## Kiến Trúc Kỹ Thuật Hiện Tại

```
HomeScreen
  └── document picker (expo-document-picker)
  └── danh sách file gần đây (AsyncStorage)
  └── header right: icon 🌙/☀️ (theme toggle, Phase 7) + icon ⚙️ → OcrKeySettingsScreen

OcrKeySettingsScreen
  └── OcrKeyService.js — quản lý pool API keys
        └── DEFAULT_KEYS (dev thêm sẵn nhiều key trong code)
        └── user thêm key qua UI → lưu AsyncStorage
        └── getActiveKey() / markQuotaExceeded() / addKey() / removeKey()

PDFViewerScreen
  └── WebView
        └── PDF.js v4.4.168 (ES module, jsDelivr CDN)
              └── render từng trang thành <canvas>
              └── getTextContent() song song → postMessage
              └── getPageImage(n) → JPEG base64 khi cần OCR
  └── TextExtractorService.js
        └── lưu text/OCR per page
        └── isGarbled() dùng Unicode range U+1E00-U+1EFF
  └── OcrCacheService.js — cache kết quả OCR vào AsyncStorage
        └── loadAllForFile() dùng multiGet khi mở file
        └── saveOCR() sau khi OCR thành công
        └── loadOCR() kiểm tra cache trước khi gọi API
  └── OcrKeyService.js
        └── getActiveKey() → callOCRSpace dùng thay OCR_API_KEY cứng
        └── markQuotaExceeded() → auto-rotate khi hết quota
  └── OCR.space API (Engine 2, language=vnm)
        └── canvas JPEG → text tiếng Việt đầy đủ dấu
  └── TTSService.js (expo-speech + chunk-based pause/resume)
  └── TTS controls: ▶/⏸/▶/⏹ + tốc độ

Navigation: AppNavigator (react-navigation v6 native-stack)
```

---

## Các Tính Năng Cần Làm

---

### Phase 5 — Lưu & Khôi Phục Tiến Trình Đọc ✅

**Mục tiêu:** Thoát ra, mở lại vẫn nhớ đọc tới trang nào + chunk nào.

**Schema AsyncStorage** (key = `reading_progress_<safeName>_<uriLength>`):

```json
{
  "fileUri": "content://...",
  "fileName": "sach.pdf",
  "currentPage": 42,
  "chunkIndex": 3,
  "lastRead": 1750000000000
}
```

**Tasks:**

- [x] `ProgressService.js`: `saveProgress()`, `loadProgress()`, `clearProgress()`, `loadProgressForFiles()`
- [x] PDFViewerScreen: auto-save khi thay đổi `visiblePage` (debounce 2s), reset chunkIndex = 0
- [x] PDFViewerScreen: auto-save khi TTSService chunk thay đổi (debounce 1.5s)
- [x] PDFViewerScreen: auto-save khi app vào background (AppState listener)
- [x] PDFViewerScreen: khi mở file → check saved progress → hỏi "Tiếp tục từ trang X?" → scroll + auto-start TTS từ chunkIndex đã lưu
- [x] HomeScreen: hiện progress bar + "Trang X/Y (ZZ%)" bên cạnh mỗi file trong danh sách gần đây

---

### Phase 5b — Chọn Điểm Bắt Đầu Đọc ✅

**Mục tiêu:** User có thể chọn trang bất kỳ để bắt đầu đọc, tap vào dòng chữ để đọc từ đó.

**Tasks:**

- [x] Tap vào bất kỳ chỗ nào trên trang PDF → TTS bắt đầu đọc từ vị trí đó (yPercent → chunk index)
- [x] Auto-continue: đọc xong trang N → tự scroll và đọc tiếp trang N+1
- [x] Pre-fetch: khi đang đọc trang N → silently OCR trang N+1 ngay, N+2 sau 3s → không bị gián đoạn khi màn hình tắt
- [x] `cleanTextForTTS()`: loại bỏ số trang và header/footer ngắn trước khi đọc
- [ ] Jump-to-page input: nhấn vào số trang → popup nhập số → scroll đến trang đó
- [ ] Nút ⏭ "Trang tiếp" trên thanh TTS khi đang playing

---

### Phase 6 — Quản Lý Giọng Đọc ✅

**Mục tiêu:** User chọn giọng khác ngoài giọng mặc định Android, có thể preview.

**Tasks:**

- [x] `VoiceSettingScreen.js`: danh sách giọng, ưu tiên `vi-VN` lên đầu, hiện quality
- [x] Nhấn vào giọng → preview câu mẫu bằng giọng đó
- [x] Chọn giọng → lưu voiceId vào AsyncStorage → TTSService dùng khi speak
- [x] `TTSService.setVoiceId()` / `getVoiceId()`: truyền `voice` vào `Speech.speak()`
- [x] `App.js`: load voiceId từ AsyncStorage khi khởi động → set vào TTSService

---

### Phase 7 — Theme Sáng / Tối ✅

**Tasks:**

- [x] `ThemeContext.js` — React Context + `useTheme()` hook, lưu AsyncStorage `@app_theme`
- [x] `colors.js` — `lightColors`, `darkColors`, backward-compat `colors = lightColors`
- [x] Tất cả màn hình dùng `useTheme()` + `makeStyles(colors)` pattern
- [x] Nút toggle ☀️/🌙 trên header HomeScreen
- [x] `AppNavigator.js`: header background/text theo theme
- [x] `App.js`: `StatusBar` style theo theme

---

### Phase 8 — OCR: Key Pool + Cache + Nhập Key Thủ Công ✅

**Mục tiêu:** Giảm request OCR.space, tránh hết quota.

#### 8a — Key Pool (nhiều API key luân phiên)

- [x] `OcrKeyService.js`: lưu danh sách keys trong AsyncStorage
  - `getActiveKey()`: trả về key còn quota đầu tiên
  - `markQuotaExceeded(key)`: đánh dấu key đã hết quota + rotate sang key tiếp theo
  - `addKey(key, label)` / `removeKey(key)` / `listKeys()`
  - `DEFAULT_KEYS`: dev thêm sẵn nhiều key trong code (comment sẵn chỗ thêm)
  - `isBuiltin` flag: key mặc định không xóa được qua UI
- [x] Trong `callOCRSpace`: nếu response là quota error → `markQuotaExceeded` → rotate tự động

#### 8b — Cache Text Đã OCR

- [x] `OcrCacheService.js`: cache AsyncStorage với key `ocr_<fileHash>_p<n>`
  - `loadAllForFile(uri, totalPages)`: dùng `multiGet`, load toàn bộ cache khi mở file
  - `saveOCR(uri, page, text)`: lưu sau khi OCR thành công
  - `loadOCR(uri, page)`: check cache trước khi gọi API (cache hit = 0 request)
  - In-memory cache (`_memCache`) tránh đọc AsyncStorage lặp
- [x] `doOCRForPage`: check cache đầu tiên → nếu hit thì dùng, không gọi API
- [x] `onMessage "loaded"`: `loadAllForFile()` → pre-populate TextExtractorService

#### 8c — Nhập API Key Trong App

- [x] `OcrKeySettingsScreen.js`: màn hình quản lý key
  - Hướng dẫn 4 bước + nút mở `https://ocr.space/OCRAPI` đăng ký
  - Danh sách key với badge "Còn lượt" / "Hết lượt"
  - Key built-in có nhãn "(mặc định)", không xóa được
  - Form thêm key mới (API key + tên gợi nhớ)
  - Nút "Đặt lại" reset quota đầu tháng
- [x] Header HomeScreen: icon ⚙️ (settings) + icon 🌙/☀️ (theme placeholder) góc phải
  - Bỏ nút body, dùng `useLayoutEffect` + `navigation.setOptions({ headerRight })`

---

### Phase 9 — Build APK

- [ ] Cấu hình `eas.json` với profile `production`
- [ ] Tạo app icon + splash screen
- [ ] Set `bundleIdentifier` và `versionCode` trong `app.json`
- [ ] `eas build --platform android --profile production`
- [ ] Test APK trên thiết bị thật
- [ ] Phân phối qua link EAS hoặc upload lên CH Play

---

## Thứ Tự Ưu Tiên Thực Hiện

```
Phase 5b (jump-to-page + nut trang tiep - con lai)
   ↓
Phase 9  (build APK)
```

---

## Ghi Chú Kỹ Thuật Quan Trọng

| Vấn đề                          | Giải pháp                                                                 |
| ------------------------------- | ------------------------------------------------------------------------- |
| VIEWER_HTML phải ASCII thuần    | Mọi ký tự > 127 trong template literal → crash WebView im lặng            |
| Lookbehind regex `/(?<=[.!?])/` | Crash Hermes trên Android → dùng marker `\x00` thay thế                   |
| PDF.js v4 dùng `.mjs`           | Không có `.js` build → dùng `<script type="module">` + jsDelivr           |
| OCR.space Engine 2              | Cần key đăng ký (không phải demo key) + language=`vnm` (không phải `vie`) |
| expo-speech pause/resume        | Không có trên Android → chunk-based: stop + save index + resume từ index  |
| Expo SDK 54                     | KHÔNG nâng lên 55/56 — phải tương thích Expo Go trên CH Play              |

---
