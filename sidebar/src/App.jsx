import { useEffect, useRef, useState } from "react";
import ChatColumn from "./components/ChatColumn.jsx";
import SettingsPanel from "./components/SettingsPanel.jsx";
import { useStreamingChat } from "./hooks/useStreamingChat.js";
import { listOllamaModels } from "./services/ollama.js";
import { STORAGE_KEYS } from "./utils/storageKeys.js";
import { ACTION_TEMPLATES } from "./utils/strings.js";

const ASK_MODEL = "qwen3:8b";
const OLLAMA_FALLBACK_MODELS = [{ id: ASK_MODEL, vendor: "Ollama" }];

function createId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatContext(context) {
  const lines = [];
  if (context.title) lines.push(`Title: ${context.title}`);
  if (context.url) lines.push(`URL: ${context.url}`);
  if (context.selectedText) {
    lines.push("Selected text:");
    lines.push(context.selectedText);
  }
  if (!lines.length) return null;
  return {
    role: "system",
    content: `Page context\n${lines.join("\n")}`,
  };
}

function mapOllamaModels(models) {
  return models
    .map((model) => model?.name || model?.model)
    .filter(Boolean)
    .map((id) => ({ id, vendor: "Ollama" }));
}

export default function App() {
  const [catalog, setCatalog] = useState(OLLAMA_FALLBACK_MODELS);
  const [input, setInput] = useState("");
  const [context, setContext] = useState({
    title: "",
    url: "",
    selectedText: "",
  });
  const [conversations, setConversations] = useState({});
  const [streamingState, setStreamingState] = useState({});
  const [status, setStatus] = useState("");
  const [ollamaStatus, setOllamaStatus] = useState({
    state: "checking",
    message: "Đang kết nối...",
  });

  const conversationsRef = useRef({});
  const historyLoadedRef = useRef(false);
  const { startStream, stopStream } = useStreamingChat();

  const activeModel = catalog.some((model) => model.id === ASK_MODEL)
    ? ASK_MODEL
    : null;
  const isStreaming = Object.values(streamingState).some(Boolean);

  const loadOllamaModels = async () => {
    setOllamaStatus({ state: "checking", message: "Đang kết nối..." });
    try {
      const mapped = mapOllamaModels(await listOllamaModels());
      setCatalog(mapped);
      if (!mapped.length) {
        setOllamaStatus({ state: "invalid", message: "Chưa cài model local" });
        return;
      }
      if (!mapped.some((model) => model.id === ASK_MODEL)) {
        setOllamaStatus({
          state: "invalid",
          message: `Chưa cài ${ASK_MODEL}`,
        });
        return;
      }
      setOllamaStatus({
        state: "valid",
        message: `${ASK_MODEL} sẵn sàng`,
      });
    } catch {
      setCatalog([]);
      setOllamaStatus({ state: "invalid", message: "Ollama chưa chạy" });
    }
  };

  useEffect(() => {
    loadOllamaModels();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.classList.add("dark");
  }, []);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    chrome.storage.local.get([STORAGE_KEYS.chatHistory], (data) => {
      const stored = data?.[STORAGE_KEYS.chatHistory];
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        conversationsRef.current = stored;
        setConversations(stored);
      }
      historyLoadedRef.current = true;
    });
  }, []);

  useEffect(() => {
    if (!historyLoadedRef.current) return undefined;
    const timeoutId = setTimeout(() => {
      chrome.storage.local.set({
        [STORAGE_KEYS.chatHistory]: conversations,
      });
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [conversations]);

  useEffect(() => {
    if (window.parent !== window) {
      window.parent.postMessage(
        { source: "ai-sidebar", type: "REQUEST_CONTEXT" },
        "*",
      );
    }

    const handler = (event) => {
      const data = event?.data;
      if (
        !data ||
        data.source !== "ai-sidebar" ||
        event.source !== window.parent
      ) {
        return;
      }

      if (data.type === "CONTEXT_RESPONSE") {
        setContext((previous) => ({ ...previous, ...data.payload }));
      }
      if (data.type === "PROMPT_FROM_SELECTION") {
        const text = data.payload?.text || "";
        setInput(ACTION_TEMPLATES.ask(text));
        if (data.payload?.context) {
          setContext((previous) => ({ ...previous, ...data.payload.context }));
        }
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const selectedText = params.get("text") || "";
    const pageTitle = params.get("pageTitle") || "";
    const pageUrl = params.get("pageUrl") || "";

    if (selectedText) setInput(ACTION_TEMPLATES.ask(selectedText));
    if (pageTitle || pageUrl || selectedText) {
      setContext({ title: pageTitle, url: pageUrl, selectedText });
    }
  }, []);

  const handleSend = async () => {
    const prompt = input.trim();
    if (!prompt || isStreaming) return;
    if (!activeModel) {
      setStatus("Không tìm thấy model Ollama để chat.");
      return;
    }

    setStatus("");
    const userMessage = { id: createId(), role: "user", content: prompt };
    const assistantMessage = {
      id: createId(),
      role: "assistant",
      content: "",
    };
    const history = conversationsRef.current[activeModel] || [];
    const payloadMessages = [...history, userMessage]
      .filter((message) => message.content?.trim())
      .map((message) => ({ role: message.role, content: message.content }));
    const systemMessage = formatContext(context);
    if (systemMessage) payloadMessages.unshift(systemMessage);

    const nextConversations = {
      ...conversationsRef.current,
      [activeModel]: [...history, userMessage, assistantMessage],
    };
    conversationsRef.current = nextConversations;
    setConversations(nextConversations);
    setStreamingState({ [activeModel]: true });
    setInput("");

    await startStream({
      model: activeModel,
      messages: payloadMessages,
      onDelta: (delta) => {
        setConversations((previous) => ({
          ...previous,
          [activeModel]: (previous[activeModel] || []).map((message) =>
            message.id === assistantMessage.id
              ? { ...message, content: `${message.content}${delta}` }
              : message,
          ),
        }));
      },
      onDone: () => setStreamingState({}),
      onError: (error) => {
        setStatus(error?.message || "Không kết nối được Ollama local.");
        setConversations((previous) => ({
          ...previous,
          [activeModel]: (previous[activeModel] || []).map((message) =>
            message.id === assistantMessage.id
              ? {
                  ...message,
                  content: message.content || `[Error] ${error.message}`,
                }
              : message,
          ),
        }));
      },
    });
  };

  const handleStop = () => {
    stopStream();
    setStreamingState({});
  };

  const handleClear = () => {
    stopStream();
    setStreamingState({});
    conversationsRef.current = {};
    setConversations({});
    setStatus("");
  };

  const messages = activeModel ? conversations[activeModel] || [] : [];

  return (
    <div className="flex h-screen flex-col gap-3 overflow-hidden bg-transparent p-3 text-slate-100">
      <header className="flex flex-none items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-slate-400">
            Local AI
          </div>
          <div className="text-lg font-semibold">Ask AI</div>
        </div>
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.15em] text-slate-400">
          <span
            className={`h-2 w-2 rounded-full ${
              ollamaStatus.state === "valid"
                ? "bg-emerald-400"
                : ollamaStatus.state === "checking"
                  ? "animate-pulse bg-amber-400"
                  : "bg-rose-400"
            }`}
          />
          {ollamaStatus.state === "valid" ? "Local ready" : "Local offline"}
        </div>
      </header>

      <details className="group flex-none overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/60">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-xs font-semibold text-slate-200">
          <span>Ollama status · qwen3:8b</span>
          <span className="text-slate-500 transition group-open:rotate-180">⌄</span>
        </summary>
        <div className="max-h-[50vh] overflow-y-auto border-t border-slate-800 p-3">
          <SettingsPanel
            onCheckOllama={loadOllamaModels}
            ollamaStatus={ollamaStatus}
          />
        </div>
      </details>

      <div className="flex flex-none items-center justify-between gap-3">
        <div className="text-xs text-slate-400">
          Bôi đen văn bản trên trang và bấm Translate để dịch nhanh.
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleStop}
            disabled={!isStreaming}
            className="rounded-full border border-slate-700 px-3 py-1 text-xs disabled:opacity-40"
          >
            Stop
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="rounded-full border border-slate-700 px-3 py-1 text-xs"
          >
            Clear
          </button>
        </div>
      </div>

      {status ? (
        <div className="flex-none rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {status}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/60 p-2">
        {activeModel ? (
          <ChatColumn
            title={activeModel}
            messages={messages}
            streaming={isStreaming}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-rose-300">
            Ollama chưa sẵn sàng. Mở Model Ollama để kiểm tra.
          </div>
        )}
      </div>

      <div className="flex-none space-y-2 rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              handleSend();
            }
          }}
          rows={2}
          placeholder="Hỏi AI... (Enter để gửi, Shift+Enter để xuống dòng)"
          className="w-full resize-none rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm focus:border-cyan-400 focus:outline-none"
        />
        <div className="flex items-center justify-between gap-3">
          <div className="truncate text-[11px] text-slate-400">
            {activeModel || "Không có model"} · {context.title || "Local chat"}
          </div>
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim() || isStreaming || !activeModel}
            className="rounded-full bg-cyan-500 px-5 py-2 text-xs font-semibold text-slate-950 transition active:scale-95 disabled:opacity-40"
          >
            {isStreaming ? "Đang trả lời..." : "Ask AI"}
          </button>
        </div>
      </div>
    </div>
  );
}
