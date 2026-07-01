# 🛡️ AdBlock+ — NT208 Nhóm 16

> **Chrome Extension (Manifest V3)** — Chặn quảng cáo, chống phishing, đọc tài liệu Studocu miễn phí, chụp màn hình toàn trang, tự động Picture-in-Picture và trợ lý AI ngay trong trình duyệt.

---

## ✨ Tổng quan tính năng

| Tính năng | Mô tả |
|---|---|
| 🚫 **AdBlock** | Chặn quảng cáo bằng `declarativeNetRequest` (MV3) + heuristics DOM |
| 🎓 **Studocu Bypass** | Xem & tải toàn bộ tài liệu trả phí miễn phí |
| 📸 **Full-Page Capture** | Chụp ảnh toàn bộ trang web dài dưới dạng PNG |
| 📺 **Auto PiP** | Tự động bật Picture-in-Picture khi đổi tab |
| 🤖 **AI Sidebar** | Chat AI (OpenRouter) ngay bên cạnh trang web |
| 🔐 **Anti-Phishing** | Chặn tên miền lừa đảo, cập nhật từ OpenPhish |
| 📚 **Study Blocker** | Chặn truy cập mạng xã hội trong giờ học |

---

## 📁 Cấu trúc thư mục

```
NT208-AdBlock-Nhom16/
├── manifest.json                  # Cấu hình extension (MV3)
├── background.js                  # Service worker chính
├── content.js                     # Content script tổng hợp
├── ai-content.js                  # Inject AI sidebar
├── app.py                         # Backend Flask (tùy chọn)
│
├── blocking/
│   ├── ad-constants.js            # Hằng số bộ lọc quảng cáo
│   ├── ad-heuristics.js           # Phát hiện quảng cáo theo DOM
│   ├── cosmetic-engine.js         # Ẩn phần tử quảng cáo bằng CSS
│   ├── dom-observer.js            # Theo dõi DOM thay đổi
│   └── element-picker.js          # Chọn phần tử để chặn thủ công
│
├── studocu/
│   ├── viewdocs.js                # Bypass blur & tải PDF Studocu
│   ├── remove-banner.js           # Xóa banner Premium
│   └── update-inter.js            # Cập nhật font chữ
│
├── fullpage-capture/
│   ├── api-capture.js             # API chụp từng vùng hiển thị
│   └── page.js                    # Ghép ảnh thành toàn trang
│
├── pip/
│   └── pip-manager.js             # Quản lý Picture-in-Picture
│
├── phishing-alert/
│   ├── anti-phishing.js           # Bộ lọc chống phishing
│   └── phishing-alert.html        # Trang cảnh báo đỏ
│
├── study-blocker/
│   ├── study-blocker.js           # Logic chặn trang giải trí
│   └── study-ui.js                # Giao diện Study Mode
│
├── sidebar/                       # React + Vite + Tailwind
│   └── src/
│       ├── App.jsx
│       ├── components/            # ChatColumn, ModelPicker, ...
│       ├── hooks/                 # useChromeStorage, useStreamingChat
│       └── services/openrouter.js
│
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
│
└── rules/
    └── rule.json                  # Bộ quy tắc DNR tĩnh
```

---

## 🚀 Cài đặt

### Yêu cầu

- Google Chrome 116+ (hoặc Chromium-based: Edge, Brave, Opera)
- Node.js 18+ và npm (chỉ để build AI Sidebar)

### 1. Tải mã nguồn

```bash
git clone https://github.com/Duong24520357/NT208-AdBlock-Nhom16.git
cd NT208-AdBlock-Nhom16
```

### 2. Build AI Sidebar (tùy chọn nhưng khuyến nghị)

```bash
cd sidebar
npm install
npm run build
cd ..
```

> Kết quả build xuất vào `sidebar/dist/`, extension sẽ tải tự động.

### 3. Nạp extension vào Chrome

1. Mở Chrome và truy cập `chrome://extensions/`
2. Bật **Developer mode** (góc trên bên phải)
3. Nhấn **Load unpacked**
4. Chọn thư mục gốc `NT208-AdBlock-Nhom16/`
5. Extension xuất hiện trên thanh công cụ ✅

---

## 🎓 Tính năng Studocu — Xem & Tải tài liệu miễn phí

> **Nguồn cảm hứng:** [studocuhack](https://github.com/danieltyukov/studocuhack) của Daniel Tyukov

Tính năng này tích hợp ý tưởng bypass từ studocuhack nhưng được viết lại hoàn toàn trong kiến trúc MV3 với các cải tiến:

### Cách hoạt động

Khi truy cập `studocu.com` hoặc `studocu.vn`, extension tự động:

1. **Xóa banner Premium** — loại bỏ overlay yêu cầu đăng ký trả phí
2. **Bỏ blur** — hiển thị toàn bộ nội dung tài liệu bị làm mờ

### Kỹ thuật

```
studocu/viewdocs.js
│
├── Đọc dữ liệu từ window.__NEXT_DATA__ (Next.js internal)
├── Trích xuất URL ảnh từng trang (bg1.png, bg2.png, ...)
├── Thu thập text overlay (pdf2htmlEX / Viewer_descale / pc-layer)
│   ├── Strategy 1: Viewer_descale (React wrapper)
│   ├── Strategy 2: .pf div với class "pc" (pdf2htmlEX)
│   └── Strategy 3: .page-content với span text
├── Tạo HTML preview với ảnh + text overlay cho mỗi trang
└── Mở blob URL trong tab mới → in PDF
```

---

## 📸 Full-Page Screen Capture

> **Nguồn cảm hứng:** [full-page-screen-capture-chrome-extension](https://github.com/mrcoles/full-page-screen-capture-chrome-extension) của Peter Coles

Tính năng chụp toàn trang được tích hợp vào module `fullpage-capture/`:

### Cách sử dụng

1. Mở popup extension
2. Nhấn nút **Chụp toàn trang**
3. Extension tự động cuộn trang và ghép ảnh
4. Kết quả xuất ra file PNG hoặc PDF và mở trong tab mới

### Kỹ thuật

```
fullpage-capture/
├── api-capture.js   — Dùng chrome.tabs.captureVisibleTab() theo từng đoạn
│                      (giới hạn 15000×4000 px / đoạn để tránh out-of-memory)
└── page.js          — Content script: cuộn trang theo từng bước,
                       nhận signal từ background, ghép canvas cuối cùng
```

**Giới hạn kỹ thuật:**
- Kích thước tối đa: 15 000 × 8 000 px (tổng)
- Không hỗ trợ trang `chrome.google.com/*`

---

## 📺 Auto Picture-in-Picture

> **Nguồn cảm hứng:** [chrome-auto-pip](https://github.com/apotenza92/chrome-auto-pip) của apotenza92

Tự động bật PiP khi người dùng chuyển sang tab khác, tương tự hành vi của Arc Browser hay Firefox.

### Cài đặt bắt buộc (Chrome flag)

```
1. Truy cập: chrome://flags
2. Tìm: auto-picture-in-picture-for-video-playback
3. Đặt thành: Enabled
4. Khởi động lại Chrome
```

### Tính năng PiP

- **Tự động bật PiP** khi đổi tab hoặc cửa sổ mất focus
- **Chọn domain** — giới hạn PiP chỉ trên các trang được phép
- **Nút bật ngay** — "Bật PiP tab này" trong popup
- **Chọn video thông minh** — ưu tiên video đang phát, hỗ trợ iframe
- **Theo dõi visibility** — dùng `visibilitychange` + `chrome.tabs.onActivated`

### Bật/tắt từ Popup

1. Mở popup extension
2. Gạt công tắc **Auto PiP**
3. Nhập tên miền vào ô *Allowed domains* (để trống = áp dụng mọi trang)

---

## 🤖 AI Sidebar (OpenRouter)

Sidebar trợ lý AI được build bằng React + Vite + Tailwind, inject vào mọi trang web.

### Phím tắt

| Phím tắt | Hành động |
|---|---|
| `Ctrl + Shift + K` | Mở/đóng AI Sidebar |

### Tính năng

- **Streaming response** với Markdown, code highlight, nút Copy
- **Multi-model compare** — so sánh 2–4 model cùng lúc
- **Selection actions** — chọn văn bản → Ask AI / Tóm tắt / Dịch / Viết lại / Giải thích code
- **Prompt Templates** — lưu và tái sử dụng prompt hay dùng
- **Dark / Light mode** + kéo thay đổi chiều rộng sidebar
- **API key** lưu trong `chrome.storage.local` (không gửi ra ngoài)

### Cấu hình API key

1. Mở sidebar (`Ctrl + Shift + K`)
2. Vào tab **Settings**
3. Nhập **OpenRouter API key** (đăng ký miễn phí tại [openrouter.ai](https://openrouter.ai))
4. Chọn model và bắt đầu chat

---

## 🔐 Anti-Phishing

Extension tự động bảo vệ khỏi trang web lừa đảo:

- **Danh sách đen tĩnh** — một số domain phishing phổ biến tại Việt Nam
- **Cập nhật động** — tải danh sách mới nhất từ [OpenPhish](https://openphish.com) khi khởi động
- **Chuyển hướng** — domain bị phát hiện → trang cảnh báo đỏ (`phishing-alert.html`)
- **Ưu tiên cao** — rule priority 2, chạy trước AdBlock thông thường

---

## 📚 Study Blocker

Chế độ tập trung học tập:

- Chặn truy cập vào danh sách website giải trí do người dùng cấu hình
- Giao diện thông báo thân thiện thay vì lỗi trình duyệt
- Bật/tắt từ popup theo từng phiên hoặc theo lịch

---

## 🔒 Quyền (Permissions)

| Permission | Mục đích |
|---|---|
| `declarativeNetRequest` | Chặn quảng cáo và phishing |
| `storage` | Lưu cài đặt người dùng |
| `tabs` | Theo dõi tab để PiP và đếm quảng cáo bị chặn |
| `scripting` | Inject content scripts động |
| `downloads` | Tải file (ảnh, PDF) |
| `notifications` | Thông báo khi phát hiện phishing |
| `activeTab` | Truy cập tab đang mở |

---

## 🛠️ Stack kỹ thuật

| Thành phần | Công nghệ |
|---|---|
| Core extension | Vanilla JS, Chrome MV3 |
| Ad blocking | `declarativeNetRequest` + DOM heuristics |
| AI Sidebar | React 18, Vite, Tailwind CSS |
| Backend (tùy chọn) | Python Flask (`app.py`) |
| Streaming AI | OpenRouter API (SSE) |

---

## 👥 Nhóm phát triển

**Môn học:** NT208 — Lập trình ứng dụng WEB 
**Nhóm:** 16  
**Trường:** Đại học Công nghệ Thông tin — ĐHQG TP.HCM

### 1. Tỷ lệ đóng góp của các thành viên
| STT | Họ và tên | MSSV | Nhiệm vụ | Tỷ lệ đóng góp |
|---|---|---|---|---|
| 1 | Đỗ Tến Dương | 24520357 | AntiPhishing, Quản lí cookies phiên đăng nhập |  |
| 2 | Đặng Trần Khánh Duy | 24520365 | Full-Page Capture, Trợ lý AI đa năng, tải video youtube | |
| 3 | Lê Quốc Dương | 24520358 | AdBlock, Studocu Bypass, Auto PiP, Study Blocker | |
| 4 | Lê Huy Phát | 24521299 |  |  |
*(Tổng tỷ lệ đóng góp: 100%)*

### 2. Links Tài nguyên đánh giá
* **Video Demo toàn bộ tính năng:** https://drive.google.com/drive/folders/1HYSOk0Liv0QEpkYxoGNScDVUmzINTZbt

---
---

---

## 📜 Giấy phép & Tín dụng

Dự án tham khảo và lấy cảm hứng từ:

- [studocuhack](https://github.com/danieltyukov/studocuhack) — Daniel Tyukov (MIT)
- [full-page-screen-capture-chrome-extension](https://github.com/mrcoles/full-page-screen-capture-chrome-extension) — Peter Coles (MIT)
- [chrome-auto-pip](https://github.com/apotenza92/chrome-auto-pip) — apotenza92 (MIT)

Toàn bộ mã trong repo này được phát triển độc lập cho mục đích học thuật.
## Chúng em đã biết làm web và hiểu hệ thống web hoạt động như thế nào.
