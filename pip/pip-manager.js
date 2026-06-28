const PipManager = (() => {
  const retryTimers = new WeakMap();
  let preparedPipVideo = null;

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

  function isTopLevelDocument() {
    try { return window.top === window; } catch (_) { return false; }
  }

  function isFeatureAllowedByPolicy(featureName) {
    const policy = document.permissionsPolicy || document.featurePolicy;
    if (!policy || typeof policy.allowsFeature !== "function") {
      return isTopLevelDocument();
    }

    try { return policy.allowsFeature(featureName) !== false; } catch (_) { return false; }
  }

  function isPipPermittedInCurrentDocument() {
    if (!isFeatureAllowedByPolicy("picture-in-picture")) return false;
    if (typeof HTMLVideoElement === "undefined") return false;
    if (typeof HTMLVideoElement.prototype.requestPictureInPicture !== "function") return false;
    if (typeof document.exitPictureInPicture !== "function") return false;
    return true;
  }

  function canManagePipInCurrentDocument() {
    return (
      state.enabled &&
      state.pipEnabled &&
      isPipAllowedForCurrentPage() &&
      isPipPermittedInCurrentDocument()
    );
  }

  function isYouTubePage() {
    return /(^|\.)youtube(?:-nocookie)?\.com$/.test(window.location.hostname);
  }

  function normalizeYouTubeVideoFlags(video) {
    if (!isYouTubePage() || !video) return;
    try { video.disablePictureInPicture = false; } catch (_) {}
    try { video.removeAttribute("disablepictureinpicture"); } catch (_) {}
  }

  function isYouTubeAdVideo(video) {
    if (!isYouTubePage() || !video?.closest) return false;
    const player = video.closest("#movie_player");
    if (!player) return false;
    return (
      player.classList.contains("ad-showing") ||
      player.classList.contains("ad-interrupting") ||
      !!player.querySelector(".ytp-ad-player-overlay, .ytp-ad-preview-container")
    );
  }

  function isVideoCandidate(video) {
    if (!video || video.ownerDocument !== document) return false;
    normalizeYouTubeVideoFlags(video);
    return video.readyState >= 1 && !video.ended && !video.disablePictureInPicture && !isYouTubeAdVideo(video);
  }

  function isEligibleVideo(video) {
    return isVideoCandidate(video) && !video.hasAttribute("data-auto-pip-disabled");
  }

  function isPreparedPipVideo(video) {
    if (preparedPipVideo && !preparedPipVideo.isConnected) {
      preparedPipVideo = null;
    }
    return !!video && (video === preparedPipVideo || video.hasAttribute("data-auto-pip-prepared"));
  }

  function clearPreparedPipMarkers(exceptVideo = null) {
    getVideos().forEach((video) => {
      if (video === exceptVideo) return;
      try { video.removeAttribute("data-auto-pip-prepared"); } catch (_) {}
    });

    preparedPipVideo = exceptVideo;
  }

  function isVisibleVideo(video) {
    if (!video || video.ownerDocument !== document) return false;

    let rect;
    try { rect = video.getBoundingClientRect(); } catch (_) { return false; }
    if (!rect || rect.width < 80 || rect.height < 45) return false;
    if (rect.bottom <= 0 || rect.right <= 0) return false;
    if (rect.top >= window.innerHeight || rect.left >= window.innerWidth) return false;

    try {
      const style = window.getComputedStyle(video);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
        return false;
      }
    } catch (_) {}

    return true;
  }

  function getVideoScore(video) {
    if (!isEligibleVideo(video) || video.paused || video.ended || video.readyState < 2 || pipDeniedVideos.has(video)) {
      return -1;
    }

    let score = 0;
    let rect = null;

    if (isVisibleVideo(video)) {
      rect = video.getBoundingClientRect();
      score += 1000;
      score += Math.min(rect.width * rect.height, 1000000) / 1000;
    }

    if (document.fullscreenElement?.contains?.(video)) score += 700;
    if (isPreparedPipVideo(video)) score += 2000;
    if (video.closest?.("ytd-reel-video-renderer[is-active], ytd-shorts, ytm-shorts-lockup-view-model")) score += 600;
    if (video.closest?.("#movie_player")) score += 400;
    if (video.hasAttribute("data-auto-pip-managed")) score += 100;
    if (!video.muted) score += 20;

    if (rect) {
      const videoCenterX = rect.left + rect.width / 2;
      const videoCenterY = rect.top + rect.height / 2;
      const pageCenterX = window.innerWidth / 2;
      const pageCenterY = window.innerHeight / 2;
      const distance = Math.hypot(videoCenterX - pageCenterX, videoCenterY - pageCenterY);
      score -= Math.min(distance / 10, 200);
    }

    return score;
  }

  function getBestPipCandidate() {
    return getVideos()
      .map((video) => ({ video, score: getVideoScore(video) }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)[0]?.video || null;
  }

  function syncVideoWithRetry(video, retries = 5, delay = 200) {
    if (!video) return;
    if (!canManagePipInCurrentDocument()) {
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
    if (!canManagePipInCurrentDocument()) {
      clearRetryTimer(video);
      try { video.removeAttribute("autopictureinpicture"); } catch (_) {}
      try { video.removeAttribute("data-auto-pip-managed"); } catch (_) {}
      try { video.removeAttribute("data-auto-pip-prepared"); } catch (_) {}
      if (video === preparedPipVideo) preparedPipVideo = null;
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
    if (!canManagePipInCurrentDocument()) {
      getVideos().forEach((v) => {
        try { v.removeAttribute("autopictureinpicture"); } catch (_) {}
        try { v.removeAttribute("data-auto-pip-managed"); } catch (_) {}
        try { v.removeAttribute("data-auto-pip-prepared"); } catch (_) {}
      });
      preparedPipVideo = null;
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

  function getFallbackPreparedCandidate() {
    return getVideos()
      .filter((video) => isEligibleVideo(video) && isVisibleVideo(video) && !pipDeniedVideos.has(video))
      .sort((a, b) => {
        const rectA = a.getBoundingClientRect();
        const rectB = b.getBoundingClientRect();
        return rectB.width * rectB.height - rectA.width * rectA.height;
      })[0] || null;
  }

  function prepareCurrentVideoForPip() {
    if (!canManagePipInCurrentDocument()) {
      return { success: false, error: "PIP_NOT_ALLOWED" };
    }

    const candidate = getBestPipCandidate() || getFallbackPreparedCandidate();
    if (!candidate) {
      return { success: false, error: "NO_VIDEO" };
    }

    clearPreparedPipMarkers(candidate);
    try { candidate.setAttribute("autopictureinpicture", ""); } catch (_) {}
    try { candidate.setAttribute("data-auto-pip-managed", ""); } catch (_) {}
    try { candidate.setAttribute("data-auto-pip-prepared", ""); } catch (_) {}
    syncVideo(candidate);

    return { success: true, prepared: true };
  }

  async function tryEnterPip() {
    if (!canManagePipInCurrentDocument()) return;
    if (document.pictureInPictureElement) return;

    const candidate = getBestPipCandidate();
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
    if (!isPipPermittedInCurrentDocument()) return Promise.resolve();
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
    if (!canManagePipInCurrentDocument()) return;
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
        if (mutation.type === "attributes") {
          if (mutation.target instanceof HTMLVideoElement) {
            needsRefresh = true;
            continue;
          }
          if (isYouTubePage() && mutation.target instanceof Element && mutation.target.id === "movie_player") {
            needsRefresh = true;
          }
        }
      }
      if (needsRefresh) scheduleRefresh(100);
    });
    try {
      state.observer.observe(document.documentElement || document, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["paused", "readyState", "src", "class", "autopictureinpicture", "disablepictureinpicture"],
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
    window.addEventListener("yt-navigate-finish", () => scheduleRefresh(300), true);
    window.addEventListener("yt-page-data-updated", () => scheduleRefresh(300), true);
    window.addEventListener("yt-player-updated", () => scheduleRefresh(100), true);

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

    if (message.type === "PREPARE_AUTO_PIP") {
      const result = prepareCurrentVideoForPip();
      refreshVideos();
      sendResponse?.(result);
      return false;
    }

    if (message.type === "REFRESH_PIP_STATE") {
      refreshVideos();
      sendResponse?.({ success: true });
      return false;
    }
  });

  register();

  return { refreshVideos };
})();
