import { Player, PublicDeathReason, PublicRoom, ROLES, isWolfRole } from '@werewolf/shared';

interface DeathEvent {
  playerId: string;
  reason: PublicDeathReason;
  day: number;
}

interface GameOverModalProps {
  winner: 'villager' | 'werewolf';
  room: PublicRoom;
  myId: string | null;
  isHost: boolean;
  revealedPlayers: Player[] | null;
  deathEvents: DeathEvent[];
  hasReviewEvents: boolean;
  onOpenReview: () => void;
  onResetRoom: () => void;
  onLeaveRoom: () => void;
  getPlayerName: (playerId: string | null) => string;
  getDeathReasonName: (reason: PublicDeathReason) => string;
  getDeathReasonClass: (reason: PublicDeathReason) => string;
}

export function GameOverModal({
  winner,
  room,
  myId,
  isHost,
  revealedPlayers,
  deathEvents,
  hasReviewEvents,
  onOpenReview,
  onResetRoom,
  onLeaveRoom,
  getPlayerName,
  getDeathReasonName,
  getDeathReasonClass
}: GameOverModalProps) {
  const winnerName = winner === 'villager' ? '好人阵营' : '狼人阵营';
  const players = revealedPlayers ?? room.players;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-md animate-fade-in">
      <div className="glass-dark rounded-3xl p-6 w-full max-w-sm animate-moonrise">
        <div className="text-center mb-6">
          <div className="text-5xl mb-4">
            {winner === 'villager' ? '☀️' : '🌙'}
          </div>
          <h2 className="font-display text-3xl mb-2 text-shadow-glow">
            {winnerName}
          </h2>
          <p className="text-moon-dim text-sm">获得胜利</p>
          <div className="mt-3 w-16 h-px bg-gradient-to-r from-transparent via-blood/60 to-transparent mx-auto" />
        </div>

        <div className="mb-6">
          <h3 className="text-xs text-moon-dim tracking-wider uppercase mb-3 text-center">身份揭示</h3>
          <div className="space-y-2">
            {players.map((player) => {
              const isWolf = player.role !== null && isWolfRole(player.role);
              return (
                <div
                  key={player.id}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl ${
                    player.status === 'dead' ? 'opacity-50' : ''
                  } ${player.id === myId ? 'glass border-blood/10' : 'bg-forest-50/30'}`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                    isWolf ? 'bg-blood/20 text-blood-400' : 'bg-heal/20 text-heal-400'
                  }`}>
                    {player.name.charAt(0)}
                  </div>
                  <span className={`flex-1 text-sm ${player.status === 'dead' ? 'line-through text-moon-mist' : ''}`}>
                    {player.name}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    isWolf ? 'bg-blood/20 text-blood-400' : 'bg-heal/20 text-heal-400'
                  }`}>
                    {player.role ? ROLES[player.role].name : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {deathEvents.length > 0 && (
          <div className="mb-6">
            <h3 className="text-xs text-moon-dim tracking-wider uppercase mb-3 text-center">死亡时间线</h3>
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {deathEvents.map((event, index) => (
                <div key={`${event.playerId}-${event.reason}-${event.day}-${index}`} className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-forest-50/30">
                  <span className="text-xs text-moon-mist">DAY {event.day}</span>
                  <span className="flex-1 text-sm text-moon truncate">{getPlayerName(event.playerId)}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${getDeathReasonClass(event.reason)}`}>
                    {getDeathReasonName(event.reason)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {hasReviewEvents && (
          <button
            onClick={onOpenReview}
            className="w-full mb-3 py-3 rounded-2xl glass text-moon font-display text-base active:scale-[0.97] transition-transform"
          >
            查看复盘记录
          </button>
        )}

        <button
          onClick={isHost ? onResetRoom : onLeaveRoom}
          className="w-full py-4 rounded-2xl bg-gradient-to-r from-blood-700 via-blood to-blood-700 text-white font-display text-lg tracking-wide active:scale-[0.97] transition-transform"
        >
          {isHost ? '重新开局' : '离开房间'}
        </button>
      </div>
    </div>
  );
}
