const StudyBlocker = window.StudyBlocker || {};
const StudyUI = window.StudyUI || {};
const CosmeticEngine = window.CosmeticEngine || {};

// Hàm khởi tạo
async function initialize() {
    try {
        // Gửi message lên background.js
        const response = await chrome.runtime.sendMessage({
            type: "GET_STATE",
        });

        // Kiểm tra response có hợp lệ không
        if (!response) {
            console.log("[AdBlock] Không nhận được response từ background");
            return;
        }

        // Lưu trạng thái vào biến cục bộ
        const { enabled, whitelisted, studyBlocked, hostname } = response;

        // Nếu extension tắt → dừng toàn bộ
        if (!enabled) {
            console.log("[AdBlock] Không hoạt động (tắt)");
            return;
        }

        // Chặn domain theo danh sách học tập (chỉ top-frame)
        if (studyBlocked && window.StudyBlocker?.isTopFrame?.()) {
            StudyUI.enforceStudyBlocked?.(hostname || window.location.hostname);
            console.log("[AdBlock] Đã chặn truy cập (học tập):", hostname || window.location.hostname);
            return;
        }

        // Domain trong whitelist → dừng chặn quảng cáo
        if (whitelisted) {
            console.log("[AdBlock] Không hoạt động trên trang này (whitelist)");
            return;
        }

        const startAdBlock = () => {
            injectAdBlockCSS();
            CosmeticEngine.hideAds?.();
            window.DOMObserver?.start?.(CosmeticEngine.hideAds);
            console.log("[AdBlock] Bắt đầu chạy trên:", window.location.hostname);
        };

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", startAdBlock, { once: true });
        } else {
            startAdBlock();
        }
    } catch (error) {
        // Extension có thể bị reload → bắt lỗi để tránh crash trang
        console.error("[AdBlock] Lỗi khởi tạo:", error);
    }
}

// Study UI moved to blocking/study-ui.js

// Pre-check nhanh từ storage để chặn sớm (service worker đôi khi wake-up chậm)
(async () => {
    try {
        if (!window.StudyBlocker?.isTopFrame?.()) return;
        const currentHostname = window.location.hostname;
        const saved = await chrome.storage.local.get("adblockState");
        const adblockState = saved?.adblockState || {};
        const enabled = adblockState.enabled !== false; // default true
        const blockedDomains = adblockState.blockedDomains || [];
        if (enabled && window.StudyBlocker?.isHostnameBlocked?.(currentHostname, blockedDomains)) {
            StudyUI.enforceStudyBlocked?.(currentHostname);
        }
    } catch {
        // ignore
    }
})();

// Gọi hàm initialize ngay khi content script chạy
initialize();

// Ad constants moved to blocking/ad-constants.js
const adSelectors = window.AdConstants?.adSelectors || [];
// AD_DOMAINS moved to blocking/ad-constants.js
const AD_DOMAINS = window.AdConstants?.AD_DOMAINS || [];

// STRICT_AD_WRAPPER_SELECTOR moved to blocking/ad-constants.js
const STRICT_AD_WRAPPER_SELECTOR = window.AdConstants?.STRICT_AD_WRAPPER_SELECTOR || "";

// hasStrongAdSignal delegated to blocking/ad-heuristics.js
function hasStrongAdSignal(node) {
    try { return window.AdHeuristics?.hasStrongAdSignal?.(node) || false; } catch { return false; }
}

// hideFloatingVideoAds delegated to blocking/ad-heuristics.js
function hideFloatingVideoAds() {
    try { return window.AdHeuristics?.hideFloatingVideoAds?.() || 0; } catch { return 0; }
}

// hideVideoLikeAds delegated to blocking/ad-heuristics.js
function hideVideoLikeAds() {
    try { return window.AdHeuristics?.hideVideoLikeAds?.() || 0; } catch { return 0; }
}

// CSS injection: ẩn quảng cáo in-player (YouTube, generic video player)
function injectAdBlockCSS() {
    if (document.getElementById("adblock-css-injected")) return;
    const style = document.createElement("style");
    style.id = "adblock-css-injected";
    style.textContent = `
        /* Hide YouTube UI ads outside player */
        ytd-display-ad-renderer,
        ytd-promoted-video-renderer,
        ytd-in-feed-ad-layout-renderer,
        ytd-ad-slot-renderer {
            display: none !important;
        }

        /* Hide in-player ads ONLY when ad is showing */
        #movie_player.ad-showing .ytp-ad-module,
        #movie_player.ad-showing .ytp-ad-overlay-container,
        #movie_player.ad-showing .ytp-ad-text-overlay,
        #movie_player.ad-showing .ytp-ad-skip-button-container,
        #movie_player.ad-showing .ytp-ad-player-overlay,
        #movie_player.ad-showing .ytp-ad-progress,
        #movie_player.ad-showing .ytp-ad-progress-list,
        #movie_player.ad-showing .ytp-ad-preview-container,
        #movie_player.ad-showing .ytp-ad-image-overlay {
            display: none !important;
        }

        /* Restore player UI when no ad */
        #movie_player:not(.ad-showing) .ytp-ad-module,
        #movie_player:not(.ad-showing) .ytp-ad-overlay-container {
            display: block !important;
        }

        /* Video overlay/floating ads */
        [class*='video-ad'],
        [class*='ad-video'],
        [class*='video-overlay'][class*='ad'],
        [class*='floating-video'][class*='ad'],
        [class*='sticky-video'][class*='ad'],
        [class*='no-ads-under'],
        [class*='ads-under'],
        [class*='under-player-ad'],
        [class*='under-video-ad'] { display: none !important; }

        /* Instream video ads */
        [class*='instream'],
        [id*='instream'],
        [class*='InstreamDom'],
        [id*='InstreamDom'],
        [class*='instream-ad'],
        [id*='instream-ad'],
        [class*='instream-wrapper'],
        [class*='instream-container'],
        [class*='instreamads'],
        [id*='instreamads'] { display: none !important; }
    `;
    document.head.appendChild(style);
}

// Cosmetic engine moved to blocking/cosmetic-engine.js

// DOM observer moved to blocking/dom-observer.js as window.DOMObserver

// Full page capture moved to blocking/fullpage-capture.js as window.FullPageCapture

// Lắng nghe message từ background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (String(message.type || "").startsWith("FULLPAGE_")) {
        return window.FullPageCapture?.handleMessage?.(message, sendResponse) || false;
    }

    switch (message.type) {
        case "APPLY_COSMETIC_FILTERS":
            if (message.enabled) {
                // Bật AdBlock → ẩn ads + bật observer
                CosmeticEngine.hideAds?.();
                window.DOMObserver?.start?.(CosmeticEngine.hideAds);
                console.log("[AdBlock] Đã bật cosmetic filtering");
            } else {
                // Tắt AdBlock → hiện lại ads + tắt observer
                window.DOMObserver?.stop?.();
                CosmeticEngine.showAds?.();
                console.log("[AdBlock] Đã tắt cosmetic filtering");
            }
            sendResponse({ success: true });
            return false;

        case "ENTER_ELEMENT_PICKER":
            window.ElementPicker?.start?.();
            sendResponse({ success: true });
            return false;

        default:
            sendResponse({ error: "Unknown message type" });
            return false;
    }
});

