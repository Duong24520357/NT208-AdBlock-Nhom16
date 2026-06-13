// State mặc đinh của extension
importScripts("phishing-alert/anti-phishing.js"); //ngăn phishing
const defaultState = {
  enabled: true,
  pipEnabled: true,
  pipAllowedDomains: [],
  whitelist: [],
  blockedDomains: [],
  blockedPerTab: {},
  totalBlocked: 0,
};

let state = { ...defaultState };
let lastActiveTabId = null;
let lastActiveWindowId = null;
let tempBlankTabId = null;

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
      pipEnabled: state.pipEnabled,
      pipAllowedDomains: state.pipAllowedDomains,
      whitelist: state.whitelist,
      blockedDomains: state.blockedDomains,
      totalBlocked: state.totalBlocked,
    },
  });
}

function isHostnameInScope(hostname, domain) {
  if (!hostname || !domain) return false;
  return hostname === domain || hostname.endsWith(`.${domain}`);
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
const CAPTURE_MIN_INTERVAL_MS = 1100;

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

async function togglePipEnabled(enabled) {
  state.pipEnabled = enabled;
  await saveState();

  chrome.tabs.query({}, (tabs) => {
    (tabs || []).forEach((tab) => {
      if (!tab || typeof tab.id !== "number") return;
      if (!tab.url || !/^https?:\/\//.test(tab.url)) return;
      chrome.tabs.sendMessage(
        tab.id,
        {
          type: "PIP_SETTING_CHANGED",
          enabled: state.pipEnabled,
        },
        () => void chrome.runtime.lastError,
      );
    });
  });

  return { success: true, pipEnabled: state.pipEnabled };
}

async function preparePipInTab(tabId) {
  if (!tabId || state.pipEnabled === false) return { success: false, error: "PIP_DISABLED" };

  chrome.tabs.sendMessage(
    tabId,
    {
      type: "PREPARE_AUTO_PIP",
    },
    () => void chrome.runtime.lastError,
  );

  return { success: true };
}

async function togglePipAllowedDomain(domainInput) {
  const hostname = normalizeDomain(domainInput);
  if (!hostname) return { success: false, error: "INVALID_DOMAIN" };

  state.pipAllowedDomains = Array.isArray(state.pipAllowedDomains)
    ? state.pipAllowedDomains
    : [];

  const index = state.pipAllowedDomains.indexOf(hostname);
  const nowAllowed = index === -1;
  if (nowAllowed) {
    state.pipAllowedDomains.push(hostname);
  } else {
    state.pipAllowedDomains.splice(index, 1);
  }

  await saveState();

  chrome.tabs.query({}, (tabs) => {
    (tabs || []).forEach((tab) => {
      if (!tab || typeof tab.id !== "number") return;
      if (!tab.url || !/^https?:\/\//.test(tab.url)) return;
      chrome.tabs.sendMessage(
        tab.id,
        {
          type: "PIP_SETTING_CHANGED",
          enabled: state.pipEnabled,
          allowedDomains: state.pipAllowedDomains,
        },
        () => void chrome.runtime.lastError,
      );
    });
  });

  return { success: true, hostname, allowed: nowAllowed };
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
  if (tempBlankTabId === tabId) {
    tempBlankTabId = null;
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  const previousTabId = lastActiveTabId;
  lastActiveTabId = activeInfo?.tabId ?? null;

  chrome.tabs.get(activeInfo?.tabId, (tab) => {
    if (!chrome.runtime.lastError && tab && typeof tab.windowId === "number") {
      lastActiveWindowId = tab.windowId;
    }
  });

  if (activeInfo?.tabId) {
    preparePipInTab(activeInfo.tabId);
  }

  if (!state.pipEnabled || !previousTabId || previousTabId === activeInfo?.tabId) {
    return;
  }
  preparePipInTab(previousTabId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  // Previously we created a temporary about:blank tab when focus was lost
  // (WINDOW_ID_NONE) to force a tab switch for auto-PiP. That behavior caused
  // the extension to open about:blank when the user clicked the extension UI
  // (or other cases). To avoid unexpected redirects, do not create a blank
  // tab on focus loss anymore.
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }

  // If a temp blank tab exists (legacy fallback), remove it when focus returns.
  if (tempBlankTabId != null) {
    const tabId = tempBlankTabId;
    tempBlankTabId = null;
    chrome.tabs.remove(tabId, () => void chrome.runtime.lastError);
  }
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
          const pipAllowedDomains = Array.isArray(state.pipAllowedDomains)
            ? state.pipAllowedDomains
            : [];
          const pipDomainAllowed =
            pipAllowedDomains.length === 0 ||
            pipAllowedDomains.some((domain) => isHostnameInScope(hostname, domain));
          sendResponse({
            enabled: state.enabled,
            pipEnabled: state.pipEnabled !== false,
            pipAllowedDomains,
            pipDomainAllowed,
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

    case "TOGGLE_PIP_ENABLED":
      togglePipEnabled(message.enabled).then((result) => {
        sendResponse(result);
      });
      return true;

    case "TOGGLE_PIP_ALLOWED_DOMAIN":
      togglePipAllowedDomain(message.domain).then((result) => {
        sendResponse(result);
      });
      return true;

    case "PREPARE_AUTO_PIP":
      {
        const targetTabId = message.tabId || sender.tab?.id;
        if (!targetTabId) {
          sendResponse({ success: false, error: "NO_TAB" });
          return false;
        }

        preparePipInTab(targetTabId).then((result) => {
          sendResponse(result);
        });

        return true;
      }

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

    case "CAPTURE_VIEWPORT":
      {
        // Content script requests the background to capture the visible viewport
        // We use sender.tab.windowId to call captureVisibleTabWithThrottle
        const winId = message.windowId ?? sender.tab?.windowId ?? lastActiveWindowId;
        if (typeof winId === "undefined") {
          sendResponse({ ok: false, reason: "NO_WINDOW_ID" });
          return false;
        }

        captureVisibleTabWithThrottle(winId)
          .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
          .catch((error) => sendResponse({ ok: false, reason: error?.message || String(error) }));

        return true;
      }

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
