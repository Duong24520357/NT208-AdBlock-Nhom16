// State mặc đinh của extension
importScripts("phishing-alert/anti-phishing.js"); //ngăn phishing
const defaultState = {
  enabled: true,
  whitelist: [],
  blockedDomains: [],
  blockedPerTab: {},
  totalBlocked: 0,
};

let state = { ...defaultState };

// Hàm áp dụng state và declarativceNetRequest
async function applyState() {
  if (state.enabled) {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: ["ruleset_1"],
    });
  } else {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      disableRulesetIds: ["ruleset_1"],
    });
  }
}

// Hàm tải state đã lưu từ storage
async function loadState() {
  const savedState = await chrome.storage.local.get("adblockState");
  if (savedState.adblockState) {
    state = { ...defaultState, ...savedState.adblockState };
  }
}

// Hàm lưu state hiện tại vào storage
async function saveState() {
  await chrome.storage.local.set({
    adblockState: {
      enabled: state.enabled,
      whitelist: state.whitelist,
      blockedDomains: state.blockedDomains,
      totalBlocked: state.totalBlocked,
    },
  });
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
  } catch {
    return null;
  }
}

async function addBlockedDomain(domainInput) {
  const hostname = normalizeDomain(domainInput);
  if (!hostname) return { success: false, error: "INVALID_DOMAIN" };
  state.blockedDomains = Array.isArray(state.blockedDomains)
    ? state.blockedDomains
    : [];

  if (!state.blockedDomains.includes(hostname)) {
    state.blockedDomains.push(hostname);
    await saveState();
  }

  return { success: true, hostname };
}

async function removeBlockedDomain(domainInput) {
  const hostname = normalizeDomain(domainInput);
  if (!hostname) return { success: false, error: "INVALID_DOMAIN" };

  state.blockedDomains = Array.isArray(state.blockedDomains)
    ? state.blockedDomains
    : [];
  const index = state.blockedDomains.indexOf(hostname);
  if (index !== -1) {
    state.blockedDomains.splice(index, 1);
    await saveState();
  }

  return { success: true, hostname };
}

async function toggleBlockedDomain(domainInput) {
  const hostname = normalizeDomain(domainInput);
  if (!hostname) return { success: false, error: "INVALID_DOMAIN" };

  state.blockedDomains = Array.isArray(state.blockedDomains)
    ? state.blockedDomains
    : [];
  const index = state.blockedDomains.indexOf(hostname);
  const nowBlocked = index === -1;
  if (nowBlocked) {
    state.blockedDomains.push(hostname);
  } else {
    state.blockedDomains.splice(index, 1);
  }

  await saveState();
  return { success: true, hostname, blocked: nowBlocked };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let lastCaptureAt = 0;
const CAPTURE_MIN_INTERVAL_MS = 650;

async function captureVisibleTabWithThrottle(windowId, retries = 3) {
  const elapsed = Date.now() - lastCaptureAt;
  if (elapsed < CAPTURE_MIN_INTERVAL_MS) {
    await delay(CAPTURE_MIN_INTERVAL_MS - elapsed);
  }

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: "png",
    });
    lastCaptureAt = Date.now();
    return dataUrl;
  } catch (error) {
    const message = error?.message || "";
    if (
      retries > 0 &&
      message.includes("MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND")
    ) {
      await delay(CAPTURE_MIN_INTERVAL_MS + 120);
      return captureVisibleTabWithThrottle(windowId, retries - 1);
    }
    throw error;
  }
}

async function requestTabMessage(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
  } catch {
    return null;
  }
}

function withTimeout(promise, timeoutMs, onTimeout) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      if (onTimeout) onTimeout();
      reject(new Error("CAPTURE_TIMEOUT"));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

async function captureFullPage(tabId, options = {}) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab?.windowId) {
    throw new Error("TAB_NOT_FOUND");
  }

  let originalScrollY = 0;

  const metrics = await requestTabMessage(tabId, {
    type: "FULLPAGE_GET_METRICS",
  });
  if (!metrics?.ok) {
    throw new Error("CAPTURE_NOT_AVAILABLE");
  }

  const initResult = await requestTabMessage(tabId, {
    type: "FULLPAGE_STITCH_INIT",
    totalHeight: metrics.totalHeight,
    viewportHeight: metrics.viewportHeight,
    viewportWidth: metrics.viewportWidth,
    hostname: metrics.hostname,
    format: options.format,
  });
  if (!initResult?.ok) {
    throw new Error(initResult?.reason || "STITCH_INIT_FAILED");
  }

  originalScrollY = metrics.originalScrollY || 0;

  try {
    const viewportHeight = Math.max(1, Math.ceil(metrics.viewportHeight || 0));
    const overlap = Math.min(120, Math.floor(viewportHeight * 0.15));
    const step = Math.max(1, viewportHeight - overlap);
    let nextY = originalScrollY;
    let lastCapturedY = -1;
    let capturedFrames = 0;
    let reachedEnd = false;
    let stoppedByUser = false;

    const maxFrames = Math.max(
      3,
      Math.ceil((metrics.totalHeight || viewportHeight) / step) + 6,
    );

    while (capturedFrames < maxFrames) {
      const scrollResult = await requestTabMessage(tabId, {
        type: "FULLPAGE_SCROLL_TO",
        y: nextY,
      });
      if (!scrollResult?.ok) {
        throw new Error("SCROLL_FAILED");
      }

      await delay(180);

      const dataUrl = await captureVisibleTabWithThrottle(tab.windowId);
      const actualY = Math.max(0, Math.floor(scrollResult.y || 0));

      if (actualY === lastCapturedY && capturedFrames > 0) {
        reachedEnd = true;
        break;
      }

      const addResult = await requestTabMessage(tabId, {
        type: "FULLPAGE_STITCH_ADD",
        y: actualY,
        dataUrl,
      });
      if (!addResult?.ok) {
        throw new Error("STITCH_ADD_FAILED");
      }

      capturedFrames += 1;
      lastCapturedY = actualY;

      const confirmResult = await requestTabMessage(tabId, {
        type: "FULLPAGE_CONFIRM_NEXT",
        currentFrame: capturedFrames,
      });

      if (!confirmResult?.ok) {
        throw new Error(confirmResult?.reason || "CONFIRM_FAILED");
      }

      if (!confirmResult.continueCapture) {
        stoppedByUser = true;
        break;
      }

      const liveMetrics = await requestTabMessage(tabId, {
        type: "FULLPAGE_GET_METRICS",
      });
      if (!liveMetrics?.ok) {
        throw new Error("CAPTURE_NOT_AVAILABLE");
      }

      const maxScrollY = Math.max(
        0,
        Math.ceil(liveMetrics.totalHeight || 0) -
          Math.ceil(liveMetrics.viewportHeight || viewportHeight),
      );

      nextY = Math.min(actualY + step, maxScrollY);

      if (nextY <= actualY + 1) {
        reachedEnd = true;
        break;
      }

      if (lastCapturedY === nextY && nextY > 0) {
        reachedEnd = true;
        break;
      }
    }

    const finalizeResult = await requestTabMessage(tabId, {
      type: "FULLPAGE_STITCH_FINALIZE",
    });
    if (!finalizeResult?.ok) {
      throw new Error("STITCH_FINALIZE_FAILED");
    }

    return {
      success: true,
      fileName: finalizeResult.fileName,
      capturedFrames,
      reachedEnd,
      stoppedByUser,
    };
  } catch (error) {
    await requestTabMessage(tabId, {
      type: "FULLPAGE_STITCH_ABORT",
    });
    throw error;
  } finally {
    await requestTabMessage(tabId, {
      type: "FULLPAGE_SCROLL_TO",
      y: originalScrollY,
    });
  }
}

// Hàm đọc state từ storage và áp dụng khi extension được cài đặt hoặc Chrome khởi động
chrome.runtime.onInstalled.addListener(async () => {
  await loadState(); // 1. Đọc state cũ
  await applyState(); // 2. Áp dụng vào Chrome
});

chrome.runtime.onStartup.addListener(async () => {
  await loadState(); // 1. Đọc state cũ
  await applyState(); // 2. Áp dụng vào Chrome
});

// Hàm cập nhật badge icon theo trạng thái tab hiện tại
function updateBadge(tabId) {
  if (!state.enabled) {
    chrome.action.setBadgeText({ text: "OFF" });
    chrome.action.setBadgeBackgroundColor({ color: "gray" });
    return;
  }

  if (tabId) {
    const blockedCount = state.blockedPerTab[tabId] || 0;
    chrome.action.setBadgeText({
      text: blockedCount > 0 ? blockedCount.toString() : "",
      tabId: tabId,
    });
    chrome.action.setBadgeBackgroundColor({ color: "red", tabId: tabId });
  }
}

// Hàm đổi trạng thái bật/tắt extension
async function toggleEnabled(enabled) {
  state.enabled = enabled;
  await applyState();
  await saveState();
  updateBadge(null);
}

// Hàm tạo lại whitelist rules dạng session
async function updateWhitelistRules() {
  // Xóa toàn bộ session rules cũ
  const existing = await chrome.declarativeNetRequest.getSessionRules();
  const oldIds = existing.map((r) => r.id);

  // Tạo rule ALLOW mới cho từng domain trong whitelist
  const newRules = state.whitelist.map((domain, index) => ({
    id: 100000 + index,
    priority: 10, // Ưu tiên cao hơn ruleset_1 (priority 1)
    action: { type: "allow" },
    condition: {
      initiatorDomains: [domain],
      urlFilter: "*", // Cho phép tất cả request từ domain này
    },
  }));

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: oldIds,
    addRules: newRules,
  });
}

// Hàm thêm/xóa một hostname khỏi whitelist
async function toggleWhitelist(hostname) {
  const index = state.whitelist.indexOf(hostname);

  if (index === -1) {
    // Chưa có trong whitelist → thêm vào
    state.whitelist.push(hostname);
  } else {
    // Đã có rồi → xóa đi
    state.whitelist.splice(index, 1);
  }

  await updateWhitelistRules();
  await saveState();
}

// Lắng nghe tab reload để reset blocked count
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    state.blockedPerTab[tabId] = 0;
    updateBadge(tabId);
  }
});

// Dọn dẹp khi tab bị đóng
chrome.tabs.onRemoved.addListener((tabId) => {
  delete state.blockedPerTab[tabId];
});

// Nhận message từ popup và content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    // Popup hỏi trạng thái hiện tại
    case "GET_STATE":
      {
        const resolveTab = (tab) => {
          const hostname = tab?.url ? new URL(tab.url).hostname : "";
          const blockedDomains = state.blockedDomains || [];
          sendResponse({
            enabled: state.enabled,
            totalBlocked: state.totalBlocked,
            tabBlocked: state.blockedPerTab[tab?.id] || 0,
            whitelisted: state.whitelist.includes(hostname),
            hostname: hostname,
            blockedDomains,
            studyBlocked: blockedDomains.includes(hostname),
          });
        };

        const tabId = message.tabId || sender.tab?.id;
        if (tabId) {
          chrome.tabs.get(tabId, (tab) => resolveTab(tab));
        } else {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) =>
            resolveTab(tabs[0]),
          );
        }
      }
      return true; // ⚠️ Bắt buộc có dòng này khi dùng async sendResponse

    // Popup bật/tắt AdBlock
    case "TOGGLE_ENABLED":
      toggleEnabled(message.enabled).then(() => {
        sendResponse({ success: true });
      });
      return true;

    // Popup thêm/xóa domain khỏi whitelist
    case "TOGGLE_WHITELIST":
      toggleWhitelist(message.hostname).then(() => {
        sendResponse({ success: true });
      });
      return true;

    // Popup thêm domain vào danh sách chặn (học tập)
    case "ADD_BLOCKED_DOMAIN":
      addBlockedDomain(message.domain).then((result) => {
        sendResponse(result);
      });
      return true;

    // Popup xóa domain khỏi danh sách chặn
    case "REMOVE_BLOCKED_DOMAIN":
      removeBlockedDomain(message.domain).then((result) => {
        sendResponse(result);
      });
      return true;

    // Toggle chặn/bỏ chặn domain (thường dùng cho trang hiện tại)
    case "TOGGLE_BLOCKED_DOMAIN":
      toggleBlockedDomain(message.domain).then((result) => {
        sendResponse(result);
      });
      return true;

    case "CAPTURE_FULL_PAGE":
      {
        const activeTabId = message.tabId || sender.tab?.id;
        if (!activeTabId) {
          sendResponse({ success: false, error: "TAB_ID_REQUIRED" });
          return false;
        }

        let responded = false;
        const safeRespond = (payload) => {
          if (responded) return;
          responded = true;
          sendResponse(payload);
        };

        const abortCapture = () => {
          requestTabMessage(activeTabId, { type: "FULLPAGE_STITCH_ABORT" });
        };

        withTimeout(
          captureFullPage(activeTabId, { format: message.format }),
          45000,
          abortCapture,
        )
          .then((result) => safeRespond(result))
          .catch((error) => {
            const errorCode = error?.message || "CAPTURE_FAILED";
            const userMessage =
              errorCode === "CAPTURE_TIMEOUT"
                ? "Chụp ảnh bị timeout. Hãy thử lại hoặc cuộn ít nội dung hơn."
                : errorCode === "CAPTURE_NOT_AVAILABLE"
                  ? "Trang hiện tại không cho phép content script chạy (ví dụ Chrome Web Store hoặc trang nội bộ)."
                  : errorCode === "NOT_TOP_FRAME"
                    ? "Không lấy được top frame của trang để bắt đầu ghép ảnh. Hãy tải lại trang rồi thử lại."
                    : errorCode.includes(
                          "MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND",
                        )
                      ? "Chrome đang giới hạn tốc độ chụp. Hãy thử lại sau 1-2 giây."
                      : errorCode;

            safeRespond({
              success: false,
              error: userMessage,
            });
          });
      }
      return true;

    // Content script báo cáo đã ẩn ads trong DOM
    case "REPORT_BLOCKED":
      const tabId = sender.tab?.id;
      if (tabId) {
        state.blockedPerTab[tabId] =
          (state.blockedPerTab[tabId] || 0) + message.count;
        state.totalBlocked += message.count;
        updateBadge(tabId);
        saveState();
      }
      sendResponse({ success: true });
      break;
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-ai-sidebar") return;

  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  const tab = tabs?.[0];
  if (!tab?.id) return;

  chrome.tabs.sendMessage(tab.id, { type: "AI_TOGGLE_SIDEBAR" });
});
