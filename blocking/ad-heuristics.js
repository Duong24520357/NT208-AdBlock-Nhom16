// Ad detection heuristics moved from content.js
(function () {
    function hasStrongAdSignal(node) {
        if (!node) return false;

        const AD_DOMAINS = window.AdConstants?.AD_DOMAINS || [];
        const text = `${node.id || ""} ${typeof node.className === "string" ? node.className : ""}`.toLowerCase();
        const src = `${node.getAttribute?.("src") || node.src || ""}`.toLowerCase();

        const hasAdDataAttr = node.matches?.(
            "[data-ad-client], [data-ad-slot], [data-ad-type], [data-ad-id], [data-adunit], [data-video-ad], [data-ad-network]"
        );

        const hasKnownToken = /(adsbygoogle|gpt-ad|div-gpt-ad|google_ads|banner-ad|advertisement|ad-container|ad-wrapper|sponsor|promo|video-ad|ad-video|under-player-ad|under-video-ad|outstream|preroll|midroll|postroll|inread|instream|no-ads-under|ads-under)/.test(text);
        const hasAdDomainSrc = AD_DOMAINS.some((domain) => src.includes(domain));

        return Boolean(hasAdDataAttr || hasKnownToken || hasAdDomainSrc);
    }

    function hideFloatingVideoAds() {
        // replicate logic but reference globals at runtime
        let hiddenCount = 0;
        const AD_DOMAINS = window.AdConstants?.AD_DOMAINS || [];
        const STRICT_AD_WRAPPER_SELECTOR = window.AdConstants?.STRICT_AD_WRAPPER_SELECTOR || "";

        const videoContainers = document.querySelectorAll(
            "video, iframe[src*='player'], iframe[src*='video'], div:has(> video), div:has(> iframe), div:has(video)"
        );

        const AD_CONTAINER_SELECTOR = ".no-ads-under,[class*='no-ads-under'],[id*='no-ads-under'],[class*='ads-under'],[id*='ads-under'],.plyr__video-wrapper,.plyr--video,[class*='video-overlay'],[class*='video-ad'],[class*='ad-video'],[class*='under-player-ad'],[class*='under-video-ad'],[class*='floating-video'],[class*='sticky-video'],[id*='video-ad'],[id*='ad-video']";

        const getCandidateContainer = (element) => {
            const adContainer = element.closest(AD_CONTAINER_SELECTOR);
            if (adContainer) return adContainer;
            return null;
        };

        videoContainers.forEach(element => {
            const priorityContainer = getCandidateContainer(element);
            const candidate = priorityContainer || element;
            if (candidate.dataset.adblockHidden) return;

            const style = window.getComputedStyle(candidate);
            const rect = candidate.getBoundingClientRect();
            const zIndex = parseInt(style.zIndex, 10) || 0;
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const html = `${candidate.id || ""} ${candidate.className || ""} ${(candidate.src || "")}`.toLowerCase();

            const isFloating = style.position === "fixed" || style.position === "sticky";
            const isSmallFloating = rect.width < 500 && rect.width > 120 && rect.height > 80;
            const isOverlay = (style.position === "fixed" || style.position === "absolute") && zIndex >= 999 && rect.width >= viewportWidth * 0.3 && rect.height >= viewportHeight * 0.2;

            const srcAttr = (candidate.src || candidate.getAttribute?.("src") || "").toLowerCase();
            const isAdDomainSrc = AD_DOMAINS.some(domain => srcAttr.includes(domain));

            const hasAdSignal = isAdDomainSrc || html.includes("gliastudios") || html.includes("ad") || html.includes("adx") || html.includes("doubleclick") || html.includes("googlesyndication") || html.includes("adservice") || html.includes("ads") || html.includes("no-ads-under") || html.includes("ads-under") || html.includes("under-player") || html.includes("under-video") || html.includes("sponsor") || html.includes("promo") || html.includes("vast") || html.includes("ima");

            const isCornerFloating = (style.position === "fixed" || style.position === "absolute") && zIndex >= 50 && rect.width > 180 && rect.width < window.innerWidth * 0.65 && rect.height > 100 && (rect.right >= window.innerWidth * 0.8 || rect.left <= window.innerWidth * 0.2) && (rect.bottom >= window.innerHeight * 0.7 || rect.top <= window.innerHeight * 0.3);

            const shouldHide = isAdDomainSrc || (isFloating && isSmallFloating) || (isOverlay && hasAdSignal) || (isCornerFloating && hasAdSignal) || (priorityContainer && (isFloating || isOverlay || isCornerFloating));

            if (shouldHide) {
                try {
                    if (window.hideAndCollapse?.(candidate)) {
                        hiddenCount++;
                    }
                } catch (e) { /* ignore */ }
                candidate.dataset.adblockHidden = "true";
            }
        });

        if (hiddenCount > 0) {
            try { window.reportBlocked?.(hiddenCount); } catch (e) { /* ignore */ }
        }
    }

    function hideVideoLikeAds() {
        let hiddenCount = 0;
        const AD_DOMAINS = window.AdConstants?.AD_DOMAINS || [];
        const STRICT_AD_WRAPPER_SELECTOR = window.AdConstants?.STRICT_AD_WRAPPER_SELECTOR || "";

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
                        if (window.hideAndCollapse?.(el)) {
                            hiddenCount++;
                        }
                        el.dataset.adblockHidden = "true";
                    }
                });
            } catch (e) { /* ignore invalid selectors */ }
        });

        document.querySelectorAll("video:not([data-adblock-hidden])").forEach(video => {
            const hasAutoplay = video.hasAttribute("autoplay") || video.autoplay;
            const hasMuted    = video.hasAttribute("muted")    || video.muted;
            const hasNoControls = !video.hasAttribute("controls") && !video.controls;
            const hasNoPoster   = !video.getAttribute("poster");

            const videoSrc = (video.src || video.getAttribute("data-src") || video.getAttribute("data-video-src") || "").toLowerCase();
            const isAdSrc = AD_DOMAINS.some(d => videoSrc.includes(d));

            const adContainer = video.closest(STRICT_AD_WRAPPER_SELECTOR);
            const parent = video.parentElement;
            const hasAdSibling = parent && !!(
                parent.querySelector("[class*='skip']") ||
                parent.querySelector("[class*='countdown']") ||
                parent.querySelector("[class*='close-ad']") ||
                parent.querySelector("[class*='ad-label']") ||
                parent.querySelector("[aria-label*='ad']") ||
                parent.querySelector("[aria-label*='advertisement']")
            );

            const rect = video.getBoundingClientRect();
            const isTinyTracker = rect.width <= 2 || rect.height <= 2;

            const shouldHide = isAdSrc || isTinyTracker || hasAdSibling || (hasAutoplay && hasMuted && hasNoControls && hasNoPoster && !!adContainer) || (hasAutoplay && hasMuted && hasNoControls && !!adContainer);

            if (shouldHide) {
                const target = adContainer || video;
                if (!target.dataset.adblockHidden) {
                    try {
                        if (window.hideAndCollapse?.(target)) {
                            hiddenCount++;
                        }
                    } catch (e) { /* ignore */ }
                }
            }
        });

        document.querySelectorAll("iframe:not([data-adblock-hidden])").forEach(iframe => {
            const src = (iframe.src || iframe.getAttribute("data-src") || "").toLowerCase();
            const isAdSrc = AD_DOMAINS.some(d => src.includes(d));

            const title = (iframe.title || iframe.getAttribute("aria-label") || "").toLowerCase();
            const hasAdTitle = title.includes("advertisement") || title.includes("sponsored") || (title.includes("ad") && title.length < 20);

            if (isAdSrc || hasAdTitle) {
                const parent = iframe.parentElement;
                const target = (parent && parent !== document.body && parent !== document.documentElement) ? parent : iframe;
                if (!target.dataset.adblockHidden) {
                    try { if (window.hideAndCollapse?.(target)) hiddenCount++; } catch (e) { /* ignore */ }
                }
            }
        });

        if (hiddenCount > 0) {
            try { window.reportBlocked?.(hiddenCount); } catch (e) { /* ignore */ }
        }
        return hiddenCount;
    }

    window.AdHeuristics = {
        hasStrongAdSignal,
        hideFloatingVideoAds,
        hideVideoLikeAds
    };
})();
