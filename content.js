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
        const { enabled, whitelisted } = response;

        // Nếu extension tắt hoặc domain trong whitelist → dừng
        if (!enabled || whitelisted) {
            console.log("[AdBlock] Không hoạt động trên trang này");
            return;
        }

        injectAdBlockCSS();
        hideAds();
        startObserver();

        // Đến đây → được phép chạy
        console.log("[AdBlock] Bắt đầu chạy trên:", window.location.hostname);

    } catch (error) {
        // Extension có thể bị reload → bắt lỗi để tránh crash trang
        console.error("[AdBlock] Lỗi khởi tạo:", error);
    }
}

// Gọi hàm initialize đúng thời điểm
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
} else {
    initialize();
}

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

    // Quảng cáo chung theo class/id phổ biến
    "div[class*='banner-ad']",
    "div[class*='advertisement']",
    "div[class*='ad-container']",
    "div[class*='ad-wrapper']",
    "div[id*='ad-container']",
    "div[id*='ad-banner']",
    "div[id*='sponsor']",
    "div[class*='sponsor']",

    // Iframe quảng cáo
    "iframe[src*='ads']",
    "iframe[src*='adservice']",
    "iframe[id*='ad-']",

    // Facebook Ads
    "div[data-testid='placementTracking']",

    // Quảng cáo dạng sticky/popup
    "div[class*='popup-ad']",
    "div[class*='sticky-ad']",
    "div[class*='floating-ad']",
    ".no-ads-under",
    "[class*='no-ads-under']",
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

    // Video ad types (outstream, preroll, inread, ...)
    "[class*='outstream']",
    "[class*='preroll']",
    "[class*='midroll']",
    "[class*='postroll']",
    "[class*='inread']",
    "[class*='native-video']",
    "[class*='sponsored-video']",
    "[class*='promoted-video']",
    "[class*='vast-ad']",
    "[class*='vpaid']",
    "[class*='ima-ad']",
    "[class*='video-ad-container']",
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
];

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
            candidate.style.setProperty("display", "none", "important");
            candidate.dataset.adblockHidden = "true";
            hiddenCount++;
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
                    el.style.setProperty("display", "none", "important");
                    el.dataset.adblockHidden = "true";
                    hiddenCount++;
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
            "aside, [class*='ad'], [id*='ad'], [class*='sponsor'], [class*='promo']," +
            "[class*='outstream'], [class*='inread'], [class*='preroll']"
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
                target.style.setProperty("display", "none", "important");
                target.dataset.adblockHidden = "true";
                hiddenCount++;
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
                target.style.setProperty("display", "none", "important");
                target.dataset.adblockHidden = "true";
                hiddenCount++;
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
        /* YouTube in-player ads */
        .ytp-ad-module,
        .ytp-ad-overlay-container,
        .ytp-ad-text-overlay,
        .ytp-ad-skip-button-container,
        .ytp-ad-player-overlay,
        .ytp-ad-progress,
        .ytp-ad-progress-list,
        .ytp-ad-preview-container,
        .ytp-ad-image-overlay,
        div#player-ads,
        .video-ads.ytp-player-content,
        ytd-action-companion-ad-renderer,
        ytd-banner-promo-renderer,
        ytd-promoted-sparkles-web-renderer,
        ytd-promoted-video-renderer,
        ytd-ad-slot-renderer,
        ytd-in-feed-ad-layout-renderer,
        .ytd-promoted-sparkles-text-search-renderer { display: none !important; }

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
                element.style.setProperty("display", "none", "important");

                // Đánh dấu đã ẩn bởi extension
                element.dataset.adblockHidden = "true";

                hiddenCount++;
            });

        } catch (error) {
            console.warn("[AdBlock] Selector lỗi:", selector, error);
        }
    });

    hideFloatingVideoAds();
    hideVideoLikeAds();

    if (hiddenCount > 0) {
        reportBlocked(hiddenCount);
    }

    return hiddenCount;
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
    // Tìm tất cả element đã bị ẩn bởi extension
    const hiddenElements = document.querySelectorAll("[data-adblock-hidden]");

    hiddenElements.forEach(element => {
        // Xóa style ẩn đã thêm vào
        element.style.removeProperty("display");

        // Xóa đánh dấu
        delete element.dataset.adblockHidden;
    });

    console.log("[AdBlock] Đã hiện lại", hiddenElements.length, "elements");
}

// Xử lý quảng cáo động
let observer = null;

let debounceTimer = null;

function debounceHideAds() {
    // Hủy timer cũ nếu có
    if (debounceTimer) clearTimeout(debounceTimer);

    // Đặt timer mới - chỉ chạy hideAds() sau 100ms không có thay đổi
    debounceTimer = setTimeout(() => {
        hideAds();
    }, 100);
}

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
        attributeFilter: ["class", "src", "style", "data-ad-status"],
        characterData: false // Không cần theo dõi text
    });

    console.log("[AdBlock] MutationObserver đã bật");
}

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

            // Ẩn ngay element đó
            hoveredElement.style.setProperty("display", "none", "important");
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