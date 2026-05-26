import { useCallback, useRef } from "react";
import { streamChatCompletion } from "../services/openrouter.js";

export function useStreamingChat() {
  const controllersRef = useRef({});

  const startStream = useCallback(
    async ({ apiKey, model, messages, onDelta, onDone, onError }) => {
      const controller = new AbortController();
      controllersRef.current[model] = controller;

      await streamChatCompletion({
        apiKey,
        model,
        messages,
        signal: controller.signal,
        onDelta,
        onDone,
        onError,
      });
    },
    [],
  );

  const stopStream = useCallback((model) => {
    if (model) {
      controllersRef.current[model]?.abort();
      delete controllersRef.current[model];
      return;
    }

    Object.values(controllersRef.current).forEach((controller) => {
      controller?.abort();
    });
    controllersRef.current = {};
  }, []);

  return { startStream, stopStream };
}
