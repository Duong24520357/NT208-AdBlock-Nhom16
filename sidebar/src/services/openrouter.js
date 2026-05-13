import { streamSse } from "../utils/sse.js";

const CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODELS_URL = "https://openrouter.ai/api/v1/models";

export async function listModels(apiKey) {
  const referer = chrome?.runtime?.getURL
    ? chrome.runtime.getURL("")
    : "https://local.extension";
  const title = chrome?.runtime?.getManifest
    ? chrome.runtime.getManifest().name
    : "AI Sidebar";

  const headers = {
    "HTTP-Referer": referer,
    "X-OpenRouter-Title": title,
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(MODELS_URL, { headers });
  if (!response.ok) {
    throw new Error("MODEL_LIST_FAILED");
  }

  const data = await response.json();
  return Array.isArray(data?.data) ? data.data : [];
}

export async function streamChatCompletion({
  apiKey,
  model,
  messages,
  signal,
  onDelta,
  onDone,
  onError,
}) {
  const referer = chrome?.runtime?.getURL
    ? chrome.runtime.getURL("")
    : "https://local.extension";
  const title = chrome?.runtime?.getManifest
    ? chrome.runtime.getManifest().name
    : "AI Sidebar";

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "HTTP-Referer": referer,
    "X-OpenRouter-Title": title,
  };

  const response = await fetch(CHAT_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: 0.4,
    }),
    signal,
  });

  if (!response.ok) {
    let errorMessage = "REQUEST_FAILED";
    let responseText = "";

    try {
      responseText = await response.text();
      const parsed = responseText ? JSON.parse(responseText) : null;
      errorMessage = parsed?.error?.message || errorMessage;
    } catch {
      if (responseText) {
        errorMessage = responseText.slice(0, 300);
      }
    }

    throw new Error(`HTTP ${response.status}: ${errorMessage}`);
  }

  try {
    await streamSse(response, (data) => {
      if (data === "[DONE]") {
        if (onDone) onDone();
        return;
      }

      let payload;
      try {
        payload = JSON.parse(data);
      } catch {
        return;
      }

      const errorMessage = payload?.error?.message;
      if (errorMessage) {
        if (onError) onError(new Error(errorMessage));
        return;
      }

      const delta = payload?.choices?.[0]?.delta?.content;
      if (delta && onDelta) onDelta(delta);
    });
  } catch (error) {
    if (error?.name === "AbortError") return;
    if (onError) onError(error);
  }
}
