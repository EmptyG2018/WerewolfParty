interface HunterActionPanelProps {
  isPaused: boolean;
  selectedTarget: string | null;
  canPass: boolean;
  onShoot: () => void;
  onPass: () => void;
  getPlayerName: (playerId: string | null) => string;
}

export function HunterActionPanel({
  isPaused,
  selectedTarget,
  canPass,
  onShoot,
  onPass,
  getPlayerName
}: HunterActionPanelProps) {
  const selectedTargetName = selectedTarget ? getPlayerName(selectedTarget) : '';

  return (
    <div className="px-4 pb-safe pt-2 pb-4 relative z-20 animate-slide-in-bottom">
      <div className="glass-dark rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs text-moon-dim tracking-wider">技能目标</div>
          {selectedTarget && (
            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-moon-dim">{'->'}</span>
              <span className="font-medium text-moon">{selectedTargetName}</span>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          {canPass && (
            <button
              onClick={onPass}
              disabled={isPaused}
              className="px-5 py-3.5 rounded-xl glass text-moon-dim font-display text-sm shrink-0 active:scale-95 transition-transform disabled:opacity-30 disabled:cursor-not-allowed"
            >
              不发动
            </button>
          )}
          <button
            onClick={onShoot}
            disabled={isPaused || !selectedTarget}
            className="flex-1 py-3.5 rounded-xl font-display text-base tracking-wide text-white transition-all duration-200 active:scale-[0.97] disabled:opacity-20 disabled:cursor-not-allowed bg-gradient-to-r from-amber-700 to-amber-500"
          >
            {selectedTarget ? `带走 ${selectedTargetName}` : '选择技能目标'}
          </button>
        </div>
      </div>
    </div>
  );
}
