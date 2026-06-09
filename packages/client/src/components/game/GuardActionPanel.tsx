interface GuardActionPanelProps {
  isPaused: boolean;
  selectedTarget: string | null;
  lastGuardTargetId: string | null;
  onProtect: () => void;
  getPlayerName: (playerId: string | null) => string;
}

export function GuardActionPanel({
  isPaused,
  selectedTarget,
  lastGuardTargetId,
  onProtect,
  getPlayerName
}: GuardActionPanelProps) {
  const selectedTargetName = selectedTarget ? getPlayerName(selectedTarget) : '';
  const lastGuardTargetName = lastGuardTargetId ? getPlayerName(lastGuardTargetId) : null;
  const isRepeatTarget = !!selectedTarget && selectedTarget === lastGuardTargetId;

  return (
    <div className="px-4 pb-safe pt-2 pb-4 relative z-20 animate-slide-in-bottom">
      <div className="glass-dark rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs text-moon-dim tracking-wider">守护目标</div>
          {selectedTarget && (
            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-moon-dim">{'->'}</span>
              <span className="font-medium text-moon">{selectedTargetName}</span>
            </div>
          )}
        </div>

        <button
          onClick={onProtect}
          disabled={isPaused || !selectedTarget || isRepeatTarget}
          className="w-full py-3.5 rounded-xl font-display text-base tracking-wide text-white transition-all duration-200 active:scale-[0.97] disabled:opacity-20 disabled:cursor-not-allowed bg-gradient-to-r from-blue-700 to-blue-500"
        >
          {isRepeatTarget
            ? '不能连续守护'
            : selectedTarget
            ? `守护 ${selectedTargetName}`
            : '选择守护目标'}
        </button>

        {lastGuardTargetName && (
          <div className="mt-3 rounded-xl bg-forest-50/50 px-3 py-2 flex items-center justify-between gap-3">
            <span className="text-[10px] text-moon-dim tracking-wider">上晚守护</span>
            <span className="text-sm font-medium text-moon-mist">{lastGuardTargetName}</span>
          </div>
        )}
      </div>
    </div>
  );
}
