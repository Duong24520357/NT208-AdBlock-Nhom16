export async function streamSse(response, onMessage) {
  if (!response.body) throw new Error("STREAM_NOT_SUPPORTED");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data) onMessage(data);
    }
  }

  if (buffer.trim().startsWith("data:")) {
    onMessage(buffer.trim().slice(5).trim());
  }
}
