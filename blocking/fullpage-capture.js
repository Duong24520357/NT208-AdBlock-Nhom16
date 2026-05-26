(function () {
  let fullPageCaptureState = null;

  // Giới hạn canvas để tránh browser block (Safari: 16777216px², Chrome: ~268MP)
  const MAX_CANVAS_HEIGHT = 16000;
  const MAX_CANVAS_WIDTH = 8000;

  function isTopFrame() {
    try {
      return window.top === window.self;
    } catch {
      return true;
    }
  }

  function waitForScrollSettled(targetY, root, attempts = 15) {
    return new Promise((resolve) => {
      let remaining = Math.max(15, attempts);
      let stableCount = 0;
      let lastY = -1;

      const readY = () => {
        try {
          if (root && typeof root.scrollTop === "number") return root.scrollTop;
          return window.scrollY || document.documentElement?.scrollTop || 0;
        } catch {
          return 0;
        }
      };

      const tick = () => {
        const currentY = readY();
        const settled = Math.abs(currentY - targetY) <= 2;
        // Yêu cầu 2 lần liên tiếp ổn định mới resolve (tránh lazy-load jitter)
        if (settled) {
          stableCount++;
          if (stableCount >= 2 || remaining <= 0) {
            resolve();
            return;
          }
        } else {
          stableCount = 0;
        }
        lastY = currentY;
        remaining--;
        if (remaining <= 0) {
          resolve();
          return;
        }
        setTimeout(tick, 80);
      };

      tick();
    });
  }

  function getScrollableCandidates() {
    const seen = new Set();
    const candidates = [];

    const add = (node) => {
      if (!node || seen.has(node)) return;
      seen.add(node);
      candidates.push(node);
    };

    [
      document.scrollingElement,
      document.documentElement,
      document.body,
      document.querySelector("[role='main']"),
      document.querySelector("main"),
      document.querySelector("#root"),
      document.querySelector("#app"),
    ].forEach(add);

    const allNodes = document.querySelectorAll("body *");
    for (const node of allNodes) {
      if (candidates.length >= 1200) break;
      try {
        const style = window.getComputedStyle(node);
        const overflowY = style.overflowY;
        const overflow = (node.scrollHeight || 0) - (node.clientHeight || 0);
        const visible =
          (node.clientHeight || 0) > 0 && (node.clientWidth || 0) > 0;
        if (
          visible &&
          overflow > 100 &&
          (overflowY === "scroll" ||
            overflowY === "auto" ||
            overflowY === "overlay")
        ) {
          add(node);
        }
      } catch {}
    }

    return candidates;
  }

  function detectVirtualScroll() {
    try {
      const root = getScrollRoot();
      if (!root) return false;
      // If the chosen scroll root is an inner element (not the document/body),
      // and it has significant overflow, treat as virtual scroll.
      const isInner =
        root !== document.scrollingElement &&
        root !== document.documentElement &&
        root !== document.body;
      const overflow = Math.max(
        0,
        (root.scrollHeight || 0) - (root.clientHeight || 0),
      );
      return (
        isInner && overflow > Math.max(100, Math.round(root.clientHeight * 0.2))
      );
    } catch {
      return false;
    }
  }

  function getScrollRoot() {
    const candidates = getScrollableCandidates();
    let best = document.scrollingElement || document.documentElement;
    let bestScore = 0;

    candidates.forEach((node) => {
      try {
        const style = window.getComputedStyle(node);
        const overflowY = style.overflowY;
        const overflow = (node.scrollHeight || 0) - (node.clientHeight || 0);
        const visible =
          (node.clientHeight || 0) > 0 && (node.clientWidth || 0) > 0;
        const isScrollable =
          overflowY === "scroll" ||
          overflowY === "auto" ||
          overflowY === "overlay";
        const score =
          overflow > 100
            ? overflow * (isScrollable ? 3 : 1) * (visible ? 1.25 : 0.5)
            : 0;
        if (score > bestScore) {
          best = node;
          bestScore = score;
        }
      } catch {}
    });

    return best;
  }

  function runAsync(task, sendResponse) {
    return Promise.resolve()
      .then(task)
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({ ok: false, reason: error?.message || "UNKNOWN_ERROR" }),
      );
  }

  function normalizeFilenamePart(value) {
    return (
      String(value || "page")
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "_")
        .replace(/^_+|_+$/g, "") || "page"
    );
  }

  function buildFileName(hostname, format) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const ext = format === "image/jpeg" ? "jpg" : "png";
    return `${normalizeFilenamePart(hostname || window.location.hostname || "page")}-${stamp}.${ext}`;
  }

  function normalizeFormat(format) {
    if (format === "image/jpeg" || format === "image/jpg") return "image/jpeg";
    return "image/png";
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("IMAGE_LOAD_FAILED"));
      image.src = dataUrl;
    });
  }

  function clampScale(totalHeight, viewportWidth, scale) {
    // Giảm scale nếu canvas sẽ vượt giới hạn browser
    const rawH = totalHeight * scale;
    const rawW = viewportWidth * scale;
    if (rawH <= MAX_CANVAS_HEIGHT && rawW <= MAX_CANVAS_WIDTH) return scale;
    const scaleByH = MAX_CANVAS_HEIGHT / totalHeight;
    const scaleByW = MAX_CANVAS_WIDTH / viewportWidth;
    return Math.max(1, Math.min(scaleByH, scaleByW));
  }

  function hideFixedElements() {
    const hidden = [];
    document.querySelectorAll("*").forEach((el) => {
      try {
        const style = window.getComputedStyle(el);
        if (style.position === "fixed" || style.position === "sticky") {
          hidden.push({ el, visibility: el.style.visibility });
          el.style.visibility = "hidden";
        }
      } catch {}
    });
    return hidden;
  }

  function restoreFixedElements(hidden) {
    (hidden || []).forEach(({ el, visibility }) => {
      try {
        el.style.visibility = visibility;
      } catch {}
    });
  }

  function ensureCanvas(state) {
    if (state.canvas && state.ctx) return state;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(state.viewportWidth * state.scale));
    canvas.height = Math.max(1, Math.round(state.totalHeight * state.scale));

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("CANVAS_CONTEXT_FAILED");

    state.canvas = canvas;
    state.ctx = ctx;
    return state;
  }

  function getMetrics() {
    if (!isTopFrame()) return { ok: false, reason: "NOT_TOP_FRAME" };

    const scrollRoot = getScrollRoot();
    const totalHeight = Math.max(
      scrollRoot?.scrollHeight || 0,
      scrollRoot?.offsetHeight || 0,
      scrollRoot?.clientHeight || 0,
    );
    const viewportHeight = Math.max(
      1,
      scrollRoot?.clientHeight || window.innerHeight || 0,
    );
    const viewportWidth = Math.max(
      1,
      scrollRoot?.clientWidth || window.innerWidth || 0,
    );

    return {
      ok: true,
      totalHeight,
      viewportHeight,
      viewportWidth,
      originalScrollY: scrollRoot?.scrollTop || window.scrollY || 0,
      hostname: window.location.hostname,
      isVirtualScroll: detectVirtualScroll(),
    };
  }

  function init(message) {
    if (!isTopFrame()) return { ok: false, reason: "NOT_TOP_FRAME" };

    const scrollRoot = getScrollRoot();
    const viewportHeight = Math.max(
      1,
      Math.floor(message.viewportHeight || window.innerHeight || 0),
    );
    const viewportWidth = Math.max(
      1,
      Math.floor(message.viewportWidth || window.innerWidth || 0),
    );
    const totalHeight = Math.max(
      viewportHeight,
      Math.floor(message.totalHeight || 0),
    );
    const format = normalizeFormat(message.format);
    const rawScale = Math.max(1, window.devicePixelRatio || 1);
    // Clamp scale để tránh canvas quá lớn
    const scale = clampScale(totalHeight, viewportWidth, rawScale);

    fullPageCaptureState = {
      hostname: (message.hostname || window.location.hostname || "").trim(),
      totalHeight,
      viewportHeight,
      viewportWidth,
      originalScrollY: Math.max(
        0,
        Math.floor(scrollRoot?.scrollTop || window.scrollY || 0),
      ),
      scrollRoot,
      scrollCandidates: getScrollableCandidates(),
      format,
      scale,
      canvas: null,
      ctx: null,
      fileName: buildFileName(
        message.hostname || window.location.hostname || "page",
        format,
      ),
      drawQueue: Promise.resolve(),
      capturedFrames: 0,
      _hiddenFixed: null,
    };

    return { ok: true, scale }; // Trả scale về để background biết
  }

  function addSegment(message) {
    if (!isTopFrame()) return { ok: false, reason: "NOT_TOP_FRAME" };
    if (!fullPageCaptureState)
      return { ok: false, reason: "STITCH_NOT_INITIALIZED" };

    const dataUrl = message.dataUrl;
    if (!dataUrl) return { ok: false, reason: "MISSING_DATA_URL" };

    const y = Math.max(0, Math.floor(message.y || 0));
    // Chiều cao thực của segment này (frame cuối có thể ngắn hơn)
    const segmentHeight = message.segmentHeight
      ? Math.floor(message.segmentHeight)
      : null;

    fullPageCaptureState.drawQueue = fullPageCaptureState.drawQueue.then(
      async () => {
        const state = ensureCanvas(fullPageCaptureState);
        const image = await loadImage(dataUrl);

        const destY = Math.round(y * state.scale);
        const destW = Math.round(state.viewportWidth * state.scale);
        // Dùng segmentHeight nếu có (tránh stretch frame cuối), fallback về viewportHeight
        const destH = segmentHeight
          ? Math.round(segmentHeight * state.scale)
          : Math.round(state.viewportHeight * state.scale);

        // Clip vùng vẽ để không vượt canvas height
        const clippedH = Math.min(destH, state.canvas.height - destY);
        if (clippedH > 0) {
          state.ctx.drawImage(
            image,
            0,
            0,
            image.width,
            image.height,
            0,
            destY,
            destW,
            clippedH,
          );
        }

        state.capturedFrames += 1;
        return { ok: true };
      },
    );

    return fullPageCaptureState.drawQueue;
  }

  async function finalize() {
    if (!isTopFrame()) return { ok: false, reason: "NOT_TOP_FRAME" };
    if (!fullPageCaptureState)
      return { ok: false, reason: "STITCH_NOT_INITIALIZED" };

    await fullPageCaptureState.drawQueue;
    ensureCanvas(fullPageCaptureState);

    const blob = await new Promise((resolve, reject) => {
      fullPageCaptureState.canvas.toBlob(
        (result) => {
          if (result) resolve(result);
          else reject(new Error("BLOB_CREATION_FAILED"));
        },
        fullPageCaptureState.format,
        fullPageCaptureState.format === "image/jpeg" ? 0.92 : undefined,
      );
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

  function confirmNext(message) {
    if (!isTopFrame()) return { ok: false, reason: "NOT_TOP_FRAME" };
    const frameNo = Math.max(1, Math.floor(message.currentFrame || 1));
    const continueCapture = window.confirm(
      `Đã chụp xong khung ${frameNo}. Bấm OK để chụp tiếp, hoặc Cancel để dừng và lưu ảnh hiện tại.`,
    );
    return { ok: true, continueCapture };
  }

  async function scrollToY(message) {
    if (!isTopFrame()) return { ok: false, reason: "NOT_TOP_FRAME" };

    const targetY = Math.max(0, Math.floor(message.y || 0));
    const roots = [
      fullPageCaptureState?.scrollRoot,
      ...(fullPageCaptureState?.scrollCandidates || []),
      getScrollRoot(),
    ].filter(Boolean);

    const uniqueRoots = [];
    const seen = new Set();
    for (const root of roots) {
      if (seen.has(root)) continue;
      seen.add(root);
      uniqueRoots.push(root);
    }

    for (const root of uniqueRoots) {
      try {
        const before =
          typeof root.scrollTop === "number"
            ? root.scrollTop
            : window.scrollY || document.documentElement?.scrollTop || 0;

        try {
          root.scrollTop = targetY;
        } catch {}
        try {
          window.scrollTo({ top: targetY, left: 0, behavior: "auto" });
        } catch {}
        try {
          window.scrollTo(0, targetY);
        } catch {}
        try {
          if (document.documentElement)
            document.documentElement.scrollTop = targetY;
        } catch {}
        try {
          if (document.body) document.body.scrollTop = targetY;
        } catch {}

        await waitForScrollSettled(targetY, root, 20);

        const after =
          typeof root.scrollTop === "number"
            ? root.scrollTop
            : window.scrollY || document.documentElement?.scrollTop || 0;

        if (Math.abs(after - before) <= 2 && Math.abs(after - targetY) > 2) {
          continue;
        }

        return { ok: true, y: after };
      } catch {}
    }

    return { ok: false, reason: "SCROLL_FAILED" };
  }

  function handleMessage(message, sendResponse) {
    switch (message.type) {
      case "FULLPAGE_GET_METRICS":
        sendResponse(getMetrics());
        return false;
      case "FULLPAGE_HIDE_FIXED":
        {
          const hiddenEls = hideFixedElements();
          if (fullPageCaptureState) {
            fullPageCaptureState._hiddenFixed = hiddenEls;
          }
          sendResponse({ ok: true });
        }
        return false;
      case "FULLPAGE_RESTORE_FIXED":
        {
          if (fullPageCaptureState?._hiddenFixed) {
            restoreFixedElements(fullPageCaptureState._hiddenFixed);
            fullPageCaptureState._hiddenFixed = null;
          }
          sendResponse({ ok: true });
        }
        return false;
      case "FULLPAGE_SCROLL_TO":
        scrollToY(message).then(sendResponse);
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
    confirmNext,
    handleMessage,
    getState,
  };
})();
