// Full page capture flow exported as a blocking module
(function () {
    let fullPageCaptureState = null;

    function isTopFrame() {
        try {
            return window.top === window.self;
        } catch {
            return true;
        }
    }

    function waitForScrollSettled(targetY, attempts = 8) {
        return new Promise((resolve) => {
            let remainingAttempts = Math.max(8, attempts);

            const readY = () => {
                try {
                    return (
                        window.scrollY ||
                        document.documentElement?.scrollTop ||
                        document.body?.scrollTop ||
                        0
                    );
                } catch {
                    return 0;
                }
            };

            const tick = () => {
                const currentY = readY();
                if (Math.abs(currentY - targetY) <= 2 || remainingAttempts <= 0) {
                    resolve();
                    return;
                }

                remainingAttempts -= 1;
                setTimeout(tick, 80);
            };

            tick();
        });
    }

    function runAsync(task, sendResponse) {
        return Promise.resolve()
            .then(task)
            .then((result) => sendResponse(result))
            .catch((error) => {
                sendResponse({
                    ok: false,
                    reason: error?.message || "UNKNOWN_ERROR",
                });
            });
    }

    function normalizeFilenamePart(value) {
        return String(value || "page")
            .toLowerCase()
            .replace(/[^a-z0-9._-]+/g, "_")
            .replace(/^_+|_+$/g, "") || "page";
    }

    function buildFileName(hostname) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        return `${normalizeFilenamePart(hostname || window.location.hostname || "page")}-${stamp}.png`;
    }

    function loadImage(dataUrl) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error("IMAGE_LOAD_FAILED"));
            image.src = dataUrl;
        });
    }

    function ensureCanvas(state) {
        if (state.canvas && state.ctx) {
            return state;
        }

        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(state.viewportWidth * state.scale));
        canvas.height = Math.max(1, Math.round(state.totalHeight * state.scale));

        const ctx = canvas.getContext("2d");
        if (!ctx) {
            throw new Error("CANVAS_CONTEXT_FAILED");
        }

        // Work in device-pixel coordinates; do not call ctx.scale().
        // We'll draw images at their device-pixel sizes.
        state.canvas = canvas;
        state.ctx = ctx;
        return state;
    }

    function getMetrics() {
        if (!isTopFrame()) {
            return { ok: false, reason: "NOT_TOP_FRAME" };
        }

        const doc = document.documentElement;
        const body = document.body;
        const totalHeight = Math.max(
            doc?.scrollHeight || 0,
            body?.scrollHeight || 0,
            doc?.offsetHeight || 0,
            body?.offsetHeight || 0,
            doc?.clientHeight || 0,
        );

        return {
            ok: true,
            totalHeight,
            viewportHeight: window.innerHeight,
            viewportWidth: window.innerWidth,
            originalScrollY: window.scrollY,
            hostname: window.location.hostname,
        };
    }

    function init(message) {
        if (!isTopFrame()) {
            return { ok: false, reason: "NOT_TOP_FRAME" };
        }

        const viewportHeight = Math.max(1, Math.floor(message.viewportHeight || window.innerHeight || 0));
        const viewportWidth = Math.max(1, Math.floor(message.viewportWidth || window.innerWidth || 0));
        const totalHeight = Math.max(viewportHeight, Math.floor(message.totalHeight || 0));

        fullPageCaptureState = {
            hostname: (message.hostname || window.location.hostname || "").trim(),
            totalHeight,
            viewportHeight,
            viewportWidth,
            originalScrollY: Math.max(0, Math.floor(window.scrollY || 0)),
            // Use actual devicePixelRatio (may be fractional); apply scaling when drawing
            scale: Math.max(1, window.devicePixelRatio || 1),
            canvas: null,
            ctx: null,
            fileName: buildFileName(message.hostname || window.location.hostname || "page"),
            drawQueue: Promise.resolve(),
            capturedFrames: 0,
        };

        return { ok: true };
    }

    function addSegment(message) {
        if (!isTopFrame()) {
            return { ok: false, reason: "NOT_TOP_FRAME" };
        }

        if (!fullPageCaptureState) {
            return { ok: false, reason: "STITCH_NOT_INITIALIZED" };
        }

        const dataUrl = message.dataUrl;
        if (!dataUrl) {
            return { ok: false, reason: "MISSING_DATA_URL" };
        }

        const y = Math.max(0, Math.floor(message.y || 0));
        fullPageCaptureState.drawQueue = fullPageCaptureState.drawQueue.then(async () => {
            const state = ensureCanvas(fullPageCaptureState);
            const image = await loadImage(dataUrl);
            // Draw using device-pixel coordinates: scale positions and sizes by devicePixelRatio
            const destY = Math.round(y * state.scale);
            const destW = Math.round(state.viewportWidth * state.scale);
            const destH = Math.round(state.viewportHeight * state.scale);
            state.ctx.drawImage(image, 0, destY, destW, destH);
            state.capturedFrames += 1;
            return { ok: true };
        });

        return fullPageCaptureState.drawQueue;
    }

    async function finalize() {
        if (!isTopFrame()) {
            return { ok: false, reason: "NOT_TOP_FRAME" };
        }

        if (!fullPageCaptureState) {
            return { ok: false, reason: "STITCH_NOT_INITIALIZED" };
        }

        await fullPageCaptureState.drawQueue;
        ensureCanvas(fullPageCaptureState);

        const blob = await new Promise((resolve, reject) => {
            fullPageCaptureState.canvas.toBlob((result) => {
                if (result) {
                    resolve(result);
                } else {
                    reject(new Error("BLOB_CREATION_FAILED"));
                }
            }, "image/png");
        });

        const objectUrl = URL.createObjectURL(blob);
        try {
            const anchor = document.createElement("a");
            anchor.href = objectUrl;
            anchor.download = fullPageCaptureState.fileName;
            anchor.rel = "noopener";
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
        } finally {
            setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        }

        const result = {
            ok: true,
            fileName: fullPageCaptureState.fileName,
            capturedFrames: fullPageCaptureState.capturedFrames,
        };
        fullPageCaptureState = null;
        return result;
    }

    function abort() {
        fullPageCaptureState = null;
        return { ok: true };
    }

    function scrollToY(message) {
        return runAsync(async () => {
            if (!isTopFrame()) {
                return { ok: false, reason: "NOT_TOP_FRAME" };
            }

            const targetY = Math.max(0, Math.floor(message.y || 0));
            // Try multiple ways to set scroll to be robust against pages that
            // intercept window.scrollTo or use non-standard scrolling containers.
            try {
                window.scrollTo({ top: targetY, left: 0, behavior: "auto" });
            } catch {
                try {
                    window.scrollTo(0, targetY);
                } catch {
                    // swallow
                }
            }

            try {
                if (document.documentElement) document.documentElement.scrollTop = targetY;
            } catch {}
            try {
                if (document.body) document.body.scrollTop = targetY;
            } catch {}

            await waitForScrollSettled(targetY, 20);
            return { ok: true, y: window.scrollY };
        });
    }

    function confirmNext(message) {
        if (!isTopFrame()) {
            return { ok: false, reason: "NOT_TOP_FRAME" };
        }

        const frameNo = Math.max(1, Math.floor(message.currentFrame || 1));
        const continueCapture = window.confirm(
            `Đã chụp xong khung ${frameNo}. Bấm OK để chụp tiếp, hoặc Cancel để dừng và lưu ảnh hiện tại.`,
        );
        return { ok: true, continueCapture };
    }

    function handleMessage(message, sendResponse) {
        switch (message.type) {
            case "FULLPAGE_GET_METRICS":
                sendResponse(getMetrics());
                return false;

            case "FULLPAGE_SCROLL_TO":
                scrollToY(message).then((result) => sendResponse(result));
                return true;

            case "FULLPAGE_STITCH_INIT":
                sendResponse(init(message));
                return false;

            case "FULLPAGE_STITCH_ADD":
                runAsync(() => addSegment(message), sendResponse);
                return true;

            case "FULLPAGE_STITCH_FINALIZE":
                runAsync(() => finalize(), sendResponse);
                return true;

            case "FULLPAGE_CONFIRM_NEXT":
                sendResponse(confirmNext(message));
                return false;

            case "FULLPAGE_STITCH_ABORT":
                sendResponse(abort());
                return false;

            default:
                return false;
        }
    }

    function getState() {
        return fullPageCaptureState
            ? {
                ...fullPageCaptureState,
                drawQueue: undefined,
                canvas: undefined,
                ctx: undefined,
            }
            : null;
    }

    window.FullPageCapture = {
        getMetrics,
        init,
        addSegment,
        finalize,
        abort,
        handleMessage,
        getState,
    };
})();