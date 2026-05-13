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

// --- Simov-style fullpage capture integrated ---
function delayMs(ms) {
    return new Promise((res) => setTimeout(res, ms));
}

function loadImageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('IMAGE_LOAD_FAILED'));
        img.src = dataUrl;
    });
}

async function fullPageCaptureSimov(options = {}) {
    const html = document.documentElement;
    const body = document.body;
    // choose container that supports scrollTop
    const container = (() => {
        try {
            html.scrollTop = 1;
            if (html.scrollTop === 1) {
                html.scrollTop = 0;
                return html;
            }
        } catch (e) {}
        return body || html;
    })();

    const originalOverflowHtml = html.style.overflow;
    const originalOverflowBody = body ? body.style.overflow : '';
    const delay = options.delay || 140;

    try {
        // prevent layout shifts
        html.style.overflow = 'hidden';
        if (body) body.style.overflow = 'hidden';

        const images = [];
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;
        const scale = Math.max(1, window.devicePixelRatio || 1);

        let maxScroll = Math.max(0, (container.scrollHeight || document.documentElement.scrollHeight) - viewportHeight);
        let count = 0;
        let userStopped = false;

        // Pre-scroll on first iteration to avoid capturing empty/top frame
        if (maxScroll > 0) {
            container.scrollTop = Math.min(viewportHeight, maxScroll);
            await delayMs(delay);
        }

        // Helper to retry capture if background is not responding
        async function captureViewportWithRetry(maxAttempts = 3) {
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                try {
                    const res = await new Promise((resMsg, rejMsg) => {
                        const timeout = setTimeout(() => {
                            rejMsg(new Error('CAPTURE_TIMEOUT'));
                        }, 5000);

                        chrome.runtime.sendMessage({ type: 'CAPTURE_VIEWPORT' }, (response) => {
                            clearTimeout(timeout);
                            if (chrome.runtime.lastError) {
                                rejMsg(new Error(chrome.runtime.lastError.message));
                            } else {
                                resMsg(response);
                            }
                        });
                    });

                    if (res?.ok) return res;
                    throw new Error(res?.reason || 'CAPTURE_FAILED');
                } catch (err) {
                    console.warn(`[Fullpage Capture] Attempt ${attempt + 1}/${maxAttempts} failed:`, err.message);
                    if (attempt < maxAttempts - 1) {
                        await delayMs(500);
                    } else {
                        throw err;
                    }
                }
            }
        }

        while (true) {
            // ask background to capture visible viewport with retry
            const res = await captureViewportWithRetry();
            const dataUrl = res.dataUrl;
            const currentOffset = Math.max(0, Math.floor(container.scrollTop || 0));
            // compute actual height for last segment
            let height = viewportHeight;
            if (currentOffset + viewportHeight > (container.scrollHeight || document.documentElement.scrollHeight)) {
                height = Math.max(0, (container.scrollHeight || document.documentElement.scrollHeight) - currentOffset);
            }

            images.push({ image: dataUrl, offset: currentOffset, height });

            // Check if reached end before asking
            if (currentOffset >= maxScroll) {
                break;
            }

            // Ask user if they want to continue capturing
            const continueCapture = window.confirm(
                `Đã chụp xong khung ${images.length}. Bấm OK để chụp tiếp, hoặc Cancel để dừng và lưu ảnh hiện tại.`
            );

            if (!continueCapture) {
                userStopped = true;
                break;
            }

            count += 1;
            container.scrollTop = Math.min(currentOffset + viewportHeight, maxScroll);
            await delayMs(delay);

            // guard: if scroll didn't advance after waiting, assume end
            if (container.scrollTop >= maxScroll) break;
        }

        if (images.length === 0) {
            throw new Error('NO_FRAMES_CAPTURED');
        }

        console.log(`[Fullpage Capture] Stitching ${images.length} frames...`);

        // Stitch images into single canvas
        const totalHeight = images.reduce((acc, it) => acc + it.height, 0);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(viewportWidth * scale));
        canvas.height = Math.max(1, Math.round(totalHeight * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('CANVAS_FAILED');

        for (const seg of images) {
            const img = await loadImageFromDataUrl(seg.image);
            const destY = Math.round(seg.offset * scale);
            const destW = Math.round(viewportWidth * scale);
            const destH = Math.round(seg.height * scale);
            ctx.drawImage(img, 0, destY, destW, destH);
        }

        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob((b) => {
                if (b) {
                    console.log(`[Fullpage Capture] Blob created: ${b.size} bytes`);
                    resolve(b);
                } else {
                    reject(new Error('BLOB_FAILED'));
                }
            }, 'image/png');
        });

        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        anchor.download = `screenshot-${(window.location.hostname || 'page')}-${stamp}.png`;
        anchor.rel = 'noopener';
        document.body.appendChild(anchor);
        
        console.log(`[Fullpage Capture] Triggering download: ${anchor.download}`);
        anchor.click();
        anchor.remove();
        setTimeout(() => {
            URL.revokeObjectURL(objectUrl);
            console.log('[Fullpage Capture] ObjectURL revoked');
        }, 1000);

        return { ok: true, fileName: anchor.download, capturedFrames: images.length, userStopped };
    } catch (error) {
        console.error('[Fullpage Capture] Error:', error);
        throw error;
    } finally {
        html.style.overflow = originalOverflowHtml;
        if (body) body.style.overflow = originalOverflowBody;
    }
}

// Listen for simov-style start
chrome.runtime.onMessage.addListener((req, sender, res) => {
    if (req && req.type === 'FULLPAGE_SIMOV_START') {
        fullPageCaptureSimov({ delay: req.delay }).then((result) => res(result)).catch((e) => res({ ok: false, error: e?.message || String(e) }));
        return true;
    }

    return false;
});
