import { GamePhase, Role, ROLES, isWolfRole } from '@werewolf/shared';
import { getPhaseIcon, getPhaseName } from '../../game-ui/phaseText';

interface PhaseHeaderProps {
  day: number;
  phase: GamePhase;
  isNight: boolean;
  isHost: boolean;
  isPaused: boolean;
  myRole: Role;
  onPause: () => void;
  onResume: () => void;
}

export function PhaseHeader({
  day,
  phase,
  isNight,
  isHost,
  isPaused,
  myRole,
  onPause,
  onResume
}: PhaseHeaderProps) {
  return (
    <header className="safe-top px-4 pt-3 pb-2 relative z-10">
      <div className="glass rounded-2xl px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">{getPhaseIcon(phase)}</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-moon-dim tracking-wider">DAY {day}</span>
                {isNight && <span className="w-1 h-1 rounded-full bg-indigo-400 animate-breathe" />}
              </div>
              <div className="font-display text-base leading-tight">
                {getPhaseName(phase)}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isHost && phase !== GamePhase.GAME_OVER && (
              <button
                onClick={isPaused ? onResume : onPause}
                className={`px-3 py-2 rounded-xl text-xs font-display tracking-wide border transition-colors ${
                  isPaused
                    ? 'bg-heal/15 text-heal-400 border-heal/25'
                    : 'bg-gold/10 text-gold border-gold/20'
                }`}
              >
                {isPaused ? '恢复' : '暂停'}
              </button>
            )}
            <div className="text-right">
              <div className="text-[10px] text-moon-dim tracking-wider">身份</div>
              <div className="font-display text-sm text-blood-400">
                {ROLES[myRole].name}
              </div>
            </div>
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm ${
              isWolfRole(myRole)
                ? 'bg-blood/20 text-blood-400'
                : 'bg-heal/20 text-heal-400'
            }`}>
              {isWolfRole(myRole) ? '🐺' : '👤'}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
