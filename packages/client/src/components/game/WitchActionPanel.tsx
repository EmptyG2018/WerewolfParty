interface WitchActionPanelProps {
  isPaused: boolean;
  selectedTarget: string | null;
  killedPlayerId: string | null;
  saveAvailable: boolean;
  poisonAvailable: boolean;
  canSave: boolean;
  canPoison: boolean;
  onSave: () => void;
  onPoison: () => void;
  onPass: () => void;
  getPlayerName: (playerId: string | null) => string;
}

export function WitchActionPanel({
  isPaused,
  selectedTarget,
  killedPlayerId,
  saveAvailable,
  poisonAvailable,
  canSave,
  canPoison,
  onSave,
  onPoison,
  onPass,
  getPlayerName
}: WitchActionPanelProps) {
  const selectedTargetName = selectedTarget ? getPlayerName(selectedTarget) : '';
  const killedTargetName = killedPlayerId ? getPlayerName(killedPlayerId) : '无人';

  return (
    <div className="px-4 pb-safe pt-2 pb-4 relative z-20 animate-slide-in-bottom">
      <div className="glass-dark rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs text-moon-dim tracking-wider">魔药抉择</div>
          {selectedTarget && (
            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-moon-dim">{'->'}</span>
              <span className="font-medium text-moon">{selectedTargetName}</span>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          {canSave && (
            <button
              onClick={onSave}
              disabled={isPaused || !killedPlayerId || !saveAvailable}
              className="px-5 py-3.5 rounded-xl bg-gradient-to-r from-heal-dark to-heal text-white font-display text-sm shrink-0 active:scale-95 transition-transform disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {saveAvailable ? '解药' : '解药已用'}
            </button>
          )}

          <button
            onClick={onPass}
            disabled={isPaused}
            className="px-5 py-3.5 rounded-xl glass text-moon-dim font-display text-sm shrink-0 active:scale-95 transition-transform disabled:opacity-30 disabled:cursor-not-allowed"
          >
            跳过
          </button>

          {canPoison && (
            <button
              onClick={onPoison}
              disabled={isPaused || !selectedTarget || !poisonAvailable}
              className="flex-1 py-3.5 rounded-xl font-display text-base tracking-wide text-white transition-all duration-200 active:scale-[0.97] disabled:opacity-20 disabled:cursor-not-allowed bg-gradient-to-r from-poison-dark to-poison"
            >
              {!poisonAvailable
                ? '毒药已用'
                : selectedTarget
                ? `毒杀 ${selectedTargetName}`
                : '选择毒药目标'}
            </button>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {canSave && (
            <div className={`rounded-xl px-3 py-2 ${saveAvailable ? 'bg-heal/10 text-heal-400' : 'bg-white/[0.04] text-moon-mist'}`}>
              <div className="text-[10px] tracking-wider">解药</div>
              <div className="text-sm font-medium">{saveAvailable ? '可用' : '已使用'}</div>
            </div>
          )}
          {canPoison && (
            <div className={`rounded-xl px-3 py-2 ${poisonAvailable ? 'bg-poison/10 text-poison' : 'bg-white/[0.04] text-moon-mist'}`}>
              <div className="text-[10px] tracking-wider">毒药</div>
              <div className="text-sm font-medium">{poisonAvailable ? '可用' : '已使用'}</div>
            </div>
          )}
        </div>

        {canSave && (
          <div className="mt-3 rounded-xl bg-forest-50/50 px-3 py-2 flex items-center justify-between gap-3">
            <span className="text-[10px] text-moon-dim tracking-wider">今晚被袭击</span>
            <span className={`text-sm font-medium ${killedPlayerId ? 'text-heal-400' : 'text-moon-mist'}`}>
              {killedTargetName}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
