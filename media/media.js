// FILE: media/media.js

const MediaController = (() => {
  // State is cached in the content script's memory
  const MediaState = {
    volume: 100,
    brightness: 100,
    initialized: false,
  };

  /**
   * Applies the current volume from the internal state to all media elements.
   */
  function applyVolume() {
    const volumeLevel = Math.max(0, Math.min(100, MediaState.volume)) / 100;
    document.querySelectorAll("video, audio").forEach((media) => {
      try {
        // FIX: Luôn override trạng thái muted để đảm bảo video có tiếng
        if (volumeLevel > 0) {
          media.muted = false;
        }
        media.volume = volumeLevel;
      } catch (e) {
        // Ignore errors, e.g., on media elements in other contexts
      }
    });
  }

  /**
   * Applies the current brightness from the internal state to all video elements.
   */
  function applyBrightness() {
    const brightnessValue = Math.max(0, Math.min(200, MediaState.brightness));
    document.querySelectorAll("video").forEach((video) => {
      try {
        video.style.filter = `brightness(${brightnessValue}%)`;
        video.style.transition = 'filter 0.1s ease-in-out';
      } catch (e) {
        // Ignore errors
      }
    });
  }

  /**
   * Applies all current media settings to the page.
   */
  function applyAll() {
    applyVolume();
    applyBrightness();
  }

  function applyMediaState(volume, brightness) {
    if (typeof volume === "number") {
      MediaState.volume = volume;
    }
    if (typeof brightness === "number") {
      MediaState.brightness = brightness;
    }
    applyAll();
  }

  /**
   * Starts a MutationObserver to watch for DOM changes and re-apply media settings.
   * This is crucial for SPAs like YouTube and Facebook.
   */
  function startObserver() {
    let debounceTimer;
    const debouncedApplyAll = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(applyAll, 200);
    };

    // FIX: Trigger applyAll trên mọi thay đổi của DOM để bắt các trường hợp SPA phức tạp,
    // sử dụng debounce để tránh gọi quá nhiều lần.
    const observer = new MutationObserver(debouncedApplyAll);

    // Observe the entire document for changes
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Initializes the MediaController.
   * Loads the state from chrome.storage, applies it, and starts the observer.
   */
  async function init() {
    if (MediaState.initialized) return;
    MediaState.initialized = true;

    try {
      const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
      if (response) {
        MediaState.volume = response.mediaVolume ?? 100;
        MediaState.brightness = response.mediaBrightness ?? 100;
      }
    } catch (e) {
      // Could not get state from background, use defaults.
    }

    applyAll();
    startObserver();
  }

  // FIX: Thêm message listener để nhận state mới từ background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case "INIT_MEDIA":
      case "APPLY_MEDIA_STATE":
        applyMediaState(message.mediaVolume, message.mediaBrightness);
        sendResponse({ success: true });
        return true;

      case "SET_VOLUME":
        applyMediaState(message.value, undefined);
        sendResponse({ success: true });
        return true;

      case "SET_BRIGHTNESS":
        applyMediaState(undefined, message.value);
        sendResponse({ success: true });
        return true;

      case "RESET_MEDIA":
        applyMediaState(100, 100);
        sendResponse({ success: true });
        return true;

      default:
        return false;
    }
  });

  // Expose public methods to be controlled by content.js
  return {
    init,
    applyMediaState,
    setVolume: (value) => {
      applyMediaState(value, undefined);
    },
    setBrightness: (value) => {
      applyMediaState(undefined, value);
    },
    reset: () => {
      applyMediaState(100, 100);
    }
  };
})();

// Initialize the controller as soon as the script is injected.
MediaController.init();
