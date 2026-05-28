import { useState, useEffect } from 'react';
import { useGameStore } from '../stores/gameStore';

export function Home() {
  const [playerName, setPlayerName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { createRoom, joinRoom, error, initSocket } = useGameStore();

  useEffect(() => {
    initSocket();
    requestAnimationFrame(() => setMounted(true));
  }, [initSocket]);

  const handleCreateRoom = () => {
    if (!playerName.trim()) return;
    createRoom(playerName.trim());
  };

  const handleJoinRoom = () => {
    if (!playerName.trim() || !roomId.trim()) return;
    joinRoom(roomId.trim().toUpperCase(), playerName.trim());
  };

  return (
    <div className="flex flex-col min-h-dvh relative overflow-hidden">
      {/* Atmospheric background */}
      <div className="absolute inset-0 bg-vignette pointer-events-none" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-gradient-to-b from-blue-900/10 via-transparent to-transparent blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-forest to-transparent pointer-events-none" />

      {/* Moon */}
      <div className="absolute top-8 right-8 w-16 h-16 rounded-full bg-gradient-to-br from-moon/20 to-moon/5 blur-sm animate-breathe pointer-events-none" />

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 relative z-10">
        {/* Logo */}
        <div className={`text-center mb-12 transition-all duration-1000 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
          {/* Wolf icon */}
          <div className="relative inline-block mb-6">
            <div className="text-7xl leading-none select-none" aria-hidden="true">🐺</div>
            <div className="absolute -inset-4 bg-blood/10 rounded-full blur-2xl animate-breathe" />
          </div>

          <h1 className="font-display text-5xl font-bold tracking-tight text-shadow-glow mb-3">
            狼人杀
          </h1>
          <p className="text-moon-dim text-sm tracking-[0.3em] uppercase font-body">
            Werewolf Party
          </p>
          <div className="mt-4 w-16 h-px bg-gradient-to-r from-transparent via-blood/60 to-transparent mx-auto" />
        </div>

        {/* Form area */}
        <div className={`w-full max-w-sm transition-all duration-700 delay-300 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
          {/* Error */}
          {error && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-blood/10 border border-blood/20 text-blood-400 text-sm text-center animate-slide-up">
              {error}
            </div>
          )}

          {/* Name input */}
          <div className="mb-6">
            <label className="block text-xs text-moon-dim mb-2 tracking-wider uppercase">
              你的代号
            </label>
            <input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="在此输入昵称"
              className="w-full px-5 py-4 bg-forest-50/50 border border-white/[0.06] rounded-2xl text-moon placeholder:text-moon-mist focus:outline-none focus:border-blood/30 focus:ring-1 focus:ring-blood/20 transition-all text-center text-lg font-body"
              maxLength={10}
            />
          </div>

          {/* Action buttons */}
          {!isJoining ? (
            <div className="space-y-3">
              <button
                onClick={handleCreateRoom}
                disabled={!playerName.trim()}
                className="group relative w-full py-4 rounded-2xl font-display text-lg tracking-wide overflow-hidden transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-blood-700 via-blood to-blood-700 group-hover:from-blood-600 group-hover:via-blood-500 group-hover:to-blood-600 transition-all" />
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.1),transparent_70%)]" />
                <span className="relative z-10 text-white">创建房间</span>
              </button>

              <button
                onClick={() => setIsJoining(true)}
                className="w-full py-4 rounded-2xl font-display text-lg tracking-wide glass hover:bg-white/[0.06] transition-all text-moon/80 hover:text-moon"
              >
                加入房间
              </button>
            </div>
          ) : (
            <div className="space-y-3 animate-slide-up">
              <div>
                <label className="block text-xs text-moon-dim mb-2 tracking-wider uppercase">
                  房间号
                </label>
                <input
                  type="text"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  placeholder="输入 6 位房间号"
                  className="w-full px-5 py-4 bg-forest-50/50 border border-white/[0.06] rounded-2xl text-moon placeholder:text-moon-mist focus:outline-none focus:border-blood/30 focus:ring-1 focus:ring-blood/20 transition-all text-center text-2xl font-mono tracking-[0.5em] uppercase"
                  maxLength={6}
                />
              </div>

              <button
                onClick={handleJoinRoom}
                disabled={!playerName.trim() || !roomId.trim()}
                className="group relative w-full py-4 rounded-2xl font-display text-lg tracking-wide overflow-hidden transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-emerald-700 via-emerald-600 to-emerald-700 group-hover:from-emerald-600 group-hover:via-emerald-500 group-hover:to-emerald-600 transition-all" />
                <span className="relative z-10 text-white">加入</span>
              </button>

              <button
                onClick={() => setIsJoining(false)}
                className="w-full py-3 text-moon-dim hover:text-moon transition-colors text-sm"
              >
                返回
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className={`pb-safe text-center transition-all duration-700 delay-500 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
        <div className="flex items-center justify-center gap-3 text-moon-mist text-xs tracking-wider pb-6">
          <span className="w-8 h-px bg-white/10" />
          <span>局域网联机</span>
          <span className="text-blood/40">·</span>
          <span>同一 WiFi</span>
          <span className="w-8 h-px bg-white/10" />
        </div>
      </div>
    </div>
  );
}
