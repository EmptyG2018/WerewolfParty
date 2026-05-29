import { Role, isGodRole } from './roles';
import { Player } from './game';

export interface RoomConfig {
  maxPlayers: number;
  roles: Role[];
  wolfCount: number;
  voteTime: number;
  hybridRoles: Role[];
}

export interface Room {
  id: string;
  hostId: string;
  players: Player[];
  config: RoomConfig;
  status: 'waiting' | 'playing' | 'finished';
  createdAt: number;
}

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  maxPlayers: 9,
  roles: [Role.WEREWOLF, Role.SEER, Role.WITCH, Role.HUNTER],
  wolfCount: 3,
  voteTime: 60,
  hybridRoles: []
};

export const MIN_PLAYERS = 7;
export const MAX_PLAYERS = 12;

/** 计算阵营人数 */
export function getCampCounts(config: RoomConfig) {
  const hasWolfKing = config.roles.includes(Role.WOLF_KING);
  const wolves = config.wolfCount + (hasWolfKing ? 1 : 0);
  const gods = config.roles.filter(r => isGodRole(r)).length;
  const villagers = config.maxPlayers - wolves - gods;
  return { wolves, gods, villagers, total: config.maxPlayers };
}

/** 获取各角色数量（用于显示） */
export function getRoleCounts(config: RoomConfig): Record<string, number> {
  const counts: Record<string, number> = {};
  config.roles.forEach(r => {
    if (r === Role.WEREWOLF) {
      counts[r] = config.wolfCount;
    } else {
      counts[r] = (counts[r] || 0) + 1;
    }
  });
  const { villagers } = getCampCounts(config);
  if (villagers > 0) {
    counts[Role.VILLAGER] = villagers;
  }
  return counts;
}

/** 校验房间配置是否合法 */
export function validateConfig(config: Partial<RoomConfig>): string | null {
  const maxPlayers = config.maxPlayers ?? DEFAULT_ROOM_CONFIG.maxPlayers;
  const wolfCount = config.wolfCount ?? DEFAULT_ROOM_CONFIG.wolfCount;
  const roles = config.roles ?? DEFAULT_ROOM_CONFIG.roles;

  if (maxPlayers < MIN_PLAYERS || maxPlayers > MAX_PLAYERS) {
    return `玩家数需在 ${MIN_PLAYERS}-${MAX_PLAYERS} 之间`;
  }
  if (wolfCount < 1) {
    return '至少需要 1 个狼人';
  }
  const hasWolfKing = roles.includes(Role.WOLF_KING);
  const totalWolves = wolfCount + (hasWolfKing ? 1 : 0);
  if (totalWolves >= maxPlayers / 2) {
    return '狼人数量不能超过总人数的一半';
  }
  return null;
}
