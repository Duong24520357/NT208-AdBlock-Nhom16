(() => {
  "use strict";

  const GUARD_FLAG = "__nt208YoutubePageGuardInstalled";
  if (window[GUARD_FLAG]) return;

  Object.defineProperty(window, GUARD_FLAG, {
    value: true,
    configurable: false,
  });

  const YOUTUBE_HOST_RE = /(^|\.)youtube(?:-nocookie)?\.com$|(^|\.)youtubekids\.com$/;
  if (!YOUTUBE_HOST_RE.test(window.location.hostname)) return;

  const RESPONSE_URL_RE =
    /\/youtubei\/v1\/(?:player|get_watch|next|browse|reel\/reel_watch_sequence)|\/reel_watch_sequence|\/playlist\?|\/watch\?/;
  const AD_TOKEN_RE =
    /"(?:adPlacements|adSlots|playerAds|adBreakHeartbeatParams|adClientParams|reelWatchEndpoint)"/;
  const TEXT_REPLACERS = [
    [/"adPlacements"\s*:/g, '"no_ads":'],
    [/"adSlots"\s*:/g, '"no_ads":'],
    [/"playerAds"\s*:/g, '"no_ads":'],
    [/"adBreakHeartbeatParams"\s*:/g, '"no_ads":'],
  ];

  const PRUNE_KEYS = new Set([
    "adPlacements",
    "playerAds",
    "adSlots",
    "adBreakHeartbeatParams",
    "adBreakHeartbeatUrl",
    "adSafetyReason",
    "playerLegacyDesktopWatchAdsRenderer",
    "adPlacementRenderer",
    "adSlotRenderer",
    "displayAdRenderer",
    "promotedVideoRenderer",
    "promotedSparklesWebRenderer",
  ]);

  function shouldPatchUrl(input) {
    const rawUrl = typeof input === "string" ? input : input?.url || input?.href || String(input || "");
    if (!rawUrl) return false;

    try {
      const url = new URL(rawUrl, window.location.href);
      return YOUTUBE_HOST_RE.test(url.hostname) && RESPONSE_URL_RE.test(url.href);
    } catch {
      return false;
    }
  }

  function hasAdTokens(text) {
    return typeof text === "string" && AD_TOKEN_RE.test(text);
  }

  function isObject(value) {
    return value !== null && typeof value === "object";
  }

  function isAdArrayItem(item) {
    if (!isObject(item)) return false;

    const reelParams = item.command?.reelWatchEndpoint?.adClientParams;
    if (reelParams?.isAd === true) return true;

    return Boolean(
      item.adPlacementRenderer ||
        item.adSlotRenderer ||
        item.displayAdRenderer ||
        item.promotedVideoRenderer ||
        item.promotedSparklesWebRenderer,
    );
  }

  function pruneYouTubeAds(value, seen = new WeakSet()) {
    if (!isObject(value) || seen.has(value)) return value;
    seen.add(value);

    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) {
        const item = value[i];
        if (isAdArrayItem(item)) {
          value.splice(i, 1);
          continue;
        }
        pruneYouTubeAds(item, seen);
      }
      return value;
    }

    Object.keys(value).forEach((key) => {
      if (PRUNE_KEYS.has(key)) {
        delete value[key];
        return;
      }

      const child = value[key];
      if (isAdArrayItem(child)) {
        delete value[key];
        return;
      }

      pruneYouTubeAds(child, seen);
    });

    return value;
  }

  function patchTextResponse(text) {
    if (!hasAdTokens(text)) return text;

    try {
      const parsed = JSON.parse(text);
      pruneYouTubeAds(parsed);
      return JSON.stringify(parsed);
    } catch {
      return TEXT_REPLACERS.reduce(
        (output, [pattern, replacement]) => output.replace(pattern, replacement),
        text,
      );
    }
  }

  function clonePatchedResponse(response, patchedText) {
    const headers = new Headers(response.headers);
    headers.delete("content-length");

    const patchedResponse = new Response(patchedText, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });

    try {
      Object.defineProperties(patchedResponse, {
        ok: { value: response.ok },
        redirected: { value: response.redirected },
        type: { value: response.type },
        url: { value: response.url },
      });
    } catch {
      // The Response still works even if these readonly properties cannot be mirrored.
    }

    return patchedResponse;
  }

  function patchResponse(response, forcePatch) {
    if (!forcePatch && !shouldPatchUrl(response?.url)) return response;
    if (!response?.clone) return response;

    return response
      .clone()
      .text()
      .then((text) => {
        const patchedText = patchTextResponse(text);
        return patchedText === text ? response : clonePatchedResponse(response, patchedText);
      })
      .catch(() => response);
  }

  function installJsonParsePatch() {
    const nativeParse = JSON.parse;
    if (nativeParse.__nt208YoutubePatched) return;

    const patchedParse = new Proxy(nativeParse, {
      apply(target, thisArg, args) {
        const parsed = Reflect.apply(target, thisArg, args);
        return hasAdTokens(args[0]) ? pruneYouTubeAds(parsed) : parsed;
      },
    });

    Object.defineProperty(patchedParse, "__nt208YoutubePatched", {
      value: true,
    });

    JSON.parse = patchedParse;
  }

  function installFetchPatch() {
    if (typeof window.fetch !== "function" || window.fetch.__nt208YoutubePatched) {
      return;
    }

    const nativeFetch = window.fetch;
    const patchedFetch = new Proxy(nativeFetch, {
      apply(target, thisArg, args) {
        const forcePatch = shouldPatchUrl(args[0]);
        const promise = Reflect.apply(target, thisArg, args);
        if (!forcePatch) return promise;
        return Promise.resolve(promise).then((response) => patchResponse(response, true));
      },
    });

    Object.defineProperty(patchedFetch, "__nt208YoutubePatched", {
      value: true,
    });

    window.fetch = patchedFetch;
  }

  function installXhrPatch() {
    if (
      typeof window.XMLHttpRequest !== "function" ||
      window.XMLHttpRequest.__nt208YoutubePatched
    ) {
      return;
    }

    const NativeXMLHttpRequest = window.XMLHttpRequest;
    const xhrDetails = new WeakMap();

    class PatchedXMLHttpRequest extends NativeXMLHttpRequest {
      open(method, url, ...args) {
        xhrDetails.set(this, {
          url: String(url || ""),
          rawText: undefined,
          patchedText: undefined,
        });

        return super.open(method, url, ...args);
      }

      get responseText() {
        const text = super.responseText;
        const details = xhrDetails.get(this);
        if (!details || !shouldPatchUrl(details.url)) return text;
        if (details.rawText === text && details.patchedText !== undefined) {
          return details.patchedText;
        }

        details.rawText = text;
        details.patchedText = patchTextResponse(text);
        return details.patchedText;
      }

      get response() {
        const response = super.response;
        const details = xhrDetails.get(this);
        if (!details || !shouldPatchUrl(details.url)) return response;

        if (this.responseType === "json" && isObject(response)) {
          return pruneYouTubeAds(response);
        }

        if (typeof response === "string" || this.responseType === "" || this.responseType === "text") {
          return this.responseText;
        }

        return response;
      }
    }

    Object.defineProperty(PatchedXMLHttpRequest, "__nt208YoutubePatched", {
      value: true,
    });

    window.XMLHttpRequest = PatchedXMLHttpRequest;
  }

  function installPlayerResponseAccessors() {
    ["ytInitialPlayerResponse", "playerResponse"].forEach((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(window, name);
      if (descriptor && descriptor.configurable === false) {
        try {
          pruneYouTubeAds(window[name]);
        } catch {
          // Ignore locked properties.
        }
        return;
      }

      let value;
      try {
        value = descriptor?.get ? descriptor.get.call(window) : window[name];
      } catch {
        value = undefined;
      }

      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get() {
          return value;
        },
        set(nextValue) {
          value = pruneYouTubeAds(nextValue);
        },
      });

      if (value !== undefined) {
        window[name] = value;
      }
    });
  }

  let playerAdState = null;

  function getMoviePlayer() {
    return document.getElementById("movie_player");
  }

  function isAdShowing(player) {
    return Boolean(
      player &&
        (player.classList.contains("ad-showing") ||
          player.classList.contains("ad-interrupting") ||
          player.querySelector(".ytp-ad-player-overlay, .ytp-ad-preview-container")),
    );
  }

  function clickSkipButtons(player) {
    const selectors = [
      ".ytp-ad-skip-button",
      ".ytp-ad-skip-button-modern",
      ".ytp-ad-skip-button-container button",
      ".ytp-skip-ad-button",
      ".ytp-skip-ad-button__button",
    ];

    selectors.forEach((selector) => {
      player.querySelectorAll(selector).forEach((button) => {
        try {
          if (!button.disabled) button.click();
        } catch {
          // Ignore transient player DOM errors.
        }
      });
    });
  }

  function speedThroughAd(player) {
    const video = player.querySelector("video") || document.querySelector("video.html5-main-video");
    if (!video) return;

    if (!playerAdState) {
      playerAdState = {
        muted: video.muted,
        playbackRate: video.playbackRate,
      };
    }

    try {
      video.muted = true;
    } catch {
      // Ignore readonly media state.
    }

    try {
      video.playbackRate = Math.max(video.playbackRate || 1, 16);
    } catch {
      // Ignore unsupported playback rates.
    }

    const duration = Number(video.duration);
    if (Number.isFinite(duration) && duration > 0 && duration < 180) {
      try {
        video.currentTime = Math.max(duration - 0.05, video.currentTime || 0);
      } catch {
        // Ignore failed seeks.
      }
    }
  }

  function restoreVideoState(player) {
    if (!playerAdState || isAdShowing(player)) return;

    const video = player?.querySelector("video") || document.querySelector("video.html5-main-video");
    if (video) {
      try {
        video.muted = playerAdState.muted;
      } catch {
        // Ignore readonly media state.
      }

      try {
        video.playbackRate = playerAdState.playbackRate || 1;
      } catch {
        // Ignore unsupported playback rates.
      }
    }

    playerAdState = null;
  }

  function handlePlayerAds() {
    const player = getMoviePlayer();
    if (!isAdShowing(player)) {
      restoreVideoState(player);
      return;
    }

    clickSkipButtons(player);
    speedThroughAd(player);
  }

  function startPlayerObserver() {
    const observer = new MutationObserver(handlePlayerAds);
    const observeTarget = document.documentElement || document;

    try {
      observer.observe(observeTarget, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "hidden", "style"],
      });
    } catch {
      // Ignore early-document observer failures.
    }

    window.setInterval(handlePlayerAds, 300);
    window.addEventListener("yt-navigate-finish", handlePlayerAds, true);
    window.addEventListener("yt-player-updated", handlePlayerAds, true);
  }

  installJsonParsePatch();
  installFetchPatch();
  installXhrPatch();
  installPlayerResponseAccessors();
  startPlayerObserver();
})();
