// Cosmetic blocking and collapse utilities moved from content.js
(function () {
    function isYouTubePlayerSurface(el) {
        return Boolean(el && el.closest && el.closest(
            ".ytp-player-content, .ytp-iv-player-content, #movie_player"
        ));
    }

    function hideElement(el) {
        if (!el || el.dataset.adblockHidden) return false;
        if (isYouTubePlayerSurface(el)) return false;
        el.dataset.adblockHidden = "true";
        el.style.setProperty("display", "none", "important");
        return true;
    }

    function shouldCollapseContainer(container) {
        if (!container || container === document.body || container === document.documentElement) return false;
        if (container.dataset.adblockCollapsed) return false;
        if (isYouTubePlayerSurface(container)) return false;

        const hasContentTags = container.querySelector("article, main, p, h1, h2, h3, ul, ol, table, form");
        if (hasContentTags) return false;

        const visibleChildren = Array.from(container.children).filter((child) => {
            if (child.dataset.adblockHidden === "true" || child.dataset.adblockCollapsed === "true") return false;
            return window.getComputedStyle(child).display !== "none";
        });

        return visibleChildren.length === 0;
    }

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

    function findBestHideTarget(el) {
        if (!el) return el;
        if (isYouTubePlayerSurface(el)) return null;

        const STRICT_AD_WRAPPER_SELECTOR = window.AdConstants?.STRICT_AD_WRAPPER_SELECTOR || "";
        const wrapper = el.closest(STRICT_AD_WRAPPER_SELECTOR);

        if (wrapper && wrapper !== document.body && wrapper !== document.documentElement && window.AdHeuristics?.hasStrongAdSignal?.(wrapper)) {
            return wrapper;
        }

        return el;
    }

    function hideAndCollapse(el) {
        const target = findBestHideTarget(el);
        if (!target) return false;
        const hidden = hideElement(target);
        if (hidden) collapseParentChain(target);
        return hidden;
    }

    function collapseEmptyAdPlaceholders() {
        const STRICT_AD_WRAPPER_SELECTOR = window.AdConstants?.STRICT_AD_WRAPPER_SELECTOR || "";
        const placeholders = document.querySelectorAll(STRICT_AD_WRAPPER_SELECTOR);

        placeholders.forEach((node) => {
            if (node === document.body || node === document.documentElement) return;
            if (node.dataset.adblockCollapsed === "true") return;
            if (isYouTubePlayerSurface(node)) return;

            const hasAdSignal = window.AdHeuristics?.hasStrongAdSignal?.(node) || node.querySelector("[data-adblock-hidden='true']") !== null;
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

    function reportBlocked(count) {
        chrome.runtime.sendMessage({
            type: "REPORT_BLOCKED",
            count: count
        }).catch(error => {
            console.error("[AdBlock] Lỗi gửi báo cáo:", error);
        });
    }

    function hideAds() {
        let hiddenCount = 0;
        const adSelectors = window.AdConstants?.adSelectors || [];

        adSelectors.forEach(selector => {
            try {
                const elements = document.querySelectorAll(selector);

                elements.forEach(element => {
                    if (element.dataset.adblockHidden) return;
                    if (hideAndCollapse(element)) {
                        hiddenCount++;
                    }
                    element.dataset.adblockHidden = "true";
                });
            } catch (error) {
                console.warn("[AdBlock] Selector lỗi:", selector, error);
            }
        });

        try { window.AdHeuristics?.hideFloatingVideoAds?.(); } catch { /* ignore */ }
        try { window.AdHeuristics?.hideVideoLikeAds?.(); } catch { /* ignore */ }
        collapseEmptyAdPlaceholders();

        if (hiddenCount > 0) {
            reportBlocked(hiddenCount);
        }

        return hiddenCount;
    }

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

    window.CosmeticEngine = {
        hideElement,
        shouldCollapseContainer,
        collapseParentChain,
        findBestHideTarget,
        hideAndCollapse,
        collapseEmptyAdPlaceholders,
        reportBlocked,
        hideAds,
        showAds
    };

    window.hideAndCollapse = hideAndCollapse;
    window.reportBlocked = reportBlocked;
})();
