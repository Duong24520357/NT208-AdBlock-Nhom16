import { streamSse } from "../utils/sse.js";

const CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODELS_URL = "https://openrouter.ai/api/v1/models";

export async function listModels(apiKey) {
  const headers = {};
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
    try {
      const error = await response.json();
      errorMessage = error?.error?.message || errorMessage;
    } catch {
      // ignore
    }
    throw new Error(errorMessage);
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

      const delta = payload?.choices?.[0]?.delta?.content;
      if (delta && onDelta) onDelta(delta);
    });
  } catch (error) {
    if (error?.name === "AbortError") return;
    if (onError) onError(error);
  }
}

export async function validateToken({ apiKey, model }) {
  const referer = chrome?.runtime?.getURL
    ? chrome.runtime.getURL("")
    : "https://local.extension";
  const title = chrome?.runtime?.getManifest
    ? chrome.runtime.getManifest().name
    : "AI Sidebar";

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": referer,
    "X-OpenRouter-Title": title,
  };

  const response = await fetch(CHAT_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
      temperature: 0,
      stream: false,
    }),
  });

  if (!response.ok) {
    let errorMessage = "TOKEN_INVALID";
    try {
      const error = await response.json();
      errorMessage = error?.error?.message || errorMessage;
    } catch {
      // ignore
    }
    throw new Error(errorMessage);
  }

  return true;
}
