import { useEffect, useMemo, useRef } from "react";
import { marked } from "marked";
import hljs from "highlight.js/lib/common";
import { sanitizeHtml } from "../utils/sanitize.js";

marked.setOptions({
  gfm: true,
  breaks: true,
});

export default function ChatMessage({ message }) {
  const contentRef = useRef(null);
  const isUser = message.role === "user";

  const rendered = useMemo(() => {
    const raw = message.content || "";
    if (!raw) return "";
    return sanitizeHtml(marked.parse(raw));
  }, [message.content]);

  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    const codeBlocks = container.querySelectorAll("pre code");
    codeBlocks.forEach((block) => {
      hljs.highlightElement(block);
    });

    const pres = container.querySelectorAll("pre");
    pres.forEach((pre) => {
      if (pre.querySelector(".ai-copy-btn")) return;
      const button = document.createElement("button");
      button.className = "ai-copy-btn";
      button.textContent = "Copy";
      button.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(pre.innerText || "");
          button.textContent = "Copied";
          setTimeout(() => {
            button.textContent = "Copy";
          }, 1200);
        } catch {
          button.textContent = "Failed";
        }
      });
      pre.appendChild(button);
    });
  }, [rendered]);

  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div
        className={
          isUser
            ? "max-w-[82%] rounded-2xl bg-slate-800/80 px-4 py-3 text-sm text-slate-100"
            : "max-w-[82%] rounded-2xl bg-slate-900/80 px-4 py-3 text-sm text-slate-100"
        }
      >
        <div
          ref={contentRef}
          className="ai-chat-markdown prose prose-invert max-w-none"
          dangerouslySetInnerHTML={{ __html: rendered || "" }}
        />
      </div>
    </div>
  );
}
