import { GamePhase, PublicDeathReason } from '@werewolf/shared';
import { DeathEvent, VoteResultState } from '../../stores/gameStore';

interface PhaseResultPanelProps {
  phase: GamePhase;
  isGameOver: boolean;
  currentDayDeaths: DeathEvent[];
  voteResult: VoteResultState | null;
  sortedVoteResult: Array<[string, number]>;
  getPlayerName: (playerId: string | null) => string;
  getDeathReasonName: (reason: PublicDeathReason) => string;
  getDeathReasonClass: (reason: PublicDeathReason) => string;
}

export function PhaseResultPanel({
  phase,
  isGameOver,
  currentDayDeaths,
  voteResult,
  sortedVoteResult,
  getPlayerName,
  getDeathReasonName,
  getDeathReasonClass
}: PhaseResultPanelProps) {
  if ((phase !== GamePhase.DAY_ANNOUNCE && !voteResult) || isGameOver) return null;

  return (
    <div className="px-4 py-1.5 relative z-10">
      <div className="glass-dark rounded-xl px-4 py-3 space-y-2">
        {phase === GamePhase.DAY_ANNOUNCE && (
          <div>
            <div className="text-[10px] text-moon-dim tracking-wider mb-1">昨夜结果</div>
            {currentDayDeaths.length === 0 ? (
              <div className="font-display text-base text-heal-400">平安夜，没有人死亡</div>
            ) : (
              <div className="space-y-1.5">
                {currentDayDeaths.map(event => (
                  <div key={`${event.playerId}-${event.reason}-${event.day}`} className="flex items-center justify-between gap-2">
                    <span className="text-sm text-moon truncate">{getPlayerName(event.playerId)}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${getDeathReasonClass(event.reason)}`}>
                      {getDeathReasonName(event.reason)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {voteResult && (
          <div className="pt-2 border-t border-white/5">
            <div className="text-[10px] text-moon-dim tracking-wider mb-1">投票结果</div>
            <div className="flex flex-wrap gap-1.5">
              {sortedVoteResult.length === 0 ? (
                <span className="text-sm text-moon-mist">无人投票</span>
              ) : sortedVoteResult.map(([playerId, count]) => (
                <span key={playerId} className={`text-xs px-2 py-1 rounded-lg ${
                  playerId === voteResult.eliminated ? 'bg-blood/20 text-blood-400' : 'bg-white/[0.05] text-moon-dim'
                }`}>
                  {getPlayerName(playerId)} {count}票
                </span>
              ))}
              {voteResult.abstained > 0 && (
                <span className="text-xs px-2 py-1 rounded-lg bg-white/[0.04] text-moon-mist">
                  弃票 {voteResult.abstained}票
                </span>
              )}
            </div>
            <div className="text-sm text-moon mt-2">
              {voteResult.eliminated ? `${getPlayerName(voteResult.eliminated)} 出局` : '平票，无人出局'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
