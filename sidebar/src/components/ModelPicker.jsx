import clsx from "clsx";

function formatModelLabel(modelId) {
  const parts = modelId.split("/");
  return parts[parts.length - 1].replace(/[-_]/g, " ");
}

export default function ModelPicker({ models, selected, onChange }) {
  const toggle = (modelId) => {
    const exists = selected.includes(modelId);
    let next = exists
      ? selected.filter((id) => id !== modelId)
      : [...selected, modelId];

    if (next.length > 4) {
      next = next.slice(0, 4);
    }

    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
        Models
      </div>
      <div className="grid grid-cols-2 gap-2">
        {models.map((model) => (
          <button
            key={model.id}
            type="button"
            onClick={() => toggle(model.id)}
            className={clsx(
              "rounded-xl border px-3 py-2 text-left text-xs font-semibold transition",
              selected.includes(model.id)
                ? "border-cyan-400 bg-cyan-500/20 text-cyan-100"
                : "border-slate-700 bg-slate-900/60 text-slate-200 hover:border-slate-500",
            )}
          >
            <div className="truncate">{formatModelLabel(model.id)}</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
              {model.vendor}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
