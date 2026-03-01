// State mặc đinh của extension

const defaultState = {
    enabled: true,
    whitelist: [],
    blockedPerTab: {},
    totalBlocked: 0,
};

let state = { ...defaultState };

// Hàm áp dụng state và declarativceNetRequest
async function applyState() {
    if (state.enabled) {
        await chrome.declarativeNetRequest.updateEnabledRulesets({
            enableRulesetIds: ["ruleset_1"]
        });
    } else {
        await chrome.declarativeNetRequest.updateEnabledRulesets({
            disableRulesetIds: ["ruleset_1"]
        });
    }
}

// Hàm tiện ích loadState từ storage
async function loadState() {
    const savedState = await chrome.storage.local.get("adblockState");
    if (savedState.adblockState) {
        state = { ...defaultState, ...savedState.adblockState };
    }
}

// Hàm lưu state vào storage
async function saveState() {
    await chrome.storage.local.set({
        "adblockState": {
            enabled: state.enabled,
            whitelist: state.whitelist,
            totalBlocked: state.totalBlocked
        }
    })
}

// Hàm đọc state từ storage và áp dụng khi extension được cài đặt hoặc Chrome khởi động
chrome.runtime.onInstalled.addListener(async () => {
    await loadState();   // 1. Đọc state cũ
    await applyState();  // 2. Áp dụng vào Chrome
});

chrome.runtime.onStartup.addListener(async () => {
    await loadState();   // 1. Đọc state cũ
    await applyState();  // 2. Áp dụng vào Chrome
});

// Hàm cập nhật badge icon
function updateBadge(tabId) {
    if (!state.enabled) {
        chrome.action.setBadgeText({ text: "OFF"});
        chrome.action.setBadgeBackgroundColor({ color: "gray" });
        return;
    }

    if (tabId) {
        const blockedCount = state.blockedPerTab[tabId] || 0;
        chrome.action.setBadgeText({ text: blockedCount > 0 ? blockedCount.toString() : "" , tabId: tabId });
        chrome.action.setBadgeBackgroundColor({ color: "red" , tabId: tabId });
    }
}

// Hàm toggle trạng thái bật/tắt extension
async function toggleEnabled(enabled) {
    state.enabled = enabled;
    await applyState();
    await saveState();
    updateBadge(null); 
}

// Hàm cập nhật whitelist Rules
async function updateWhitelistRules() {
    // Xóa toàn bộ session rules cũ
    const existing = await chrome.declarativeNetRequest.getSessionRules();
    const oldIds = existing.map(r => r.id);

    // Tạo rule ALLOW mới cho từng domain trong whitelist
    const newRules = state.whitelist.map((domain, index) => ({
        id: 100000 + index,
        priority: 10,          // Ưu tiên cao hơn ruleset_1 (priority 1)
        action: { type: "allow" },
        condition: {
            initiatorDomains: [domain],
            urlFilter: "*"     // Cho phép tất cả request từ domain này
        }
    }));

    await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: oldIds,
        addRules: newRules
    });
}

// Hàm toggle whitelist cho một hostname cụ thể
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
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs[0];
                const hostname = tab?.url ? new URL(tab.url).hostname : "";
                sendResponse({
                    enabled: state.enabled,
                    totalBlocked: state.totalBlocked,
                    tabBlocked: state.blockedPerTab[tab?.id] || 0,
                    whitelisted: state.whitelist.includes(hostname),
                    hostname: hostname
                });
            });
            return true;  // ⚠️ Bắt buộc có dòng này khi dùng async sendResponse

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

        // Content script báo cáo đã ẩn ads trong DOM
        case "REPORT_BLOCKED":
            const tabId = sender.tab?.id;
            if (tabId) {
                state.blockedPerTab[tabId] = (state.blockedPerTab[tabId] || 0) + message.count;
                state.totalBlocked += message.count;
                updateBadge(tabId);
                saveState();
            }
            sendResponse({ success: true });
            break;
    }
});
