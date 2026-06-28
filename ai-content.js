(() => {
  if (window.top !== window.self) return;

  const SIDEBAR_CONTAINER_ID = "ai-sidebar-container";
  const SIDEBAR_IFRAME_ID = "ai-sidebar-iframe";
  const SIDEBAR_TOGGLE_ID = "ai-sidebar-toggle";
  const SELECTION_MENU_ID = "ai-selection-menu";
  const TRANSLATION_POPUP_ID = "ai-translation-popup";
  const OPEN_CLASS = "ai-sidebar-open";
  const DEFAULT_WIDTH = 420;
  const MIN_WIDTH = 320;
  const MAX_WIDTH = 720;

  let sidebarOpen = false;
  let sidebarWidth = DEFAULT_WIDTH;
  let lastSelection = "";
  let isDragging = false;
  let dragStartX = 0;
  let dragStartWidth = DEFAULT_WIDTH;
  let repairObserver = null;
  let sidebarReady = false;
  let pendingSelectionPrompt = null;

  function getMountRoot() {
    return document.body || document.documentElement;
  }

  function clampWidth(value) {
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, value));
  }

  function getPageContext() {
    return {
      title: document.title || "",
      url: window.location.href || "",
      selectedText: lastSelection || "",
    };
  }

  function saveSidebarWidth(width) {
    chrome.storage.local.set({ aiSidebarWidth: width });
  }

  function saveSidebarOpen(open) {
    chrome.storage.local.set({ aiSidebarOpen: open });
  }

  function loadSidebarPrefs() {
    chrome.storage.local.get(["aiSidebarWidth", "aiSidebarOpen"], (data) => {
      if (typeof data.aiSidebarWidth === "number") {
        sidebarWidth = clampWidth(data.aiSidebarWidth);
      }
      if (typeof data.aiSidebarOpen === "boolean") {
        sidebarOpen = data.aiSidebarOpen;
      }
      applySidebarState();
    });
  }

  function ensureStyles() {
    if (document.getElementById("ai-sidebar-styles")) return;

    const style = document.createElement("style");
    style.id = "ai-sidebar-styles";
    style.textContent = `
      #${SIDEBAR_CONTAINER_ID} {
        position: fixed;
        top: 0;
        right: 0;
        height: 100vh;
        width: ${DEFAULT_WIDTH}px;
        transform: translateX(100%);
        transition: transform 0.25s ease, box-shadow 0.25s ease;
        z-index: 2147483646;
        pointer-events: none;
      }

      #${SIDEBAR_CONTAINER_ID}.${OPEN_CLASS} {
        transform: translateX(0);
        box-shadow: -12px 0 30px rgba(0, 0, 0, 0.22);
        pointer-events: auto;
      }

      #${SIDEBAR_IFRAME_ID} {
        width: 100%;
        height: 100%;
        border: none;
        background: transparent;
      }

      #${SIDEBAR_TOGGLE_ID} {
        position: fixed;
        top: 40%;
        right: 0;
        transform: translateX(0);
        background: linear-gradient(135deg, #101827, #1f2937);
        color: #f8fafc;
        border: 1px solid rgba(148, 163, 184, 0.35);
        border-right: none;
        border-radius: 12px 0 0 12px;
        padding: 10px 12px;
        font: 600 12px/1.2 "Sora", "Space Grotesk", system-ui, sans-serif;
        cursor: pointer;
        z-index: 2147483647;
        transition: transform 0.25s ease, opacity 0.25s ease;
        box-shadow: -6px 0 16px rgba(15, 23, 42, 0.35);
        pointer-events: auto !important;
        touch-action: manipulation;
        user-select: none;
        display: block;
        text-decoration: none;
      }


      #${SIDEBAR_CONTAINER_ID} .ai-resize-handle {
        position: absolute;
        left: -6px;
        top: 0;
        width: 6px;
        height: 100%;
        cursor: ew-resize;
        background: rgba(15, 23, 42, 0.12);
      }

      #${SELECTION_MENU_ID} {
        position: fixed;
        display: none;
        gap: 6px;
        padding: 8px;
        background: #111827;
        border: 1px solid rgba(148, 163, 184, 0.35);
        border-radius: 12px;
        box-shadow: 0 12px 30px rgba(15, 23, 42, 0.35);
        z-index: 2147483647;
        font: 500 12px/1.2 "Sora", "Space Grotesk", system-ui, sans-serif;
        pointer-events: auto !important;
        touch-action: manipulation;
        user-select: none;
      }

      #${SELECTION_MENU_ID} a,
      #${SELECTION_MENU_ID} button {
        background: #1f2937;
        color: #e2e8f0;
        border: none;
        padding: 6px 10px;
        border-radius: 10px;
        cursor: pointer;
        transition: background 0.2s ease;
        text-decoration: none;
        font: inherit;
      }

      #${SELECTION_MENU_ID} a:hover,
      #${SELECTION_MENU_ID} button:hover {
        background: #334155;
      }

      #${TRANSLATION_POPUP_ID} {
        position: fixed;
        display: none;
        width: min(420px, calc(100vw - 24px));
        max-height: min(320px, calc(100vh - 24px));
        overflow: hidden;
        background: #0f172a;
        color: #e2e8f0;
        border: 1px solid rgba(34, 211, 238, 0.55);
        border-radius: 14px;
        box-shadow: 0 18px 45px rgba(2, 6, 23, 0.48);
        z-index: 2147483647;
        font: 500 13px/1.55 system-ui, sans-serif;
        pointer-events: auto !important;
      }

      #${TRANSLATION_POPUP_ID} .ai-translation-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 12px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.2);
        color: #67e8f9;
        font-weight: 700;
      }

      #${TRANSLATION_POPUP_ID} .ai-translation-actions {
        display: flex;
        gap: 6px;
      }

      #${TRANSLATION_POPUP_ID} button {
        padding: 4px 9px;
        color: #e2e8f0;
        background: #1e293b;
        border: 1px solid rgba(148, 163, 184, 0.3);
        border-radius: 8px;
        cursor: pointer;
        font: 600 11px/1.4 system-ui, sans-serif;
      }

      #${TRANSLATION_POPUP_ID} .ai-translation-content {
        max-height: 250px;
        overflow-y: auto;
        padding: 12px;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        user-select: text;
      }

      #${TRANSLATION_POPUP_ID}[data-loading="true"] .ai-translation-content {
        color: #94a3b8;
      }
    `;

    document.documentElement.appendChild(style);
  }

  function ensureSidebar() {
    if (document.getElementById(SIDEBAR_CONTAINER_ID)) return;

    ensureStyles();

    const container = document.createElement("div");
    container.id = SIDEBAR_CONTAINER_ID;

    const handle = document.createElement("div");
    handle.className = "ai-resize-handle";
    handle.addEventListener("mousedown", (event) => {
      isDragging = true;
      dragStartX = event.clientX;
      dragStartWidth = sidebarWidth;
      event.preventDefault();
    });

    const iframe = document.createElement("iframe");
    iframe.id = SIDEBAR_IFRAME_ID;
    iframe.src = chrome.runtime.getURL("sidebar/dist/index.html");
    iframe.title = "AI Sidebar";

    container.appendChild(handle);
    container.appendChild(iframe);
    getMountRoot().appendChild(container);

    const toggle = document.createElement("a");
    toggle.id = SIDEBAR_TOGGLE_ID;
    toggle.textContent = "AI";
    toggle.href = buildChatUrl();
    toggle.target = "_blank";
    toggle.rel = "noopener noreferrer";
    toggle.title = "Open Local AI Chat";
    getMountRoot().appendChild(toggle);

    window.addEventListener("mousemove", handleDrag);
    window.addEventListener("mouseup", stopDrag);

    iframe.addEventListener("load", () => {
      sidebarReady = true;
      postContextToSidebar();
      postSidebarState();
      if (pendingSelectionPrompt) {
        const prompt = pendingSelectionPrompt;
        pendingSelectionPrompt = null;
        sendSelectionPrompt(prompt.action, prompt.text);
      }
    });
  }

  function applySidebarState() {
    const container = document.getElementById(SIDEBAR_CONTAINER_ID);
    const toggle = document.getElementById(SIDEBAR_TOGGLE_ID);
    if (!container || !toggle) return;

    container.style.width = `${sidebarWidth}px`;
    if (sidebarOpen) {
      container.classList.add(OPEN_CLASS);
    } else {
      container.classList.remove(OPEN_CLASS);
    }
    toggle.dataset.open = sidebarOpen ? "true" : "false";

    postSidebarState();
  }

  function toggleSidebar(forceOpen) {
    sidebarOpen = typeof forceOpen === "boolean" ? forceOpen : !sidebarOpen;
    applySidebarState();
    saveSidebarOpen(sidebarOpen);
  }

  function openSidebar() {
    toggleSidebar(true);
  }

  function handleDrag(event) {
    if (!isDragging) return;
    const delta = dragStartX - event.clientX;
    const nextWidth = clampWidth(dragStartWidth + delta);
    sidebarWidth = nextWidth;
    applySidebarState();
  }

  function stopDrag() {
    if (!isDragging) return;
    isDragging = false;
    saveSidebarWidth(sidebarWidth);
  }

  function ensureSelectionMenu() {
    if (document.getElementById(SELECTION_MENU_ID)) return;

    const menu = document.createElement("div");
    menu.id = SELECTION_MENU_ID;

    const actions = [
      { key: "ask", label: "Ask AI" },
      { key: "translate", label: "Translate" },
    ];

    actions.forEach((action) => {
      if (action.key === "translate") {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = action.label;
        button.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const selectionRect = getSelectionRect();
          const text = lastSelection;
          hideSelectionMenu();
          if (text && selectionRect) translateSelection(text, selectionRect);
        });
        menu.appendChild(button);
        return;
      }

      const link = document.createElement("a");
      link.textContent = action.label;
      link.dataset.action = action.key;
      link.href = buildChatUrl(action.key, "");
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      menu.appendChild(link);
    });

    document.documentElement.appendChild(menu);
  }

  function ensureTranslationPopup() {
    const existing = document.getElementById(TRANSLATION_POPUP_ID);
    if (existing) return existing;

    const popup = document.createElement("div");
    popup.id = TRANSLATION_POPUP_ID;

    const header = document.createElement("div");
    header.className = "ai-translation-header";
    const title = document.createElement("span");
    title.textContent = "Bản dịch tiếng Việt";

    const actions = document.createElement("div");
    actions.className = "ai-translation-actions";
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.textContent = "Copy";
    copyButton.addEventListener("click", async () => {
      const content = popup.querySelector(".ai-translation-content");
      try {
        await navigator.clipboard.writeText(content?.textContent || "");
        copyButton.textContent = "Đã copy";
      } catch {
        copyButton.textContent = "Lỗi copy";
      }
      setTimeout(() => {
        copyButton.textContent = "Copy";
      }, 1200);
    });

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "Đóng";
    closeButton.addEventListener("click", () => {
      popup.style.display = "none";
    });

    const content = document.createElement("div");
    content.className = "ai-translation-content";

    actions.append(copyButton, closeButton);
    header.append(title, actions);
    popup.append(header, content);
    document.documentElement.appendChild(popup);
    return popup;
  }

  function positionTranslationPopup(popup, rect) {
    popup.style.display = "block";
    const popupRect = popup.getBoundingClientRect();
    const preferredTop = rect.top - popupRect.height - 12;
    const top = preferredTop >= 12 ? preferredTop : rect.bottom + 12;
    const left = Math.min(
      Math.max(12, rect.left),
      window.innerWidth - popupRect.width - 12,
    );
    popup.style.top = `${Math.max(
      12,
      Math.min(top, window.innerHeight - popupRect.height - 12),
    )}px`;
    popup.style.left = `${left}px`;
  }

  function translateSelection(text, rect) {
    const popup = ensureTranslationPopup();
    const content = popup.querySelector(".ai-translation-content");
    const requestId = `${Date.now()}-${Math.random()}`;
    popup.dataset.requestId = requestId;
    popup.dataset.loading = "true";
    content.textContent = "Đang dịch bằng Ollama local...";
    positionTranslationPopup(popup, rect);

    chrome.runtime.sendMessage(
      { type: "AI_TRANSLATE_SELECTION", text: text.slice(0, 6000) },
      (response) => {
        if (popup.dataset.requestId !== requestId) return;
        popup.dataset.loading = "false";
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          content.textContent = "Không kết nối được extension. Hãy reload extension và thử lại.";
          return;
        }
        content.textContent = response?.success
          ? response.translation
          : response?.error || "Không dịch được. Hãy kiểm tra Ollama.";
        positionTranslationPopup(popup, rect);
      },
    );
  }

  function showSelectionMenu(rect) {
    const menu = document.getElementById(SELECTION_MENU_ID);
    if (!menu) return;

    const top = rect.top - 48;
    const left = Math.min(
      Math.max(12, rect.left),
      window.innerWidth - menu.offsetWidth - 12,
    );

    menu.style.top = `${Math.max(12, top)}px`;
    menu.style.left = `${left}px`;
    menu.style.display = "flex";
    menu.querySelectorAll("a[data-action]").forEach((link) => {
      link.href = buildChatUrl(link.dataset.action, lastSelection);
    });
  }

  function buildChatUrl(action = "", text = "") {
    const url = new URL(chrome.runtime.getURL("sidebar/dist/index.html"));
    if (action) url.searchParams.set("action", action);
    if (text) url.searchParams.set("text", text.slice(0, 6000));
    url.searchParams.set("pageTitle", document.title || "");
    url.searchParams.set("pageUrl", window.location.href || "");
    return url.toString();
  }

  function hideSelectionMenu() {
    const menu = document.getElementById(SELECTION_MENU_ID);
    if (menu) menu.style.display = "none";
  }

  function getSelectionRect() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    return range.getBoundingClientRect();
  }

  function updateSelectionMenu() {
    const selection = window.getSelection();
    const text = selection ? selection.toString().trim() : "";
    lastSelection = text;
    const anchor = selection?.anchorNode?.parentElement;
    if (anchor && anchor.closest("input, textarea, [contenteditable='true']")) {
      hideSelectionMenu();
      return;
    }
    if (!text || text.length < 2) {
      hideSelectionMenu();
      return;
    }

    const rect = getSelectionRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      hideSelectionMenu();
      return;
    }

    ensureSelectionMenu();
    showSelectionMenu(rect);
  }

  function sendSelectionPrompt(action, text) {
    const iframe = document.getElementById(SIDEBAR_IFRAME_ID);
    if (!iframe?.contentWindow) return;

    if (!sidebarReady) {
      pendingSelectionPrompt = { action, text };
      return;
    }

    iframe.contentWindow.postMessage(
      {
        source: "ai-sidebar",
        type: "PROMPT_FROM_SELECTION",
        payload: {
          action,
          text,
          context: getPageContext(),
        },
      },
      "*",
    );
  }

  function postContextToSidebar() {
    const iframe = document.getElementById(SIDEBAR_IFRAME_ID);
    if (!iframe?.contentWindow) return;

    iframe.contentWindow.postMessage(
      {
        source: "ai-sidebar",
        type: "CONTEXT_RESPONSE",
        payload: getPageContext(),
      },
      "*",
    );
  }

  function postSidebarState() {
    const iframe = document.getElementById(SIDEBAR_IFRAME_ID);
    if (!iframe?.contentWindow) return;

    iframe.contentWindow.postMessage(
      {
        source: "ai-sidebar",
        type: "SIDEBAR_STATE",
        payload: {
          open: sidebarOpen,
          width: sidebarWidth,
        },
      },
      "*",
    );
  }

  function handleMessage(event) {
    if (!event?.data || event.data.source !== "ai-sidebar") return;

    const iframe = document.getElementById(SIDEBAR_IFRAME_ID);
    if (!iframe || event.source !== iframe.contentWindow) return;

    if (event.data.type === "REQUEST_CONTEXT") {
      postContextToSidebar();
    }

    if (event.data.type === "OPEN_SIDEBAR") {
      openSidebar();
    }
  }

  function handleChromeMessage(message) {
    if (!message?.type) return;

    if (message.type === "AI_TOGGLE_SIDEBAR") {
      toggleSidebar();
    }

    if (message.type === "AI_OPEN_SIDEBAR") {
      openSidebar();
      if (message.payload?.text) {
        sendSelectionPrompt("ask", message.payload.text);
      }
    }
  }

  function init() {
    removeStaleUi();
    ensureSidebar();
    ensureSelectionMenu();
    loadSidebarPrefs();
    startRepairObserver();

    document.addEventListener("mouseup", () => {
      setTimeout(updateSelectionMenu, 10);
    });

    document.addEventListener("keyup", (event) => {
      if (event.key === "Escape") {
        hideSelectionMenu();
        const translationPopup = document.getElementById(TRANSLATION_POPUP_ID);
        if (translationPopup) translationPopup.style.display = "none";
        return;
      }
      setTimeout(updateSelectionMenu, 10);
    });

    document.addEventListener("scroll", hideSelectionMenu, true);
    document.addEventListener("mousedown", (event) => {
      const menu = document.getElementById(SELECTION_MENU_ID);
      if (menu && !menu.contains(event.target)) hideSelectionMenu();
      const translationPopup = document.getElementById(TRANSLATION_POPUP_ID);
      if (translationPopup && !translationPopup.contains(event.target)) {
        translationPopup.style.display = "none";
      }
    });

    window.addEventListener("message", handleMessage);
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "AI_PING") {
        sendResponse({ success: true });
        return;
      }
      handleChromeMessage(message);
      if (
        message?.type === "AI_TOGGLE_SIDEBAR" ||
        message?.type === "AI_OPEN_SIDEBAR"
      ) {
        sendResponse({ success: true });
      }
    });
  }

  function removeStaleUi() {
    [
      SIDEBAR_CONTAINER_ID,
      SIDEBAR_TOGGLE_ID,
      SELECTION_MENU_ID,
      TRANSLATION_POPUP_ID,
      "ai-sidebar-styles",
    ].forEach((id) => document.getElementById(id)?.remove());
    sidebarReady = false;
    pendingSelectionPrompt = null;
  }

  function startRepairObserver() {
    if (repairObserver) return;
    repairObserver = new MutationObserver(() => {
      const container = document.getElementById(SIDEBAR_CONTAINER_ID);
      const toggle = document.getElementById(SIDEBAR_TOGGLE_ID);
      if (!container || !toggle) {
        ensureSidebar();
        applySidebarState();
      }
    });

    repairObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  init();
})();
