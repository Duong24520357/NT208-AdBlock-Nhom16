export default function PromptTemplates({ templates, onUse, onAdd }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
          Prompts
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="rounded-full border border-slate-700 px-3 py-1 text-[11px] font-semibold text-slate-200"
        >
          Add
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {templates.map((template) => (
          <button
            key={template.id}
            type="button"
            onClick={() => onUse(template)}
            className="rounded-full border border-slate-700 px-3 py-1 text-[11px] font-semibold text-slate-200 hover:border-slate-500"
          >
            {template.label}
          </button>
        ))}
      </div>
    </div>
  );
}
