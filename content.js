// Kiểm tra tính hợp lệ của URL
// const currentUrl = window.location.href;
// if (currentUrl.startsWith("http://") || currentUrl.startsWith("https://")) {
//     throw new Error("[AdBlock] Không thể chạy trên trang HTTP/HTTPS.");
// }

// Hàm khởi tạo
async function initialize() {
    try {
        // Gửi message lên background.js
        const response = await chrome.runtime.sendMessage({
            type: "GET_STATE"
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
        if (studyBlocked && isTopFrame()) {
            enforceStudyBlocked(hostname || window.location.hostname);
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
            hideAds();
            startObserver();
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

function isTopFrame() {
    try {
        return window.top === window.self;
    } catch {
        return true;
    }
}

function normalizeHostname(input) {
    let hostname = (input || "").trim().toLowerCase();
    if (!hostname) return "";
    if (hostname.startsWith("www.")) hostname = hostname.slice(4);
    return hostname;
}

function isHostnameBlocked(currentHostname, blockedDomains) {
    const host = normalizeHostname(currentHostname);
    if (!host) return false;
    const list = Array.isArray(blockedDomains) ? blockedDomains : [];
    return list.some((domain) => {
        const d = normalizeHostname(domain);
        return d && (host === d || host.endsWith(`.${d}`));
    });
}

let studyBlockObserver = null;

function enforceStudyBlocked(hostname) {
    if (!isTopFrame()) return;
    if (document.documentElement?.dataset?.adblockStudyBlocked === "true") {
        // Overlay có thể bị xóa bởi site script → đảm bảo còn tồn tại
        showStudyBlockedOverlay(hostname);
        return;
    }

    try { window.stop(); } catch { /* ignore */ }

    // Reset DOM về trang trắng để giảm "rác" và làm cảm giác chặn mạnh hơn
    const docEl = document.documentElement;
    if (docEl) {
        docEl.dataset.adblockStudyBlocked = "true";
        while (docEl.firstChild) {
            docEl.removeChild(docEl.firstChild);
        }

        const head = document.createElement("head");
        const title = document.createElement("title");
        title.textContent = "Giờ học";
        head.appendChild(title);

        const body = document.createElement("body");
        body.style.margin = "0";
        body.style.height = "100vh";
        body.style.background = "#000";

        docEl.appendChild(head);
        docEl.appendChild(body);
    }

    showStudyBlockedOverlay(hostname);

    // Giữ overlay luôn tồn tại (site script có thể cố gỡ)
    if (!studyBlockObserver && docEl) {
        studyBlockObserver = new MutationObserver(() => {
            if (!document.getElementById("adblock-study-blocked")) {
                showStudyBlockedOverlay(hostname);
            }
        });
        studyBlockObserver.observe(docEl, { childList: true, subtree: true });
    }
}

function showStudyBlockedOverlay(hostname) {
    if (document.getElementById("adblock-study-blocked")) return;

    // Đảm bảo có body để append
    if (!document.body) {
        const body = document.createElement("body");
        document.documentElement?.appendChild(body);
    }

    const overlay = document.createElement("div");
    overlay.id = "adblock-study-blocked";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.style.cssText = [
        "position:fixed",
        "inset:0",
        "z-index:2147483647",
        "background:rgba(0,0,0,0.92)",
        "color:#fff",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "padding:24px",
        "font-family:system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        "text-align:center",
    ].join(";");

    const box = document.createElement("div");
    box.style.cssText = [
        "max-width:520px",
        "width:100%",
        "border:1px solid rgba(255,255,255,0.15)",
        "border-radius:12px",
        "padding:18px",
        "background:rgba(255,255,255,0.06)",
    ].join(";");

    const title = document.createElement("div");
    title.textContent = "Đang trong giờ học, vui lòng chú ý";
    title.style.cssText = "font-size:18px;font-weight:800;margin-bottom:10px;";

    const desc = document.createElement("div");
    desc.textContent = `Domain: ${hostname || "(không xác định)"}. Mở popup extension để bỏ chặn nếu cần.`;
    desc.style.cssText = "font-size:13px;opacity:0.9;line-height:1.5;";

    box.appendChild(title);
    box.appendChild(desc);
    overlay.appendChild(box);

    // Chặn tương tác trang
    document.documentElement?.style.setProperty("overflow", "hidden", "important");
    overlay.style.setProperty("pointer-events", "auto", "important");

    (document.body || document.documentElement).appendChild(overlay);
}

// Pre-check nhanh từ storage để chặn sớm (service worker đôi khi wake-up chậm)
(async () => {
    try {
        if (!isTopFrame()) return;
        const currentHostname = window.location.hostname;
        const saved = await chrome.storage.local.get("adblockState");
        const adblockState = saved?.adblockState || {};
        const enabled = adblockState.enabled !== false; // default true
        const blockedDomains = adblockState.blockedDomains || [];
        if (enabled && isHostnameBlocked(currentHostname, blockedDomains)) {
            enforceStudyBlocked(currentHostname);
        }
    } catch {
        // ignore
    }
})();

// Gọi hàm initialize ngay khi content script chạy
initialize();

// Hàm khai báo danh sách các selector của quảng cáo
const adSelectors = [
    // Google Ads
    "ins.adsbygoogle",
    "ins[data-ad-client]",
    "ins[data-ad-slot]",
    "ins.adsbygoogle[data-ad-status='unfilled']",
    "ins.adsbygoogle[data-ad-status='filled']",
    "div[id^='google_ads']",
    "div[id^='GoogleAds']",
    "div[id*='google_ads']",
    "div[id*='GoogleAds']",
    "div[id*='div-gpt-ad']",
    "div[class*='gpt-ad']",
    "iframe[src*='googlesyndication']",
    "iframe[src*='doubleclick']",
    "iframe[src*='doubleclick.net']",
    "iframe[src*='pubads.g.doubleclick']",

    // Canvas
    "canvas[id*='canvas']",
    "canvas[class*='canvas']",
    "[id*='box-landing'] canvas",
    "[class*='box-landing'] canvas",
    "[id*='landing-ad'] canvas",
    "[class*='landing-ad'] canvas",
    "canvas[data-ad-type]",
    "canvas[data-ad-id]",
    "div[class*='box-landing']",

    // Quảng cáo chung theo class/id phổ biến
    // "div[class*='banner-ad']",
    // "div[class*='advertisement']",
    // "div[class*='ad-container']",
    // "div[class*='ad-wrapper']",
    // "div[id*='ad-container']",
    // "div[id*='ad-banner']",
    // "div[id*='sponsor']",
    // "div[class*='sponsor']",

    // Iframe quảng cáo
    "iframe[src*='ads']",
    "iframe[src*='adservice']",
    "iframe[id*='ad-']",
    "iframe[src*='vads.net.vn']",

    // Facebook Ads
    "div[data-testid='placementTracking']",

    // Quảng cáo dạng sticky/popup
    "div[class*='popup-ad']",
    "div[class*='sticky-ad']",
    "div[class*='floating-ad']",
    ".no-ads-under",
    "[class*='no-ads-under']",
    "[class*='adzone']",
    "[id*='no-ads-under']",
    "div[class*='ads-under']",
    "div[id*='ads-under']",
    "div[class*='under-player-ad']",
    "div[class*='under-video-ad']",

    // Quảng cáo video
    "div[class*='sticky-video']",
    "div[class*='float-video']",
    "div[class*='floating-video']",
    "div[class*='video-float']",
    "div[class*='video-sticky']",
    "div[class*='video-overlay']",
    "div[class*='overlay-video']",
    "div[class*='video-ad']",
    "div[class*='ad-video']",
    "div[id*='video-ad']",
    "div[id*='ad-video']",
    "div[id*='sticky-video']",
    "div[id*='float-video']",
    "div[class*='video-popup']",
    "div[class*='popup-video']",
    "div[class*='modal-video-ad']",
    "div[class*='interstitial']",

    // YouTube ads
    ".ytp-ad-module",
    ".ytp-ad-overlay-container",
    ".ytp-ad-text-overlay",
    ".ytp-ad-skip-button-container",
    ".ytp-ad-player-overlay",
    "div#player-ads",
    "div.ad-showing",
    ".video-ads",

    // Video ad types (outstream, preroll, inread, instream, ...)
    "[class*='outstream']",
    "[class*='preroll']",
    "[class*='midroll']",
    "[class*='postroll']",
    "[class*='inread']",
    "[class*='instream']",
    "[id*='instream']",
    "div[id*='InstreamDom']",
    "[class*='InstreamDom']",
    "[id*='instream-ad']",
    "[class*='instream-ad']",
    "[class*='instream-wrapper']",
    "[class*='instream-container']",
    "[class*='instreamads']",
    "[class*='native-video']",
    "[class*='sponsored-video']",
    "[class*='promoted-video']",
    "[class*='vast-ad']",
    "[class*='vpaid']",
    "[class*='ima-ad']",
    "[class*='video-ad-container']",
    "[class*='ads-desktop']",
    "div[id*='outstream']",
    "div[id*='preroll']",
    "div[id*='midroll']",
    "div[id*='inread']",

    // Data-attribute quảng cáo
    "[data-ad-type]",
    "[data-ad-id]",
    "[data-adunit]",
    "[data-video-ad]",
    "[data-ad-network]",
    
];

// Danh sách domain quảng cáo dùng chung cho các hàm phát hiện
const AD_DOMAINS = [
    "gliastudios.com",
    "doubleclick.net",
    "googlesyndication",
    "imasdk.googleapis",
    "2mdn.net",
    "fwmrm.net",
    "spotxchange.com",
    "springserve.com",
    "taboola.com",
    "outbrain.com",
    "adnxs.com",
    "rubiconproject.com",
    "openx.net",
    "pubmatic.com",
    "criteo.com",
    "moatads.com",
    "adsrvr.org",
    "advertising.com",
    "smartadserver.com",
    "yieldmo.com",
    "sharethrough.com",
    "triplelift.com",
    "vads.net.vn",
];

// Selector wrapper quảng cáo an toàn, tránh match các class/id chứa "ad" chung chung
const STRICT_AD_WRAPPER_SELECTOR = [
    ".adsbygoogle",
    "[data-ad-client]",
    "[data-ad-slot]",
    "[data-ad-type]",
    "[data-ad-id]",
    "[data-adunit]",
    "[data-video-ad]",
    "[data-ad-network]",
    "[id^='google_ads']",
    "[id^='GoogleAds']",
    "[id*='div-gpt-ad']",
    "[class*='gpt-ad']",
    "[class*='banner-ad']",
    "[class*='advertisement']",
    "[class*='ad-container']",
    "[class*='ad-wrapper']",
    "[id*='ad-container']",
    "[id*='ad-banner']",
    "[class*='sponsor']",
    "[id*='sponsor']",
    "[class*='promo']",
    "[id*='promo']",
    "[class*='video-ad']",
    "[class*='ad-video']",
    "[id*='video-ad']",
    "[id*='ad-video']",
    "[class*='under-player-ad']",
    "[class*='under-video-ad']",
    "[class*='outstream']",
    "[class*='preroll']",
    "[class*='midroll']",
    "[class*='postroll']",
    "[class*='inread']",
    "[class*='instream']",
    "[id*='instream']",
    ".no-ads-under",
    "[class*='no-ads-under']",
    "[id*='no-ads-under']",
    "[class*='ads-under']",
    "[id*='ads-under']",
].join(", ");

// Kiểm tra tín hiệu quảng cáo mạnh trước khi ẩn/collapse để tránh false-positive
function hasStrongAdSignal(node) {
    if (!node) return false;

    const text = `${node.id || ""} ${typeof node.className === "string" ? node.className : ""}`.toLowerCase();
    const src = `${node.getAttribute?.("src") || node.src || ""}`.toLowerCase();

    const hasAdDataAttr = node.matches?.(
        "[data-ad-client], [data-ad-slot], [data-ad-type], [data-ad-id], [data-adunit], [data-video-ad], [data-ad-network]"
    );

    const hasKnownToken = /(adsbygoogle|gpt-ad|div-gpt-ad|google_ads|banner-ad|advertisement|ad-container|ad-wrapper|sponsor|promo|video-ad|ad-video|under-player-ad|under-video-ad|outstream|preroll|midroll|postroll|inread|instream|no-ads-under|ads-under)/.test(text);
    const hasAdDomainSrc = AD_DOMAINS.some((domain) => src.includes(domain));

    return Boolean(hasAdDataAttr || hasKnownToken || hasAdDomainSrc);
}

// Phát hiện video nổi dựa theo CSS style (position: fixed)
function hideFloatingVideoAds() {
    let hiddenCount = 0;

    // Lấy tất cả video và container khả nghi
    const videoContainers = document.querySelectorAll(
        "video, iframe[src*='player'], iframe[src*='video'], div:has(> video), div:has(> iframe), div:has(video)"
    );

    const AD_CONTAINER_SELECTOR = ".no-ads-under,[class*='no-ads-under'],[id*='no-ads-under'],[class*='ads-under'],[id*='ads-under'],.plyr__video-wrapper,.plyr--video,[class*='video-overlay'],[class*='video-ad'],[class*='ad-video'],[class*='under-player-ad'],[class*='under-video-ad'],[class*='floating-video'],[class*='sticky-video'],[id*='video-ad'],[id*='ad-video']";

    const getCandidateContainer = (element) => {
        // Ưu tiên container có tín hiệu quảng cáo rõ ràng
        const adContainer = element.closest(AD_CONTAINER_SELECTOR);
        if (adContainer) return adContainer;
        // Không fallback về div chung chung → trả về null để bỏ qua
        return null;
    };

    videoContainers.forEach(element => {
        // Thử container ưu tiên trước, nếu không có thì kiểm tra chính element
        const priorityContainer = getCandidateContainer(element);
        const candidate = priorityContainer || element;
        if (candidate.dataset.adblockHidden) return;

        const style = window.getComputedStyle(candidate);
        const rect = candidate.getBoundingClientRect();
        const zIndex = parseInt(style.zIndex, 10) || 0;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const html = `${candidate.id || ""} ${candidate.className || ""} ${(candidate.src || "")}`.toLowerCase();

        const isFloating =
            style.position === "fixed" ||      // Cố định góc màn hình
            style.position === "sticky";        // Sticky khi scroll

        const isSmallFloating =
            rect.width < 500 &&
            rect.width > 120 &&
            rect.height > 80;

        const isOverlay =
            (style.position === "fixed" || style.position === "absolute") &&
            zIndex >= 999 &&
            rect.width >= viewportWidth * 0.3 &&
            rect.height >= viewportHeight * 0.2;

        // Kiểm tra src của video/iframe có thuộc domain quảng cáo không
        const srcAttr = (candidate.src || candidate.getAttribute?.("src") || "").toLowerCase();
        const isAdDomainSrc = AD_DOMAINS.some(domain => srcAttr.includes(domain));

        const hasAdSignal =
            isAdDomainSrc ||
            html.includes("gliastudios") ||
            html.includes("ad") ||
            html.includes("adx") ||
            html.includes("doubleclick") ||
            html.includes("googlesyndication") ||
            html.includes("adservice") ||
            html.includes("ads") ||
            html.includes("no-ads-under") ||
            html.includes("ads-under") ||
            html.includes("under-player") ||
            html.includes("under-video") ||
            html.includes("sponsor") ||
            html.includes("promo") ||
            html.includes("vast") ||
            html.includes("ima");

        const isCornerFloating =
            (style.position === "fixed" || style.position === "absolute") &&
            zIndex >= 50 &&
            rect.width > 180 && rect.width < window.innerWidth * 0.65 &&
            rect.height > 100 &&
            (rect.right >= window.innerWidth * 0.8 || rect.left <= window.innerWidth * 0.2) &&
            (rect.bottom >= window.innerHeight * 0.7 || rect.top <= window.innerHeight * 0.3);

        const shouldHide =
            // src trực tiếp từ domain quảng cáo → ẩn dù inline hay floating
            isAdDomainSrc ||
            // video nổi góc màn hình có kích thước nhỏ
            (isFloating && isSmallFloating) ||
            // overlay lớn + có tín hiệu ad
            (isOverlay && hasAdSignal) ||
            // floating ở góc
            (isCornerFloating && hasAdSignal) ||
            // container đúng class ad + đang nổi bất kỳ dạng nào
            (priorityContainer && (isFloating || isOverlay || isCornerFloating));

        if (shouldHide) {
            // Ẩn element
            if (shouldHide) {
                if (hideAndCollapse(candidate)) {
                    hiddenCount++;
                }
            }
            candidate.dataset.adblockHidden = "true";
        }
    });

    if (hiddenCount > 0) {
        reportBlocked(hiddenCount);
    }
}

// Phán đoán và ẩn các phần tử tương tự quảng cáo video (heuristic)
function hideVideoLikeAds() {
    let hiddenCount = 0;

    // --- 1. Ẩn theo selector rõ ràng (outstream, preroll, data-ad-*, ...) ---
    const specificSelectors = [
        "[class*='outstream']", "[class*='preroll']", "[class*='midroll']",
        "[class*='postroll']", "[class*='inread']", "[class*='native-video']",
        "[class*='sponsored-video']", "[class*='promoted-video']",
        "[class*='vast-ad']", "[class*='vpaid']", "[class*='ima-ad']",
        "[class*='video-ad-container']",
        "[data-ad-type]", "[data-ad-id]", "[data-adunit]",
        "[data-video-ad]", "[data-ad-network]",
    ];
    specificSelectors.forEach(sel => {
        try {
            document.querySelectorAll(sel).forEach(el => {
                if (!el.dataset.adblockHidden) {
                    if (hideAndCollapse(el)) {
                        hiddenCount++;
                    }
                    el.dataset.adblockHidden = "true";
                }
            });
        } catch (e) { /* selector không hợp lệ trên browser cũ */ }
    });

    // --- 2. Heuristic: phân tích từng <video> ---
    document.querySelectorAll("video:not([data-adblock-hidden])").forEach(video => {
        const hasAutoplay = video.hasAttribute("autoplay") || video.autoplay;
        const hasMuted    = video.hasAttribute("muted")    || video.muted;
        const hasNoControls = !video.hasAttribute("controls") && !video.controls;
        const hasNoPoster   = !video.getAttribute("poster");

        // src / data-src của chính video
        const videoSrc = (
            video.src ||
            video.getAttribute("data-src") ||
            video.getAttribute("data-video-src") || ""
        ).toLowerCase();
        const isAdSrc = AD_DOMAINS.some(d => videoSrc.includes(d));

        // Container tổ tiên mang class/tag gợi ý quảng cáo
        const adContainer = video.closest(
            STRICT_AD_WRAPPER_SELECTOR
        );

        // Anh em ruột là skip-button, countdown hoặc nhãn "ad"
        const parent = video.parentElement;
        const hasAdSibling = parent && !!(
            parent.querySelector("[class*='skip']")       ||
            parent.querySelector("[class*='countdown']")  ||
            parent.querySelector("[class*='close-ad']")   ||
            parent.querySelector("[class*='ad-label']")   ||
            parent.querySelector("[aria-label*='ad']")    ||
            parent.querySelector("[aria-label*='advertisement']")
        );

        // Pixel theo dõi ẩn (width/height ≤ 2px)
        const rect = video.getBoundingClientRect();
        const isTinyTracker = rect.width <= 2 || rect.height <= 2;

        const shouldHide =
            isAdSrc ||
            isTinyTracker ||
            hasAdSibling ||
            (hasAutoplay && hasMuted && hasNoControls && hasNoPoster && !!adContainer) ||
            (hasAutoplay && hasMuted && hasNoControls && !!adContainer);

        if (shouldHide) {
            const target = adContainer || video;
            if (!target.dataset.adblockHidden) {
                if (hideAndCollapse(target)) {
                    hiddenCount++;
                }
            }
        }
    });

    // --- 3. Heuristic: phân tích từng <iframe> ---
    document.querySelectorAll("iframe:not([data-adblock-hidden])").forEach(iframe => {
        const src = (
            iframe.src ||
            iframe.getAttribute("data-src") || ""
        ).toLowerCase();
        const isAdSrc = AD_DOMAINS.some(d => src.includes(d));

        const title = (
            iframe.title ||
            iframe.getAttribute("aria-label") || ""
        ).toLowerCase();
        const hasAdTitle =
            title.includes("advertisement") ||
            title.includes("sponsored")      ||
            (title.includes("ad") && title.length < 20);

        if (isAdSrc || hasAdTitle) {
            const parent = iframe.parentElement;
            // Ẩn wrapper nếu nó không phải body/html, ngược lại ẩn chính iframe
            const target = (parent && parent !== document.body && parent !== document.documentElement)
                ? parent
                : iframe;
            if (!target.dataset.adblockHidden) {
                if (hideAndCollapse(target)) {
                    hiddenCount++;
                }
            }
        }
    });

    if (hiddenCount > 0) {
        reportBlocked(hiddenCount);
    }
    return hiddenCount;
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

// Hàm ẩn quảng cáo
function hideAds() {
    let hiddenCount = 0;

    adSelectors.forEach(selector => {
        try {
            // Tìm tất cả element khớp với selector
            const elements = document.querySelectorAll(selector);

            elements.forEach(element => {
                // Kiểm tra đã ẩn trước đó chưa
                // tránh đếm trùng khi hideAds() gọi nhiều lần
                if (element.dataset.adblockHidden) return;

                // Ẩn element 
                if (hideAndCollapse(element)) {
                    hiddenCount++;
                }

                // Đánh dấu đã ẩn bởi extension
                element.dataset.adblockHidden = "true";
            });

        } catch (error) {
            console.warn("[AdBlock] Selector lỗi:", selector, error);
        }
    });

    hideFloatingVideoAds();
    hideVideoLikeAds();
    collapseEmptyAdPlaceholders();

    if (hiddenCount > 0) {
        reportBlocked(hiddenCount);
    }

    return hiddenCount;
}

// Dọn các wrapper quảng cáo rỗng để tránh để lại khoảng trắng sau khi ẩn ads
function collapseEmptyAdPlaceholders() {
    const placeholders = document.querySelectorAll(STRICT_AD_WRAPPER_SELECTOR);

    placeholders.forEach((node) => {
        if (node === document.body || node === document.documentElement) return;
        if (node.dataset.adblockCollapsed === "true") return;

        // Chỉ xử lý khi có tín hiệu ad rõ ràng hoặc đã chứa node bị extension ẩn
        const hasAdSignal =
            hasStrongAdSignal(node) ||
            node.querySelector("[data-adblock-hidden='true']") !== null;
        if (!hasAdSignal) return;

        const hasVisibleChild = Array.from(node.children).some((child) => {
            if (child.dataset.adblockHidden === "true" || child.dataset.adblockCollapsed === "true") {
                return false;
            }
            return window.getComputedStyle(child).display !== "none";
        });

        if (!hasVisibleChild) {
            node.dataset.adblockCollapsed = "true";
            node.style.setProperty("height", "0", "important");
            node.style.setProperty("min-height", "0", "important");
            node.style.setProperty("margin", "0", "important");
            node.style.setProperty("padding", "0", "important");
            node.style.setProperty("border", "0", "important");
            node.style.setProperty("overflow", "hidden", "important");
            collapseParentChain(node, 4);
        }
    });
}

// Hàm báo cáo số lượng quảng cáo đã ẩn lên background.js
function reportBlocked(count) {
    chrome.runtime.sendMessage({
        type: "REPORT_BLOCKED",
        count: count
    }).catch(error => {
        console.error("[AdBlock] Lỗi gửi báo cáo:", error);
    });
}

// Hàm hiện lại quảng cáo (khi extension tắt hoặc domain được whitelist)
function showAds() {
    const hiddenElements = document.querySelectorAll("[data-adblock-hidden], [data-adblock-collapsed]");

    hiddenElements.forEach(element => {
        element.style.removeProperty("display");
        element.style.removeProperty("height");
        element.style.removeProperty("min-height");
        element.style.removeProperty("margin");
        element.style.removeProperty("padding");
        element.style.removeProperty("border");
        element.style.removeProperty("overflow");

        delete element.dataset.adblockHidden;
        delete element.dataset.adblockCollapsed;
    });

    console.log("[AdBlock] Đã hiện lại", hiddenElements.length, "elements");
}

// Xử lý quảng cáo động
let observer = null;

let debounceTimer = null;

// Debounce việc quét lại ads để tránh gọi hideAds quá dày
function debounceHideAds() {
    // Hủy timer cũ nếu có
    if (debounceTimer) clearTimeout(debounceTimer);

    // Đặt timer mới - chỉ chạy hideAds() sau 100ms không có thay đổi
    debounceTimer = setTimeout(() => {
        hideAds();
    }, 100);
}

// Bắt đầu theo dõi DOM thay đổi để ẩn quảng cáo động
function startObserver() {
    // Tránh tạo nhiều observer
    if (observer) return;

    observer = new MutationObserver((mutations) => {
        // Bắt cả node mới và đổi class/src/style
        const shouldRescan = mutations.some(mutation =>
            mutation.addedNodes.length > 0 ||
            mutation.type === "attributes"
        );

        if (shouldRescan) {
            debounceHideAds();
        }
    });

    // Bắt đầu theo dõi toàn bộ document
    observer.observe(document.body, {
        childList: true,   // Theo dõi thêm/xóa element con
        subtree: true,     // Theo dõi toàn bộ cây DOM
        attributes: true,  // Theo dõi đổi class/src/style
        attributeFilter: ["class", "src", "style", "data-ad-status", "id"],
        characterData: false // Không cần theo dõi text
    });

    console.log("[AdBlock] MutationObserver đã bật");
}

// Dừng theo dõi DOM và dọn dẹp timer liên quan
function stopObserver() {
    if (observer) {
        observer.disconnect();
        observer = null;

        // Hủy debounce timer nếu đang chờ
        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }

        console.log("[AdBlock] MutationObserver đã tắt");
    }
}

// Lắng nghe message từ background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {

        case "APPLY_COSMETIC_FILTERS":
            if (message.enabled) {
                // Bật AdBlock → ẩn ads + bật observer
                hideAds();
                startObserver();
                console.log("[AdBlock] Đã bật cosmetic filtering");
            } else {
                // Tắt AdBlock → hiện lại ads + tắt observer
                stopObserver();
                showAds();
                console.log("[AdBlock] Đã tắt cosmetic filtering");
            }
            sendResponse({ success: true });
            break;

        case "ENTER_ELEMENT_PICKER":
            startElementPicker();
            sendResponse({ success: true });
            break;

        default:
            sendResponse({ error: "Unknown message type" });
    }
});

// Khởi chạy chế độ chọn phần tử để người dùng tự thêm filter
function startElementPicker() {
    let hoveredElement = null;

    // Thêm style highlight khi hover
    const style = document.createElement("style");
    style.id = "adblock-picker-style";
    style.textContent = `
        .adblock-highlight {
            outline: 2px solid red !important;
            cursor: crosshair !important;
        }
    `;
    document.head.appendChild(style);

    // Highlight element khi di chuột
    function onMouseOver(e) {
        if (hoveredElement) {
            hoveredElement.classList.remove("adblock-highlight");
        }
        hoveredElement = e.target;
        hoveredElement.classList.add("adblock-highlight");
        e.stopPropagation();
    }

    // Click để chọn element → tạo selector → gửi lên background
    function onMouseClick(e) {
        e.preventDefault();
        e.stopPropagation();

        if (hoveredElement) {
            // Tạo selector đơn giản từ element được chọn
            const selector = generateSelector(hoveredElement);

            // Ẩn element đã chọn và collapse nếu cần
            hideAndCollapse(hoveredElement);
            hoveredElement.dataset.adblockHidden = "true";

            // Gửi selector lên background để lưu
            chrome.runtime.sendMessage({
                type: "ADD_CUSTOM_FILTER",
                filter: selector
            });
        }

        // Dừng element picker
        stopElementPicker(onMouseOver, onMouseClick, onKeyDown);
    }

    // Nhấn ESC để thoát
    function onKeyDown(e) {
        if (e.key === "Escape") {
            stopElementPicker(onMouseOver, onMouseClick, onKeyDown);
        }
    }

    document.addEventListener("mouseover", onMouseOver);
    document.addEventListener("click", onMouseClick);
    document.addEventListener("keydown", onKeyDown);
}

// Dừng element picker và dọn dẹp
function stopElementPicker(onMouseOver, onMouseClick, onKeyDown) {
    document.removeEventListener("mouseover", onMouseOver);
    document.removeEventListener("click", onMouseClick);
    document.removeEventListener("keydown", onKeyDown);

    // Xóa highlight còn lại
    document.querySelectorAll(".adblock-highlight")
        .forEach(el => el.classList.remove("adblock-highlight"));

    // Xóa style
    document.getElementById("adblock-picker-style")?.remove();

    console.log("[AdBlock] Element picker đã tắt");
}

// Tạo CSS selector từ element
function generateSelector(element) {
    if (element.id) {
        return `#${element.id}`;
    }
    if (element.className) {
        const classes = Array.from(element.classList).join(".");
        return `${element.tagName.toLowerCase()}.${classes}`;
    }
    return element.tagName.toLowerCase();
}

// Ẩn một phần tử quảng cáo cụ thể
function hideElement(el) {
    if (!el || el.dataset.adblockHidden) return false;
    el.dataset.adblockHidden = "true";
    el.style.setProperty("display", "none", "important");
    return true;
}

// Kiểm tra container có thể collapse mà không làm mất nội dung chính
function shouldCollapseContainer(container) {
    if (!container || container === document.body || container === document.documentElement) return false;
    if (container.dataset.adblockCollapsed) return false;

    // Tránh collapse khối nội dung thật
    const hasContentTags = container.querySelector("article, main, p, h1, h2, h3, ul, ol, table, form");
    if (hasContentTags) return false;

    // Chỉ collapse khi không còn child hiển thị
    const visibleChildren = Array.from(container.children).filter((child) => {
        if (child.dataset.adblockHidden === "true" || child.dataset.adblockCollapsed === "true") return false;
        return window.getComputedStyle(child).display !== "none";
    });

    return visibleChildren.length === 0;
}

// Collapse dần chuỗi thẻ cha để loại bỏ khoảng trắng sau khi ẩn ads
function collapseParentChain(el, maxDepth = 4) {
    let parent = el?.parentElement;
    let depth = 0;  

    while (parent && depth < maxDepth) {
        if (shouldCollapseContainer(parent)) {
            parent.dataset.adblockCollapsed = "true";
            parent.style.setProperty("height", "0", "important");
            parent.style.setProperty("min-height", "0", "important");
            parent.style.setProperty("margin", "0", "important");
            parent.style.setProperty("padding", "0", "important");
            parent.style.setProperty("border", "0", "important");
            parent.style.setProperty("overflow", "hidden", "important");
        }
        parent = parent.parentElement;
        depth++;
    }
}

// Tìm thẻ cha có thể collapse để tránh ô trắng
function findBestHideTarget(el) {
    if (!el) return el;

    // Ưu tiên wrapper có tín hiệu ad để tránh để lại khoảng rỗng
    const wrapper = el.closest(STRICT_AD_WRAPPER_SELECTOR);

    if (wrapper && wrapper !== document.body && wrapper !== document.documentElement && hasStrongAdSignal(wrapper)) {
        return wrapper;
    }

    return el;
}

// Ẩn phần tử quảng cáo và collapse container liên quan
function hideAndCollapse(el) {
    const target = findBestHideTarget(el);
    const hidden = hideElement(target);
    if (hidden) collapseParentChain(target);
    return hidden;
}