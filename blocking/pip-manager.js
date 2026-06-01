const PipManager = (() => {
  const retryTimers = new WeakMap();

  const state = {
    enabled: true,
    pipEnabled: true,
    pipAllowedDomains: [],
    refreshTimer: null,
    observer: null,
    handlerRegistered: false,
    historyPatched: false,
  };

  function clearRetryTimer(video) {
    if (!video) return;
    const timerId = retryTimers.get(video);
    if (typeof timerId === "number") clearTimeout(timerId);
    retryTimers.delete(video);
  }

  function normalizeDomain(input) {
    const raw = (input || "").trim().toLowerCase();
    if (!raw) return null;
    const candidate = raw.includes("://") ? raw : `http://${raw}`;
    try {
      const url = new URL(candidate);
      let hostname = (url.hostname || "").toLowerCase();
      if (hostname.startsWith("www.")) hostname = hostname.slice(4);
      return hostname || null;
    } catch { return null; }
  }

  function hostnameMatches(hostname, domain) {
    if (!hostname || !domain) return false;
    return hostname === domain || hostname.endsWith(`.${domain}`);
  }

  function isPipAllowedForCurrentPage() {
    const hostname = normalizeDomain(window.location.hostname);
    const allowedDomains = Array.isArray(state.pipAllowedDomains) ? state.pipAllowedDomains : [];
    if (allowedDomains.length === 0) return true;
    return allowedDomains.some((domain) => hostnameMatches(hostname, domain));
  }

  function isPipPermittedInCurrentDocument() {
    try { return document.pictureInPictureEnabled === true; } catch (_) { return false; }
  }

  function isVideoCandidate(video) {
    return !!video && video.readyState >= 1 && !video.ended && !video.disablePictureInPicture;
  }

  function isEligibleVideo(video) {
    return isVideoCandidate(video) && !video.hasAttribute("data-auto-pip-disabled");
  }

  function syncVideoWithRetry(video, retries = 5, delay = 200) {
    if (!video) return;
    if (!state.enabled || !state.pipEnabled || !isPipAllowedForCurrentPage()) {
      clearRetryTimer(video);
      return;
    }
    if (isEligibleVideo(video)) {
      clearRetryTimer(video);
      try { video.setAttribute("autopictureinpicture", ""); } catch (_) {}
      try { video.setAttribute("data-auto-pip-managed", ""); } catch (_) {}
      registerMediaSessionHandler();
      return;
    }
    if (retries <= 0 || video.ended) { clearRetryTimer(video); return; }
    clearRetryTimer(video);
    const timerId = setTimeout(() => {
      retryTimers.delete(video);
      syncVideoWithRetry(video, retries - 1, delay);
    }, delay);
    retryTimers.set(video, timerId);
  }

  function collectVideos(root, videos = new Set()) {
    if (!root) return videos;
    try {
      if (typeof root.querySelectorAll === "function") {
        root.querySelectorAll("video").forEach((v) => videos.add(v));
      }
    } catch (_) {}
    try {
      if (typeof root.querySelectorAll === "function") {
        root.querySelectorAll("*").forEach((el) => {
          if (el && el.shadowRoot) collectVideos(el.shadowRoot, videos);
          if (el && el.tagName === "IFRAME") {
            try { if (el.contentDocument) collectVideos(el.contentDocument, videos); } catch (_) {}
          }
        });
      }
    } catch (_) {}
    return videos;
  }

  function getVideos() {
    return Array.from(collectVideos(document));
  }

  function syncVideo(video) {
    if (!video) return;
    if (!state.enabled || !state.pipEnabled || !isPipAllowedForCurrentPage()) {
      clearRetryTimer(video);
      try { video.removeAttribute("autopictureinpicture"); } catch (_) {}
      try { video.removeAttribute("data-auto-pip-managed"); } catch (_) {}
      return;
    }
    if (isEligibleVideo(video)) {
      clearRetryTimer(video);
      try { video.setAttribute("autopictureinpicture", ""); } catch (_) {}
      try { video.setAttribute("data-auto-pip-managed", ""); } catch (_) {}
      return;
    }
    if (!video.hasAttribute("data-auto-pip-managed")) {
      syncVideoWithRetry(video);
      return;
    }
    clearRetryTimer(video);
    try { video.removeAttribute("autopictureinpicture"); } catch (_) {}
    try { video.removeAttribute("data-auto-pip-managed"); } catch (_) {}
  }

  function refreshVideos() {
    if (!state.enabled || !state.pipEnabled || !isPipAllowedForCurrentPage()) {
      getVideos().forEach((v) => {
        try { v.removeAttribute("autopictureinpicture"); } catch (_) {}
        try { v.removeAttribute("data-auto-pip-managed"); } catch (_) {}
      });
      return;
    }
    getVideos().forEach(syncVideo);
    registerMediaSessionHandler();
  }

  function scheduleRefresh(delay = 0) {
    if (state.refreshTimer) clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => {
      state.refreshTimer = null;
      refreshVideos();
    }, delay);
  }

  // ─── PiP enter / exit ────────────────────────────────────────────────────

  const pipDeniedVideos = new WeakSet();

  async function tryEnterPip() {
    if (!state.enabled || !state.pipEnabled || !isPipAllowedForCurrentPage()) return;
    if (!isPipPermittedInCurrentDocument()) return;
    if (document.pictureInPictureElement) return;

    const candidate = getVideos().find(
      (v) =>
        isEligibleVideo(v) &&
        !v.paused &&
        !v.ended &&
        v.readyState >= 2 &&
        !pipDeniedVideos.has(v)
    );
    if (!candidate) return;

    try {
      await candidate.requestPictureInPicture();
    } catch (err) {
      if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
        pipDeniedVideos.add(candidate);
      }
    }
  }

  // Thoát PiP và đợi sự kiện leavepictureinpicture trên video trước khi resolve.
  // Điều này đảm bảo video element được trả về đúng vị trí trong DOM
  // trước khi tab visible và render lại, tránh bị phủ mất.
  function tryExitPip() {
    const pipVideo = document.pictureInPictureElement;
    if (!pipVideo) return Promise.resolve();

    return new Promise((resolve) => {
      // Timeout fallback 800ms phòng trường hợp sự kiện không fire
      const timer = setTimeout(resolve, 800);

      pipVideo.addEventListener(
        "leavepictureinpicture",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );

      document.exitPictureInPicture().catch(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────

  function onEnterPictureInPictureAction() {
    refreshVideos();
  }

  // Dùng flag để tránh onVisibilityChange chạy đè lên nhau khi
  // user chuyển tab nhanh liên tục.
  let visibilityLock = false;

  async function onVisibilityChange() {
    if (!state.enabled || !state.pipEnabled || !isPipAllowedForCurrentPage()) return;
    if (visibilityLock) return;

    visibilityLock = true;
    try {
      if (document.visibilityState === "hidden") {
        await tryEnterPip();
      } else if (document.visibilityState === "visible") {
        // Đợi PiP exit hoàn toàn (leavepictureinpicture) trước khi refresh,
        // tránh video PiP còn overlay lên video chính.
        await tryExitPip();
        scheduleRefresh(0);
      }
    } finally {
      visibilityLock = false;
    }
  }

  function onVideoEvent(event) {
    const video = event?.target;
    if (!(video instanceof HTMLVideoElement)) return;

    if (event.type === "play" || event.type === "playing") {
      pipDeniedVideos.delete(video);
    }

    syncVideo(video);

    if (event.type === "pause" && document.visibilityState === "visible") {
      try { video.setAttribute("data-auto-pip-user-paused-at", String(Date.now())); } catch (_) {}
    }

    if (
      event.type === "play" ||
      event.type === "playing" ||
      event.type === "loadedmetadata" ||
      event.type === "loadeddata" ||
      event.type === "canplay"
    ) {
      scheduleRefresh(0);
    }
  }

  function observeDom() {
    if (state.observer) return;
    state.observer = new MutationObserver((mutations) => {
      let needsRefresh = false;
      for (const mutation of mutations) {
        if (mutation.type === "childList" && (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)) {
          mutation.addedNodes.forEach((node) => {
            if (!(node instanceof Element)) return;
            if (node instanceof HTMLVideoElement) { syncVideoWithRetry(node); return; }
            try {
              if (typeof node.querySelectorAll === "function") {
                node.querySelectorAll("video").forEach((v) => syncVideoWithRetry(v));
              }
            } catch (_) {}
          });
          needsRefresh = true;
          continue;
        }
        if (mutation.type === "attributes" && mutation.target instanceof HTMLVideoElement) {
          needsRefresh = true;
        }
      }
      if (needsRefresh) scheduleRefresh(100);
    });
    try {
      state.observer.observe(document.documentElement || document, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["paused", "readyState", "src", "autopictureinpicture"],
      });
    } catch (_) {}
  }

  async function loadState() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
      if (response) {
        state.enabled = response.enabled !== false;
        state.pipEnabled = response.pipEnabled !== false;
        state.pipAllowedDomains = Array.isArray(response.pipAllowedDomains)
          ? response.pipAllowedDomains.slice()
          : [];
      }
    } catch (_) {}
    refreshVideos();
  }

  function registerMediaSessionHandler() {
    if (state.handlerRegistered) return;
    if (!navigator.mediaSession || typeof navigator.mediaSession.setActionHandler !== "function") return;
    try {
      navigator.mediaSession.setActionHandler("enterpictureinpicture", onEnterPictureInPictureAction);
      state.handlerRegistered = true;
    } catch (_) {}
  }

  function register() {
    if (document.__adblockPipManagerRegistered) return;
    document.__adblockPipManagerRegistered = true;

    ["play", "playing", "pause", "loadedmetadata", "loadeddata", "canplay"].forEach((eventName) => {
      document.addEventListener(eventName, onVideoEvent, true);
    });

    document.addEventListener("visibilitychange", onVisibilityChange, true);
    window.addEventListener("pageshow", () => scheduleRefresh(0), true);

    let hasNavigationApi = false;
    try {
      if (window.navigation && typeof window.navigation.addEventListener === "function") {
        hasNavigationApi = true;
        window.navigation.addEventListener("navigate", () => scheduleRefresh(300));
      }
    } catch (_) {}

    try {
      if (!hasNavigationApi && !state.historyPatched && history && typeof history.pushState === "function") {
        const _push = history.pushState.bind(history);
        const _replace = typeof history.replaceState === "function" ? history.replaceState.bind(history) : null;
        history.pushState = function (...args) {
          try { _push(...args); } catch (_) {}
          scheduleRefresh(500);
        };
        if (_replace) {
          history.replaceState = function (...args) {
            try { _replace(...args); } catch (_) {}
            scheduleRefresh(500);
          };
        }
        window.addEventListener("popstate", () => scheduleRefresh(500));
        state.historyPatched = true;
      }
    } catch (_) {}

    observeDom();
    loadState();
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.type !== "string") return;

    if (message.type === "PIP_SETTING_CHANGED") {
      state.pipEnabled = message.enabled !== false;
      if (Array.isArray(message.allowedDomains)) {
        state.pipAllowedDomains = message.allowedDomains.slice();
      }
      refreshVideos();
      sendResponse?.({ success: true });
      return true;
    }

    if (message.type === "PREPARE_AUTO_PIP" || message.type === "REFRESH_PIP_STATE") {
      refreshVideos();
      sendResponse?.({ success: true });
      return false;
    }
  });

  register();

  return { refreshVideos };
})();