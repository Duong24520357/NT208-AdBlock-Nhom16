import { useCallback, useRef } from "react";
import { streamOllamaChat } from "../services/ollama.js";

export function useStreamingChat() {
  const controllersRef = useRef({});

  const startStream = useCallback(
    async ({ model, messages, onDelta, onDone, onError }) => {
      controllersRef.current[model]?.abort();
      const controller = new AbortController();
      controllersRef.current[model] = controller;

      try {
        await streamOllamaChat({
          model,
          messages,
          signal: controller.signal,
          onDelta,
        });
      } catch (error) {
        if (error?.name !== "AbortError") onError?.(error);
      } finally {
        if (controllersRef.current[model] === controller) {
          delete controllersRef.current[model];
        }
        onDone?.();
      }
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
