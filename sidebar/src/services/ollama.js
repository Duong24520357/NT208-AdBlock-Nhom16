const OLLAMA_BASE_URL = "http://127.0.0.1:11434";

async function readNdjson(response, onMessage) {
  if (!response.body) throw new Error("STREAM_NOT_SUPPORTED");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const processLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let payload;
    try {
      payload = JSON.parse(trimmed);
    } catch {
      throw new Error("INVALID_OLLAMA_RESPONSE");
    }
    onMessage(payload);
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    lines.forEach(processLine);
  }

  buffer += decoder.decode();
  if (buffer.trim()) processLine(buffer);
}

async function parseError(response, fallback) {
  try {
    const payload = await response.json();
    return payload?.error || fallback;
  } catch {
    return fallback;
  }
}

export async function listOllamaModels() {
  let response;
  try {
    response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
  } catch {
    throw new Error("OLLAMA_UNAVAILABLE");
  }

  if (!response.ok) {
    throw new Error(await parseError(response, "OLLAMA_UNAVAILABLE"));
  }

  const data = await response.json();
  return Array.isArray(data?.models) ? data.models : [];
}

export async function streamOllamaChat({ model, messages, signal, onDelta }) {
  let response;
  try {
    response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        think: false,
        options: { temperature: 0.4 },
      }),
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new Error("OLLAMA_UNAVAILABLE");
  }

  if (!response.ok) {
    throw new Error(await parseError(response, "OLLAMA_REQUEST_FAILED"));
  }

  await readNdjson(response, (payload) => {
    if (payload?.error) throw new Error(payload.error);
    const delta = payload?.message?.content;
    if (delta) onDelta?.(delta);
  });
}
