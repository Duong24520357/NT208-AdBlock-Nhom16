// =============================================
// BƯỚC 1: LẤY CÁC DOM ELEMENTS
// =============================================
const toggleSwitch = document.getElementById("toggle-switch");
const toggleLabel = document.getElementById("toggle-label");
const whitelistBtn = document.getElementById("whitelist-btn");
const pickerBtn = document.getElementById("picker-btn");
const tabBlockedCount = document.getElementById("tab-blocked-count");
const totalBlockedCount = document.getElementById("total-blocked-count");
const hostnameLabel = document.getElementById("hostname-label");
const statusDot = document.getElementById("status-dot");
const blockSiteBtn = document.getElementById("blocksite-btn");
const blockDomainInput = document.getElementById("block-domain-input");
const blockAddBtn = document.getElementById("block-add-btn");
const blockedDomainsEl = document.getElementById("blocked-domains");
const blocklistHint = document.getElementById("blocklist-hint");

// Lưu state hiện tại và tab hiện tại
let currentState = null;
let currentTab = null;
let updateInterval = null;

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

function renderBlockedDomains(state) {
    const domains = Array.isArray(state?.blockedDomains) ? state.blockedDomains : [];
    blockedDomainsEl.textContent = "";
    const currentHostname = (state?.hostname || "").toLowerCase();

    if (domains.length === 0) {
        blocklistHint.innerHTML = "Chưa có domain nào. <strong>Thêm domain</strong> để chặn trong giờ học.";
        return;
    }

    blocklistHint.textContent = "Mẹo: chặn cả subdomain tự động (vd: www." + domains[0] + ")";
    domains
        .slice()
        .sort((a, b) => a.localeCompare(b))
        .forEach((domain) => {
            const item = document.createElement("div");
            item.className = "blocked-item";
            if (currentHostname && (currentHostname === domain || currentHostname.endsWith(`.${domain}`))) {
                item.classList.add("blocked-item-active");
            }

            const label = document.createElement("div");
            label.className = "blocked-domain";
            label.textContent = domain;

            const removeBtn = document.createElement("button");
            removeBtn.className = "blocked-remove";
            removeBtn.type = "button";
            removeBtn.textContent = "Xóa";
            removeBtn.dataset.domain = domain;

            item.appendChild(label);
            item.appendChild(removeBtn);
            blockedDomainsEl.appendChild(item);
        });
}


// =============================================
// BƯỚC 2: RENDER UI THEO STATE
// =============================================
// Hàm render toàn bộ giao diện popup theo state hiện tại
function renderUI(state) {
    if (!state) return;
    currentState = state;

    // --- Toggle bật/tắt ---
    if (state.enabled) {
        toggleSwitch.checked = true;
        toggleLabel.textContent = "Đang bật";
        toggleLabel.style.color = "#2ecc71";
        statusDot.style.background = "#2ecc71";
    } else {
        toggleSwitch.checked = false;
        toggleLabel.textContent = "Đang tắt";
        toggleLabel.style.color = "#999999";
        statusDot.style.background = "#999999";
    }

    // --- Số ads bị chặn ---
    tabBlockedCount.textContent = state.tabBlocked || 0;
    totalBlockedCount.textContent = state.totalBlocked || 0;

    // --- Hostname ---
    if (state.hostname) {
        hostnameLabel.textContent = state.hostname;
    } else {
        hostnameLabel.textContent = "Không xác định";
    }

    // --- Nút Whitelist ---
    if (!state.enabled) {
        // AdBlock tắt → disable nút whitelist
        whitelistBtn.disabled = true;
        whitelistBtn.textContent = "Tắt cho trang này";
        whitelistBtn.style.opacity = "0.5";
    } else if (state.whitelisted) {
        // Domain trong whitelist → hiện "Bật cho trang này"
        whitelistBtn.disabled = false;
        whitelistBtn.textContent = "✅ Bật cho trang này";
        whitelistBtn.style.background = "#f39c12";
        whitelistBtn.style.opacity = "1";
    } else {
        // Domain không trong whitelist → hiện "Tắt cho trang này"
        whitelistBtn.disabled = false;
        whitelistBtn.textContent = "🚫 Tắt cho trang này";
        whitelistBtn.style.background = "#e74c3c";
        whitelistBtn.style.opacity = "1";
    }

    // --- Nút Element Picker ---
    pickerBtn.disabled = !state.enabled || state.whitelisted;
    pickerBtn.style.opacity = pickerBtn.disabled ? "0.5" : "1";

    // --- Nút chặn trang (học tập) ---
    if (!state.enabled) {
        blockSiteBtn.disabled = true;
        blockSiteBtn.style.opacity = "0.5";
        blockSiteBtn.textContent = "Chặn trang này (học tập)";
        blockSiteBtn.classList.remove("btn-study-on");
    } else if (state.studyBlocked) {
        blockSiteBtn.disabled = false;
        blockSiteBtn.style.opacity = "1";
        blockSiteBtn.textContent = "✅ Đang chặn trang này";
        blockSiteBtn.classList.add("btn-study-on");
    } else {
        blockSiteBtn.disabled = false;
        blockSiteBtn.style.opacity = "1";
        blockSiteBtn.textContent = "🚫 Chặn trang này (học tập)";
        blockSiteBtn.classList.remove("btn-study-on");
    }

    renderBlockedDomains(state);
}


// =============================================
// BƯỚC 3: LOAD STATE TỪ BACKGROUND
// =============================================
// Hàm lấy state mới nhất từ background và đổ vào UI
async function loadState() {
    try {
        // Lấy tab đang active
        const tabs = await chrome.tabs.query({
            active: true,
            currentWindow: true
        });

        currentTab = tabs[0];

        // Kiểm tra tab có hợp lệ không
        if (!currentTab || !currentTab.url?.startsWith("http")) {
            hostnameLabel.textContent = "Không hỗ trợ trang này";
            whitelistBtn.disabled = true;
            pickerBtn.disabled = true;
            return;
        }

        // Gửi GET_STATE lên background
        const response = await chrome.runtime.sendMessage({
            type: "GET_STATE",
            tabId: currentTab.id
        });

        if (response) {
            renderUI(response);
        }

    } catch (error) {
        console.error("[Popup] Lỗi load state:", error);
    }
}


// =============================================
// BƯỚC 4: XỬ LÝ TOGGLE BẬT/TẮT
// =============================================
toggleSwitch.addEventListener("change", async () => {
    try {
        const enabled = toggleSwitch.checked;

        // Cập nhật UI ngay lập tức (không đợi response)
        renderUI({ ...currentState, enabled });

        // Luu trạng thái mới
        chrome.storage.local.set({ enabled }, () => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs?.[0];
                if (tab?.id && /^https?:\/\//.test(tab.url || "")) {
                    chrome.tabs.reload(tab.id);
                }
            });
        });

        // Gửi lệnh lên background
        await chrome.runtime.sendMessage({
            type: "TOGGLE_ENABLED",
            enabled: enabled
        });

    } catch (error) {
        console.error("[Popup] Lỗi toggle:", error);
        // Rollback UI nếu lỗi
        renderUI(currentState);
    }
});


// =============================================
// BƯỚC 5: XỬ LÝ WHITELIST
// =============================================
whitelistBtn.addEventListener("click", async () => {
    try {
        if (!currentTab) return;

        const hostname = new URL(currentTab.url).hostname;

        // Cập nhật UI ngay lập tức
        const newWhitelisted = !currentState.whitelisted;
        renderUI({ ...currentState, whitelisted: newWhitelisted });

        // Gửi lệnh lên background
        await chrome.runtime.sendMessage({
            type: "TOGGLE_WHITELIST",
            hostname: hostname
        });

    } catch (error) {
        console.error("[Popup] Lỗi whitelist:", error);
        renderUI(currentState);
    }
});


// =============================================
// BƯỚC 6: XỬ LÝ ELEMENT PICKER
// =============================================
pickerBtn.addEventListener("click", async () => {
    try {
        if (!currentTab) return;

        // Đóng popup trước
        window.close();

        // Gửi lệnh xuống content.js của tab hiện tại
        await chrome.tabs.sendMessage(currentTab.id, {
            type: "ENTER_ELEMENT_PICKER"
        });

    } catch (error) {
        console.error("[Popup] Lỗi element picker:", error);
    }
});


// =============================================
// BƯỚC 7: CẬP NHẬT SỐ ĐẾM REALTIME
// =============================================
// Hàm bắt đầu polling để cập nhật số ads bị chặn theo thời gian thực
function startRealtimeUpdate() {
    updateInterval = setInterval(async () => {
        try {
            if (!currentTab) return;

            const response = await chrome.runtime.sendMessage({
                type: "GET_STATE",
                tabId: currentTab.id
            });

            if (response) {
                // Chỉ cập nhật số đếm, không render lại toàn bộ UI
                tabBlockedCount.textContent = response.tabBlocked || 0;
                totalBlockedCount.textContent = response.totalBlocked || 0;

                // Cập nhật currentState
                currentState = response;
            }
        } catch (error) {
            // Popup có thể đang đóng → dừng interval
            stopRealtimeUpdate();
        }
    }, 1000); // Cập nhật mỗi 1 giây
}

// Hàm dừng polling realtime khi popup đóng hoặc gặp lỗi
function stopRealtimeUpdate() {
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
}

// Dừng interval khi popup đóng
window.addEventListener("unload", stopRealtimeUpdate);


// =============================================
// BƯỚC 8: KHỞI ĐỘNG
// =============================================
document.addEventListener("DOMContentLoaded", async () => {
    await loadState();      // Load state từ background
    startRealtimeUpdate();  // Bắt đầu cập nhật realtime
});

// =============================================
// BƯỚC 5B: XỬ LÝ BLOCKLIST (HỌC TẬP)
// =============================================
blockSiteBtn.addEventListener("click", async () => {
    try {
        if (!currentTab) return;
        const hostname = new URL(currentTab.url).hostname;

        // Update UI optimistic
        const nextBlocked = !currentState.studyBlocked;
        renderUI({
            ...currentState,
            studyBlocked: nextBlocked,
            blockedDomains: nextBlocked
                ? Array.from(new Set([...(currentState.blockedDomains || []), hostname]))
                : (currentState.blockedDomains || []).filter((d) => d !== hostname)
        });

        await chrome.runtime.sendMessage({
            type: "TOGGLE_BLOCKED_DOMAIN",
            domain: hostname
        });

        // Reload để áp dụng chặn ngay trên trang hiện tại
        if (currentTab?.id) {
            chrome.tabs.reload(currentTab.id);
        }

        await loadState();
    } catch (error) {
        console.error("[Popup] Lỗi block site:", error);
        renderUI(currentState);
    }
});

blockAddBtn.addEventListener("click", async () => {
    try {
        const normalized = normalizeDomain(blockDomainInput.value);
        if (!normalized) {
            blocklistHint.textContent = "Domain không hợp lệ. Ví dụ: facebook.com";
            return;
        }

        const result = await chrome.runtime.sendMessage({
            type: "ADD_BLOCKED_DOMAIN",
            domain: normalized
        });

        if (!result?.success) {
            blocklistHint.textContent = "Không thêm được domain.";
            return;
        }

        blockDomainInput.value = "";
        await loadState();
    } catch (error) {
        console.error("[Popup] Lỗi thêm domain:", error);
    }
});

blockDomainInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        blockAddBtn.click();
    }
});

blockedDomainsEl.addEventListener("click", async (e) => {
    try {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        if (!target.classList.contains("blocked-remove")) return;
        const domain = target.dataset.domain;
        if (!domain) return;

        await chrome.runtime.sendMessage({
            type: "REMOVE_BLOCKED_DOMAIN",
            domain
        });

        // Nếu xóa đúng domain đang mở, reload để bỏ chặn
        if (currentTab?.url) {
            const currentHost = new URL(currentTab.url).hostname;
            if (normalizeDomain(currentHost) === normalizeDomain(domain)) {
                chrome.tabs.reload(currentTab.id);
            }
        }

        await loadState();
    } catch (error) {
        console.error("[Popup] Lỗi xóa domain:", error);
    }
});