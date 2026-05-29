export enum Role {
  VILLAGER = 'villager',
  WEREWOLF = 'werewolf',
  WOLF_KING = 'wolf_king',
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
  [Role.WOLF_KING]: {
    id: Role.WOLF_KING,
    name: '狼王',
    camp: 'werewolf',
    description: '被狼人击杀时可开枪带走一人，被毒或被投票出局不能发动',
    skill: '临终一击',
    canDisable: true
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

export interface RolePreset {
  id: string;
  name: string;
  playerCount: number;
  roles: Role[];
  wolfCount: number;
  hybridRoles: Role[];
}

export const ROLE_PRESETS: RolePreset[] = [
  {
    id: 'preset-9',
    name: '9人标准局',
    playerCount: 9,
    roles: [Role.WEREWOLF, Role.SEER, Role.WITCH, Role.HUNTER],
    wolfCount: 3,
    hybridRoles: []
  },
  {
    id: 'preset-12',
    name: '12人进阶局',
    playerCount: 12,
    roles: [Role.WEREWOLF, Role.WOLF_KING, Role.SEER, Role.WITCH, Role.HUNTER, Role.GUARD],
    wolfCount: 3,
    hybridRoles: []
  }
];

/** 是否为狼人阵营角色 */
export function isWolfRole(role: Role): boolean {
  return role === Role.WEREWOLF || role === Role.WOLF_KING;
}

/** 是否为神职角色（非狼人、非村民） */
export function isGodRole(role: Role): boolean {
  return ROLES[role]?.camp === 'villager' && role !== Role.VILLAGER;
}
