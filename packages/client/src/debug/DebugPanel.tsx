import { useState } from 'react';
import { GamePhase } from '@werewolf/shared';
import { SERVER_URL } from '../lib/socket';
import { useGameStore } from '../stores/gameStore';

export function DebugPanel() {
  const { room, gameState, currentView, setError } = useGameStore();
  const [busy, setBusy] = useState(false);

  if (!import.meta.env.DEV || !room) return null;

  const callDebug = async (path: string) => {
    setBusy(true);
    try {
      const response = await fetch(`${SERVER_URL}${path}`, { method: 'POST' });
      if (!response.ok) throw new Error(`调试接口失败：${response.status}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : '调试接口失败');
      setTimeout(() => setError(null), 3000);
    } finally {
      setBusy(false);
    }
  };

  const canFill = currentView === 'room' && room.status === 'waiting' && room.players.length < room.config.maxPlayers;
  const canAutoAct = currentView === 'game' && gameState?.phase !== GamePhase.GAME_OVER;

  if (!canFill && !canAutoAct) return null;

  return (
    <div className="fixed right-3 bottom-3 z-[80] flex flex-col gap-2">
      <div className="glass-dark rounded-2xl p-2 shadow-xl border border-gold/10">
        <div className="px-2 pb-1 text-[9px] text-gold tracking-widest">DEV</div>
        {canFill && (
          <button
            onClick={() => callDebug(`/api/debug/rooms/${room.id}/fill`)}
            disabled={busy}
            className="block w-full px-3 py-2 rounded-xl bg-gold/15 text-gold text-xs font-display active:scale-[0.97] disabled:opacity-40"
          >
            补齐调试玩家
          </button>
        )}
        {canAutoAct && (
          <button
            onClick={() => callDebug(`/api/debug/rooms/${room.id}/auto-act`)}
            disabled={busy}
            className="block w-full px-3 py-2 rounded-xl bg-heal/15 text-heal-400 text-xs font-display active:scale-[0.97] disabled:opacity-40"
          >
            调试玩家行动
          </button>
        )}
      </div>
    </div>
  );
}
