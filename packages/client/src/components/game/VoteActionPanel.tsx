interface VoteActionPanelProps {
  isPaused: boolean;
  selectedTarget: string | null;
  hasCompletedVote: boolean;
  onVote: () => void;
  onAbstain: () => void;
  getPlayerName: (playerId: string | null) => string;
}

export function VoteActionPanel({
  isPaused,
  selectedTarget,
  hasCompletedVote,
  onVote,
  onAbstain,
  getPlayerName
}: VoteActionPanelProps) {
  const selectedTargetName = selectedTarget ? getPlayerName(selectedTarget) : '';

  return (
    <div className="px-4 pb-safe pt-2 pb-4 relative z-20 animate-slide-in-bottom">
      <div className="glass-dark rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs text-moon-dim tracking-wider">投票淘汰目标</div>
          {selectedTarget && (
            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-moon-dim">{'->'}</span>
              <span className="font-medium text-moon">{selectedTargetName}</span>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={onAbstain}
            disabled={isPaused || hasCompletedVote}
            className="px-5 py-3.5 rounded-xl glass text-moon-dim font-display text-sm shrink-0 active:scale-95 transition-transform disabled:opacity-30 disabled:cursor-not-allowed"
          >
            弃票
          </button>
          <button
            onClick={onVote}
            disabled={isPaused || !selectedTarget || hasCompletedVote}
            className="flex-1 py-3.5 rounded-xl font-display text-base tracking-wide text-white transition-all duration-200 active:scale-[0.97] disabled:opacity-20 disabled:cursor-not-allowed bg-gradient-to-r from-blood-700 to-blood"
          >
            {hasCompletedVote
              ? '已完成投票'
              : selectedTarget
              ? `投票淘汰 ${selectedTargetName}`
              : '选择投票目标'}
          </button>
        </div>
      </div>
    </div>
  );
}
