export default function SettingsPanel({ onCheckOllama, ollamaStatus }) {
  return (
    <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
      <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
        Ollama Local
      </div>
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs text-slate-300">
        http://127.0.0.1:11434
      </div>
      <button
        type="button"
        onClick={onCheckOllama}
        disabled={ollamaStatus?.state === "checking"}
        className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 disabled:opacity-50"
      >
        {ollamaStatus?.state === "checking" ? "Đang kiểm tra..." : "Kiểm tra Ollama"}
      </button>
      <div
        className={
          ollamaStatus?.state === "valid"
            ? "text-xs text-emerald-300"
            : ollamaStatus?.state === "invalid"
              ? "text-xs text-rose-300"
              : "text-xs text-slate-400"
        }
      >
        {ollamaStatus?.message || "Chưa kiểm tra"}
      </div>
    </div>
  );
}
