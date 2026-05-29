import {
  Room, Player, Role, GamePhase, GameState, SpeakingState,
  ROLES, isWolfRole, isGodRole
} from '@werewolf/shared';

export interface NightResolution {
  killedPlayerId: string | null;
  poisonedPlayerId: string | null;
  deadPlayerIds: string[];
  wolfKingCanShoot: boolean;
}

export interface VoteResolution {
  voteCount: Record<string, number>;
  eliminatedId: string | null;
  isTie: boolean;
}

export class GameEngine {

  /** 分配角色：构建角色池、洗牌、分配 */
  assignRoles(room: Room): void {
    const { roles, wolfCount } = room.config;
    const players = [...room.players];
    const rolePool: Role[] = [];

    for (let i = 0; i < wolfCount; i++) {
      rolePool.push(Role.WEREWOLF);
    }
    roles.forEach(role => {
      if (role !== Role.WEREWOLF) {
        rolePool.push(role);
      }
    });
    while (rolePool.length < players.length) {
      rolePool.push(Role.VILLAGER);
    }

    // Fisher-Yates 洗牌
    for (let i = rolePool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rolePool[i], rolePool[j]] = [rolePool[j], rolePool[i]];
    }

    players.forEach((player, index) => {
      player.role = rolePool[index];
    });
  }

  /** 根据房间配置获取夜晚阶段顺序 */
  getNightPhases(room: Room): GamePhase[] {
    const phases: GamePhase[] = [GamePhase.NIGHT_WEREWOLF];
    if (room.config.roles.includes(Role.SEER)) phases.push(GamePhase.NIGHT_SEER);
    if (room.config.roles.includes(Role.GUARD)) phases.push(GamePhase.NIGHT_GUARD);
    if (room.config.roles.includes(Role.WITCH)) phases.push(GamePhase.NIGHT_WITCH);
    return phases;
  }

  /** 解析夜晚行动结果（纯逻辑，不修改状态） */
  resolveNight(
    room: Room,
    gameState: GameState,
    nightActions: Map<Role, { targetId: string }>
  ): NightResolution {
    let killedPlayerId = nightActions.get(Role.WEREWOLF)?.targetId ?? null;
    const poisonedPlayerId = nightActions.get(Role.WITCH)?.targetId ?? null;

    // 守卫保护
    const guardAction = nightActions.get(Role.GUARD);
    if (guardAction && guardAction.targetId === killedPlayerId) {
      killedPlayerId = null;
    }

    // 女巫解药
    if (gameState.witchSaveUsed && killedPlayerId) {
      killedPlayerId = null;
      gameState.witchSaveUsed = false;
    }

    const deadPlayerIds: string[] = [];
    let wolfKingCanShoot = false;

    if (killedPlayerId) {
      deadPlayerIds.push(killedPlayerId);
      const killedPlayer = room.players.find(p => p.id === killedPlayerId);
      if (killedPlayer?.role === Role.WOLF_KING) {
        wolfKingCanShoot = true;
      }
    }
    if (poisonedPlayerId) {
      deadPlayerIds.push(poisonedPlayerId);
    }

    return { killedPlayerId, poisonedPlayerId, deadPlayerIds, wolfKingCanShoot };
  }

  /** 解析投票结果（纯逻辑） */
  resolveVote(votes: Record<string, string>): VoteResolution {
    const voteCount: Record<string, number> = {};
    Object.values(votes).forEach(targetId => {
      voteCount[targetId] = (voteCount[targetId] || 0) + 1;
    });

    let maxVotes = 0;
    let eliminatedId: string | null = null;
    let isTie = false;

    Object.entries(voteCount).forEach(([playerId, count]) => {
      if (count > maxVotes) {
        maxVotes = count;
        eliminatedId = playerId;
        isTie = false;
      } else if (count === maxVotes) {
        isTie = true;
      }
    });

    if (isTie) eliminatedId = null;

    return { voteCount, eliminatedId, isTie };
  }

  /** 击杀玩家（修改状态） */
  killPlayer(
    room: Room,
    gameState: GameState,
    playerId: string,
    reason: 'killed' | 'voted' | 'poisoned' | 'shot'
  ): Player | null {
    const player = room.players.find(p => p.id === playerId);
    if (!player) return null;

    player.status = 'dead';
    gameState.deadPlayers.push({ playerId, reason, day: gameState.day });
    return player;
  }

  /** 胜负判定 */
  checkWinner(room: Room): 'villager' | 'werewolf' | null {
    const hybridSet = new Set(room.config.hybridRoles || []);
    const alivePlayers = room.players.filter(p => p.status === 'alive');

    const aliveWolves = alivePlayers.filter(p => p.role !== null && isWolfRole(p.role));
    if (aliveWolves.length === 0) return 'villager';

    const isHybrid = (p: Player) => p.role !== null && hybridSet.has(p.role);
    const aliveGods = alivePlayers.filter(p => (p.role !== null && isGodRole(p.role)) || isHybrid(p));
    const aliveVillagers = alivePlayers.filter(p => p.role === Role.VILLAGER || isHybrid(p));

    if (aliveGods.length === 0) return 'werewolf';
    if (aliveVillagers.length === 0) return 'werewolf';

    return null;
  }

  /** 发言顺序：从昨晚被刀者下一位开始，随机正序或反序 */
  buildSpeakingOrder(room: Room, lastKilledPlayerId: string | null): string[] {
    const alivePlayers = room.players.filter(p => p.status === 'alive');
    if (alivePlayers.length === 0) return [];

    // 按座位号排序
    const sorted = [...alivePlayers].sort((a, b) => a.seatIndex - b.seatIndex);

    // 找到被刀者的座位号
    let startIdx = 0;
    if (lastKilledPlayerId) {
      const killedPlayer = room.players.find(p => p.id === lastKilledPlayerId);
      if (killedPlayer) {
        // 从被刀者下一位开始
        const nextIdx = sorted.findIndex(p => p.seatIndex > killedPlayer.seatIndex);
        startIdx = nextIdx >= 0 ? nextIdx : 0;
      }
    }

    // 随机正序或反序
    const forward = Math.random() < 0.5;
    const ordered = forward
      ? [...sorted.slice(startIdx), ...sorted.slice(0, startIdx)]
      : [...sorted.slice(0, startIdx).reverse(), ...sorted.slice(startIdx).reverse()];

    return ordered.map(p => p.id);
  }

  /** 初始化新游戏状态 */
  createInitialGameState(): GameState {
    return {
      phase: GamePhase.NIGHT_WEREWOLF,
      day: 1,
      nightActions: [],
      deadPlayers: [],
      systemMessages: [],
      phaseTimer: 0,
      winner: null,
      votes: {},
      seerCheckResult: null,
      witchSaveUsed: false,
      witchPoisonUsed: false,
      lastKilledPlayer: null,
      lastGuardTarget: null,
      speaking: null,
      wolfKingCanShoot: false,
      wolfVotes: {}
    };
  }
}
