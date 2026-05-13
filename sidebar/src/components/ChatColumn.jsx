import { useEffect, useRef } from "react";
import ChatMessage from "./ChatMessage.jsx";

export default function ChatColumn({ title, messages, streaming }) {
  const listRef = useRef(null);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-800 bg-slate-950/60">
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
        className="ai-scrollbar flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}
      </div>
    </div>
  );
}
