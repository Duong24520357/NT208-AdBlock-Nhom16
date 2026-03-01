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

// Lưu state hiện tại và tab hiện tại
let currentState = null;
let currentTab = null;
let updateInterval = null;


// =============================================
// BƯỚC 2: RENDER UI THEO STATE
// =============================================
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
}


// =============================================
// BƯỚC 3: LOAD STATE TỪ BACKGROUND
// =============================================
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