// 角色定义
export enum Role {
  VILLAGER = 'villager',
  WEREWOLF = 'werewolf',
  SEER = 'seer',
  WITCH = 'witch',
  HUNTER = 'hunter',
  GUARD = 'guard'
}

export interface RoleInfo {
  id: Role;
  name: string;
  camp: 'villager' | 'werewolf';
  description: string;
  skill: string;
  canDisable: boolean;
}

export const ROLES: Record<Role, RoleInfo> = {
  [Role.VILLAGER]: {
    id: Role.VILLAGER,
    name: '村民',
    camp: 'villager',
    description: '普通村民，没有特殊技能',
    skill: '无',
    canDisable: false
  },
  [Role.WEREWOLF]: {
    id: Role.WEREWOLF,
    name: '狼人',
    camp: 'werewolf',
    description: '每晚可以击杀一名玩家',
    skill: '击杀',
    canDisable: false
  },
  [Role.SEER]: {
    id: Role.SEER,
    name: '预言家',
    camp: 'villager',
    description: '每晚可以查验一名玩家的身份',
    skill: '查验',
    canDisable: true
  },
  [Role.WITCH]: {
    id: Role.WITCH,
    name: '女巫',
    camp: 'villager',
    description: '拥有一瓶解药和一瓶毒药，各限使用一次',
    skill: '解药/毒药',
    canDisable: true
  },
  [Role.HUNTER]: {
    id: Role.HUNTER,
    name: '猎人',
    camp: 'villager',
    description: '死亡时可以开枪带走一名玩家',
    skill: '开枪',
    canDisable: true
  },
  [Role.GUARD]: {
    id: Role.GUARD,
    name: '守卫',
    camp: 'villager',
    description: '每晚可以守护一名玩家，使其免受狼人击杀',
    skill: '守护',
    canDisable: true
  }
};

// 角色预设
export interface RolePreset {
  id: string;
  name: string;
  playerCount: number;
  roles: Role[];
  wolfCount: number;
}

export const ROLE_PRESETS: RolePreset[] = [
  {
    id: 'preset-9',
    name: '9人标准局',
    playerCount: 9,
    roles: [Role.WEREWOLF, Role.SEER, Role.WITCH, Role.HUNTER, Role.GUARD],
    wolfCount: 3
  },
  {
    id: 'preset-12',
    name: '12人进阶局',
    playerCount: 12,
    roles: [Role.WEREWOLF, Role.SEER, Role.WITCH, Role.HUNTER, Role.GUARD],
    wolfCount: 4
  }
];

// 游戏阶段
export enum GamePhase {
  WAITING = 'waiting',
  NIGHT_WEREWOLF = 'night_werewolf',
  NIGHT_SEER = 'night_seer',
  NIGHT_WITCH = 'night_witch',
  NIGHT_GUARD = 'night_guard',
  DAY_ANNOUNCE = 'day_announce',
  DAY_SPEAKING = 'day_speaking',
  DAY_VOTE = 'day_vote',
  HUNTER_SHOOT = 'hunter_shoot',
  GAME_OVER = 'game_over'
}

// 玩家状态
export interface Player {
  id: string;
  name: string;
  roomId: string;
  role: Role | null;
  status: 'alive' | 'dead';
  isHost: boolean;
  voteTarget: string | null;
  skillUsed: {
    witchSave: boolean;
    witchPoison: boolean;
    lastGuardTarget: string | null;
  };
}

// 房间配置
export interface RoomConfig {
  maxPlayers: number;
  roles: Role[];
  wolfCount: number;
  voteTime: number;
}

// 房间
export interface Room {
  id: string;
  hostId: string;
  players: Player[];
  config: RoomConfig;
  status: 'waiting' | 'playing' | 'finished';
  createdAt: number;
}

// 夜晚行动
export interface NightAction {
  playerId: string;
  role: Role;
  action: string;
  targetId: string;
  timestamp: number;
}

// 死亡玩家
export interface DeadPlayer {
  playerId: string;
  reason: 'killed' | 'voted' | 'poisoned' | 'shot';
  day: number;
}

// 系统消息
export interface SystemMessage {
  id: string;
  content: string;
  timestamp: number;
}

// 发言状态
export interface SpeakingState {
  order: string[];           // 发言顺序（玩家ID列表）
  currentIndex: number;      // 当前发言者索引
  confirmed: string[];       // 已确认发言完毕的玩家ID
}

// 游戏状态
export interface GameState {
  phase: GamePhase;
  day: number;
  nightActions: NightAction[];
  deadPlayers: DeadPlayer[];
  systemMessages: SystemMessage[];
  phaseTimer: number;
  winner: 'villager' | 'werewolf' | null;
  votes: Record<string, string>;
  seerCheckResult: { playerId: string; isWerewolf: boolean } | null;
  witchSaveUsed: boolean;
  witchPoisonUsed: boolean;
  lastKilledPlayer: string | null;
  lastGuardTarget: string | null;
  speaking: SpeakingState | null;
}

// Socket.IO 事件类型
export interface ClientToServerEvents {
  'room:create': (data: { playerName: string; config: Partial<RoomConfig> }) => void;
  'room:join': (data: { roomId: string; playerName: string }) => void;
  'room:leave': () => void;
  'room:updateConfig': (data: Partial<RoomConfig>) => void;
  'room:start': () => void;
  'game:werewolfKill': (data: { targetId: string }) => void;
  'game:seerCheck': (data: { targetId: string }) => void;
  'game:witchSave': () => void;
  'game:witchPoison': (data: { targetId: string }) => void;
  'game:guardProtect': (data: { targetId: string }) => void;
  'game:vote': (data: { targetId: string }) => void;
  'game:speakingDone': () => void;
  'game:hunterShoot': (data: { targetId: string }) => void;
}

export interface ServerToClientEvents {
  'room:created': (data: { roomId: string }) => void;
  'room:joined': (data: { room: Room }) => void;
  'room:updated': (data: { room: Room }) => void;
  'room:error': (data: { message: string }) => void;
  'room:playerJoined': (data: { player: Player }) => void;
  'room:playerLeft': (data: { playerId: string }) => void;
  'game:started': (data: { gameState: GameState; myRole: Role }) => void;
  'game:phaseChanged': (data: { phase: GamePhase; timer: number; speaking?: SpeakingState }) => void;
  'game:speakingUpdate': (data: { speaking: SpeakingState }) => void;
  'game:playerDead': (data: { playerId: string; reason: string }) => void;
  'game:seerResult': (data: { playerId: string; isWerewolf: boolean }) => void;
  'game:voteResult': (data: { votes: Record<string, number>; eliminated: string | null }) => void;
  'game:over': (data: { winner: 'villager' | 'werewolf'; players: Player[] }) => void;
  'game:systemMessage': (data: SystemMessage) => void;
  'game:error': (data: { message: string }) => void;
  'game:hunterRequired': (data: { playerId: string }) => void;
}

// 广播消息
export interface BroadcastMessage {
  type: 'room_announce';
  roomId: string;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
  status: 'waiting' | 'playing';
  port: number;
}

// 默认房间配置（9人标准局）
export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  maxPlayers: 9,
  roles: [Role.WEREWOLF, Role.SEER, Role.WITCH, Role.HUNTER, Role.GUARD],
  wolfCount: 3,
  voteTime: 60
};

// 最小/最大玩家数
export const MIN_PLAYERS = 7;
export const MAX_PLAYERS = 12;
