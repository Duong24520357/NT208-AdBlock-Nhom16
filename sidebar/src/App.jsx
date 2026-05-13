import { useEffect, useMemo, useRef, useState } from "react";
import ChatColumn from "./components/ChatColumn.jsx";
import ModelPicker from "./components/ModelPicker.jsx";
import PromptTemplates from "./components/PromptTemplates.jsx";
import SettingsPanel from "./components/SettingsPanel.jsx";
import Toolbar from "./components/Toolbar.jsx";
import { useChromeStorage } from "./hooks/useChromeStorage.js";
import { useStreamingChat } from "./hooks/useStreamingChat.js";
import { listModels } from "./services/openrouter.js";
import { STORAGE_KEYS } from "./utils/storageKeys.js";
import { ACTION_TEMPLATES } from "./utils/strings.js";

const DEFAULT_TEMPLATES = [
  { id: "explain", label: "Explain simply", value: "Explain simply" },
  { id: "summarize", label: "Summarize", value: "Summarize" },
  { id: "translate", label: "Translate", value: "Translate to Vietnamese" },
  { id: "rewrite", label: "Rewrite", value: "Rewrite for clarity" },
];

const FALLBACK_MODELS = [
  { id: "openai/gpt-4o", vendor: "OpenAI" },
  { id: "anthropic/claude-3.5-sonnet", vendor: "Claude" },
  { id: "google/gemini-1.5-pro", vendor: "Gemini" },
  { id: "x-ai/grok-2", vendor: "Grok" },
  { id: "deepseek/deepseek-chat", vendor: "DeepSeek" },
  { id: "meta-llama/llama-3.1-70b-instruct", vendor: "Llama" },
];

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

function mapModels(models) {
  const buckets = [];

  models.forEach((model) => {
    const id = model?.id || "";
    const lowered = id.toLowerCase();
    let vendor = null;

    if (lowered.includes("openai")) vendor = "OpenAI";
    if (lowered.includes("anthropic") || lowered.includes("claude")) vendor = "Claude";
    if (lowered.includes("gemini") || lowered.includes("google")) vendor = "Gemini";
    if (lowered.includes("grok") || lowered.includes("x-ai")) vendor = "Grok";
    if (lowered.includes("deepseek")) vendor = "DeepSeek";
    if (lowered.includes("llama") || lowered.includes("meta-llama")) vendor = "Llama";

    if (vendor) buckets.push({ id, vendor });
  });

  return buckets.length ? buckets : FALLBACK_MODELS;
}

export default function App() {
  const [apiKey, setApiKey] = useChromeStorage(STORAGE_KEYS.apiKey, "");
  const [theme, setTheme] = useChromeStorage(STORAGE_KEYS.theme, "dark");
  const [templates, setTemplates] = useChromeStorage(
    STORAGE_KEYS.templates,
    DEFAULT_TEMPLATES,
  );
  const [selectedModels, setSelectedModels] = useChromeStorage(
    STORAGE_KEYS.modelPrefs,
    [],
  );

  const [catalog, setCatalog] = useState(FALLBACK_MODELS);
  const [input, setInput] = useState("");
  const [context, setContext] = useState({
    title: "",
    url: "",
    selectedText: "",
  });
  const [conversations, setConversations] = useState({});
  const [streamingState, setStreamingState] = useState({});
  const [status, setStatus] = useState("");

  const lastPromptRef = useRef("");
  const conversationsRef = useRef({});
  const streamTimeoutRef = useRef({});
  const { startStream, stopStream } = useStreamingChat();

  const clearStreamTimeout = (modelId) => {
    const timeoutId = streamTimeoutRef.current[modelId];
    if (timeoutId) {
      clearTimeout(timeoutId);
      delete streamTimeoutRef.current[modelId];
    }
  };

  const armStreamTimeout = (modelId, assistantMessage) => {
    clearStreamTimeout(modelId);
    streamTimeoutRef.current[modelId] = setTimeout(() => {
      stopStream(modelId);
      setStreamingState((prev) => ({ ...prev, [modelId]: false }));
      setConversations((prev) => {
        const historyNext = prev[modelId] || [];
        const updated = historyNext.map((item) => {
          if (item.id !== assistantMessage.id) return item;
          return {
            ...item,
            content: `${item.content}\n\n[Error] Stream timed out.`,
          };
        });
        return { ...prev, [modelId]: updated };
      });
    }, 20000);
  };

  const activeModels = useMemo(() => {
    if (selectedModels.length) return selectedModels;
    return catalog.slice(0, 1).map((model) => model.id);
  }, [selectedModels, catalog]);

  const compareMode = activeModels.length > 1;
  const isStreaming = Object.values(streamingState).some(Boolean);

  useEffect(() => {
    if (!apiKey) {
      setCatalog(FALLBACK_MODELS);
      return;
    }

    listModels(apiKey)
      .then((models) => {
        const mapped = mapModels(models);
        setCatalog(mapped);
        if (!selectedModels.length && mapped.length) {
          setSelectedModels([mapped[0].id]);
        }
      })
      .catch(() => {
        setCatalog(FALLBACK_MODELS);
      });
  }, [apiKey, selectedModels.length, setSelectedModels]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    window.parent?.postMessage(
      { source: "ai-sidebar", type: "REQUEST_CONTEXT" },
      "*",
    );

    const handler = (event) => {
      const data = event?.data;
      if (!data || data.source !== "ai-sidebar") return;

      if (data.type === "CONTEXT_RESPONSE") {
        setContext((prev) => ({ ...prev, ...data.payload }));
      }

      if (data.type === "PROMPT_FROM_SELECTION") {
        const action = data.payload?.action;
        const text = data.payload?.text || "";
        const template = ACTION_TEMPLATES[action];
        setInput(template ? template(text) : text);
        if (data.payload?.context) {
          setContext((prev) => ({ ...prev, ...data.payload.context }));
        }
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const handleSend = async (prompt) => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    if (!apiKey) {
      setStatus("Add your OpenRouter API key to continue.");
      return;
    }

    setStatus("");
    lastPromptRef.current = trimmed;

    const systemMessage = formatContext(context);

    activeModels.forEach(async (modelId) => {
      const userMessage = { id: createId(), role: "user", content: trimmed };
      const assistantMessage = { id: createId(), role: "assistant", content: "" };

      setConversations((prev) => {
        const history = prev[modelId] || [];
        return {
          ...prev,
          [modelId]: [...history, userMessage, assistantMessage],
        };
      });

      setStreamingState((prev) => ({ ...prev, [modelId]: true }));
      armStreamTimeout(modelId, assistantMessage);

      const history = conversationsRef.current[modelId] || [];
      const payloadMessages = [...history, userMessage].map((item) => ({
        role: item.role,
        content: item.content,
      }));

      if (systemMessage) payloadMessages.unshift(systemMessage);

      await startStream({
        apiKey,
        model: modelId,
        messages: payloadMessages,
        onDelta: (delta) => {
          armStreamTimeout(modelId, assistantMessage);
          setConversations((prev) => {
            const historyNext = prev[modelId] || [];
            const updated = historyNext.map((item) => {
              if (item.id !== assistantMessage.id) return item;
              return { ...item, content: `${item.content}${delta}` };
            });
            return { ...prev, [modelId]: updated };
          });
        },
        onDone: () => {
          clearStreamTimeout(modelId);
          setStreamingState((prev) => ({ ...prev, [modelId]: false }));
        },
        onError: (error) => {
          clearStreamTimeout(modelId);
          setStreamingState((prev) => ({ ...prev, [modelId]: false }));
          setConversations((prev) => {
            const historyNext = prev[modelId] || [];
            const updated = historyNext.map((item) => {
              if (item.id !== assistantMessage.id) return item;
              return {
                ...item,
                content: `${item.content}\n\n[Error] ${error.message}`,
              };
            });
            return { ...prev, [modelId]: updated };
          });
        },
      });
    });

    setInput("");
  };

  const handleRegenerate = () => {
    if (!lastPromptRef.current) return;
    handleSend(lastPromptRef.current);
  };

  const handleStop = () => {
    stopStream();
    Object.keys(streamTimeoutRef.current).forEach((modelId) => {
      clearStreamTimeout(modelId);
    });
    setStreamingState({});
  };

  const handleClear = () => {
    Object.keys(streamTimeoutRef.current).forEach((modelId) => {
      clearStreamTimeout(modelId);
    });
    setConversations({});
    setStatus("");
  };

  const addTemplate = () => {
    const label = window.prompt("Template label");
    if (!label) return;
    const value = window.prompt("Template prompt");
    if (!value) return;
    const next = [...templates, { id: createId(), label, value }];
    setTemplates(next);
  };

  const columns = activeModels.map((modelId) => {
    const messages = conversations[modelId] || [];
    const title = catalog.find((m) => m.id === modelId)?.vendor || modelId;
    return {
      id: modelId,
      title,
      messages,
      streaming: !!streamingState[modelId],
    };
  });

  return (
    <div className="flex h-screen flex-col gap-4 bg-transparent p-4 text-slate-100">
      <header className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-slate-400">
            AI Sidebar
          </div>
          <div className="text-lg font-semibold text-slate-100">
            OpenRouter Multi-Model
          </div>
        </div>
        <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
          {compareMode ? "Compare" : "Single"}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4">
          <SettingsPanel
            apiKey={apiKey}
            onApiKeyChange={setApiKey}
            theme={theme}
            onTheme={setTheme}
          />
          <ModelPicker
            models={catalog}
            selected={activeModels}
            onChange={setSelectedModels}
          />
          <PromptTemplates
            templates={templates}
            onUse={(template) => setInput(template.value)}
            onAdd={addTemplate}
          />
          <Toolbar
            onRegenerate={handleRegenerate}
            onStop={handleStop}
            onClear={handleClear}
            streaming={isStreaming}
          />
          {status ? (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
              {status}
            </div>
          ) : null}
        </div>

        <div className="flex h-full min-h-[420px] flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="flex-1">
            <div
              className={
                compareMode
                  ? "grid h-full gap-3 md:grid-cols-2"
                  : "grid h-full"
              }
              style={{
                gridTemplateColumns: compareMode
                  ? `repeat(${Math.min(columns.length, 4)}, minmax(0, 1fr))`
                  : "minmax(0, 1fr)",
              }}
            >
              {columns.map((column) => (
                <ChatColumn
                  key={column.id}
                  title={column.title}
                  messages={column.messages}
                  streaming={column.streaming}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              rows={3}
              placeholder="Type your prompt..."
              className="w-full resize-none rounded-2xl border border-slate-700 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
            />
            <div className="flex items-center justify-between">
              <div className="text-[11px] text-slate-400">
                Context: {context.title || "No page context"}
              </div>
              <button
                type="button"
                onClick={() => handleSend(input)}
                className="rounded-full bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
