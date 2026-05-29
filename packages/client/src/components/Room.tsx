import { useState } from 'react';
import { useGameStore } from '../stores/gameStore';
import { Role, ROLES, MIN_PLAYERS, Player, getCampCounts, getRoleCounts } from '@werewolf/shared';

export function Room() {
  const { room, myId, startGame, leaveRoom, error, pendingSwapRequest, swapSeat, acceptSwap, rejectSwap } = useGameStore();
  const [copied, setCopied] = useState(false);

  if (!room) return null;

  const isHost = room.hostId === myId;
  const canStart = room.players.length >= MIN_PLAYERS;

  const copyRoomId = () => {
    navigator.clipboard.writeText(room.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const { wolves, gods, villagers } = getCampCounts(room.config);
  const roleCounts = getRoleCounts(room.config);
  const hasWolfKing = room.config.roles.includes(Role.WOLF_KING);

  // 构建座位表：按座位号排列，null 表示空座
  const seats: (Player | null)[] = Array.from({ length: room.config.maxPlayers }, () => null);
  room.players.forEach(p => { seats[p.seatIndex] = p; });

  const myPlayer = room.players.find(p => p.id === myId);
  const mySeat = myPlayer?.seatIndex ?? -1;

  const handleSeatClick = (seatIndex: number) => {
    if (seatIndex === mySeat) return;
    if (room.status !== 'waiting') return;
    swapSeat(seatIndex);
  };

  return (
    <div className="flex flex-col min-h-dvh relative">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[400px] h-[300px] bg-gradient-to-b from-gold/5 to-transparent rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <header className="safe-top px-5 pt-4 pb-2 flex items-center justify-between relative z-10">
        <button
          onClick={leaveRoom}
          className="flex items-center gap-1.5 text-moon-dim hover:text-moon transition-colors text-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          离开
        </button>
        <h2 className="font-display text-lg text-moon/80">等待大厅</h2>
        <div className="w-16" />
      </header>

      {/* Room ID Card */}
      <div className="px-5 py-3 animate-slide-up">
        <div className="glass rounded-2xl p-5 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-gold/5 via-transparent to-transparent pointer-events-none" />
          <p className="text-xs text-moon-dim tracking-wider uppercase mb-2">房间号</p>
          <div className="flex items-center justify-center gap-3">
            <span className="font-mono text-4xl font-bold tracking-[0.4em] text-moon text-shadow-moon">
              {room.id}
            </span>
          </div>
          <button
            onClick={copyRoomId}
            className="mt-3 px-4 py-1.5 rounded-full text-xs tracking-wider glass hover:bg-white/[0.08] transition-all text-moon-dim hover:text-moon"
          >
            {copied ? '✓ 已复制' : '复制房间号'}
          </button>
        </div>
      </div>

      {/* Player Seats */}
      <div className="flex-1 px-5 py-2 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm text-moon-dim tracking-wider">
            玩家 <span className="text-moon font-medium">{room.players.length}</span>
            <span className="text-moon-mist">/{room.config.maxPlayers}</span>
          </h3>
          <span className="text-[10px] text-moon-mist">点击空座可换位</span>
        </div>

        <div className="grid grid-cols-2 gap-2 stagger-children">
          {seats.map((player, seatIndex) => {
            const isMe = player?.id === myId;
            const isEmpty = player === null;
            const isClickable = room.status === 'waiting' && seatIndex !== mySeat;

            return (
              <button
                key={seatIndex}
                onClick={() => handleSeatClick(seatIndex)}
                disabled={!isClickable}
                className={`animate-slide-up flex items-center gap-3 p-3 rounded-xl transition-all text-left ${
                  isEmpty
                    ? 'border border-dashed border-white/[0.06] opacity-50 active:scale-[0.97]'
                    : isMe
                    ? 'glass border-blood/20 bg-blood/5'
                    : 'glass active:scale-[0.97]'
                } ${isClickable ? 'cursor-pointer' : 'cursor-default'}`}
              >
                {/* 座位号 */}
                <div className="relative shrink-0">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold ${
                    isEmpty
                      ? 'bg-forest-50/50 text-moon-mist'
                      : isMe
                      ? 'bg-gradient-to-br from-blood-600 to-blood-800 text-white'
                      : 'bg-gradient-to-br from-forest-50 to-forest-100 text-moon-dim'
                  }`}>
                    {isEmpty ? seatIndex + 1 : player.name.charAt(0)}
                  </div>
                  {/* 座位号角标 */}
                  <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-forest-100 flex items-center justify-center text-[8px] text-moon-dim font-bold border border-forest-50/30">
                    {seatIndex + 1}
                  </div>
                  {!isEmpty && player.id === room.hostId && (
                    <div className="absolute -top-1.5 -right-1.5 text-[10px]">👑</div>
                  )}
                </div>

                {/* 信息 */}
                <div className="flex-1 min-w-0">
                  {isEmpty ? (
                    <span className="text-moon-mist text-xs">空座位</span>
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5">
                        <span className="font-body text-sm font-medium truncate">{player.name}</span>
                        {isMe && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blood/20 text-blood-400 tracking-wider shrink-0">
                            我
                          </span>
                        )}
                      </div>
                      {player.id === room.hostId && (
                        <span className="text-[9px] text-gold tracking-wider">房主</span>
                      )}
                    </>
                  )}
                </div>

                {!isEmpty && (
                  <div className="w-1.5 h-1.5 rounded-full bg-heal animate-breathe shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Config display */}
      <div className="px-5 py-2">
        <div className="glass rounded-2xl p-4">
          <h3 className="text-xs text-moon-dim tracking-wider uppercase mb-3">游戏配置</h3>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-forest-50/50 rounded-xl p-3">
              <div className="text-moon-mist text-[10px] tracking-wider mb-1">狼人</div>
              <div className="font-display text-xl text-blood-400">{wolves}</div>
              {hasWolfKing && (
                <div className="text-[10px] text-moon-mist mt-0.5">普狼×{room.config.wolfCount} 狼王×1</div>
              )}
            </div>
            <div className="bg-forest-50/50 rounded-xl p-3">
              <div className="text-moon-mist text-[10px] tracking-wider mb-1">神职</div>
              <div className="font-display text-xl text-heal-400">{gods}</div>
            </div>
            <div className="bg-forest-50/50 rounded-xl p-3">
              <div className="text-moon-mist text-[10px] tracking-wider mb-1">村民</div>
              <div className="font-display text-xl text-moon">{villagers}</div>
            </div>
          </div>
          <div className="mt-2 bg-forest-50/50 rounded-xl p-3">
            <div className="text-moon-mist text-[10px] tracking-wider mb-1">启用角色</div>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {Object.entries(roleCounts).map(([role, count]) => (
                <span key={role} className="text-xs px-2 py-0.5 rounded bg-white/[0.05] text-moon-dim">
                  {ROLES[role as Role]?.name || role}{count > 1 ? `×${count}` : ''}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-5 mb-2 px-4 py-3 rounded-xl bg-blood/10 border border-blood/20 text-blood-400 text-sm text-center animate-slide-up">
          {error}
        </div>
      )}

      {/* Swap Request Modal */}
      {pendingSwapRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-forest/90 backdrop-blur-sm">
          <div className="glass rounded-3xl p-6 w-full max-w-sm text-center space-y-4 animate-slide-up">
            <div className="text-3xl">🔄</div>
            <div>
              <div className="text-sm text-moon-dim mb-1">座位交换请求</div>
              <div className="font-display text-lg text-moon">
                座位 {pendingSwapRequest.fromSeat + 1} ↔ 座位 {pendingSwapRequest.targetSeat + 1}
              </div>
              <div className="text-xs text-moon-mist mt-2">
                对方想和你交换座位
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={rejectSwap}
                className="flex-1 py-3 rounded-xl font-display text-sm text-moon-dim glass hover:bg-white/[0.08] transition-all"
              >
                拒绝
              </button>
              <button
                onClick={acceptSwap}
                className="flex-1 py-3 rounded-xl font-display text-sm text-white bg-gradient-to-r from-heal-dark to-heal active:scale-[0.97] transition-transform"
              >
                同意
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Action */}
      <div className="px-5 pb-safe pt-2 pb-4">
        {isHost ? (
          <button
            onClick={startGame}
            disabled={!canStart}
            className="group relative w-full py-4 rounded-2xl font-display text-lg tracking-wide overflow-hidden transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-blood-700 via-blood to-blood-700 group-hover:from-blood-600 group-hover:via-blood-500 group-hover:to-blood-600 group-disabled:from-forest-50 group-disabled:via-forest-50 group-disabled:to-forest-50 transition-all" />
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 group-disabled:opacity-0 transition-opacity bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.1),transparent_70%)]" />
            <span className="relative z-10 text-white group-disabled:text-moon-mist">
              {canStart ? '开始游戏' : `需要 ${MIN_PLAYERS - room.players.length} 人`}
            </span>
          </button>
        ) : (
          <div className="text-center py-4">
            <div className="inline-flex items-center gap-2 text-moon-dim text-sm">
              <div className="w-1.5 h-1.5 rounded-full bg-gold animate-breathe" />
              等待房主开始游戏...
            </div>
          </div>
        )}

        {!canStart && isHost && (
          <p className="text-center text-moon-mist text-xs mt-2">
            至少需要 {MIN_PLAYERS} 名玩家
          </p>
        )}
      </div>
    </div>
  );
}
