export default function Toolbar({ onRegenerate, onStop, onClear, streaming }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={onRegenerate}
        className="rounded-full border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-200"
      >
        Regenerate
      </button>
      <button
        type="button"
        onClick={onStop}
        disabled={!streaming}
        className="rounded-full border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-200 disabled:opacity-50"
      >
        Stop
      </button>
      <button
        type="button"
        onClick={onClear}
        className="rounded-full border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-200"
      >
        Clear
      </button>
    </div>
  );
}
