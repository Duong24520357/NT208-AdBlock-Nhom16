import { useEffect, useRef } from "react";
import ChatMessage from "./ChatMessage.jsx";

export default function ChatColumn({ title, messages, streaming }) {
  const listRef = useRef(null);
  const shouldAutoScrollRef = useRef(true);
  const previousMessageCountRef = useRef(0);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    if (messages.length < previousMessageCountRef.current) {
      previousMessageCountRef.current = 0;
      shouldAutoScrollRef.current = true;
    }
    const addedMessages = messages.slice(previousMessageCountRef.current);
    if (addedMessages.some((message) => message.role === "user")) {
      shouldAutoScrollRef.current = true;
    }
    previousMessageCountRef.current = messages.length;

    if (shouldAutoScrollRef.current) {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages]);

  const handleScroll = () => {
    const list = listRef.current;
    if (!list) return;
    const distanceFromBottom =
      list.scrollHeight - list.scrollTop - list.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 80;
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/60">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">
          {title}
        </div>
        {streaming ? (
          <span className="text-[10px] uppercase tracking-[0.2em] text-cyan-300">
            Streaming
          </span>
        ) : null}
      </div>
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="ai-scrollbar min-h-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto px-4 py-4"
      >
        {!messages.length && !streaming ? (
          <div className="flex h-full items-center justify-center text-center text-xs text-slate-500">
            Chọn model, nhập câu hỏi rồi nhấn Send.
          </div>
        ) : null}
        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}
        {streaming && !messages.at(-1)?.content ? (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-slate-900/80 px-4 py-3 text-xs text-cyan-300">
              <span className="animate-pulse">Thinking locally...</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
