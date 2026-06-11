import { Role, RoleGroup, canBeHybridRole, getRoleGroups, hasRoleGroup } from './roles';
import { Player, PublicPlayer } from './game';
import { ROOM_RULE_DEFAULTS } from './rules';

export interface RoomConfig {
  maxPlayers: number;
  roles: Role[];
  wolfCount: number;
  voteTime: number;
  roleConfirmTime: number;     // 确认身份倒计时（秒）
  allowWitchSelfSave: boolean; // 是否允许女巫自救
  allowWolfFriendlyFire: boolean; // 是否允许狼人自刀或刀狼队友
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

export type PublicRoom = Omit<Room, 'players'> & {
  players: PublicPlayer[];
};

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  maxPlayers: ROOM_RULE_DEFAULTS.maxPlayers,
  roles: [Role.WEREWOLF, Role.SEER, Role.WITCH, Role.HUNTER],
  wolfCount: ROOM_RULE_DEFAULTS.wolfCount,
  voteTime: ROOM_RULE_DEFAULTS.voteTime,
  roleConfirmTime: ROOM_RULE_DEFAULTS.roleConfirmTime,
  allowWitchSelfSave: ROOM_RULE_DEFAULTS.allowWitchSelfSave,
  allowWolfFriendlyFire: ROOM_RULE_DEFAULTS.allowWolfFriendlyFire,
  hybridRoles: []
};

export const MIN_PLAYERS = 7;
export const MAX_PLAYERS = 12;

/** 计算胜负判定所需的阵营人数，神民同体角色会同时计入神和民。 */
export function getCampCounts(config: RoomConfig) {
  const roleCounts = getRoleCounts(config, true);
  let wolves = 0;
  let gods = 0;
  let villagers = 0;

  Object.entries(roleCounts).forEach(([role, count]) => {
    const groups = getRoleGroups(role as Role, config.hybridRoles);
    if (groups.includes(RoleGroup.WOLF)) wolves += count;
    if (groups.includes(RoleGroup.GOD)) gods += count;
    if (groups.includes(RoleGroup.VILLAGER)) villagers += count;
  });

  return { wolves, gods, villagers, total: config.maxPlayers };
}

/** 获取各角色数量（用于显示/校验）；未显式配置的座位自动补村民。 */
export function getRoleCounts(config: RoomConfig, includeAutoVillagers = true): Record<string, number> {
  const counts: Record<string, number> = {};
  config.roles.forEach(r => {
    if (r === Role.WEREWOLF) {
      counts[r] = config.wolfCount;
    } else {
      counts[r] = (counts[r] || 0) + 1;
    }
  });

  if (includeAutoVillagers) {
    const assignedSeats = Object.values(counts).reduce((sum, count) => sum + count, 0);
    const autoVillagers = config.maxPlayers - assignedSeats;
    if (autoVillagers > 0) {
      counts[Role.VILLAGER] = autoVillagers;
    }
  }

  return counts;
}

/** 校验房间配置是否合法，保证开局后角色池能完整填满所有座位。 */
export function validateConfig(config: Partial<RoomConfig>): string | null {
  const maxPlayers = config.maxPlayers ?? DEFAULT_ROOM_CONFIG.maxPlayers;
  const wolfCount = config.wolfCount ?? DEFAULT_ROOM_CONFIG.wolfCount;
  const roles = config.roles ?? DEFAULT_ROOM_CONFIG.roles;
  const hybridRoles = config.hybridRoles ?? DEFAULT_ROOM_CONFIG.hybridRoles;
  const uniqueRoles = new Set(roles);

  if (maxPlayers < MIN_PLAYERS || maxPlayers > MAX_PLAYERS) {
    return `玩家数需在 ${MIN_PLAYERS}-${MAX_PLAYERS} 之间`;
  }
  if (wolfCount < 1) {
    return '至少需要 1 个狼人';
  }
  if (!roles.includes(Role.WEREWOLF)) {
    return '角色配置必须包含狼人';
  }
  if (uniqueRoles.size !== roles.length) {
    return '特殊角色不能重复选择';
  }
  if (roles.includes(Role.VILLAGER)) {
    return '村民由系统自动填充，不能手动选择';
  }
  if (hybridRoles.some(role => !roles.includes(role) || !canBeHybridRole(role))) {
    return '神民同体只能应用于已启用的神职角色';
  }

  const roleCounts = getRoleCounts({ ...DEFAULT_ROOM_CONFIG, ...config, maxPlayers, wolfCount, roles, hybridRoles }, false);
  const assignedSeats = Object.values(roleCounts).reduce((sum, count) => sum + count, 0);
  if (assignedSeats > maxPlayers) {
    return '角色数量不能超过总人数';
  }
  if (maxPlayers - assignedSeats < 1) {
    return '至少需要 1 名村民';
  }

  const totalWolves = Object.entries(roleCounts).reduce((sum, [role, count]) => {
    return hasRoleGroup(role as Role, RoleGroup.WOLF, hybridRoles) ? sum + count : sum;
  }, 0);
  if (totalWolves >= maxPlayers / 2) {
    return '狼人数量不能超过总人数的一半';
  }
  return null;
}
