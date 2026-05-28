import { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../stores/gameStore';
import { GamePhase, Role, ROLES } from '@werewolf/shared';

export function Game() {
  const {
    room, myId, myRole, gameState, messages, seerResult, error,
    werewolfKill, seerCheck, witchSave, witchPoison, guardProtect,
    vote, sendChat, hunterShoot, setSeerResult
  } = useGameStore();

  const [chatInput, setChatInput] = useState('');
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'players' | 'chat'>('players');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!room || !gameState || !myRole) return null;

  const myPlayer = room.players.find(p => p.id === myId);
  const isAlive = myPlayer?.status === 'alive';
  const currentPhase = gameState.phase;
  const isNight = currentPhase.startsWith('night_');

  const getPhaseName = (phase: GamePhase) => {
    const names: Record<GamePhase, string> = {
      [GamePhase.WAITING]: '等待中',
      [GamePhase.NIGHT_WEREWOLF]: '月黑风高',
      [GamePhase.NIGHT_SEER]: '预言时刻',
      [GamePhase.NIGHT_WITCH]: '魔药抉择',
      [GamePhase.NIGHT_GUARD]: '暗中守护',
      [GamePhase.DAY_ANNOUNCE]: '天亮了',
      [GamePhase.DAY_DISCUSS]: '唇枪舌剑',
      [GamePhase.DAY_VOTE]: '投票处决',
      [GamePhase.HUNTER_SHOOT]: '临终一击',
      [GamePhase.GAME_OVER]: '尘埃落定'
    };
    return names[phase] || phase;
  };

  const getPhaseEmoji = (phase: GamePhase) => {
    const emojis: Record<GamePhase, string> = {
      [GamePhase.WAITING]: '⏳',
      [GamePhase.NIGHT_WEREWOLF]: '🌑',
      [GamePhase.NIGHT_SEER]: '🔮',
      [GamePhase.NIGHT_WITCH]: '🧪',
      [GamePhase.NIGHT_GUARD]: '🛡️',
      [GamePhase.DAY_ANNOUNCE]: '☀️',
      [GamePhase.DAY_DISCUSS]: '💬',
      [GamePhase.DAY_VOTE]: '⚔️',
      [GamePhase.HUNTER_SHOOT]: '🔫',
      [GamePhase.GAME_OVER]: '🏆'
    };
    return emojis[phase] || '🌙';
  };

  const getCampName = (role: Role) => {
    return ROLES[role]?.camp === 'werewolf' ? '狼人阵营' : '好人阵营';
  };

  const handleSendChat = () => {
    if (!chatInput.trim()) return;
    sendChat(chatInput.trim());
    setChatInput('');
  };

  const handleAction = () => {
    if (!selectedTarget) return;
    switch (currentPhase) {
      case GamePhase.NIGHT_WEREWOLF:
        if (myRole === Role.WEREWOLF) werewolfKill(selectedTarget);
        break;
      case GamePhase.NIGHT_SEER:
        if (myRole === Role.SEER) seerCheck(selectedTarget);
        break;
      case GamePhase.NIGHT_WITCH:
        if (myRole === Role.WITCH) witchPoison(selectedTarget);
        break;
      case GamePhase.NIGHT_GUARD:
        if (myRole === Role.GUARD) guardProtect(selectedTarget);
        break;
      case GamePhase.DAY_VOTE:
        vote(selectedTarget);
        break;
      case GamePhase.HUNTER_SHOOT:
        if (myRole === Role.HUNTER) hunterShoot(selectedTarget);
        break;
    }
    setSelectedTarget(null);
  };

  const canAct = () => {
    if (!isAlive) return false;
    switch (currentPhase) {
      case GamePhase.NIGHT_WEREWOLF: return myRole === Role.WEREWOLF;
      case GamePhase.NIGHT_SEER: return myRole === Role.SEER;
      case GamePhase.NIGHT_WITCH: return myRole === Role.WITCH;
      case GamePhase.NIGHT_GUARD: return myRole === Role.GUARD;
      case GamePhase.DAY_VOTE: return true;
      case GamePhase.HUNTER_SHOOT: return myRole === Role.HUNTER;
      default: return false;
    }
  };

  const getActionName = () => {
    switch (currentPhase) {
      case GamePhase.NIGHT_WEREWOLF: return '击杀';
      case GamePhase.NIGHT_SEER: return '查验';
      case GamePhase.NIGHT_WITCH: return '毒杀';
      case GamePhase.NIGHT_GUARD: return '守护';
      case GamePhase.DAY_VOTE: return '投票淘汰';
      case GamePhase.HUNTER_SHOOT: return '开枪带走';
      default: return '';
    }
  };

  const getActionColor = () => {
    switch (currentPhase) {
      case GamePhase.NIGHT_WEREWOLF: return 'from-blood-700 to-blood';
      case GamePhase.NIGHT_SEER: return 'from-poison-dark to-poison';
      case GamePhase.NIGHT_WITCH: return 'from-poison-dark to-poison';
      case GamePhase.NIGHT_GUARD: return 'from-blue-700 to-blue-500';
      case GamePhase.DAY_VOTE: return 'from-blood-700 to-blood';
      case GamePhase.HUNTER_SHOOT: return 'from-amber-700 to-amber-500';
      default: return 'from-blood-700 to-blood';
    }
  };

  const getTargetablePlayers = () => {
    return room.players.filter(p => {
      if (p.id === myId) return false;
      if (p.status === 'dead') return false;
      if (currentPhase === GamePhase.NIGHT_GUARD && myRole === Role.GUARD) {
        if (myPlayer?.skillUsed.lastGuardTarget === p.id) return false;
      }
      return true;
    });
  };

  return (
    <div className={`flex flex-col min-h-dvh relative transition-colors duration-1000 ${
      isNight ? 'bg-forest' : 'bg-forest'
    }`}>
      {/* Night atmosphere */}
      {isNight && (
        <>
          <div className="absolute inset-0 bg-gradient-to-b from-indigo-950/20 via-transparent to-transparent pointer-events-none" />
          <div className="absolute top-4 left-1/2 -translate-x-1/2 w-20 h-20 rounded-full bg-gradient-to-b from-slate-300/10 to-transparent blur-xl pointer-events-none animate-breathe" />
        </>
      )}

      {/* Day atmosphere */}
      {!isNight && currentPhase !== GamePhase.GAME_OVER && (
        <div className="absolute inset-0 bg-gradient-to-b from-amber-950/10 via-transparent to-transparent pointer-events-none" />
      )}

      {/* Top Status Bar */}
      <header className="safe-top px-4 pt-3 pb-2 relative z-10">
        <div className="glass rounded-2xl px-4 py-3">
          <div className="flex items-center justify-between">
            {/* Left: Phase info */}
            <div className="flex items-center gap-2.5">
              <span className="text-xl">{getPhaseEmoji(currentPhase)}</span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-moon-dim tracking-wider">DAY {gameState.day}</span>
                  {isNight && <span className="w-1 h-1 rounded-full bg-indigo-400 animate-breathe" />}
                </div>
                <div className="font-display text-base leading-tight">
                  {getPhaseName(currentPhase)}
                </div>
              </div>
            </div>

            {/* Right: My role */}
            <div className="flex items-center gap-2">
              <div className="text-right">
                <div className="text-[10px] text-moon-dim tracking-wider">身份</div>
                <div className="font-display text-sm text-blood-400">
                  {ROLES[myRole].name}
                </div>
              </div>
              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm ${
                ROLES[myRole].camp === 'werewolf'
                  ? 'bg-blood/20 text-blood-400'
                  : 'bg-heal/20 text-heal-400'
              }`}>
                {ROLES[myRole].camp === 'werewolf' ? '🐺' : '👤'}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Tab Switcher */}
      <div className="px-4 py-1.5 relative z-10">
        <div className="glass rounded-xl p-1 flex">
          <button
            onClick={() => setActiveTab('players')}
            className={`flex-1 py-2 rounded-lg text-sm font-body transition-all ${
              activeTab === 'players'
                ? 'bg-white/[0.08] text-moon'
                : 'text-moon-dim'
            }`}
          >
            玩家 {room.players.filter(p => p.status === 'alive').length}/{room.players.length}
          </button>
          <button
            onClick={() => setActiveTab('chat')}
            className={`flex-1 py-2 rounded-lg text-sm font-body transition-all relative ${
              activeTab === 'chat'
                ? 'bg-white/[0.08] text-moon'
                : 'text-moon-dim'
            }`}
          >
            对话
            {messages.length > 0 && (
              <span className="absolute top-1 right-3 w-1.5 h-1.5 rounded-full bg-blood animate-breathe" />
            )}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 px-4 pb-2 relative z-10 overflow-hidden">
        {/* Players Tab */}
        {activeTab === 'players' && (
          <div className="h-full overflow-y-auto space-y-2 pb-4 stagger-children">
            {room.players.map((player) => {
              const isDead = player.status === 'dead';
              const isSelected = player.id === selectedTarget;
              const isMe = player.id === myId;
              const isTargetable = !isDead && !isMe && isAlive;

              return (
                <button
                  key={player.id}
                  onClick={() => isTargetable && setSelectedTarget(isSelected ? null : player.id)}
                  disabled={!isTargetable}
                  className={`animate-slide-up w-full flex items-center gap-3.5 p-3.5 rounded-2xl transition-all duration-200 text-left ${
                    isDead
                      ? 'opacity-40 bg-forest-50/30'
                      : isSelected
                      ? 'bg-blood/15 border border-blood/30 ring-1 ring-blood/20'
                      : isMe
                      ? 'glass border-blood/10'
                      : 'glass active:scale-[0.98]'
                  }`}
                >
                  {/* Avatar */}
                  <div className="relative shrink-0">
                    <div className={`w-11 h-11 rounded-full flex items-center justify-center text-base font-bold ${
                      isDead
                        ? 'bg-forest-100 text-moon-mist'
                        : isMe
                        ? 'bg-gradient-to-br from-blood-600 to-blood-800 text-white'
                        : 'bg-gradient-to-br from-forest-50 to-forest-100 text-moon-dim'
                    }`}>
                      {player.name.charAt(0)}
                    </div>
                    {/* Status dot */}
                    {!isDead && (
                      <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-heal border-2 border-forest" />
                    )}
                    {isDead && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-lg opacity-60">💀</span>
                      </div>
                    )}
                    {/* Host crown */}
                    {player.id === room.hostId && !isDead && (
                      <div className="absolute -top-1.5 -right-1.5 text-[10px]">👑</div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`font-body font-medium truncate ${isDead ? 'line-through text-moon-mist' : ''}`}>
                        {player.name}
                      </span>
                      {isMe && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blood/20 text-blood-400 tracking-wider shrink-0">
                          我
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-moon-mist mt-0.5">
                      {isDead ? '已阵亡' : isMe ? ROLES[myRole].name : '存活'}
                    </div>
                  </div>

                  {/* Selection indicator */}
                  {isTargetable && (
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                      isSelected
                        ? 'border-blood bg-blood text-white'
                        : 'border-white/20'
                    }`}>
                      {isSelected && (
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Chat Tab */}
        {activeTab === 'chat' && (
          <div className="h-full flex flex-col">
            <div className="flex-1 overflow-y-auto space-y-3 pb-4">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-48 text-moon-mist">
                  <span className="text-3xl mb-3">💬</span>
                  <span className="text-sm">暂无消息</span>
                </div>
              )}
              {messages.map((msg) => (
                <div key={msg.id} className="animate-fade-in">
                  {msg.type === 'system' ? (
                    <div className="text-center py-2">
                      <span className="inline-block px-3 py-1 rounded-full bg-white/[0.04] text-moon-mist text-xs">
                        {msg.content}
                      </span>
                    </div>
                  ) : (
                    <div className={`flex gap-2.5 ${msg.playerId === myId ? 'flex-row-reverse' : ''}`}>
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                        msg.playerId === myId
                          ? 'bg-blood/30 text-blood-300'
                          : 'bg-forest-50 text-moon-dim'
                      }`}>
                        {msg.playerName.charAt(0)}
                      </div>
                      <div className={`max-w-[75%] ${msg.playerId === myId ? 'text-right' : ''}`}>
                        <div className="text-[10px] text-moon-mist mb-1 px-1">
                          {msg.playerName}
                        </div>
                        <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                          msg.playerId === myId
                            ? 'bg-blood/20 text-moon rounded-br-md'
                            : 'glass text-moon/90 rounded-bl-md'
                        }`}>
                          {msg.content}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Chat input */}
            {isAlive && (currentPhase === GamePhase.DAY_DISCUSS || currentPhase === GamePhase.DAY_VOTE) && (
              <div className="pb-safe pt-2 pb-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
                    placeholder="说点什么..."
                    className="flex-1 px-4 py-3 bg-forest-50/50 border border-white/[0.06] rounded-2xl text-moon text-sm placeholder:text-moon-mist focus:outline-none focus:border-blood/20 transition-all"
                  />
                  <button
                    onClick={handleSendChat}
                    disabled={!chatInput.trim()}
                    className="w-12 h-12 rounded-2xl bg-blood/20 text-blood-400 flex items-center justify-center disabled:opacity-30 active:scale-95 transition-all"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Seer Result Modal */}
      {myRole === Role.SEER && seerResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="glass-dark rounded-3xl p-6 w-full max-w-xs text-center animate-moonrise">
            <div className="text-4xl mb-4">🔮</div>
            <h3 className="font-display text-xl mb-2">查验结果</h3>
            <p className="text-moon-dim text-sm mb-4">
              {room.players.find(p => p.id === seerResult.playerId)?.name}
            </p>
            <div className={`inline-flex items-center gap-2 px-5 py-3 rounded-2xl text-lg font-display ${
              seerResult.isWerewolf
                ? 'bg-blood/20 text-blood-400'
                : 'bg-heal/20 text-heal-400'
            }`}>
              {seerResult.isWerewolf ? '🐺 是狼人！' : '✨ 是好人'}
            </div>
            <button
              onClick={() => setSeerResult(null)}
              className="mt-5 w-full py-3 rounded-xl glass text-moon-dim text-sm hover:text-moon transition-colors"
            >
              知道了
            </button>
          </div>
        </div>
      )}

      {/* Bottom Action Bar */}
      {canAct() && (
        <div className="px-4 pb-safe pt-2 pb-4 relative z-20 animate-slide-in-bottom">
          <div className="glass-dark rounded-2xl p-4">
            {/* Action info */}
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-moon-dim tracking-wider">
                {getActionName()}目标
              </div>
              {selectedTarget && (
                <div className="flex items-center gap-1.5 text-sm">
                  <span className="text-moon-dim">→</span>
                  <span className="font-medium text-moon">
                    {room.players.find(p => p.id === selectedTarget)?.name}
                  </span>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              {/* Witch save button */}
              {myRole === Role.WITCH && currentPhase === GamePhase.NIGHT_WITCH && (
                <button
                  onClick={witchSave}
                  className="px-5 py-3.5 rounded-xl bg-gradient-to-r from-heal-dark to-heal text-white font-display text-sm shrink-0 active:scale-95 transition-transform"
                >
                  解药 💊
                </button>
              )}

              {/* Main action button */}
              <button
                onClick={handleAction}
                disabled={!selectedTarget}
                className={`flex-1 py-3.5 rounded-xl font-display text-base tracking-wide text-white transition-all duration-200 active:scale-[0.97] disabled:opacity-20 disabled:cursor-not-allowed bg-gradient-to-r ${getActionColor()}`}
              >
                {getActionName()} {selectedTarget ? room.players.find(p => p.id === selectedTarget)?.name : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dead overlay */}
      {!isAlive && currentPhase !== GamePhase.GAME_OVER && (
        <div className="px-4 pb-safe pt-2 pb-4 relative z-20">
          <div className="glass-dark rounded-2xl p-4 text-center">
            <span className="text-2xl">💀</span>
            <p className="text-moon-dim text-sm mt-1">你已阵亡，只能观战</p>
          </div>
        </div>
      )}

      {/* Game Over */}
      {currentPhase === GamePhase.GAME_OVER && gameState.winner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-md animate-fade-in">
          <div className="glass-dark rounded-3xl p-6 w-full max-w-sm animate-moonrise">
            {/* Winner banner */}
            <div className="text-center mb-6">
              <div className="text-5xl mb-4">
                {gameState.winner === 'villager' ? '☀️' : '🌙'}
              </div>
              <h2 className="font-display text-3xl mb-2 text-shadow-glow">
                {gameState.winner === 'villager' ? '好人阵营' : '狼人阵营'}
              </h2>
              <p className="text-moon-dim text-sm">获得胜利</p>
              <div className="mt-3 w-16 h-px bg-gradient-to-r from-transparent via-blood/60 to-transparent mx-auto" />
            </div>

            {/* Role reveal */}
            <div className="mb-6">
              <h3 className="text-xs text-moon-dim tracking-wider uppercase mb-3 text-center">身份揭示</h3>
              <div className="space-y-2">
                {room.players.map((player) => (
                  <div
                    key={player.id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl ${
                      player.status === 'dead' ? 'opacity-50' : ''
                    } ${player.id === myId ? 'glass border-blood/10' : 'bg-forest-50/30'}`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                      player.role === Role.WEREWOLF
                        ? 'bg-blood/20 text-blood-400'
                        : 'bg-heal/20 text-heal-400'
                    }`}>
                      {player.name.charAt(0)}
                    </div>
                    <span className={`flex-1 text-sm ${player.status === 'dead' ? 'line-through text-moon-mist' : ''}`}>
                      {player.name}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      player.role === Role.WEREWOLF
                        ? 'bg-blood/20 text-blood-400'
                        : 'bg-heal/20 text-heal-400'
                    }`}>
                      {player.role ? ROLES[player.role].name : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={() => window.location.reload()}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-blood-700 via-blood to-blood-700 text-white font-display text-lg tracking-wide active:scale-[0.97] transition-transform"
            >
              返回大厅
            </button>
          </div>
        </div>
      )}

      {/* Error toast */}
      {error && (
        <div className="fixed top-20 left-4 right-4 z-50 animate-slide-up">
          <div className="glass-dark rounded-2xl px-4 py-3 text-blood-400 text-sm text-center">
            {error}
          </div>
        </div>
      )}
    </div>
  );
}
