// DOM observer controller for ad rescanning
(function () {
    let observer = null;
    let debounceTimer = null;

    function debounce(fn, delay) {
        return function () {
            if (debounceTimer) clearTimeout(debounceTimer);
            const args = arguments;
            debounceTimer = setTimeout(() => {
                try { fn.apply(null, args); } catch (e) { /* ignore */ }
            }, delay);
        };
    }

    function start(onRescan) {
        if (observer) return;
        const debouncedRescan = debounce(() => onRescan && onRescan(), 100);

        observer = new MutationObserver((mutations) => {
            const shouldRescan = mutations.some(mutation =>
                mutation.addedNodes.length > 0 || mutation.type === "attributes"
            );
            if (shouldRescan) debouncedRescan();
        });

        try {
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ["class", "src", "style", "data-ad-status", "id"],
                characterData: false
            });
        } catch (e) {
            // ignore observe errors on weird pages
        }

        console.log("[AdBlock] DOMObserver started");
    }

    function stop() {
        if (observer) {
            try { observer.disconnect(); } catch { /* ignore */ }
            observer = null;
        }
        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }
        console.log("[AdBlock] DOMObserver stopped");
    }

    window.DOMObserver = {
        start,
        stop
    };
})();
