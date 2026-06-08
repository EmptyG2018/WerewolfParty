import { Role } from './roles';

export enum GamePhase {
  WAITING = 'waiting',
  // 发牌后先让每个客户端确认身份，避免直接入夜导致玩家没看到角色。
  ROLE_CONFIRM = 'role_confirm',
  NIGHT_WEREWOLF = 'night_werewolf',
  NIGHT_SEER = 'night_seer',
  NIGHT_WITCH = 'night_witch',
  NIGHT_GUARD = 'night_guard',
  DAY_ANNOUNCE = 'day_announce',
  DAY_RESOLVING = 'day_resolving',
  DAY_SPEAKING = 'day_speaking',
  // 被白天投票放逐的玩家遗言阶段；技能击杀当前实现不进入遗言。
  DAY_VOTE = 'day_vote',
  LAST_WORDS = 'last_words',
  // 狼人/白狼王白天自曝后中断当天流程，短暂停留后直接进入下一夜。
  DAY_SELF_REVEAL = 'day_self_reveal',
  HUNTER_SHOOT = 'hunter_shoot',
  WOLF_KING_SHOOT = 'wolf_king_shoot',
  GAME_OVER = 'game_over'
}

export interface Player {
  id: string;
  // sessionId 是稳定玩家身份；socket 断线重连后可能变化，但玩家 id 保持为 sessionId。
  sessionId: string;
  name: string;
  roomId: string;
  playerNumber: number;        // 稳定玩家编号（1-based，不随座位变化）
  seatIndex: number;           // 座位号（0-based，显示时 +1）
  role: Role | null;
  status: 'alive' | 'dead';
  online: boolean;
  isHost: boolean;
  voteTarget: string | null;
  skillUsed: {
    witchSave: boolean;
    witchPoison: boolean;
    lastGuardTarget: string | null;
  };
}

export type PublicPlayer = Omit<Player, 'role'> & {
  role: null;
};

/** 座位交换请求 */
export interface SeatSwapRequest {
  fromId: string;              // 发起者 socketId
  fromSeat: number;
  targetSeat: number;
  targetId: string | null;     // 目标玩家 socketId，null 表示空座
}

export interface NightAction {
  playerId: string;
  role: Role;
  action: string;
  targetId: string;
  timestamp: number;
}

export interface DeadPlayer {
  playerId: string;
  // 死亡原因会影响后续结算，例如猎人只在被狼人击杀/投票放逐时进入开枪流程。
  reason: DeathReason;
  day: number;
}

export type DeathReason = 'killed' | 'voted' | 'poisoned' | 'shot' | 'self_exposed' | 'exploded';
export type PublicDeathReason = 'night' | 'voted' | 'shot' | 'self_exposed' | 'exploded';

export interface PublicDeadPlayer {
  playerId: string;
  reason: PublicDeathReason;
  day: number;
}

export interface SystemMessage {
  id: string;
  content: string;
  timestamp: number;
}

export interface SpeakingState {
  // 发言顺序保存玩家 id，服务端按 currentIndex 推进，客户端只负责展示和确认。
  order: string[];
  currentIndex: number;
  confirmed: string[];
}

export interface VoteHistoryEntry {
  day: number;
  // null 表示弃票；没有在限时内投票的存活玩家会在结算时补为 null。
  votes: Record<string, string | null>;
  voteCount: Record<string, number>;
  eliminated: string | null;
  abstained: number;
  isTie: boolean;
}

export interface GameState {
  phase: GamePhase;
  day: number;
  nightActions: NightAction[];
  deadPlayers: DeadPlayer[];
  systemMessages: SystemMessage[];
  // phaseEndsAt 使用服务端时间戳，客户端用它校准倒计时，避免多端计时漂移。
  phaseTimer: number;
  phaseEndsAt: number | null;
  paused: boolean;
  pausedAt: number | null;
  remainingMs: number | null;
  winner: 'villager' | 'werewolf' | null;
  votes: Record<string, string | null>;
  voteHistory: VoteHistoryEntry[];
  seerCheckResult: { playerId: string; isWerewolf: boolean } | null;
  witchSaveUsed: boolean;
  witchPoisonUsed: boolean;
  lastKilledPlayer: string | null;
  lastGuardTarget: string | null;
  speaking: SpeakingState | null;
  // 狼王被夜刀后设置为 true，用于限制只有当前 WOLF_KING_SHOOT 阶段可以开枪。
  wolfKingCanShoot: boolean;
  wolfVotes: Record<string, string>;  // wolfId → targetId (狼人投票)
}

export type PublicGameState = Omit<
  GameState,
  | 'deadPlayers'
  | 'nightActions'
  | 'seerCheckResult'
  | 'witchSaveUsed'
  | 'witchPoisonUsed'
  | 'lastKilledPlayer'
  | 'lastGuardTarget'
  | 'wolfKingCanShoot'
  | 'wolfVotes'
> & {
  deadPlayers: PublicDeadPlayer[];
};
