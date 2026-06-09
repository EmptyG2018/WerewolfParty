import { GamePhase, PublicDeathReason, Role, RoleAbility, ROLES, SpeakingState, roleHasAbility } from '@werewolf/shared';
import { PublicRoom } from '@werewolf/shared';
import { DeathEvent } from '../../stores/gameStore';

interface PlayerSeatGridProps {
  room: PublicRoom;
  myId: string | null;
  myRole: Role;
  phase: GamePhase;
  selectedTarget: string | null;
  speaking: SpeakingState | null;
  isSpeakingPhase: boolean;
  currentSpeakerId: string | undefined;
  isWolf: boolean;
  isWolfPhase: boolean;
  isAlive: boolean;
  wolfTeam: string[];
  wolfSelections: Record<string, string>;
  wolfVotes: Record<string, string>;
  lastGuardTargetId: string | null;
  hasCompletedVote: boolean;
  canSelectTarget: boolean;
  onSelectTarget: (targetId: string, isSelected: boolean) => void;
  getPlayerName: (playerId: string | null) => string;
  getPlayerNumber: (player: { seatIndex: number }) => number;
  getDeathReasonName: (reason: PublicDeathReason) => string;
  getLatestDeath: (playerId: string) => DeathEvent | undefined;
}

export function PlayerSeatGrid({
  room,
  myId,
  myRole,
  phase,
  selectedTarget,
  speaking,
  isSpeakingPhase,
  currentSpeakerId,
  isWolf,
  isWolfPhase,
  isAlive,
  wolfTeam,
  wolfSelections,
  wolfVotes,
  lastGuardTargetId,
  hasCompletedVote,
  canSelectTarget,
  onSelectTarget,
  getPlayerName,
  getPlayerNumber,
  getDeathReasonName,
  getLatestDeath
}: PlayerSeatGridProps) {
  const wolfTargetCounts = Object.values(wolfVotes).reduce<Record<string, number>>((counts, targetId) => {
    counts[targetId] = (counts[targetId] || 0) + 1;
    return counts;
  }, {});
  const wolfTopVotes = Math.max(0, ...Object.values(wolfTargetCounts));
  const wolfTopTargets = Object.entries(wolfTargetCounts)
    .filter(([, count]) => count === wolfTopVotes && count > 0)
    .map(([targetId]) => targetId);

  return (
    <div className="flex-1 px-4 pb-2 relative z-10 overflow-hidden">
      <div className="h-full overflow-y-auto pb-4">
        <div className="grid grid-cols-2 gap-2 stagger-children">
          {room.players.map((player) => {
            const isDead = player.status === 'dead';
            const isSelected = player.id === selectedTarget;
            const isMe = player.id === myId;
            const isWolfTeamTarget = wolfTeam.includes(player.id);
            const wolfTargetAllowed = !isWolfPhase || !isWolf || room.config.allowWolfFriendlyFire || !isWolfTeamTarget;
            const canTargetSelf = isWolfPhase && isWolf && room.config.allowWolfFriendlyFire;
            const isGuardRepeatTarget = phase === GamePhase.NIGHT_GUARD &&
              roleHasAbility(myRole, RoleAbility.GUARD_PROTECT) &&
              player.id === lastGuardTargetId;
            const isVoteLocked = phase === GamePhase.DAY_VOTE && hasCompletedVote;
            const isTargetable = !isDead && !isVoteLocked && !isGuardRepeatTarget && wolfTargetAllowed && (canTargetSelf || !isMe) && canSelectTarget;
            const isOffline = !player.online;
            const isCurrentSpeaker = isSpeakingPhase && player.id === currentSpeakerId;
            const hasPlayerSpoken = speaking?.confirmed.includes(player.id) ?? false;
            const latestDeath = getLatestDeath(player.id);

            const wolfPendingSelectionsOnThis = isWolf && isWolfPhase
              ? Object.entries(wolfSelections)
                .filter(([wolfId, tid]) => tid === player.id && !Object.prototype.hasOwnProperty.call(wolfVotes, wolfId))
                .map(([wolfId]) => wolfId)
              : [];
            const wolfVotesOnThis = isWolf && isWolfPhase
              ? Object.entries(wolfVotes).filter(([, tid]) => tid === player.id).map(([wolfId]) => wolfId)
              : [];
            const myPendingSelectionOnThis = myId ? wolfPendingSelectionsOnThis.includes(myId) : false;
            const myConfirmedVoteOnThis = myId ? wolfVotesOnThis.includes(myId) : false;

            return (
              <button
                key={player.id}
                onClick={() => isTargetable && onSelectTarget(player.id, isSelected)}
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
                {wolfVotesOnThis.length > 0 && (
                  <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-blood flex items-center justify-center">
                    <span className="text-[9px] text-white font-bold">{wolfVotesOnThis.length}</span>
                  </div>
                )}

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
                      : isGuardRepeatTarget
                      ? '上晚已守护'
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
                  {isWolf && isWolfPhase && (wolfPendingSelectionsOnThis.length > 0 || wolfVotesOnThis.length > 0) && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {wolfPendingSelectionsOnThis.length > 0 && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                          myPendingSelectionOnThis
                            ? 'bg-gold/20 text-gold'
                            : 'bg-white/[0.06] text-moon-mist'
                        }`}>
                          {myPendingSelectionOnThis ? '我已选' : '狼队选择'}×{wolfPendingSelectionsOnThis.length}
                        </span>
                      )}
                      {wolfVotesOnThis.length > 0 && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                          myConfirmedVoteOnThis
                            ? 'bg-heal/20 text-heal-400'
                            : 'bg-blood/15 text-blood-400'
                        }`}>
                          {myConfirmedVoteOnThis ? '我已确认' : '已确认'}×{wolfVotesOnThis.length}
                        </span>
                      )}
                    </div>
                  )}
                </div>

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

        {isWolf && isWolfPhase && isAlive && (
          <div className="mt-3 glass-dark rounded-xl px-3 py-2.5">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs">🐺</span>
              <span className="text-[10px] text-blood-400 tracking-wider">狼队投票</span>
              <span className="ml-auto text-[10px] text-moon-dim">
                {Object.keys(wolfVotes).length}/{room.players.filter(p => wolfTeam.includes(p.id) && p.status === 'alive').length} 已确认
              </span>
            </div>
            {!room.config.allowWolfFriendlyFire && (
              <div className="mb-2 rounded-lg bg-white/[0.04] border border-white/[0.06] px-2 py-1.5">
                <div className="text-[10px] text-moon-mist">
                  当前规则：只能刀存活非狼人
                </div>
              </div>
            )}
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
  );
}
