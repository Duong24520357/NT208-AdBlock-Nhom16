export default function SettingsPanel({
  apiKey,
  onApiKeyChange,
  theme,
  onTheme,
  onCheckToken,
  tokenStatus,
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
      <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
        Settings
      </div>
      <div className="space-y-2">
        <label className="text-xs font-semibold text-slate-300">
          OpenRouter API Key
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(event) => onApiKeyChange(event.target.value)}
          placeholder="sk-or-..."
          className="w-full rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs text-slate-100 focus:border-cyan-400 focus:outline-none"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCheckToken}
            disabled={tokenStatus?.state === "checking"}
            className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 disabled:opacity-50"
          >
            {tokenStatus?.state === "checking" ? "Checking..." : "Check token"}
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onTheme(theme === "dark" ? "light" : "dark")}
        className="w-full rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200"
      >
        Theme: {theme === "dark" ? "Dark" : "Light"}
      </button>
      <div
        className={
          tokenStatus?.state === "valid"
            ? "text-xs text-emerald-300"
            : tokenStatus?.state === "invalid"
              ? "text-xs text-rose-300"
              : "text-xs text-slate-400"
        }
      >
        Token status: {tokenStatus?.message || "Not checked"}
      </div>
    </div>
  );
}
