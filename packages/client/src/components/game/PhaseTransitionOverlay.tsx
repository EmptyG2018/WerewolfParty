import { GamePhase } from '@werewolf/shared';
import { getPhaseIcon, getPhaseName, getPhaseSubtitle } from '../../game-ui/phaseText';

interface PhaseTransitionOverlayProps {
  phase: GamePhase | null;
}

export function PhaseTransitionOverlay({ phase }: PhaseTransitionOverlayProps) {
  if (!phase) return null;

  const isNight = phase.toString().startsWith('night_');

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-forest/85 backdrop-blur-sm animate-fade-in">
      <div className="text-center animate-moonrise">
        <div className={`mx-auto mb-5 w-20 h-20 rounded-full flex items-center justify-center text-4xl ${
          isNight
            ? 'bg-indigo-950/40 text-moon shadow-lg shadow-indigo-950/30'
            : 'bg-gold/15 text-gold shadow-lg shadow-gold/10'
        }`}>
          {getPhaseIcon(phase)}
        </div>
        <div className="font-display text-3xl text-moon text-shadow-glow">
          {getPhaseName(phase)}
        </div>
        <div className="mt-2 text-sm text-moon-dim tracking-wider">
          {getPhaseSubtitle(phase)}
        </div>
      </div>
    </div>
  );
}
