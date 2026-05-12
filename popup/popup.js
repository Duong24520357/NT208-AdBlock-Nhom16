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

// --- DOM Elements cho phần Cookies ---
const btnExport = document.getElementById("btnExport");
const btnImport = document.getElementById("btnImport");
const fileImport = document.getElementById("fileImport");

const videoUrlInput = document.getElementById("video-url-input");
const downloadBtn = document.getElementById("download-btn");
const downloadStatus = document.getElementById("download-status");
const captureFullPageBtn = document.getElementById("capture-fullpage-btn");
const captureStatus = document.getElementById("capture-status");

const BACKEND_BASE_URL = "http://127.0.0.1:5000";
let isDownloading = false;

// Lưu state hiện tại và tab hiện tại
let currentState = null;
let currentTab = null;
let updateInterval = null;
let isCapturingFullPage = false;

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
  const domains = Array.isArray(state?.blockedDomains)
    ? state.blockedDomains
    : [];
  blockedDomainsEl.textContent = "";
  const currentHostname = (state?.hostname || "").toLowerCase();

  if (domains.length === 0) {
    blocklistHint.innerHTML =
      "Chưa có domain nào. <strong>Thêm domain</strong> để chặn trong giờ học.";
    return;
  }

  blocklistHint.textContent =
    "Mẹo: chặn cả subdomain tự động (vd: www." + domains[0] + ")";
  domains
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .forEach((domain) => {
      const item = document.createElement("div");
      item.className = "blocked-item";
      if (
        currentHostname &&
        (currentHostname === domain || currentHostname.endsWith(`.${domain}`))
      ) {
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
      currentWindow: true,
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
      tabId: currentTab.id,
    });

    if (response) {
      renderUI(response);
    }
  } catch (error) {
    console.error("[Popup] Lỗi load state:", error);
  }
}

async function checkBackendStatus() {
  if (!downloadStatus) return;
  try {
    const response = await fetch(`${BACKEND_BASE_URL}/health`);
    if (!response.ok) {
      throw new Error("healthcheck failed");
    }
    downloadStatus.textContent = "Backend: đang chạy";
    downloadStatus.classList.remove("is-error");
    downloadStatus.classList.add("is-success");
  } catch {
    downloadStatus.textContent =
      "Backend chưa chạy (hãy mở app.py ở cổng 5000)";
    downloadStatus.classList.remove("is-success");
    downloadStatus.classList.add("is-error");
  }
}

async function startVideoDownload() {
  if (!videoUrlInput || !downloadStatus || !downloadBtn) return;
  if (isDownloading) return;

  const url = (videoUrlInput.value || "").trim();
  if (!url) {
    downloadStatus.textContent = "Vui lòng dán link video.";
    downloadStatus.classList.remove("is-success");
    downloadStatus.classList.add("is-error");
    return;
  }

  isDownloading = true;
  downloadBtn.disabled = true;
  downloadStatus.textContent = "Đang gửi yêu cầu tải...";
  downloadStatus.classList.remove("is-error", "is-success");

  try {
    const response = await fetch(`${BACKEND_BASE_URL}/download`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
    });

    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error || "Tải video thất bại");
    }

    downloadStatus.textContent = `Đã tải: ${data.title || "video"}`;
    downloadStatus.classList.remove("is-error");
    downloadStatus.classList.add("is-success");
    videoUrlInput.value = "";
  } catch (error) {
    downloadStatus.textContent = `Lỗi: ${error.message}`;
    downloadStatus.classList.remove("is-success");
    downloadStatus.classList.add("is-error");
  } finally {
    isDownloading = false;
    downloadBtn.disabled = false;
  }
}

async function startFullPageCapture() {
  if (!captureFullPageBtn || !captureStatus) return;
  if (isCapturingFullPage) return;

  try {
    if (!currentTab || !/^https?:\/\//.test(currentTab.url || "")) {
      captureStatus.textContent = "Trang hiện tại không hỗ trợ chụp.";
      captureStatus.classList.remove("is-success");
      captureStatus.classList.add("is-error");
      return;
    }

    isCapturingFullPage = true;
    captureFullPageBtn.disabled = true;
    captureStatus.textContent = "Đang cuộn và chụp từng phần...";
    captureStatus.classList.remove("is-success", "is-error");

    const result = await chrome.runtime.sendMessage({
      type: "CAPTURE_FULL_PAGE",
      tabId: currentTab.id,
    });

    if (!result?.success) {
      throw new Error(result?.error || "CAPTURE_FAILED");
    }

    if (result.stoppedByUser) {
      captureStatus.textContent = `Đã lưu ảnh tạm (${result.capturedFrames || 1} khung): ${result.fileName || "fullpage.png"}`;
    } else if (result.reachedEnd) {
      captureStatus.textContent = `Đã chụp hết trang (${result.capturedFrames || 1} khung): ${result.fileName || "fullpage.png"}`;
    } else {
      captureStatus.textContent = `Đã xuất ảnh: ${result.fileName || "fullpage.png"}`;
    }
    captureStatus.classList.remove("is-error");
    captureStatus.classList.add("is-success");
  } catch (error) {
    captureStatus.textContent = `Lỗi chụp ảnh: ${error.message}`;
    captureStatus.classList.remove("is-success");
    captureStatus.classList.add("is-error");
  } finally {
    isCapturingFullPage = false;
    captureFullPageBtn.disabled = false;
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
      enabled: enabled,
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
      hostname: hostname,
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
      type: "ENTER_ELEMENT_PICKER",
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
        tabId: currentTab.id,
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
  await loadState(); // Load state từ background
  startRealtimeUpdate(); // Bắt đầu cập nhật realtime
  await checkBackendStatus();
});


// --- TÍNH NĂNG 2: IMPORT (NHẬP) COOKIES ---
if (btnImport && fileImport) {
    // 1. Khi bấm nút Import, thực chất là đi bấm "ké" cái thẻ input file đang bị ẩn
    btnImport.addEventListener('click', () => {
        fileImport.click();
    });

    // 2. Khi người dùng đã chọn file xong
    fileImport.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        
        // 3. Hàm này chạy khi máy tính đọc file xong
        reader.onload = async (e) => {
            try {
                // Biến văn bản thành mảng JavaScript
                const cookies = JSON.parse(e.target.result);
                
                if (!Array.isArray(cookies)) {
                    alert("File không đúng định dạng Cookie!");
                    return;
                }

                let successCount = 0;

                // Vòng lặp nhét từng Cookie vào trình duyệt
                for (const cookie of cookies) {
                    // API của Chrome yêu cầu phải tạo URL từ domain để nạp
                    let domain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
                    let url = (cookie.secure ? "https://" : "http://") + domain + cookie.path;

                    // Phải loại bỏ một số thuộc tính rác thì Chrome mới chịu nhận
                    let newCookie = {
                        url: url,
                        name: cookie.name,
                        value: cookie.value,
                        domain: cookie.domain,
                        path: cookie.path,
                        secure: cookie.secure,
                        httpOnly: cookie.httpOnly,
                        sameSite: cookie.sameSite,
                        storeId: cookie.storeId
                    };

                    // Nếu cookie có hạn sử dụng thì giữ nguyên
                    if (!cookie.session && cookie.expirationDate) {
                        newCookie.expirationDate = cookie.expirationDate;
                    }

                    // Bơm vào trình duyệt
                    await chrome.cookies.set(newCookie);
                    successCount++;
                }

                alert(`✅ Đã nạp thành công ${successCount} mã Cookies! Trang sẽ tự tải lại để áp dụng.`);
                
                // Nạp xong thì Reload lại trang để tài khoản đăng nhập thành công
                if (currentTab && currentTab.id) {
                    chrome.tabs.reload(currentTab.id);
                }

            } catch (error) {
                console.error("Lỗi khi nạp Cookie:", error);
                alert("❌ File bị lỗi hoặc không thể nạp Cookie! Xem Console để biết chi tiết.");
            }
            
            // Dọn dẹp thẻ input để lần sau chọn lại đúng file đó không bị kẹt
            fileImport.value = '';
        };
        
        // Bắt đầu đọc file JSON
        reader.readAsText(file);
    });
}

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
        ? Array.from(
            new Set([...(currentState.blockedDomains || []), hostname]),
          )
        : (currentState.blockedDomains || []).filter((d) => d !== hostname),
    });

    await chrome.runtime.sendMessage({
      type: "TOGGLE_BLOCKED_DOMAIN",
      domain: hostname,
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
      domain: normalized,
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
      domain,
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

if (downloadBtn) {
  downloadBtn.addEventListener("click", startVideoDownload);
}

if (captureFullPageBtn) {
  captureFullPageBtn.addEventListener("click", startFullPageCapture);
}

if (videoUrlInput) {
  videoUrlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      startVideoDownload();
    }
  });

  videoUrlInput.addEventListener("paste", () => {
    // Đợi input nhận giá trị mới từ clipboard rồi tự động tải.
    setTimeout(() => {
      startVideoDownload();
    }, 0);
  });
}

// =============================================
// BƯỚC 9: XỬ LÝ TẢI VIDEO
// =============================================

// =============================================
// BƯỚC 10: XỬ LÝ COOKIES (EXPORT / IMPORT)
// =============================================
// --- TÍNH NĂNG 1: EXPORT (XUẤT) COOKIES ---
if (btnExport) {
    btnExport.addEventListener('click', async () => {
        try {
            if (!currentTab || !currentTab.url) {
                alert("Không thể đọc được trang web này!");
                return;
            }

            // Lấy tên miền chuẩn
            let url = new URL(currentTab.url);
            let domain = url.hostname.replace('www.', ''); 

            // Hút toàn bộ Cookie của tên miền
            let cookies = await chrome.cookies.getAll({ domain: domain });

            if (cookies.length === 0) {
                alert("Trang web này chưa có Cookie nào (Bạn đã đăng nhập chưa?)");
                return;
            }

            // Đóng gói thành file JSON và tải về
            let jsonString = JSON.stringify(cookies, null, 2);
            let blob = new Blob([jsonString], { type: "application/json" });
            let downloadUrl = URL.createObjectURL(blob);

            let a = document.createElement('a');
            a.href = downloadUrl;
            a.download = `J2Clone_Cookies_${domain}.json`; 
            a.click();

            URL.revokeObjectURL(downloadUrl);
            
        } catch (error) {
            console.error("Lỗi khi xuất Cookie: ", error);
            alert("Có lỗi xảy ra, vui lòng mở Console để xem chi tiết!");
        }
    });
}
