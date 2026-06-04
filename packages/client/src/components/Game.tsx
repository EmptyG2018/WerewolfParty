import { useState, useEffect } from 'react';
import { useGameStore } from '../stores/gameStore';
import { DeathReason, GamePhase, RoleAbility, ROLES, isWolfRole, roleHasAbility } from '@werewolf/shared';

type PendingConfirm = {
  title: string;
  message: string;
  confirmLabel: string;
  tone: 'danger' | 'safe';
  run: () => void;
};

export function Game() {
  const {
    room, myId, myRole, gameState, speaking, seerResult, error,
    roleConfirmed, confirmedPlayers, wolfVotes, wolfSelections, wolfTeam, deathEvents, voteResult,
    confirmRole, werewolfKill, wolfConfirmVote, seerCheck, witchSave, witchPoison, guardProtect,
    vote, speakingDone, hunterShoot, wolfKingShoot, wolfSelfReveal, whiteWolfKingExplode, witchPass,
    abstainVote, pauseGame, resumeGame, resetRoom, leaveRoom, setSeerResult, hunterPass
  } = useGameStore();

  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [transitionPhase, setTransitionPhase] = useState<GamePhase | null>(null);
  const [voteHistoryOpen, setVoteHistoryOpen] = useState(false);

  // 以服务端 phaseEndsAt 校准倒计时；本地 interval 只负责平滑刷新 UI。
  useEffect(() => {
    if (!gameState || gameState.paused || !gameState.phaseEndsAt) return;
    const syncTimer = () => {
      useGameStore.setState((state) => {
        if (!state.gameState || !state.gameState.phaseEndsAt) return state;
        const phaseTimer = Math.max(0, Math.ceil((state.gameState.phaseEndsAt - Date.now()) / 1000));
        if (phaseTimer === state.gameState.phaseTimer) return state;
        return { gameState: { ...state.gameState, phaseTimer } };
      });
    };
    syncTimer();
    const interval = setInterval(() => {
      syncTimer();
    }, 250);
    return () => clearInterval(interval);
  }, [gameState?.phase, gameState?.phaseEndsAt, gameState?.paused]);

  useEffect(() => {
    if (
      !gameState ||
      gameState.paused ||
      gameState.phase === GamePhase.ROLE_CONFIRM ||
      gameState.phase === GamePhase.GAME_OVER ||
      gameState.phase.startsWith('night_')
    ) return;
    // 夜晚阶段不弹转场，避免遮住夜间技能操作。
    setTransitionPhase(gameState.phase);
    const timeout = setTimeout(() => setTransitionPhase(null), 1200);
    return () => clearTimeout(timeout);
  }, [gameState?.phase]);

  useEffect(() => {
    setSelectedTarget(null);
  }, [gameState?.phase]);

  if (!room || !gameState || !myRole) return null;

  const myPlayer = room.players.find(p => p.id === myId);
  const isAlive = myPlayer?.status === 'alive';
  const currentPhase = gameState.phase;
  const isNight = currentPhase.startsWith('night_');
  const isHost = room.hostId === myId;
  const isPaused = gameState.paused;
  const getPlayerNumber = (player: { playerNumber?: number; seatIndex: number }) => player.playerNumber ?? player.seatIndex + 1;

  const getPlayerName = (playerId: string | null) => {
    if (!playerId) return '无人';
    const player = room.players.find(p => p.id === playerId);
    return player ? `${getPlayerNumber(player)}号 ${player.name}` : '未知玩家';
  };

  const getVoteTargetName = (playerId: string | null) => {
    if (playerId === null) return '弃票';
    return getPlayerName(playerId);
  };

  const getDeathReasonName = (reason: DeathReason) => {
    const names = {
      killed: '狼人袭击',
      voted: '投票放逐',
      poisoned: '女巫毒杀',
      shot: '开枪带走',
      self_exposed: '狼人自曝',
      exploded: '白狼王带走'
    };
    return names[reason];
  };

  const getDeathReasonClass = (reason: DeathReason) => {
    switch (reason) {
      case 'poisoned': return 'bg-poison/15 text-poison border-poison/20';
      case 'voted': return 'bg-gold/15 text-gold border-gold/20';
      case 'shot': return 'bg-amber-500/15 text-amber-300 border-amber-500/20';
      case 'self_exposed': return 'bg-blood/20 text-blood-300 border-blood/30';
      case 'exploded': return 'bg-purple-500/15 text-purple-300 border-purple-500/20';
      default: return 'bg-blood/15 text-blood-400 border-blood/20';
    }
  };

  const getLatestDeath = (playerId: string) => {
    return [...deathEvents].reverse().find(event => event.playerId === playerId);
  };

  const confirmThen = (confirm: Omit<PendingConfirm, 'run'>, run: () => void) => {
    setPendingConfirm({
      ...confirm,
      run: () => {
        run();
        setSelectedTarget(null);
        setPendingConfirm(null);
      }
    });
  };

  const getPhaseName = (phase: GamePhase) => {
    const names: Record<GamePhase, string> = {
      [GamePhase.WAITING]: '等待中',
      [GamePhase.ROLE_CONFIRM]: '确认身份',
      [GamePhase.NIGHT_WEREWOLF]: '月黑风高',
      [GamePhase.NIGHT_SEER]: '预言时刻',
      [GamePhase.NIGHT_WITCH]: '魔药抉择',
      [GamePhase.NIGHT_GUARD]: '暗中守护',
      [GamePhase.DAY_ANNOUNCE]: '天亮了',
      [GamePhase.DAY_SPEAKING]: '轮流发言',
      [GamePhase.DAY_VOTE]: '投票处决',
      [GamePhase.LAST_WORDS]: '遗言时间',
      [GamePhase.DAY_SELF_REVEAL]: '狼人自曝',
      [GamePhase.HUNTER_SHOOT]: '临终一击',
      [GamePhase.GAME_OVER]: '尘埃落定',
      [GamePhase.WOLF_KING_SHOOT]: '狼王遗言'
    };
    return names[phase] || phase;
  };

  const getPhaseEmoji = (phase: GamePhase) => {
    const emojis: Record<GamePhase, string> = {
      [GamePhase.WAITING]: '⏳',
      [GamePhase.ROLE_CONFIRM]: '🎭',
      [GamePhase.NIGHT_WEREWOLF]: '🌑',
      [GamePhase.NIGHT_SEER]: '🔮',
      [GamePhase.NIGHT_WITCH]: '🧪',
      [GamePhase.NIGHT_GUARD]: '🛡️',
      [GamePhase.DAY_ANNOUNCE]: '☀️',
      [GamePhase.DAY_SPEAKING]: '🎤',
      [GamePhase.DAY_VOTE]: '⚔️',
      [GamePhase.LAST_WORDS]: '🕯️',
      [GamePhase.DAY_SELF_REVEAL]: '💥',
      [GamePhase.HUNTER_SHOOT]: '🔫',
      [GamePhase.GAME_OVER]: '🏆',
      [GamePhase.WOLF_KING_SHOOT]: '👑'
    };
    return emojis[phase] || '🌙';
  };

  const getPhaseSubtitle = (phase: GamePhase) => {
    const subtitles: Record<GamePhase, string> = {
      [GamePhase.WAITING]: '等待玩家入座',
      [GamePhase.ROLE_CONFIRM]: '确认你的身份牌',
      [GamePhase.NIGHT_WEREWOLF]: '狼人请行动',
      [GamePhase.NIGHT_SEER]: '预言家请查验',
      [GamePhase.NIGHT_WITCH]: '女巫请抉择',
      [GamePhase.NIGHT_GUARD]: '守卫请守护',
      [GamePhase.DAY_ANNOUNCE]: '公布昨夜结果',
      [GamePhase.DAY_SPEAKING]: '按顺序发言',
      [GamePhase.DAY_VOTE]: '所有存活玩家投票',
      [GamePhase.LAST_WORDS]: '放逐玩家发表遗言',
      [GamePhase.DAY_SELF_REVEAL]: '白天中断，即将入夜',
      [GamePhase.HUNTER_SHOOT]: '猎人可发动技能',
      [GamePhase.WOLF_KING_SHOOT]: '狼王可发动技能',
      [GamePhase.GAME_OVER]: '揭示所有身份'
    };
    return subtitles[phase] || '';
  };

  // 狼人是否已确认投票
  const myWolfVote = myId ? wolfVotes[myId] : undefined;
  const myWolfSelection = myId ? wolfSelections[myId] : undefined;
  const hasConfirmedWolfVote = myId ? Object.prototype.hasOwnProperty.call(wolfVotes, myId) : false;
  const canSelfReveal = !isPaused && isAlive && roleHasAbility(myRole, RoleAbility.WOLF_SELF_REVEAL)
    && (currentPhase === GamePhase.DAY_SPEAKING || currentPhase === GamePhase.DAY_VOTE);
  const canWhiteWolfKingExplode = !isPaused && isAlive && roleHasAbility(myRole, RoleAbility.WHITE_WOLF_KING_EXPLODE)
    && (currentPhase === GamePhase.DAY_SPEAKING || currentPhase === GamePhase.DAY_VOTE);

  const handleAction = () => {
    if (!selectedTarget) return;
    const targetName = getPlayerName(selectedTarget);
    switch (currentPhase) {
      case GamePhase.NIGHT_WEREWOLF:
        if (roleHasAbility(myRole, RoleAbility.WEREWOLF_KILL)) {
          if (myWolfSelection === selectedTarget) {
            confirmThen({
              title: '确认狼刀',
              message: `确认投票击杀 ${targetName}？确认后本轮不能修改。`,
              confirmLabel: '确认击杀',
              tone: 'danger'
            }, wolfConfirmVote);
          } else {
            // 新选择
            werewolfKill(selectedTarget);
          }
        }
        return;
      case GamePhase.NIGHT_SEER:
        if (roleHasAbility(myRole, RoleAbility.SEER_CHECK)) seerCheck(selectedTarget);
        break;
      case GamePhase.NIGHT_WITCH:
        if (roleHasAbility(myRole, RoleAbility.WITCH_POISON)) {
          confirmThen({
            title: '使用毒药',
            message: `确认毒杀 ${targetName}？毒药每局只能使用一次。`,
            confirmLabel: '确认毒杀',
            tone: 'danger'
          }, () => witchPoison(selectedTarget));
        }
        return;
      case GamePhase.NIGHT_GUARD:
        if (roleHasAbility(myRole, RoleAbility.GUARD_PROTECT)) guardProtect(selectedTarget);
        break;
      case GamePhase.DAY_VOTE:
        confirmThen({
          title: '确认投票',
          message: `确认投给 ${targetName}？`,
          confirmLabel: '确认投票',
          tone: 'danger'
        }, () => vote(selectedTarget));
        return;
      case GamePhase.HUNTER_SHOOT:
        if (roleHasAbility(myRole, RoleAbility.HUNTER_SHOOT)) {
          confirmThen({
            title: '猎人开枪',
            message: `确认带走 ${targetName}？`,
            confirmLabel: '确认开枪',
            tone: 'danger'
          }, () => hunterShoot(selectedTarget));
        }
        return;
      case GamePhase.WOLF_KING_SHOOT:
        if (roleHasAbility(myRole, RoleAbility.WOLF_KING_SHOOT)) {
          confirmThen({
            title: '狼王开枪',
            message: `确认带走 ${targetName}？`,
            confirmLabel: '确认开枪',
            tone: 'danger'
          }, () => wolfKingShoot(selectedTarget));
        }
        return;
    }
    setSelectedTarget(null);
  };

  const canAct = () => {
    // 猎人/狼王开枪时本人已经死亡，所以这两个阶段要绕过“存活才能行动”的通用限制。
    if (isPaused) return false;
    if (currentPhase === GamePhase.HUNTER_SHOOT) return roleHasAbility(myRole, RoleAbility.HUNTER_SHOOT) && !isAlive;
    if (currentPhase === GamePhase.WOLF_KING_SHOOT) return roleHasAbility(myRole, RoleAbility.WOLF_KING_SHOOT) && !isAlive;
    if (!isAlive) return false;
    switch (currentPhase) {
      case GamePhase.NIGHT_WEREWOLF: return roleHasAbility(myRole, RoleAbility.WEREWOLF_KILL);
      case GamePhase.NIGHT_SEER: return roleHasAbility(myRole, RoleAbility.SEER_CHECK);
      case GamePhase.NIGHT_WITCH: return roleHasAbility(myRole, RoleAbility.WITCH_POISON) || roleHasAbility(myRole, RoleAbility.WITCH_SAVE);
      case GamePhase.NIGHT_GUARD: return roleHasAbility(myRole, RoleAbility.GUARD_PROTECT);
      case GamePhase.DAY_VOTE: return true;
      default: return false;
    }
  };

  const canSelectTarget = () => canAct() || canWhiteWolfKingExplode;

  const confirmWhiteWolfKingExplode = () => {
    if (!selectedTarget) return;
    const targetName = getPlayerName(selectedTarget);
    confirmThen({
      title: '白狼王自曝',
      message: `确认自曝并带走 ${targetName}？发动后你会出局，并中断白天流程直接进入下一夜。`,
      confirmLabel: '自曝带走',
      tone: 'danger'
    }, () => whiteWolfKingExplode(selectedTarget));
  };

  const getActionName = () => {
    switch (currentPhase) {
      case GamePhase.NIGHT_WEREWOLF: return '投票击杀';
      case GamePhase.NIGHT_SEER: return '查验';
      case GamePhase.NIGHT_WITCH: return '毒杀';
      case GamePhase.NIGHT_GUARD: return '守护';
      case GamePhase.DAY_VOTE: return '投票淘汰';
      case GamePhase.HUNTER_SHOOT: return '开枪带走';
      case GamePhase.WOLF_KING_SHOOT: return '开枪带走';
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
      case GamePhase.WOLF_KING_SHOOT: return 'from-purple-700 to-purple-500';
      default: return 'from-blood-700 to-blood';
    }
  };

  // 发言相关
  const isLastWordsPhase = currentPhase === GamePhase.LAST_WORDS;
  const isSpeakingPhase = currentPhase === GamePhase.DAY_SPEAKING || isLastWordsPhase;
  const currentSpeakerId = speaking?.order[speaking?.currentIndex ?? -1];
  const isMyTurn = currentSpeakerId === myId;
  const hasSpoken = speaking?.confirmed.includes(myId ?? '') ?? false;
  const speakingProgress = speaking ? `${Math.min(speaking.currentIndex + 1, speaking.order.length)}/${speaking.order.length}` : '';
  const currentSpeakerName = currentSpeakerId ? getPlayerName(currentSpeakerId) : '';
  const canFinishSpeaking = isSpeakingPhase && isMyTurn && (isAlive || isLastWordsPhase);

  // 狼人投票相关：选择可修改，确认后锁定；服务端最终按确认票结算。
  const isWolf = isWolfRole(myRole);
  const isWolfPhase = currentPhase === GamePhase.NIGHT_WEREWOLF;
  const currentDayDeaths = deathEvents.filter(event => event.day === gameState.day);
  const sortedVoteResult = voteResult
    ? Object.entries(voteResult.votes).sort((a, b) => b[1] - a[1])
    : [];
  const wolfTargetCounts = Object.values(wolfVotes).reduce<Record<string, number>>((counts, targetId) => {
    counts[targetId] = (counts[targetId] || 0) + 1;
    return counts;
  }, {});
  const wolfTopVotes = Math.max(0, ...Object.values(wolfTargetCounts));
  const wolfTopTargets = Object.entries(wolfTargetCounts)
    .filter(([, count]) => count === wolfTopVotes && count > 0)
    .map(([targetId]) => targetId);
  const hasCompletedVote = myId ? Object.prototype.hasOwnProperty.call(gameState.votes, myId) : false;
  const voteHistory = gameState.voteHistory ?? [];
  const dedupedVoteHistory = Array.from(
    voteHistory.reduce((history, entry) => history.set(entry.day, entry), new Map<number, typeof voteHistory[number]>()).values()
  );
  const sortedVoteHistory = dedupedVoteHistory.sort((a, b) => b.day - a.day);

  return (
    <div className={`flex flex-col min-h-dvh relative transition-colors duration-1000 ${
      isNight ? 'bg-forest' : 'bg-forest'
    }`}>
      {/* Phase transition */}
      {transitionPhase && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-forest/85 backdrop-blur-sm pointer-events-none animate-fade-in">
          <div className="text-center animate-moonrise">
            <div className={`mx-auto mb-5 w-20 h-20 rounded-full flex items-center justify-center text-4xl ${
              transitionPhase.toString().startsWith('night_')
                ? 'bg-indigo-950/40 text-moon shadow-lg shadow-indigo-950/30'
                : 'bg-gold/15 text-gold shadow-lg shadow-gold/10'
            }`}>
              {getPhaseEmoji(transitionPhase)}
            </div>
            <div className="font-display text-3xl text-moon text-shadow-glow">
              {getPhaseName(transitionPhase)}
            </div>
            <div className="mt-2 text-sm text-moon-dim tracking-wider">
              {getPhaseSubtitle(transitionPhase)}
            </div>
          </div>
        </div>
      )}

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

      {/* Role Confirmation Overlay */}
      {currentPhase === GamePhase.ROLE_CONFIRM && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-forest/95 backdrop-blur-sm">
          <div className="w-full max-w-sm">
            {/* Role card */}
            <div className="glass rounded-3xl p-6 text-center space-y-5">
              {/* Role emoji */}
              <div className="text-6xl">
                {isWolfRole(myRole) ? '🐺' : '👤'}
              </div>

              {/* Role name */}
              <div>
                <div className="text-[10px] text-moon-dim tracking-widest mb-1">你的身份</div>
                <div className="font-display text-2xl text-white">{ROLES[myRole].name}</div>
              </div>

              {/* Camp badge */}
              <div className={`inline-block px-4 py-1.5 rounded-full text-xs font-medium tracking-wide ${
                isWolfRole(myRole)
                  ? 'bg-blood/20 text-blood-400 border border-blood/30'
                  : 'bg-heal/20 text-heal-400 border border-heal/30'
              }`}>
                {isWolfRole(myRole) ? '狼人阵营' : '好人阵营'}
              </div>

              {/* Description */}
              <div className="glass-light rounded-2xl p-4 space-y-3">
                <div>
                  <div className="text-[10px] text-moon-dim tracking-widest mb-1">角色介绍</div>
                  <div className="text-sm text-moon leading-relaxed">{ROLES[myRole].description}</div>
                </div>
                <div className="h-px bg-white/5" />
                <div>
                  <div className="text-[10px] text-moon-dim tracking-widest mb-1">技能</div>
                  <div className="text-sm text-heal-400 font-medium">{ROLES[myRole].skill}</div>
                </div>
              </div>

              {/* Confirm status / button */}
              {roleConfirmed ? (
                <div className="space-y-1">
                  <div className="text-heal-400 font-display text-sm">已确认</div>
                  <div className="text-[10px] text-moon-dim">
                    {confirmedPlayers.length}/{room.players.length} 人已确认
                  </div>
                </div>
              ) : (
                <button
                  onClick={confirmRole}
                  disabled={isPaused}
                  className="w-full py-3.5 rounded-xl font-display text-base text-white
                    bg-gradient-to-r from-heal-dark to-heal active:scale-[0.97]
                    transition-transform shadow-lg shadow-heal/20 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  确认身份
                </button>
              )}

              {/* Countdown timer */}
              <div className="space-y-2">
                <div className="text-[10px] text-moon-dim tracking-widest">自动进入夜晚</div>
                <div className="font-display text-4xl text-blood-400 animate-breathe">
                  {gameState.phaseTimer}
                </div>
                <div className="w-full h-1 rounded-full bg-forest-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blood-600 to-blood transition-all duration-1000"
                    style={{ width: `${(gameState.phaseTimer / (room.config.roleConfirmTime || 30)) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top Status Bar */}
      <header className="safe-top px-4 pt-3 pb-2 relative z-10">
        <div className="glass rounded-2xl px-4 py-3">
          <div className="flex items-center justify-between">
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

            <div className="flex items-center gap-2">
              {isHost && currentPhase !== GamePhase.GAME_OVER && (
                <button
                  onClick={isPaused ? resumeGame : pauseGame}
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

      {/* Phase result summary */}
      {(currentPhase === GamePhase.DAY_ANNOUNCE || voteResult) && currentPhase !== GamePhase.GAME_OVER && (
        <div className="px-4 py-1.5 relative z-10">
          <div className="glass-dark rounded-xl px-4 py-3 space-y-2">
            {currentPhase === GamePhase.DAY_ANNOUNCE && (
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
      )}

      {/* Vote history entry */}
      {sortedVoteHistory.length > 0 && currentPhase !== GamePhase.GAME_OVER && (
        <div className="px-4 py-1.5 relative z-10">
          <button
            onClick={() => setVoteHistoryOpen(true)}
            className="w-full glass-dark rounded-xl px-4 py-3 flex items-center justify-between gap-3 active:scale-[0.99] transition-transform"
          >
            <span className="text-[10px] text-moon-dim tracking-wider">历史投票</span>
            <span className="text-xs text-moon">
              {sortedVoteHistory.length}轮
            </span>
          </button>
        </div>
      )}

      {/* Speaking Progress Bar */}
      {isSpeakingPhase && speaking && (
        <div className="px-4 py-1.5 relative z-10">
          <div className="glass rounded-xl px-4 py-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] text-moon-dim tracking-wider">{isLastWordsPhase ? '当前遗言' : '当前发言'}</div>
                <div className="font-display text-sm text-moon truncate">{currentSpeakerName}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-moon-dim tracking-wider">进度</div>
                <div className="font-display text-sm text-moon">{speakingProgress}</div>
              </div>
              <div className={`font-display text-lg ${gameState.phaseTimer <= 5 ? 'text-blood-400 animate-breathe' : 'text-gold'}`}>
                {gameState.phaseTimer}s
              </div>
            </div>
            {isMyTurn && (
              <div className="mt-2 text-center text-xs px-2 py-1 rounded-lg bg-blood/20 text-blood-400 animate-breathe">
                {isLastWordsPhase ? '请发表遗言' : '轮到你了'}
              </div>
            )}
            {hasSpoken && !isMyTurn && (
              <div className="mt-2 text-center text-xs px-2 py-1 rounded-lg bg-heal/20 text-heal-400">
                已发言
              </div>
            )}
          </div>
        </div>
      )}

      {/* Player Grid — 2列横向布局，与等待大厅一致 */}
      <div className="flex-1 px-4 pb-2 relative z-10 overflow-hidden">
        <div className="h-full overflow-y-auto pb-4">
          <div className="grid grid-cols-2 gap-2 stagger-children">
            {room.players.map((player) => {
              const isDead = player.status === 'dead';
              const isSelected = player.id === selectedTarget;
              const isMe = player.id === myId;
              const isTargetable = !isDead && !isMe && canSelectTarget();
              const isOffline = !player.online;
              const isCurrentSpeaker = isSpeakingPhase && player.id === currentSpeakerId;
              const hasPlayerSpoken = speaking?.confirmed.includes(player.id) ?? false;
              const latestDeath = getLatestDeath(player.id);

              // 狼人投票：显示已确认投票数
              const wolfVotesOnThis = isWolf && isWolfPhase
                ? Object.entries(wolfVotes).filter(([, tid]) => tid === player.id).length
                : 0;

              return (
                <button
                  key={player.id}
                  onClick={() => isTargetable && setSelectedTarget(isSelected ? null : player.id)}
                  disabled={!isTargetable}
                  className={`animate-slide-up relative flex items-center gap-3 p-3 rounded-xl transition-all duration-200 text-left ${
                    isDead
                      ? 'opacity-40 bg-forest-50/30'
                      : isOffline
                      ? 'opacity-60 bg-forest-50/30 border border-white/[0.04]'
                      : isSelected
                      ? 'bg-blood/15 border border-blood/30 ring-1 ring-blood/20'
                      : isCurrentSpeaker
                      ? 'bg-gold/10 border border-gold/30 ring-1 ring-gold/20'
                      : isMe
                      ? 'glass border-blood/20 bg-blood/5'
                      : 'glass active:scale-[0.97]'
                  }`}
                >
                  {/* Wolf vote badge */}
                  {wolfVotesOnThis > 0 && (
                    <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-blood flex items-center justify-center">
                      <span className="text-[9px] text-white font-bold">{wolfVotesOnThis}</span>
                    </div>
                  )}

                  {/* 头像 + 座位号角标 */}
                  <div className="relative shrink-0">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold ${
                      isDead
                        ? 'bg-forest-100 text-moon-mist'
                        : isCurrentSpeaker
                        ? 'bg-gradient-to-br from-gold-dark to-gold text-forest'
                        : isMe
                        ? 'bg-gradient-to-br from-blood-600 to-blood-800 text-white'
                        : 'bg-gradient-to-br from-forest-50 to-forest-100 text-moon-dim'
                    }`}>
                      {isDead ? '💀' : isOffline ? '…' : player.name.charAt(0)}
                    </div>
                    <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-forest-100 flex items-center justify-center text-[8px] text-moon-dim font-bold border border-forest-50/30">
                      {getPlayerNumber(player)}
                    </div>
                    {player.id === room.hostId && !isDead && (
                      <div className="absolute -top-1.5 -right-1.5 text-[10px]">👑</div>
                    )}
                  </div>

                  {/* 信息 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`font-body text-sm font-medium truncate ${isDead ? 'line-through text-moon-mist' : ''}`}>
                        {player.name}
                      </span>
                      {isMe && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blood/20 text-blood-400 tracking-wider shrink-0">
                          我
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-moon-mist mt-0.5">
                      {isDead && latestDeath
                        ? getDeathReasonName(latestDeath.reason)
                        : isDead
                        ? '已阵亡'
                        : isOffline
                        ? '离线'
                        : isCurrentSpeaker
                        ? '🎤 正在发言'
                        : hasPlayerSpoken
                        ? '已发言'
                        : isMe
                        ? ROLES[myRole].name
                        : ''}
                    </div>
                  </div>

                  {/* 选择指示器 */}
                  {isTargetable && !isCurrentSpeaker && (
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all shrink-0 ${
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
                  {!isTargetable && !isCurrentSpeaker && !isDead && (
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOffline ? 'bg-moon-mist' : 'bg-heal animate-breathe'}`} />
                  )}
                </button>
              );
            })}
          </div>

          {/* 狼队投票面板 */}
          {isWolf && isWolfPhase && isAlive && (
            <div className="mt-3 glass-dark rounded-xl px-3 py-2.5">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs">🐺</span>
                <span className="text-[10px] text-blood-400 tracking-wider">狼队投票</span>
                <span className="ml-auto text-[10px] text-moon-dim">
                  {Object.keys(wolfVotes).length}/{room.players.filter(p => wolfTeam.includes(p.id) && p.status === 'alive').length} 已确认
                </span>
              </div>
              {wolfTopTargets.length > 0 && (
                <div className="mb-2 rounded-lg bg-blood/10 border border-blood/15 px-2 py-1.5">
                  <div className="text-[10px] text-blood-300">
                    当前最高票：{wolfTopTargets.map(getPlayerName).join('、')}
                    {wolfTopTargets.length > 1 ? '，平票将随机结算' : ''}
                  </div>
                </div>
              )}
              <div className="space-y-1">
                {room.players
                  .filter(p => wolfTeam.includes(p.id))
                  .map(wolf => {
                    const confirmedVote = wolfVotes[wolf.id];
                    const selection = wolfSelections[wolf.id];
                    const targetId = confirmedVote || selection;
                    const targetName = targetId ? room.players.find(p => p.id === targetId)?.name : null;
                    const isMeWolf = wolf.id === myId;
                    const isConfirmed = !!confirmedVote;
                    return (
                      <div key={wolf.id} className="flex items-center gap-1.5 text-[10px]">
                        <span className={wolf.status === 'dead' ? 'line-through text-moon-mist' : 'text-blood-300'}>
                          {isMeWolf ? '我' : wolf.name}
                          {wolf.status === 'dead' ? '(亡)' : ''}
                        </span>
                        <span className="text-moon-mist">→</span>
                        <span className={targetName ? (isConfirmed ? 'text-moon' : 'text-moon-dim') : 'text-moon-mist'}>
                          {targetName || '未选择'}
                        </span>
                        <span className={`ml-auto px-1.5 py-0.5 rounded text-[9px] ${
                          isConfirmed ? 'bg-heal/15 text-heal-400' : selection ? 'bg-gold/15 text-gold' : 'bg-white/[0.04] text-moon-mist'
                        }`}>
                          {isConfirmed ? '已确认' : selection ? '已选择' : '等待'}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Seer Result Modal */}
      {roleHasAbility(myRole, RoleAbility.SEER_CHECK) && seerResult && (
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

      {/* Speaking Done Button (当前发言者) */}
      {canFinishSpeaking && (
        <div className="px-4 pb-safe pt-2 pb-4 relative z-20 animate-slide-in-bottom">
          <div className="flex gap-2">
            {canSelfReveal && !isLastWordsPhase && (
              <button
                onClick={() => confirmThen({
                  title: '狼人自曝',
                  message: '确认自曝？自曝后你会出局，并中断白天流程直接进入下一夜。',
                  confirmLabel: '确认自曝',
                  tone: 'danger'
                }, wolfSelfReveal)}
                disabled={isPaused}
                className="px-5 py-4 rounded-2xl font-display text-base tracking-wide text-white bg-gradient-to-r from-blood-700 to-blood active:scale-[0.97] transition-transform disabled:opacity-30 disabled:cursor-not-allowed"
              >
                自曝
              </button>
            )}
            {canWhiteWolfKingExplode && !isLastWordsPhase && (
              <button
                onClick={confirmWhiteWolfKingExplode}
                disabled={isPaused || !selectedTarget}
                className="px-5 py-4 rounded-2xl font-display text-base tracking-wide text-white bg-gradient-to-r from-purple-700 to-purple-500 active:scale-[0.97] transition-transform disabled:opacity-30 disabled:cursor-not-allowed"
              >
                带走
              </button>
            )}
            <button
              onClick={speakingDone}
              disabled={isPaused}
              className="flex-1 py-4 rounded-2xl font-display text-lg tracking-wide text-white bg-gradient-to-r from-gold-dark via-gold to-gold-dark active:scale-[0.97] transition-transform disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {isLastWordsPhase ? '遗言完毕' : '发言完毕'}
            </button>
          </div>
        </div>
      )}

      {/* White wolf king explode button */}
      {canWhiteWolfKingExplode && (!isSpeakingPhase || !isMyTurn) && (
        <div className="px-4 pb-safe pt-2 pb-4 relative z-20 animate-slide-in-bottom">
          <div className="glass-dark rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-moon-dim tracking-wider">自曝带走目标</div>
              {selectedTarget && (
                <div className="flex items-center gap-1.5 text-sm">
                  <span className="text-moon-dim">→</span>
                  <span className="font-medium text-moon">
                    {room.players.find(p => p.id === selectedTarget)?.name}
                  </span>
                </div>
              )}
            </div>
            <button
              onClick={confirmWhiteWolfKingExplode}
              disabled={isPaused || !selectedTarget}
              className="w-full py-3.5 rounded-xl font-display text-base tracking-wide text-white bg-gradient-to-r from-purple-700 to-purple-500 active:scale-[0.97] transition-transform disabled:opacity-30 disabled:cursor-not-allowed"
            >
              白狼王自曝带走
            </button>
          </div>
        </div>
      )}

      {/* Wolf self reveal button */}
      {canSelfReveal && (!isSpeakingPhase || !isMyTurn) && (
        <div className="px-4 pb-safe pt-2 pb-4 relative z-20 animate-slide-in-bottom">
          <button
            onClick={() => confirmThen({
              title: '狼人自曝',
              message: '确认自曝？自曝后你会出局，并中断白天流程直接进入下一夜。',
              confirmLabel: '确认自曝',
              tone: 'danger'
            }, wolfSelfReveal)}
            disabled={isPaused}
            className="w-full py-4 rounded-2xl font-display text-lg tracking-wide text-white bg-gradient-to-r from-blood-700 via-blood to-blood-700 active:scale-[0.97] transition-transform disabled:opacity-30 disabled:cursor-not-allowed"
          >
            狼人自曝
          </button>
        </div>
      )}

      {/* Waiting for speaker */}
      {isSpeakingPhase && !isMyTurn && currentSpeakerId && (
        <div className="px-4 pb-safe pt-2 pb-4 relative z-20">
          <div className="glass-dark rounded-2xl p-4 text-center">
            <div className="flex items-center justify-center gap-2">
              <div className="w-2 h-2 rounded-full bg-gold animate-breathe" />
              <span className="text-moon-dim text-sm">
                等待 <span className="text-moon font-medium">{room.players.find(p => p.id === currentSpeakerId)?.name}</span> {isLastWordsPhase ? '遗言' : '发言'}...
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Action Bar (夜间/投票) */}
      {canAct() && !isSpeakingPhase && (
        <div className="px-4 pb-safe pt-2 pb-4 relative z-20 animate-slide-in-bottom">
          <div className="glass-dark rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-moon-dim tracking-wider">
                {isWolfPhase ? '狼人投票' : `${getActionName()}目标`}
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
              {roleHasAbility(myRole, RoleAbility.WITCH_SAVE) && currentPhase === GamePhase.NIGHT_WITCH && (
                <button
                  onClick={() => confirmThen({
                    title: '使用解药',
                    message: '确认使用解药？解药每局只能使用一次。',
                    confirmLabel: '确认救人',
                    tone: 'safe'
                  }, witchSave)}
                  disabled={isPaused}
                  className="px-5 py-3.5 rounded-xl bg-gradient-to-r from-heal-dark to-heal text-white font-display text-sm shrink-0 active:scale-95 transition-transform disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  解药 💊
                </button>
              )}

              {currentPhase === GamePhase.NIGHT_WITCH && (
                <button
                  onClick={witchPass}
                  disabled={isPaused}
                  className="px-5 py-3.5 rounded-xl glass text-moon-dim font-display text-sm shrink-0 active:scale-95 transition-transform disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  跳过
                </button>
              )}

              {/* 狼人投票：确认按钮 */}
              {isWolfPhase && isWolf && (
                <>
                  {hasConfirmedWolfVote ? (
                    <div className="flex-1 py-3.5 rounded-xl font-display text-base text-heal-400 text-center glass">
                      已确认投票 → {room.players.find(p => p.id === myWolfVote)?.name}
                    </div>
                  ) : (
                    <button
                      onClick={handleAction}
                      disabled={isPaused || !selectedTarget}
                      className={`flex-1 py-3.5 rounded-xl font-display text-base tracking-wide text-white transition-all duration-200 active:scale-[0.97] disabled:opacity-20 disabled:cursor-not-allowed bg-gradient-to-r ${getActionColor()}`}
                    >
                      {myWolfSelection === selectedTarget ? '确认投票' : '选择'} {selectedTarget ? room.players.find(p => p.id === selectedTarget)?.name : ''}
                    </button>
                  )}
                </>
              )}

              {/* 非狼人阶段的通用按钮 */}
              {!(isWolfPhase && isWolf) && (
                <>
                  {currentPhase === GamePhase.DAY_VOTE && (
                    <button
                      onClick={abstainVote}
                      disabled={isPaused || hasCompletedVote}
                      className="px-5 py-3.5 rounded-xl glass text-moon-dim font-display text-sm shrink-0 active:scale-95 transition-transform disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      弃票
                    </button>
                  )}
                  {currentPhase === GamePhase.HUNTER_SHOOT && (
                    <button
                      onClick={() => confirmThen({
                        title: '放弃开枪',
                        message: '确认不开枪？确认后将继续游戏流程。',
                        confirmLabel: '不开枪',
                        tone: 'safe'
                      }, hunterPass)}
                      disabled={isPaused}
                      className="px-5 py-3.5 rounded-xl glass text-moon-dim font-display text-sm shrink-0 active:scale-95 transition-transform disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      不开枪
                    </button>
                  )}
                  <button
                    onClick={handleAction}
                    disabled={isPaused || !selectedTarget || (currentPhase === GamePhase.DAY_VOTE && hasCompletedVote)}
                    className={`flex-1 py-3.5 rounded-xl font-display text-base tracking-wide text-white transition-all duration-200 active:scale-[0.97] disabled:opacity-20 disabled:cursor-not-allowed bg-gradient-to-r ${getActionColor()}`}
                  >
                    {currentPhase === GamePhase.DAY_VOTE && hasCompletedVote
                      ? '已完成投票'
                      : `${getActionName()} ${selectedTarget ? room.players.find(p => p.id === selectedTarget)?.name : ''}`}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Dead overlay */}
      {!isAlive && currentPhase !== GamePhase.GAME_OVER && !canAct() && (
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
                      player.role !== null && isWolfRole(player.role)
                        ? 'bg-blood/20 text-blood-400'
                        : 'bg-heal/20 text-heal-400'
                    }`}>
                      {player.name.charAt(0)}
                    </div>
                    <span className={`flex-1 text-sm ${player.status === 'dead' ? 'line-through text-moon-mist' : ''}`}>
                      {player.name}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      player.role !== null && isWolfRole(player.role)
                        ? 'bg-blood/20 text-blood-400'
                        : 'bg-heal/20 text-heal-400'
                    }`}>
                      {player.role ? ROLES[player.role].name : ''}
                    </span>
                  </div>
                ))}
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

            <button
              onClick={isHost ? resetRoom : leaveRoom}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-blood-700 via-blood to-blood-700 text-white font-display text-lg tracking-wide active:scale-[0.97] transition-transform"
            >
              {isHost ? '重新开局' : '离开房间'}
            </button>
          </div>
        </div>
      )}

      {/* Paused overlay */}
      {isPaused && currentPhase !== GamePhase.GAME_OVER && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-6 bg-forest/90 backdrop-blur-md animate-fade-in">
          <div className="glass-dark rounded-3xl p-6 w-full max-w-xs text-center animate-moonrise">
            <div className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-gold/15 text-gold flex items-center justify-center font-display text-2xl">
              ||
            </div>
            <h3 className="font-display text-2xl text-moon mb-2">游戏已暂停</h3>
            <p className="text-sm text-moon-dim leading-relaxed">
              等待房主恢复游戏
            </p>
            {gameState.remainingMs !== null && (
              <div className="mt-4 text-xs text-moon-mist">
                当前阶段剩余 {Math.ceil(gameState.remainingMs / 1000)}s
              </div>
            )}
            {isHost && (
              <button
                onClick={resumeGame}
                className="mt-5 w-full py-3.5 rounded-xl bg-gradient-to-r from-heal-dark to-heal text-white font-display text-base active:scale-[0.97] transition-transform"
              >
                恢复游戏
              </button>
            )}
          </div>
        </div>
      )}

      {/* Vote history drawer */}
      {voteHistoryOpen && (
        <div
          className="fixed inset-0 z-[58] flex items-end bg-black/55 backdrop-blur-sm animate-fade-in"
          onClick={() => setVoteHistoryOpen(false)}
        >
          <div
            className="w-full max-h-[72dvh] rounded-t-3xl glass-dark p-4 overflow-y-auto animate-slide-in-bottom"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <div className="text-[10px] text-moon-dim tracking-widest">历史投票</div>
                <div className="font-display text-lg text-moon">{sortedVoteHistory.length}轮记录</div>
              </div>
              <button
                onClick={() => setVoteHistoryOpen(false)}
                className="w-9 h-9 rounded-full glass flex items-center justify-center text-moon-dim active:scale-95 transition-transform"
                aria-label="关闭历史投票"
              >
                ×
              </button>
            </div>

            <div className="space-y-3">
              {sortedVoteHistory.map(entry => {
                const voteRows = Object.entries(entry.votes).sort(([a], [b]) => {
                  const playerA = room.players.find(player => player.id === a);
                  const playerB = room.players.find(player => player.id === b);
                  return (playerA ? getPlayerNumber(playerA) : 999) - (playerB ? getPlayerNumber(playerB) : 999);
                });
                return (
                  <div key={entry.day} className="rounded-2xl bg-forest-50/40 border border-white/[0.04] p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="font-display text-sm text-moon">第{entry.day}天投票</div>
                      <div className={`text-[10px] px-2 py-0.5 rounded-full border ${
                        entry.eliminated
                          ? 'bg-blood/15 text-blood-400 border-blood/20'
                          : entry.isTie
                          ? 'bg-gold/10 text-gold border-gold/20'
                          : 'bg-white/[0.04] text-moon-mist border-white/[0.04]'
                      }`}>
                        {entry.eliminated ? `${getPlayerName(entry.eliminated)} 出局` : entry.isTie ? '平票无人出局' : '无人出局'}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      {voteRows.map(([voterId, targetId]) => (
                        <div key={voterId} className="flex items-center gap-2 text-xs">
                          <span className="w-24 shrink-0 text-moon truncate">{getPlayerName(voterId)}</span>
                          <span className="text-moon-mist">→</span>
                          <span className={targetId ? 'text-moon-dim truncate' : 'text-gold'}>
                            {getVoteTargetName(targetId)}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="mt-2 pt-2 border-t border-white/[0.04] flex flex-wrap gap-1.5">
                      {Object.entries(entry.voteCount)
                        .sort((a, b) => b[1] - a[1])
                        .map(([targetId, count]) => (
                          <span key={targetId} className="text-[10px] px-2 py-0.5 rounded-lg bg-white/[0.04] text-moon-mist">
                            {getPlayerName(targetId)} {count}票
                          </span>
                        ))}
                      {entry.abstained > 0 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-lg bg-gold/10 text-gold">
                          弃票 {entry.abstained}票
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Confirm modal */}
      {pendingConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="glass-dark rounded-3xl p-5 w-full max-w-xs animate-moonrise">
            <div className="text-center mb-4">
              <div className={`mx-auto mb-3 w-11 h-11 rounded-full flex items-center justify-center text-xl ${
                pendingConfirm.tone === 'danger' ? 'bg-blood/20 text-blood-400' : 'bg-heal/20 text-heal-400'
              }`}>
                {pendingConfirm.tone === 'danger' ? '!' : '✓'}
              </div>
              <h3 className="font-display text-xl text-moon mb-2">{pendingConfirm.title}</h3>
              <p className="text-sm text-moon-dim leading-relaxed">{pendingConfirm.message}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPendingConfirm(null)}
                className="flex-1 py-3 rounded-xl glass text-moon-dim text-sm active:scale-[0.97] transition-transform"
              >
                取消
              </button>
              <button
                onClick={pendingConfirm.run}
                className={`flex-1 py-3 rounded-xl text-white font-display text-sm active:scale-[0.97] transition-transform ${
                  pendingConfirm.tone === 'danger'
                    ? 'bg-gradient-to-r from-blood-700 to-blood'
                    : 'bg-gradient-to-r from-heal-dark to-heal'
                }`}
              >
                {pendingConfirm.confirmLabel}
              </button>
            </div>
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
