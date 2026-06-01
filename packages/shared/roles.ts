export enum Role {
  VILLAGER = 'villager',
  WEREWOLF = 'werewolf',
  WOLF_KING = 'wolf_king',
  SEER = 'seer',
  WITCH = 'witch',
  HUNTER = 'hunter',
  GUARD = 'guard'
}

export enum RoleGroup {
  WOLF = 'wolf',
  GOD = 'god',
  VILLAGER = 'villager'
}

export enum RoleAbility {
  WEREWOLF_KILL = 'werewolf_kill',
  SEER_CHECK = 'seer_check',
  WITCH_SAVE = 'witch_save',
  WITCH_POISON = 'witch_poison',
  GUARD_PROTECT = 'guard_protect',
  HUNTER_SHOOT = 'hunter_shoot',
  WOLF_KING_SHOOT = 'wolf_king_shoot'
}

export interface RoleInfo {
  id: Role;
  name: string;
  icon: string;
  camp: 'villager' | 'werewolf';
  groups: RoleGroup[];
  description: string;
  skill: string;
  canDisable: boolean;
}

interface RoleDefinitionOptions {
  id: Role;
  name: string;
  icon: string;
  groups: RoleGroup[];
  description: string;
  skill: string;
  canDisable: boolean;
  abilities?: RoleAbility[];
}

export abstract class RoleDefinition {
  readonly id: Role;
  readonly name: string;
  readonly icon: string;
  readonly groups: RoleGroup[];
  readonly description: string;
  readonly skill: string;
  readonly canDisable: boolean;
  readonly abilities: RoleAbility[];

  protected constructor(options: RoleDefinitionOptions) {
    this.id = options.id;
    this.name = options.name;
    this.icon = options.icon;
    this.groups = options.groups;
    this.description = options.description;
    this.skill = options.skill;
    this.canDisable = options.canDisable;
    this.abilities = options.abilities || [];
  }

  get camp(): 'villager' | 'werewolf' {
    return this.hasBaseGroup(RoleGroup.WOLF) ? 'werewolf' : 'villager';
  }

  getGroups(hybridRoles: Role[] = []): RoleGroup[] {
    const groups = new Set(this.groups);
    if (hybridRoles.includes(this.id) && this.canBeHybrid()) {
      groups.add(RoleGroup.VILLAGER);
    }
    return [...groups];
  }

  hasGroup(group: RoleGroup, hybridRoles: Role[] = []): boolean {
    return this.getGroups(hybridRoles).includes(group);
  }

  hasAbility(ability: RoleAbility): boolean {
    return this.abilities.includes(ability);
  }

  canBeHybrid(): boolean {
    return this.hasBaseGroup(RoleGroup.GOD) && !this.hasBaseGroup(RoleGroup.WOLF);
  }

  revealsAsWolf(): boolean {
    return this.hasBaseGroup(RoleGroup.WOLF);
  }

  toInfo(): RoleInfo {
    return {
      id: this.id,
      name: this.name,
      icon: this.icon,
      camp: this.camp,
      groups: this.groups,
      description: this.description,
      skill: this.skill,
      canDisable: this.canDisable
    };
  }

  private hasBaseGroup(group: RoleGroup): boolean {
    return this.groups.includes(group);
  }
}

export class WolfRoleDefinition extends RoleDefinition {
  constructor(options: Omit<RoleDefinitionOptions, 'groups'>) {
    super({ ...options, groups: [RoleGroup.WOLF] });
  }
}

export class GodRoleDefinition extends RoleDefinition {
  constructor(options: Omit<RoleDefinitionOptions, 'groups'>) {
    super({ ...options, groups: [RoleGroup.GOD] });
  }
}

export class VillagerRoleDefinition extends RoleDefinition {
  constructor(options: Omit<RoleDefinitionOptions, 'groups'>) {
    super({ ...options, groups: [RoleGroup.VILLAGER] });
  }
}

export const ROLE_DEFINITIONS: Record<Role, RoleDefinition> = {
  [Role.VILLAGER]: new VillagerRoleDefinition({
    id: Role.VILLAGER,
    name: '村民',
    icon: '👤',
    description: '普通村民，没有特殊技能',
    skill: '无',
    canDisable: false
  }),
  [Role.WEREWOLF]: new WolfRoleDefinition({
    id: Role.WEREWOLF,
    name: '狼人',
    icon: '🐺',
    description: '每晚可以击杀一名玩家',
    skill: '击杀',
    canDisable: false,
    abilities: [RoleAbility.WEREWOLF_KILL]
  }),
  [Role.WOLF_KING]: new WolfRoleDefinition({
    id: Role.WOLF_KING,
    name: '狼王',
    icon: '👑',
    description: '被狼人击杀时可开枪带走一人，被毒或被投票出局不能发动',
    skill: '临终一击',
    canDisable: true,
    abilities: [RoleAbility.WEREWOLF_KILL, RoleAbility.WOLF_KING_SHOOT]
  }),
  [Role.SEER]: new GodRoleDefinition({
    id: Role.SEER,
    name: '预言家',
    icon: '🔮',
    description: '每晚可以查验一名玩家的身份',
    skill: '查验',
    canDisable: true,
    abilities: [RoleAbility.SEER_CHECK]
  }),
  [Role.WITCH]: new GodRoleDefinition({
    id: Role.WITCH,
    name: '女巫',
    icon: '🧪',
    description: '拥有一瓶解药和一瓶毒药，各限使用一次',
    skill: '解药/毒药',
    canDisable: true,
    abilities: [RoleAbility.WITCH_SAVE, RoleAbility.WITCH_POISON]
  }),
  [Role.HUNTER]: new GodRoleDefinition({
    id: Role.HUNTER,
    name: '猎人',
    icon: '🔫',
    description: '死亡时可以开枪带走一名玩家',
    skill: '开枪',
    canDisable: true,
    abilities: [RoleAbility.HUNTER_SHOOT]
  }),
  [Role.GUARD]: new GodRoleDefinition({
    id: Role.GUARD,
    name: '守卫',
    icon: '🛡️',
    description: '每晚可以守护一名玩家，使其免受狼人击杀',
    skill: '守护',
    canDisable: true,
    abilities: [RoleAbility.GUARD_PROTECT]
  })
};

export const ROLES: Record<Role, RoleInfo> = Object.fromEntries(
  Object.entries(ROLE_DEFINITIONS).map(([role, definition]) => [role, definition.toInfo()])
) as Record<Role, RoleInfo>;

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

export function getRoleDefinition(role: Role): RoleDefinition {
  return ROLE_DEFINITIONS[role];
}

export function getRoleGroups(role: Role, hybridRoles: Role[] = []): RoleGroup[] {
  return getRoleDefinition(role).getGroups(hybridRoles);
}

export function hasRoleGroup(role: Role, group: RoleGroup, hybridRoles: Role[] = []): boolean {
  return getRoleDefinition(role).hasGroup(group, hybridRoles);
}

/** 是否为狼人身份组 */
export function isWolfRole(role: Role, hybridRoles: Role[] = []): boolean {
  return hasRoleGroup(role, RoleGroup.WOLF, hybridRoles);
}

/** 是否为神职身份组 */
export function isGodRole(role: Role, hybridRoles: Role[] = []): boolean {
  return hasRoleGroup(role, RoleGroup.GOD, hybridRoles);
}

/** 是否为民身份组，神民同体角色会同时返回 true */
export function isVillagerRole(role: Role, hybridRoles: Role[] = []): boolean {
  return hasRoleGroup(role, RoleGroup.VILLAGER, hybridRoles);
}

export function canBeHybridRole(role: Role): boolean {
  return getRoleDefinition(role).canBeHybrid();
}

export function roleHasAbility(role: Role, ability: RoleAbility): boolean {
  return getRoleDefinition(role).hasAbility(ability);
}

export function roleRevealsAsWolf(role: Role): boolean {
  return getRoleDefinition(role).revealsAsWolf();
}
