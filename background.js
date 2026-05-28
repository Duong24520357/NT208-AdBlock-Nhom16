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

    case "CAPTURE_VIEWPORT":
      {
        // Content script requests the background to capture the visible viewport
        // We use sender.tab.windowId to call captureVisibleTabWithThrottle
        const winId = sender.tab?.windowId;
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
