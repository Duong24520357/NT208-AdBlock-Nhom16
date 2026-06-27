// =============================================
// BƯỚC 1: LẤY CÁC DOM ELEMENTS
// =============================================
const toggleSwitch = document.getElementById("toggle-switch");
const toggleLabel = document.getElementById("toggle-label");
const pipToggleSwitch = document.getElementById("pip-toggle-switch");
const pipToggleLabel = document.getElementById("pip-toggle-label");
const pipDomainLabel = document.getElementById("pip-domain-label");
const pipDomainBtn = document.getElementById("pip-domain-btn");
// const whitelistBtn = document.getElementById("whitelist-btn");
const pickerBtn = document.getElementById("picker-btn");
const tabBlockedCount = document.getElementById("tab-blocked-count");
const totalBlockedCount = document.getElementById("total-blocked-count");
const hostnameLabel = document.getElementById("hostname-label");
const statusDot = document.getElementById("status-dot");
const blockSiteBtn = document.getElementById("blocksite-btn");
const pipNowBtn = document.getElementById("pip-now-btn");
const blockDomainInput = document.getElementById("block-domain-input");
const blockAddBtn = document.getElementById("block-add-btn");
const blockedDomainsEl = document.getElementById("blocked-domains");
const blocklistHint = document.getElementById("blocklist-hint");
const videoUrlInput = document.getElementById("video-url-input");
const downloadBtn = document.getElementById("download-btn");
const downloadStatus = document.getElementById("download-status");
// legacy select removed; use custom fmtBadge dropdown instead
const captureFullPageBtn = document.getElementById("capture-fullpage-btn");
const captureStatus = document.getElementById("capture-status");
const aiSidebarBtn = document.getElementById("ai-sidebar-btn");
const fmtDd      = document.getElementById('fmtDd');
const fmtMenu    = document.getElementById('fmtMenu');
const fmtTrigger = document.getElementById('fmtTrigger');
const fmtBadge   = document.getElementById('fmtBadge');
const fmtLabel   = document.getElementById('fmtLabel');

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message || "SEND_MESSAGE_FAILED"));
        return;
      }
      resolve(response);
    });
  });
}

function createTab(url) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url }, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message || "CREATE_TAB_FAILED"));
        return;
      }
      resolve(tab);
    });
  });
}

function queryTabs(queryInfo) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message || "QUERY_TABS_FAILED"));
        return;
      }
      resolve(tabs || []);
    });
  });
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message || "SEND_RUNTIME_MESSAGE_FAILED"));
        return;
      }
      resolve(response);
    });
  });
}

// Doi thanh URL Render sau khi deploy, vi du:
// const BACKEND_BASE_URL = "https://ten-app-cua-ban.onrender.com";
const BACKEND_BASE_URL = "https://nt208-adblock-nhom16.onrender.com";
let isDownloading = false;

// Lưu state hiện tại và tab hiện tại
let currentState = null;
let currentTab = null;
let updateInterval = null;
let isCapturingFullPage = false;

function getCaptureFilename(contentURL) {
  let name = String(contentURL || "").split("?")[0].split("#")[0];
  if (name) {
    name = name
      .replace(/^https?:\/\//, "")
      .replace(/[^A-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[_\-]+/, "")
      .replace(/[_\-]+$/, "");
    name = `-${name}`;
  } else {
    name = "";
  }
  return `screencapture${name}-${Date.now()}.png`;
}

function getCaptureBaseName(contentURL) {
  return getCaptureFilename(contentURL).replace(/\.png$/i, "");
}

function sanitizeDownloadFilename(name, fallback = "video") {
  const safeName = String(name || fallback)
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return safeName || fallback;
}

function downloadBlob(blob, filename) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    chrome.downloads.download(
      {
        url: objectUrl,
        filename,
        saveAs: false,
      },
      (downloadId) => {
        const error = chrome.runtime.lastError;
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
        if (error) {
          reject(new Error(error.message || "DOWNLOAD_FAILED"));
          return;
        }
        resolve(downloadId);
      },
    );
  });
}

function downloadUrl(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url,
        filename,
        saveAs: true,
      },
      (downloadId) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message || "DOWNLOAD_FAILED"));
          return;
        }
        resolve(downloadId);
      },
    );
  });
}

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("IMAGE_LOAD_FAILED"));
    };
    image.src = objectUrl;
  });
}

function imageToJpegBinary(image) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, image.width || 1);
  canvas.height = Math.max(1, image.height || 1);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("CANVAS_CONTEXT_FAILED");
  }
  ctx.drawImage(image, 0, 0);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  return atob(dataUrl.split(",")[1]);
}

function buildPdfBlobFromImages(images) {
  const pages = images.map((image) => ({
    width: Math.max(1, Math.round(image.width || 1)),
    height: Math.max(1, Math.round(image.height || 1)),
    jpeg: imageToJpegBinary(image),
  }));

  const textEncoder = new TextEncoder();
  const bytesFromText = (text) => textEncoder.encode(text);
  const bytesFromBinary = (binary) => {
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i) & 0xff;
    }
    return bytes;
  };

  const chunks = [];
  const offsets = [0];
  let byteLength = 0;

  const appendChunk = (chunk) => {
    chunks.push(chunk);
    byteLength += chunk.length;
  };

  const appendText = (text) => appendChunk(bytesFromText(text));

  const appendObject = (objectId, bodyChunks) => {
    offsets[objectId] = byteLength;
    appendText(`${objectId} 0 obj\n`);
    bodyChunks.forEach((chunk) => appendChunk(chunk));
    appendText("\nendobj\n");
  };

  const header = new Uint8Array([
    0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3,
    0xcf, 0xd3, 0x0a,
  ]);
  appendChunk(header);

  const pageObjects = [];
  pages.forEach((page, index) => {
    const imageObjectId = 3 + index * 3;
    const contentObjectId = 4 + index * 3;
    const pageObjectId = 5 + index * 3;
    pageObjects.push(pageObjectId);

    appendObject(imageObjectId, [
      bytesFromText(
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
      ),
      bytesFromBinary(page.jpeg),
      bytesFromText("\nendstream"),
    ]);

    const contentStream = `q\n${page.width} 0 0 ${page.height} 0 0 cm\n/Im${index + 1} Do\nQ\n`;
    appendObject(contentObjectId, [
      bytesFromText(`<< /Length ${contentStream.length} >>\nstream\n${contentStream}`),
      bytesFromText("endstream"),
    ]);

    appendObject(pageObjectId, [
      bytesFromText(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources << /XObject << /Im${index + 1} ${imageObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
      ),
    ]);
  });

  appendObject(1, [bytesFromText("<< /Type /Catalog /Pages 2 0 R >>")]);
  appendObject(2, [
    bytesFromText(
      `<< /Type /Pages /Kids [${pageObjects.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjects.length} >>`,
    ),
  ]);

  const xrefOffset = byteLength;
  appendText(`xref\n0 ${pageObjects.length * 3 + 3}\n`);
  appendText("0000000000 65535 f \n");
  for (let objectId = 1; objectId <= pageObjects.length * 3 + 2; objectId += 1) {
    appendText(`${String(offsets[objectId]).padStart(10, "0")} 00000 n \n`);
  }
  appendText(
    `trailer\n<< /Size ${pageObjects.length * 3 + 3} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
  );

  return new Blob(chunks, { type: "application/pdf" });
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

  if (pipToggleSwitch) {
    const pipEnabled = state.pipEnabled !== false;
    pipToggleSwitch.checked = pipEnabled;
    if (pipToggleLabel) {
      pipToggleLabel.textContent = pipEnabled ? "Đang bật" : "Đang tắt";
      pipToggleLabel.style.color = pipEnabled ? "#2ecc71" : "#999999";
    }
  }

  if (pipDomainLabel) {
    const hostname = state.hostname || "";
    const allowList = Array.isArray(state.pipAllowedDomains)
      ? state.pipAllowedDomains
      : [];
    pipDomainLabel.textContent =
      allowList.length === 0
        ? "PiP: toàn bộ trang"
        : state.pipDomainAllowed
          ? `PiP: cho phép trên ${hostname || "trang này"}`
          : `PiP: không cho phép trên ${hostname || "trang này"}`;
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
  // if (!state.enabled) {
  //   // AdBlock tắt → disable nút whitelist
  //   whitelistBtn.disabled = true;
  //   whitelistBtn.textContent = "Tắt cho trang này";
  //   whitelistBtn.style.opacity = "0.5";
  // } else if (state.whitelisted) {
  //   // Domain trong whitelist → hiện "Bật cho trang này"
  //   whitelistBtn.disabled = false;
  //   whitelistBtn.textContent = "✅ Bật cho trang này";
  //   whitelistBtn.style.background = "#f39c12";
  //   whitelistBtn.style.opacity = "1";
  // } else {
  //   // Domain không trong whitelist → hiện "Tắt cho trang này"
  //   whitelistBtn.disabled = false;
  //   whitelistBtn.textContent = "🚫 Tắt cho trang này";
  //   whitelistBtn.style.background = "#e74c3c";
  //   whitelistBtn.style.opacity = "1";
  // }

  // --- Nút Element Picker ---
  pickerBtn.disabled = !state.enabled || state.whitelisted;
  pickerBtn.style.opacity = pickerBtn.disabled ? "0.5" : "1";

  if (pipNowBtn) {
    pipNowBtn.disabled = !state.enabled || state.pipEnabled === false;
    pipNowBtn.style.opacity = pipNowBtn.disabled ? "0.5" : "1";
  }

  if (pipDomainBtn) {
    const allowList = Array.isArray(state.pipAllowedDomains)
      ? state.pipAllowedDomains
      : [];
    pipDomainBtn.disabled = !state.enabled || !state.hostname;
    pipDomainBtn.textContent =
      allowList.length === 0 || state.pipDomainAllowed === true
        ? "Chỉ cho phép PiP trang này"
        : "Bỏ giới hạn PiP trang này";
    pipDomainBtn.style.opacity = pipDomainBtn.disabled ? "0.5" : "1";
  }

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
    const tabs = await queryTabs({
      active: true,
      currentWindow: true,
    });

    currentTab = tabs[0];

    // Kiểm tra tab có hợp lệ không
    // if (!currentTab || !currentTab.url?.startsWith("http")) {
    //   hostnameLabel.textContent = "Không hỗ trợ trang này";
    //   whitelistBtn.disabled = true;
    //   pickerBtn.disabled = true;
    //   return;
    // }

    // Gửi GET_STATE lên background
    const response = await sendRuntimeMessage({
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
  downloadStatus.textContent = "Đang lấy link tải...";
  downloadStatus.classList.remove("is-error", "is-success");

  try {
    const params = new URLSearchParams({ url });
    const response = await fetch(`${BACKEND_BASE_URL}/get-link?${params}`);
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error || "Khong lay duoc link tai");
    }
    if (!data.download_url) {
      throw new Error("Backend khong tra ve link tai");
    }

    const filename = `${sanitizeDownloadFilename(data.title)}.mp4`;
    await downloadUrl(data.download_url, filename);

    downloadStatus.textContent = `Dang tai ve may: ${data.title || "video"}`;
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
    const format = getCaptureFormat();
    captureStatus.textContent =
      format === "pdf" ? "Đang tạo file PDF..." : "Đang chụp PNG...";
    captureStatus.classList.remove("is-success", "is-error");

    if (!window.CaptureAPI) {
      throw new Error("CAPTURE_API_NOT_LOADED");
    }

    const baseName = getCaptureBaseName(currentTab.url);
    const blobs = await new Promise((resolve, reject) => {
      window.CaptureAPI.captureToBlobs(
        currentTab,
        (resultBlobs) => resolve(resultBlobs),
        (reason) => reject(new Error(reason || "CAPTURE_FAILED")),
        (complete) => {
          if (complete === 0) {
            captureStatus.textContent = "Đang mở page.js và cuộn trang...";
            return;
          }
          captureStatus.textContent = `Đang chụp: ${Math.round(complete * 100)}%`;
        },
        () => {
          captureStatus.textContent = "Trang quá dài, ảnh sẽ được tách thành nhiều file.";
        },
      );
    });

    if (format === "png") {
      const downloads = [];
      for (let i = 0; i < blobs.length; i += 1) {
        const suffix = blobs.length > 1 ? `-${i + 1}` : "";
        const filename = `${baseName}${suffix}.png`;
        downloads.push(downloadBlob(blobs[i], filename));
      }
      await Promise.all(downloads);
      captureStatus.textContent = `Đã tải ${blobs.length} file PNG.`;
    } else {
      const images = [];
      for (const blob of blobs) {
        images.push(await loadImageFromBlob(blob));
      }
      const pdfBlob = buildPdfBlobFromImages(images);
      await downloadBlob(pdfBlob, `${baseName}.pdf`);
      captureStatus.textContent = `Đã tải PDF từ ${blobs.length} khung ảnh.`;
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
    await sendRuntimeMessage({
      type: "TOGGLE_ENABLED",
      enabled: enabled,
    });
  } catch (error) {
    console.error("[Popup] Lỗi toggle:", error);
    // Rollback UI nếu lỗi
    renderUI(currentState);
  }
});

if (pipToggleSwitch) {
  pipToggleSwitch.addEventListener("change", async () => {
    try {
      const pipEnabled = pipToggleSwitch.checked;

      renderUI({ ...currentState, pipEnabled });

      await sendRuntimeMessage({
        type: "TOGGLE_PIP_ENABLED",
        enabled: pipEnabled,
      });
    } catch (error) {
      console.error("[Popup] Lỗi toggle PiP:", error);
      renderUI(currentState);
    }
  });
}

if (pipDomainBtn) {
  pipDomainBtn.addEventListener("click", async () => {
    try {
      if (!currentTab) return;
      const hostname = normalizeDomain(currentState?.hostname || currentTab.url);
      if (!hostname) return;

      const allowList = Array.isArray(currentState?.pipAllowedDomains)
        ? currentState.pipAllowedDomains
        : [];
      const allowCurrent = currentState?.pipDomainAllowed === true;
      const nextAllowed = !(allowList.length > 0 && allowCurrent);

      renderUI({
        ...currentState,
        pipDomainAllowed: nextAllowed,
        pipAllowedDomains: nextAllowed
          ? Array.from(new Set([...(allowList || []), hostname]))
          : allowList.filter((domain) => domain !== hostname),
      });

      await sendRuntimeMessage({
        type: "TOGGLE_PIP_ALLOWED_DOMAIN",
        domain: hostname,
      });
    } catch (error) {
      console.error("[Popup] Lỗi giới hạn PiP theo domain:", error);
      renderUI(currentState);
    }
  });
}

// =============================================
// BƯỚC 5: XỬ LÝ WHITELIST
// =============================================
// whitelistBtn.addEventListener("click", async () => {
//   try {
//     if (!currentTab) return;

//     const hostname = new URL(currentTab.url).hostname;

//     // Cập nhật UI ngay lập tức
//     const newWhitelisted = !currentState.whitelisted;
//     renderUI({ ...currentState, whitelisted: newWhitelisted });

//     // Gửi lệnh lên background
//     await sendRuntimeMessage({
//       type: "TOGGLE_WHITELIST",
//       hostname: hostname,
//     });
//   } catch (error) {
//     console.error("[Popup] Lỗi whitelist:", error);
//     renderUI(currentState);
//   }
// });

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

if (pipNowBtn) {
  pipNowBtn.addEventListener("click", async () => {
    try {
      if (!currentTab) return;
      window.close();
      await sendTabMessage(currentTab.id, {
        type: "PREPARE_AUTO_PIP",
      });
    } catch (error) {
      console.error("[Popup] Lỗi bật PiP:", error);
    }
  });
}

// =============================================
// BƯỚC 7: CẬP NHẬT SỐ ĐẾM REALTIME
// =============================================
// Hàm bắt đầu polling để cập nhật số ads bị chặn theo thời gian thực
function startRealtimeUpdate() {
  updateInterval = setInterval(async () => {
    try {
      if (!currentTab) return;

      const response = await sendRuntimeMessage({
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
  await initCaptureFormat(); // Load saved capture format preference
  // Wire dropdown controls (no inline handlers to satisfy CSP)
  try {
    if (fmtTrigger) fmtTrigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.debug('[Popup] fmtTrigger clicked');
      try { fmtToggle(); } catch (err) { console.error('fmtToggle error', err); }
    });
    // keep clicks inside dropdown from bubbling (so document click doesn't immediately close it)
    if (fmtDd) fmtDd.addEventListener('click', (e) => { e.stopPropagation(); });
    document.querySelectorAll('.fmt-item').forEach((item) => {
      item.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const badge = item.querySelector('.fmt-badge');
        const value = badge?.dataset?.type || 'png';
        const label = (badge?.textContent || value).toUpperCase();
        console.debug('[Popup] fmt item pick', value, label);
        fmtPick(value, label, item);
      });
    });
  } catch (e) {
    // ignore wiring errors
  }
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
        ? Array.from(
            new Set([...(currentState.blockedDomains || []), hostname]),
          )
        : (currentState.blockedDomains || []).filter((d) => d !== hostname),
    });

    await sendRuntimeMessage({
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

    const result = await sendRuntimeMessage({
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

    await sendRuntimeMessage({
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

if (captureFullPageBtn) {
  captureFullPageBtn.addEventListener("click", startFullPageCapture);
}

if (aiSidebarBtn) {
  aiSidebarBtn.addEventListener("click", async () => {
    try {
      blocklistHint.textContent = "Dang mo cua so AI...";
      try {
        await sendRuntimeMessage({ type: "OPEN_AI_TAB" });
        window.close();
      } catch (error) {
        const url = chrome.runtime.getURL("sidebar/dist/index.html");
        await createTab(url);
        window.close();
      }
    } catch (error) {
      console.error("[Popup] Loi mo AI:", error);
      blocklistHint.textContent = "Khong mo duoc AI. Hay reload extension.";
    }
  });
}

function getCaptureFormat() {
  return fmtBadge.dataset.type;
}

function fmtToggle() {
  const isOpen = fmtMenu.classList.contains('open');
  fmtMenu.classList.toggle('open', !isOpen);
  fmtTrigger.classList.toggle('open', !isOpen);
}


document.addEventListener('click', e => {
  if (!e.target.closest('#fmtDd')) {
    fmtMenu.classList.remove('open');
    fmtTrigger.classList.remove('open');
  }
});

// Persist selected capture format and initialize on load
function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (res) => resolve(res || {}));
  });
}

function storageSet(obj) {
  return new Promise((resolve) => {
    chrome.storage.local.set(obj, () => resolve());
  });
}

// Persist selection when user picks an option
function fmtPick(value, label, el) {
  fmtBadge.textContent = label;
  fmtBadge.dataset.type = value;
  fmtLabel.textContent = label;

  document.querySelectorAll('.fmt-item').forEach(i => i.classList.remove('selected'));
  if (el) el.classList.add('selected');

  fmtMenu.classList.remove('open');
  fmtTrigger.classList.remove('open');

  // save preference
  try {
    storageSet({ captureFormat: value });
  } catch (e) {
    // ignore storage errors
  }
}

// Initialize stored format on popup open
async function initCaptureFormat() {
  try {
    const { captureFormat } = await storageGet(['captureFormat']);
    const value = captureFormat || (fmtBadge && fmtBadge.dataset && fmtBadge.dataset.type) || 'png';
    const label = String(value || 'png').toUpperCase();
    fmtBadge.dataset.type = value;
    fmtBadge.textContent = label;
    fmtLabel.textContent = label;

    // mark selected item in menu
    document.querySelectorAll('.fmt-item').forEach((item) => {
      const itemBadge = item.querySelector('.fmt-badge');
      if (itemBadge && itemBadge.dataset.type === value) {
        item.classList.add('selected');
      } else {
        item.classList.remove('selected');
      }
    });
  } catch (e) {
    // ignore
  }
}
