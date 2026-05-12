// Hostname and top-frame helper utilities for study-mode
(function () {
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

    window.StudyBlocker = window.StudyBlocker || {};
    window.StudyBlocker.isTopFrame = isTopFrame;
    window.StudyBlocker.normalizeHostname = normalizeHostname;
    window.StudyBlocker.isHostnameBlocked = isHostnameBlocked;
})();
(() => {
    let studyBlockObserver = null;

    function showStudyBlockedOverlay(hostname) {
        if (document.getElementById("adblock-study-blocked")) return;

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

        document.documentElement?.style.setProperty("overflow", "hidden", "important");
        overlay.style.setProperty("pointer-events", "auto", "important");

        (document.body || document.documentElement).appendChild(overlay);
    }

    function enforceStudyBlocked(hostname) {
        if (!window.StudyBlocker?.isTopFrame?.()) return;
        if (document.documentElement?.dataset?.adblockStudyBlocked === "true") {
            showStudyBlockedOverlay(hostname);
            return;
        }

        try { window.stop(); } catch { /* ignore */ }

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

        if (!studyBlockObserver && docEl) {
            studyBlockObserver = new MutationObserver(() => {
                if (!document.getElementById("adblock-study-blocked")) {
                    showStudyBlockedOverlay(hostname);
                }
            });
            studyBlockObserver.observe(docEl, { childList: true, subtree: true });
        }
    }

    async function initPrecheck() {
        try {
            if (!window.StudyBlocker?.isTopFrame?.()) return;
            const currentHostname = window.location.hostname;
            const saved = await chrome.storage.local.get("adblockState");
            const adblockState = saved?.adblockState || {};
            const enabled = adblockState.enabled !== false; // default true
            const blockedDomains = adblockState.blockedDomains || [];
            if (enabled && window.StudyBlocker?.isHostnameBlocked?.(currentHostname, blockedDomains)) {
                enforceStudyBlocked(currentHostname);
            }
        } catch {
            // ignore
        }
    }

    window.StudyBlocker = Object.assign(window.StudyBlocker || {}, {
        enforceStudyBlocked,
        showStudyBlockedOverlay,
        initPrecheck
    });
})();