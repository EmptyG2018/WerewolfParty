interface SeerActionPanelProps {
  isPaused: boolean;
  selectedTarget: string | null;
  onCheck: () => void;
  getPlayerName: (playerId: string | null) => string;
}

export function SeerActionPanel({
  isPaused,
  selectedTarget,
  onCheck,
  getPlayerName
}: SeerActionPanelProps) {
  const selectedTargetName = selectedTarget ? getPlayerName(selectedTarget) : '';

  return (
    <div className="px-4 pb-safe pt-2 pb-4 relative z-20 animate-slide-in-bottom">
      <div className="glass-dark rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs text-moon-dim tracking-wider">查验目标</div>
          {selectedTarget && (
            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-moon-dim">{'->'}</span>
              <span className="font-medium text-moon">{selectedTargetName}</span>
            </div>
          )}
        </div>

        <button
          onClick={onCheck}
          disabled={isPaused || !selectedTarget}
          className="w-full py-3.5 rounded-xl font-display text-base tracking-wide text-white transition-all duration-200 active:scale-[0.97] disabled:opacity-20 disabled:cursor-not-allowed bg-gradient-to-r from-poison-dark to-poison"
        >
          {selectedTarget ? `查验 ${selectedTargetName}` : '选择查验目标'}
        </button>
      </div>
    </div>
  );
}
