(() => {
  if (window.top !== window.self) return;
  if (window.__aiSidebarInjected) return;
  window.__aiSidebarInjected = true;

  const SIDEBAR_CONTAINER_ID = "ai-sidebar-container";
  const SIDEBAR_IFRAME_ID = "ai-sidebar-iframe";
  const SELECTION_MENU_ID = "ai-selection-menu";
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
  let watchdogTimer = null;
  let userToggledSidebar = false;

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
    if (!chrome?.storage?.local) {
      applySidebarState();
      return;
    }

    chrome.storage.local.get(["aiSidebarWidth", "aiSidebarOpen"], (data) => {
      if (typeof data.aiSidebarWidth === "number") {
        sidebarWidth = clampWidth(data.aiSidebarWidth);
      }
      if (!userToggledSidebar && typeof data.aiSidebarOpen === "boolean") {
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
      }

      #${SELECTION_MENU_ID} button {
        background: #1f2937;
        color: #e2e8f0;
        border: none;
        padding: 6px 10px;
        border-radius: 10px;
        cursor: pointer;
        transition: background 0.2s ease;
      }

      #${SELECTION_MENU_ID} button:hover {
        background: #334155;
      }
    `;

    document.documentElement.appendChild(style);
  }

  function ensureSidebar() {
    if (!document.documentElement) return;

    ensureStyles();

    let container = document.getElementById(SIDEBAR_CONTAINER_ID);
    const createdContainer = !container;

    if (!container) {
      container = document.createElement("div");
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
      const root = getMountRoot();
      if (!root) return;
      root.appendChild(container);

      iframe.addEventListener("load", () => {
        postContextToSidebar();
        postSidebarState();
      });
    }

    if (createdContainer) {
      window.addEventListener("mousemove", handleDrag);
      window.addEventListener("mouseup", stopDrag);
    }
  }

  function applySidebarState() {
    const container = document.getElementById(SIDEBAR_CONTAINER_ID);
    if (!container) return;

    container.style.width = `${sidebarWidth}px`;
    if (sidebarOpen) {
      container.classList.add(OPEN_CLASS);
    } else {
      container.classList.remove(OPEN_CLASS);
    }

    postSidebarState();
  }

  function toggleSidebar(forceOpen) {
    userToggledSidebar = true;
    ensureSidebar();
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
      { key: "summarize", label: "Summarize" },
      { key: "translate", label: "Translate" },
      { key: "rewrite", label: "Rewrite" },
      { key: "explain", label: "Explain code" },
    ];

    actions.forEach((action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.addEventListener("click", () => {
        if (!lastSelection) return;
        openSidebar();
        sendSelectionPrompt(action.key, lastSelection);
        hideSelectionMenu();
      });
      menu.appendChild(button);
    });

    document.documentElement.appendChild(menu);
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
      return true;
    }

    if (message.type === "AI_OPEN_SIDEBAR") {
      openSidebar();
      if (message.payload?.text) {
        sendSelectionPrompt("ask", message.payload.text);
      }
      return true;
    }

    if (message.type === "AI_PING") {
      return true;
    }
  }

  function init() {
    if (document.readyState === "loading") {
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          ensureSidebar();
          ensureSelectionMenu();
          applySidebarState();
          loadSidebarPrefs();
          startRepairObserver();
          startWatchdog();
        },
        { once: true },
      );
    } else {
      ensureSidebar();
      ensureSelectionMenu();
      applySidebarState();
      loadSidebarPrefs();
      startRepairObserver();
      startWatchdog();
    }

    document.addEventListener("mouseup", () => {
      setTimeout(updateSelectionMenu, 10);
    });

    document.addEventListener("keyup", (event) => {
      if (event.key === "Escape") {
        hideSelectionMenu();
        return;
      }
      setTimeout(updateSelectionMenu, 10);
    });

    document.addEventListener("scroll", hideSelectionMenu, true);
    document.addEventListener("mousedown", (event) => {
      const menu = document.getElementById(SELECTION_MENU_ID);
      if (menu && !menu.contains(event.target)) hideSelectionMenu();
    });

    window.addEventListener("message", handleMessage);
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      const handled = handleChromeMessage(message);
      if (handled && typeof sendResponse === "function") {
        sendResponse({ ok: true });
      }
    });
  }

  function startWatchdog() {
    if (watchdogTimer) return;
    watchdogTimer = window.setInterval(() => {
      const container = document.getElementById(SIDEBAR_CONTAINER_ID);
      if (!container) {
        ensureSidebar();
        applySidebarState();
      }
    }, 2000);
  }

  function startRepairObserver() {
    if (repairObserver) return;
    repairObserver = new MutationObserver(() => {
      const container = document.getElementById(SIDEBAR_CONTAINER_ID);
      if (!container) {
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
