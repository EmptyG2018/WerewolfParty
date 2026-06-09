import { useState, useEffect } from 'react';
import { useGameStore } from '../stores/gameStore';
import { GamePhase, PublicDeathReason, ReviewEvent, Role, RoleAbility, ROLES, isWolfRole, roleHasAbility } from '@werewolf/shared';
import { ConfirmDialog, PendingConfirm } from './game/ConfirmDialog';
import { GuardActionPanel } from './game/GuardActionPanel';
import { HunterActionPanel } from './game/HunterActionPanel';
import { PhaseHeader } from './game/PhaseHeader';
import { PhaseTransitionOverlay } from './game/PhaseTransitionOverlay';
import { PhaseResultPanel } from './game/PhaseResultPanel';
import { PlayerSeatGrid } from './game/PlayerSeatGrid';
import { ReviewDrawer, ReviewFilter } from './game/ReviewDrawer';
import { SeerActionPanel } from './game/SeerActionPanel';
import { ToastLayer } from './game/ToastLayer';
import { VoteActionPanel } from './game/VoteActionPanel';
import { WerewolfActionPanel } from './game/WerewolfActionPanel';
import { WitchActionPanel } from './game/WitchActionPanel';

export function Game() {
  const {
    room, myId, myRole, gameState, speaking, seerResult, witchInfo, skillState, error,
    roleConfirmed, confirmedPlayers, wolfVotes, wolfSelections, wolfTeam, deathEvents, voteResult, revealedPlayers,
    confirmRole, werewolfKill, wolfConfirmVote, seerCheck, witchSave, witchPoison, guardProtect,
    vote, speakingDone, hunterShoot, wolfKingShoot, wolfSelfReveal, whiteWolfKingExplode, witchPass,
    abstainVote, pauseGame, resumeGame, resetRoom, leaveRoom, setSeerResult, hunterPass
  } = useGameStore();

  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [transitionPhase, setTransitionPhase] = useState<GamePhase | null>(null);
  const [voteHistoryOpen, setVoteHistoryOpen] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all');

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
      gameState.phase === GamePhase.GAME_OVER
    ) return;
    setTransitionPhase(gameState.phase);
    const timeout = setTimeout(() => setTransitionPhase(null), 1200);
    return () => clearTimeout(timeout);
  }, [gameState?.phase]);

  useEffect(() => {
    setSelectedTarget(null);
    setPendingConfirm(null);
  }, [gameState?.phase]);

  useEffect(() => {
    if (!gameState || gameState.phase !== GamePhase.NIGHT_WEREWOLF || !myId) return;
    if (Object.prototype.hasOwnProperty.call(wolfVotes, myId)) return;
    const restoredSelection = wolfSelections[myId];
    if (!restoredSelection) return;
    setSelectedTarget(current => current ?? restoredSelection);
  }, [gameState?.phase, myId, wolfSelections, wolfVotes]);

  if (!room || !gameState || !myRole) return null;

  const myPlayer = room.players.find(p => p.id === myId);
  const isAlive = myPlayer?.status === 'alive';
  const currentPhase = gameState.phase;
  const isNight = currentPhase.startsWith('night_');
  const isHost = room.hostId === myId;
  const isPaused = gameState.paused;
  const getPlayerNumber = (player: { seatIndex: number }) => player.seatIndex + 1;

  const getPlayerName = (playerId: string | null) => {
    if (!playerId) return '无人';
    const player = room.players.find(p => p.id === playerId);
    return player ? `${getPlayerNumber(player)}号 ${player.name}` : '未知玩家';
  };

  const getPlayerNumberById = (playerId: string) => {
    const player = room.players.find(p => p.id === playerId);
    return player ? getPlayerNumber(player) : 999;
  };

  const getDeathReasonName = (reason: PublicDeathReason) => {
    const names: Record<PublicDeathReason, string> = {
      night: '夜间死亡',
      voted: '投票放逐',
      skill: '技能带走',
      self_exposed: '自曝出局',
      exploded: '自曝带走'
    };
    return names[reason];
  };

  const getDeathReasonClass = (reason: PublicDeathReason) => {
    switch (reason) {
      case 'night': return 'bg-blood/15 text-blood-400 border-blood/20';
      case 'voted': return 'bg-gold/15 text-gold border-gold/20';
      case 'skill': return 'bg-amber-500/15 text-amber-300 border-amber-500/20';
      case 'self_exposed': return 'bg-blood/20 text-blood-300 border-blood/30';
      case 'exploded': return 'bg-purple-500/15 text-purple-300 border-purple-500/20';
    }
  };

  const getRevealedRoleName = (playerId?: string | null) => {
    if (!playerId || currentPhase !== GamePhase.GAME_OVER || !revealedPlayers) return null;
    const role = revealedPlayers.find(player => player.id === playerId)?.role;
    return role ? ROLES[role].name : null;
  };

  const formatPlayerWithRole = (playerId?: string | null) => {
    const playerName = getPlayerName(playerId ?? null);
    const roleName = getRevealedRoleName(playerId);
    return roleName ? `${roleName} ${playerName}` : playerName;
  };

  const getReviewPlayerName = (playerId: string | null) => {
    if (playerId === null) return '弃票';
    return formatPlayerWithRole(playerId);
  };

  const getReviewSummary = (event: ReviewEvent) => {
    switch (event.type) {
      case 'night_result': {
        const deaths = event.deaths ?? [];
        if (deaths.length === 0) return '平安夜';
        return `${deaths.map(death => getReviewPlayerName(death.playerId)).join('、')} 夜间死亡`;
      }
      case 'vote_result':
        if (event.eliminated) return `${getReviewPlayerName(event.eliminated)} 被投票放逐`;
        return event.isTie ? '平票，无人出局' : '无人出局';
      case 'self_reveal':
        return `${formatPlayerWithRole(event.actorId)} 自曝出局，白天流程中断`;
      case 'self_reveal_take':
        return `${formatPlayerWithRole(event.actorId)} 自曝带走 ${getReviewPlayerName(event.targetId ?? null)}，白天流程中断`;
      case 'skill_take': {
        const actorRole = getRevealedRoleName(event.actorId);
        const actor = formatPlayerWithRole(event.actorId);
        const target = getReviewPlayerName(event.targetId ?? null);
        if (actorRole === ROLES[Role.HUNTER].name || actorRole === ROLES[Role.WOLF_KING].name) {
          return `${actor} 开枪带走 ${target}`;
        }
        return `${actor} 发动技能带走 ${target}`;
      }
      case 'skill_pass':
        return `${formatPlayerWithRole(event.actorId)} 选择不发动技能`;
    }
  };

  const getReviewFilter = (event: ReviewEvent): ReviewFilter => {
    if (event.type === 'night_result') return 'night';
    if (event.type === 'vote_result') return 'vote';
    return 'skill';
  };

  const getReviewTagName = (event: ReviewEvent) => {
    if (event.type === 'night_result') return '夜晚';
    if (event.type === 'vote_result') return '投票';
    if (event.type === 'self_reveal' || event.type === 'self_reveal_take') return '自曝';
    return '技能';
  };

  const getReviewTagClass = (event: ReviewEvent) => {
    if (event.type === 'night_result') return 'bg-blood/15 text-blood-400 border-blood/20';
    if (event.eliminated) return 'bg-blood/15 text-blood-400 border-blood/20';
    if (event.isTie) return 'bg-gold/10 text-gold border-gold/20';
    if (event.interrupted) return 'bg-purple-500/15 text-purple-300 border-purple-500/20';
    return 'bg-white/[0.04] text-moon-mist border-white/[0.04]';
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

  // 狼人是否已确认投票
  const myWolfVote = myId ? wolfVotes[myId] : undefined;
  const myWolfSelection = myId ? wolfSelections[myId] : undefined;
  const hasConfirmedWolfVote = myId ? Object.prototype.hasOwnProperty.call(wolfVotes, myId) : false;
  const witchKilledTargetName = witchInfo ? getPlayerName(witchInfo.killedPlayerId) : null;
  const witchSaveAvailable = skillState?.witch?.saveAvailable ?? true;
  const witchPoisonAvailable = skillState?.witch?.poisonAvailable ?? true;
  const lastGuardTargetId = skillState?.guard?.lastGuardTargetId ?? null;
  const canSelfReveal = !isPaused && isAlive && roleHasAbility(myRole, RoleAbility.WOLF_SELF_REVEAL)
    && (currentPhase === GamePhase.DAY_SPEAKING || currentPhase === GamePhase.DAY_VOTE);
  const canWhiteWolfKingExplode = !isPaused && isAlive && roleHasAbility(myRole, RoleAbility.WHITE_WOLF_KING_EXPLODE)
    && currentPhase === GamePhase.DAY_VOTE;

  const selectTarget = (targetId: string, isSelected: boolean) => {
    if (isWolfPhase && isWolf) {
      if (hasConfirmedWolfVote) return;
      setSelectedTarget(targetId);
      if (myWolfSelection !== targetId) {
        werewolfKill(targetId);
      }
      return;
    }

    setSelectedTarget(isSelected ? null : targetId);
  };

  const handleAction = () => {
    if (!selectedTarget) return;
    const targetName = getPlayerName(selectedTarget);
    switch (currentPhase) {
      case GamePhase.NIGHT_WEREWOLF:
        if (roleHasAbility(myRole, RoleAbility.WEREWOLF_KILL)) {
          confirmThen({
            title: '确认狼刀',
            message: `确认将 ${targetName} 作为你的最终刀票？确认后本轮不能修改。`,
            confirmLabel: '确认刀杀',
            tone: 'danger'
          }, wolfConfirmVote);
        }
        return;
      case GamePhase.NIGHT_SEER:
        if (roleHasAbility(myRole, RoleAbility.SEER_CHECK)) seerCheck(selectedTarget);
        break;
      case GamePhase.NIGHT_WITCH:
        if (roleHasAbility(myRole, RoleAbility.WITCH_POISON) && witchPoisonAvailable) {
          confirmThen({
            title: '使用毒药',
            message: `确认毒杀 ${targetName}？毒药每局只能使用一次。`,
            confirmLabel: '确认毒杀',
            tone: 'danger'
          }, () => witchPoison(selectedTarget));
        }
        return;
      case GamePhase.NIGHT_GUARD:
        if (roleHasAbility(myRole, RoleAbility.GUARD_PROTECT) && selectedTarget !== lastGuardTargetId) guardProtect(selectedTarget);
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
      title: '自曝带走',
      message: `确认自曝并带走 ${targetName}？发动后你会出局，并中断白天流程直接进入下一夜。`,
      confirmLabel: '自曝带走',
      tone: 'danger'
    }, () => whiteWolfKingExplode(selectedTarget));
  };

  const handleAbstainVote = () => {
    setSelectedTarget(null);
    abstainVote();
  };

  const handleWitchPass = () => {
    setSelectedTarget(null);
    witchPass();
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
  const hasCompletedVote = myId ? Object.prototype.hasOwnProperty.call(gameState.votes, myId) : false;
  const reviewEvents = gameState.reviewEvents ?? [];
  const sortedReviewEvents = [...reviewEvents].sort((a, b) => a.timestamp - b.timestamp);
  const filteredReviewEvents = sortedReviewEvents.filter(event =>
    reviewFilter === 'all' || getReviewFilter(event) === reviewFilter
  );
  const groupedReviewEvents = filteredReviewEvents.reduce<Array<{ day: number; events: ReviewEvent[] }>>((groups, event) => {
    const existingGroup = groups.find(group => group.day === event.day);
    if (existingGroup) {
      existingGroup.events.push(event);
    } else {
      groups.push({ day: event.day, events: [event] });
    }
    return groups;
  }, []);
  const reviewFilterOptions: Array<{ value: ReviewFilter; label: string }> = [
    { value: 'all', label: '全部' },
    { value: 'night', label: '夜晚' },
    { value: 'vote', label: '投票' },
    { value: 'skill', label: '技能' }
  ];

  return (
    <div className={`flex flex-col min-h-dvh relative transition-colors duration-1000 ${
      isNight ? 'bg-forest' : 'bg-forest'
    }`}>
      <PhaseTransitionOverlay phase={transitionPhase} />

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

      <PhaseHeader
        day={gameState.day}
        phase={currentPhase}
        isNight={isNight}
        isHost={isHost}
        isPaused={isPaused}
        myRole={myRole}
        onPause={pauseGame}
        onResume={resumeGame}
      />

      <PhaseResultPanel
        phase={currentPhase}
        isGameOver={currentPhase === GamePhase.GAME_OVER}
        currentDayDeaths={currentDayDeaths}
        voteResult={voteResult}
        sortedVoteResult={sortedVoteResult}
        getPlayerName={getPlayerName}
        getDeathReasonName={getDeathReasonName}
        getDeathReasonClass={getDeathReasonClass}
      />

      {/* Review entry */}
      {sortedReviewEvents.length > 0 && currentPhase !== GamePhase.GAME_OVER && (
        <div className="px-4 py-1.5 relative z-10">
          <button
            onClick={() => setVoteHistoryOpen(true)}
            className="w-full glass-dark rounded-xl px-4 py-3 flex items-center justify-between gap-3 active:scale-[0.99] transition-transform"
          >
            <span className="text-[10px] text-moon-dim tracking-wider">复盘记录</span>
            <span className="text-xs text-moon">
              {sortedReviewEvents.length}条
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

      <PlayerSeatGrid
        room={room}
        myId={myId}
        myRole={myRole}
        phase={currentPhase}
        selectedTarget={selectedTarget}
        speaking={speaking}
        isSpeakingPhase={isSpeakingPhase}
        currentSpeakerId={currentSpeakerId}
        isWolf={isWolf}
        isWolfPhase={isWolfPhase}
        isAlive={!!isAlive}
        wolfTeam={wolfTeam}
        wolfSelections={wolfSelections}
        wolfVotes={wolfVotes}
        lastGuardTargetId={lastGuardTargetId}
        hasCompletedVote={hasCompletedVote}
        canSelectTarget={canSelectTarget()}
        onSelectTarget={selectTarget}
        getPlayerName={getPlayerName}
        getPlayerNumber={getPlayerNumber}
        getDeathReasonName={getDeathReasonName}
        getLatestDeath={getLatestDeath}
      />

      {/* Seer Result Modal */}
      {roleHasAbility(myRole, RoleAbility.SEER_CHECK) && seerResult && seerResult.day === gameState.day && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="glass-dark rounded-3xl p-6 w-full max-w-xs text-center animate-moonrise">
            <div className="text-4xl mb-4">🔮</div>
            <h3 className="font-display text-xl mb-2">查验结果</h3>
            <div className="text-[10px] text-moon-dim tracking-widest mb-2">第 {seerResult.day} 天查验</div>
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
              自曝带走
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

      {canAct() && !isSpeakingPhase && isWolfPhase && isWolf && (
        <WerewolfActionPanel
          isPaused={isPaused}
          selectedTarget={selectedTarget}
          myWolfVote={myWolfVote}
          myWolfSelection={myWolfSelection}
          hasConfirmedWolfVote={hasConfirmedWolfVote}
          onConfirm={handleAction}
          getPlayerName={getPlayerName}
        />
      )}

      {canAct() && !isSpeakingPhase && currentPhase === GamePhase.NIGHT_SEER && (
        <SeerActionPanel
          isPaused={isPaused}
          selectedTarget={selectedTarget}
          onCheck={handleAction}
          getPlayerName={getPlayerName}
        />
      )}

      {canAct() && !isSpeakingPhase && currentPhase === GamePhase.DAY_VOTE && (
        <VoteActionPanel
          isPaused={isPaused}
          selectedTarget={selectedTarget}
          hasCompletedVote={hasCompletedVote}
          onVote={handleAction}
          onAbstain={handleAbstainVote}
          getPlayerName={getPlayerName}
        />
      )}

      {canAct() && !isSpeakingPhase && currentPhase === GamePhase.NIGHT_WITCH && (
        <WitchActionPanel
          isPaused={isPaused}
          selectedTarget={selectedTarget}
          killedPlayerId={witchInfo?.killedPlayerId ?? null}
          saveAvailable={witchSaveAvailable}
          poisonAvailable={witchPoisonAvailable}
          canSave={roleHasAbility(myRole, RoleAbility.WITCH_SAVE)}
          canPoison={roleHasAbility(myRole, RoleAbility.WITCH_POISON)}
          onSave={() => confirmThen({
            title: '使用解药',
            message: `确认救 ${witchKilledTargetName ?? '被袭击玩家'}？解药每局只能使用一次。`,
            confirmLabel: '确认救人',
            tone: 'safe'
          }, witchSave)}
          onPoison={handleAction}
          onPass={handleWitchPass}
          getPlayerName={getPlayerName}
        />
      )}

      {canAct() && !isSpeakingPhase && currentPhase === GamePhase.NIGHT_GUARD && (
        <GuardActionPanel
          isPaused={isPaused}
          selectedTarget={selectedTarget}
          lastGuardTargetId={lastGuardTargetId}
          onProtect={handleAction}
          getPlayerName={getPlayerName}
        />
      )}

      {canAct() && !isSpeakingPhase && (currentPhase === GamePhase.HUNTER_SHOOT || currentPhase === GamePhase.WOLF_KING_SHOOT) && (
        <HunterActionPanel
          isPaused={isPaused}
          selectedTarget={selectedTarget}
          canPass={currentPhase === GamePhase.HUNTER_SHOOT}
          onShoot={handleAction}
          onPass={() => confirmThen({
            title: '放弃发动',
            message: '确认不发动技能？确认后将继续游戏流程。',
            confirmLabel: '不发动',
            tone: 'safe'
          }, hunterPass)}
          getPlayerName={getPlayerName}
        />
      )}

      {/* Safe public resolving state for hidden death-skill windows */}
      {currentPhase === GamePhase.DAY_RESOLVING && !isPaused && (
        <div className="px-4 pb-safe pt-2 pb-4 relative z-20">
          <div className="glass-dark rounded-2xl p-4 text-center">
            <div className="flex items-center justify-center gap-2">
              <div className="w-2 h-2 rounded-full bg-gold animate-breathe" />
              <span className="text-moon-dim text-sm">正在结算，请稍候</span>
              {gameState.phaseTimer > 0 && (
                <span className="text-gold font-display text-sm">{gameState.phaseTimer}s</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Dead overlay */}
      {!isAlive && currentPhase !== GamePhase.DAY_RESOLVING && currentPhase !== GamePhase.GAME_OVER && !canAct() && (
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
                {(revealedPlayers ?? room.players).map((player) => (
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

            {sortedReviewEvents.length > 0 && (
              <button
                onClick={() => setVoteHistoryOpen(true)}
                className="w-full mb-3 py-3 rounded-2xl glass text-moon font-display text-base active:scale-[0.97] transition-transform"
              >
                查看复盘记录
              </button>
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

      <ReviewDrawer
        open={voteHistoryOpen}
        totalCount={sortedReviewEvents.length}
        groupedEvents={groupedReviewEvents}
        filter={reviewFilter}
        filterOptions={reviewFilterOptions}
        onFilterChange={setReviewFilter}
        onClose={() => setVoteHistoryOpen(false)}
        getPlayerNumberById={getPlayerNumberById}
        getPlayerName={getReviewPlayerName}
        getVoteTargetName={getReviewPlayerName}
        getReviewSummary={getReviewSummary}
        getReviewTagName={getReviewTagName}
        getReviewTagClass={getReviewTagClass}
        getDeathReasonName={getDeathReasonName}
        getDeathReasonClass={getDeathReasonClass}
      />

      <ConfirmDialog confirm={pendingConfirm} onCancel={() => setPendingConfirm(null)} />
      <ToastLayer message={error} />
    </div>
  );
}
