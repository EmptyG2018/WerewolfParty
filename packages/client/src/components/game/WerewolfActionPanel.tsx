interface WerewolfActionPanelProps {
  isPaused: boolean;
  selectedTarget: string | null;
  myWolfVote?: string | null;
  myWolfSelection?: string;
  hasConfirmedWolfVote: boolean;
  onConfirm: () => void;
  getPlayerName: (playerId: string | null) => string;
}

export function WerewolfActionPanel({
  isPaused,
  selectedTarget,
  myWolfVote,
  myWolfSelection,
  hasConfirmedWolfVote,
  onConfirm,
  getPlayerName
}: WerewolfActionPanelProps) {
  const selectedTargetName = selectedTarget ? getPlayerName(selectedTarget) : '';
  const confirmedTargetName = myWolfVote ? getPlayerName(myWolfVote) : '弃票';
  const isSelectionSynced = !!selectedTarget && myWolfSelection === selectedTarget;

  return (
    <div className="px-4 pb-safe pt-2 pb-4 relative z-20 animate-slide-in-bottom">
      <div className="glass-dark rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs text-moon-dim tracking-wider">狼人投票</div>
          {selectedTarget && (
            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-moon-dim">{'->'}</span>
              <span className="font-medium text-moon">{selectedTargetName}</span>
            </div>
          )}
        </div>

        {hasConfirmedWolfVote ? (
          <div className="py-3.5 rounded-xl font-display text-base text-heal-400 text-center glass">
            已确认刀票 {'->'} {confirmedTargetName}
          </div>
        ) : (
          <button
            onClick={onConfirm}
            disabled={isPaused || !selectedTarget || !isSelectionSynced}
            className="w-full py-3.5 rounded-xl font-display text-base tracking-wide text-white transition-all duration-200 active:scale-[0.97] disabled:opacity-20 disabled:cursor-not-allowed bg-gradient-to-r from-blood-700 to-blood"
          >
            {selectedTarget
              ? isSelectionSynced
                ? `确认刀杀 ${selectedTargetName}`
                : '同步选择中'
              : '选择刀杀目标'}
          </button>
        )}
      </div>
    </div>
  );
}
