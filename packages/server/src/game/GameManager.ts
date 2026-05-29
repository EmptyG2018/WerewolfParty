import { Server, Socket } from 'socket.io';
import {
  Room, Player, Role, GamePhase, GameState, SpeakingState,
  ClientToServerEvents, ServerToClientEvents, ROLES, MIN_PLAYERS,
  isWolfRole, isGodRole
} from '@werewolf/shared';
import { RoomManager } from '../rooms/RoomManager';
import { generateMessageId } from '../utils';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

export class GameManager {
  private roomManager: RoomManager;
  private io: TypedServer;
  private gameStates: Map<string, GameState> = new Map();
  private phaseTimers: Map<string, NodeJS.Timeout> = new Map();
  private nightActions: Map<string, Map<Role, { targetId: string }>> = new Map();
  private roleConfirmations: Map<string, Set<string>> = new Map(); // roomId -> confirmed player IDs

  constructor(roomManager: RoomManager, io: TypedServer) {
    this.roomManager = roomManager;
    this.io = io;
  }

  startGame(socket: TypedSocket): void {
    const room = this.roomManager.getRoomBySocket(socket);
    if (!room) {
      socket.emit('game:error', { message: '未找到房间' });
      return;
    }

    if (room.hostId !== socket.id) {
      socket.emit('game:error', { message: '只有房主可以开始游戏' });
      return;
    }

    if (room.players.length < MIN_PLAYERS) {
      socket.emit('game:error', { message: `至少需要${MIN_PLAYERS}名玩家` });
      return;
    }

    // 分配角色
    this.assignRoles(room);

    // 初始化游戏状态
    const gameState: GameState = {
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
      wolfKingCanShoot: false
    };

    room.status = 'playing';
    this.gameStates.set(room.id, gameState);
    this.nightActions.set(room.id, new Map());
    this.roleConfirmations.set(room.id, new Set());

    // 通知所有玩家游戏开始（身份确认阶段）
    gameState.phase = GamePhase.ROLE_CONFIRM;
    room.players.forEach(player => {
      const playerSocket = this.io.sockets.sockets.get(player.id);
      if (playerSocket) {
        playerSocket.emit('game:started', { gameState, myRole: player.role! });
      }
    });
  }

  private assignRoles(room: Room): void {
    const { roles, wolfCount } = room.config;
    const players = [...room.players];

    const rolePool: Role[] = [];

    // 添加狼人
    for (let i = 0; i < wolfCount; i++) {
      rolePool.push(Role.WEREWOLF);
    }

    // 添加其他角色
    roles.forEach(role => {
      if (role !== Role.WEREWOLF) {
        rolePool.push(role);
      }
    });

    // 填充村民
    while (rolePool.length < players.length) {
      rolePool.push(Role.VILLAGER);
    }

    // 打乱角色池
    for (let i = rolePool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rolePool[i], rolePool[j]] = [rolePool[j], rolePool[i]];
    }

    // 分配角色
    players.forEach((player, index) => {
      player.role = rolePool[index];
    });
  }

  private startNightPhase(roomId: string): void {
    const room = this.roomManager.getRoom(roomId);
    const gameState = this.gameStates.get(roomId);
    if (!room || !gameState) return;

    this.nightActions.set(roomId, new Map());

    const phases: GamePhase[] = [GamePhase.NIGHT_WEREWOLF];

    if (room.config.roles.includes(Role.SEER)) {
      phases.push(GamePhase.NIGHT_SEER);
    }
    if (room.config.roles.includes(Role.GUARD)) {
      phases.push(GamePhase.NIGHT_GUARD);
    }
    if (room.config.roles.includes(Role.WITCH)) {
      phases.push(GamePhase.NIGHT_WITCH);
    }

    this.runNightPhases(roomId, phases, 0);
  }

  private runNightPhases(roomId: string, phases: GamePhase[], index: number): void {
    if (index >= phases.length) {
      this.resolveNight(roomId);
      return;
    }

    const gameState = this.gameStates.get(roomId);
    if (!gameState) return;

    const phase = phases[index];
    gameState.phase = phase;

    this.io.to(roomId).emit('game:phaseChanged', { phase, timer: 0 });

    const timeout = setTimeout(() => {
      this.runNightPhases(roomId, phases, index + 1);
    }, 30000);

    this.phaseTimers.set(roomId, timeout);
  }

  werewolfKill(socket: TypedSocket, targetId: string): void {
    const room = this.roomManager.getRoomBySocket(socket);
    if (!room) return;

    const gameState = this.gameStates.get(room.id);
    if (!gameState || gameState.phase !== GamePhase.NIGHT_WEREWOLF) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.role || !isWolfRole(player.role) || player.status === 'dead') return;

    const target = room.players.find(p => p.id === targetId);
    if (!target || target.status === 'dead') return;

    const nightActions = this.nightActions.get(room.id);
    if (nightActions) {
      nightActions.set(Role.WEREWOLF, { targetId });
    }

    const wolves = room.players.filter(p => p.role !== null && isWolfRole(p.role) && p.status === 'alive');
    const wolvesActed = wolves.every(() => {
      const actions = this.nightActions.get(room.id);
      return actions?.has(Role.WEREWOLF);
    });

    if (wolvesActed) {
      const timeout = this.phaseTimers.get(room.id);
      if (timeout) clearTimeout(timeout);
      const phases = this.getCurrentNightPhases(room);
      const currentIndex = phases.indexOf(GamePhase.NIGHT_WEREWOLF);
      this.runNightPhases(room.id, phases, currentIndex + 1);
    }
  }

  seerCheck(socket: TypedSocket, targetId: string): void {
    const room = this.roomManager.getRoomBySocket(socket);
    if (!room) return;

    const gameState = this.gameStates.get(room.id);
    if (!gameState || gameState.phase !== GamePhase.NIGHT_SEER) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.role !== Role.SEER || player.status === 'dead') return;

    const target = room.players.find(p => p.id === targetId);
    if (!target || target.status === 'dead') return;

    const isWerewolf = target.role === Role.WEREWOLF;
    socket.emit('game:seerResult', { playerId: targetId, isWerewolf });

    const timeout = this.phaseTimers.get(room.id);
    if (timeout) clearTimeout(timeout);
    const phases = this.getCurrentNightPhases(room);
    const currentIndex = phases.indexOf(GamePhase.NIGHT_SEER);
    this.runNightPhases(room.id, phases, currentIndex + 1);
  }

  witchSave(socket: TypedSocket): void {
    const room = this.roomManager.getRoomBySocket(socket);
    if (!room) return;

    const gameState = this.gameStates.get(room.id);
    if (!gameState || gameState.phase !== GamePhase.NIGHT_WITCH) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.role !== Role.WITCH || player.status === 'dead') return;

    if (player.skillUsed.witchSave) {
      socket.emit('game:error', { message: '解药已使用' });
      return;
    }

    if (gameState.witchSaveUsed) {
      socket.emit('game:error', { message: '本局解药已使用' });
      return;
    }

    player.skillUsed.witchSave = true;
    gameState.witchSaveUsed = true;

    const timeout = this.phaseTimers.get(room.id);
    if (timeout) clearTimeout(timeout);
    const phases = this.getCurrentNightPhases(room);
    const currentIndex = phases.indexOf(GamePhase.NIGHT_WITCH);
    this.runNightPhases(room.id, phases, currentIndex + 1);
  }

  witchPoison(socket: TypedSocket, targetId: string): void {
    const room = this.roomManager.getRoomBySocket(socket);
    if (!room) return;

    const gameState = this.gameStates.get(room.id);
    if (!gameState || gameState.phase !== GamePhase.NIGHT_WITCH) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.role !== Role.WITCH || player.status === 'dead') return;

    if (player.skillUsed.witchPoison) {
      socket.emit('game:error', { message: '毒药已使用' });
      return;
    }

    const nightActions = this.nightActions.get(room.id);
    if (nightActions) {
      nightActions.set(Role.WITCH, { targetId });
    }

    player.skillUsed.witchPoison = true;

    const timeout = this.phaseTimers.get(room.id);
    if (timeout) clearTimeout(timeout);
    const phases = this.getCurrentNightPhases(room);
    const currentIndex = phases.indexOf(GamePhase.NIGHT_WITCH);
    this.runNightPhases(room.id, phases, currentIndex + 1);
  }

  guardProtect(socket: TypedSocket, targetId: string): void {
    const room = this.roomManager.getRoomBySocket(socket);
    if (!room) return;

    const gameState = this.gameStates.get(room.id);
    if (!gameState || gameState.phase !== GamePhase.NIGHT_GUARD) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.role !== Role.GUARD || player.status === 'dead') return;

    if (player.skillUsed.lastGuardTarget === targetId) {
      socket.emit('game:error', { message: '不能连续两晚守护同一人' });
      return;
    }

    const nightActions = this.nightActions.get(room.id);
    if (nightActions) {
      nightActions.set(Role.GUARD, { targetId });
    }

    player.skillUsed.lastGuardTarget = targetId;

    const timeout = this.phaseTimers.get(room.id);
    if (timeout) clearTimeout(timeout);
    const phases = this.getCurrentNightPhases(room);
    const currentIndex = phases.indexOf(GamePhase.NIGHT_GUARD);
    this.runNightPhases(room.id, phases, currentIndex + 1);
  }

  private resolveNight(roomId: string): void {
    const room = this.roomManager.getRoom(roomId);
    const gameState = this.gameStates.get(roomId);
    if (!room || !gameState) return;

    const nightActions = this.nightActions.get(roomId);
    if (!nightActions) return;

    let killedPlayerId: string | null = null;
    let poisonedPlayerId: string | null = null;

    const wolfAction = nightActions.get(Role.WEREWOLF);
    if (wolfAction) {
      killedPlayerId = wolfAction.targetId;
    }

    const witchAction = nightActions.get(Role.WITCH);
    if (witchAction) {
      poisonedPlayerId = witchAction.targetId;
    }

    const guardAction = nightActions.get(Role.GUARD);
    if (guardAction && guardAction.targetId === killedPlayerId) {
      killedPlayerId = null;
    }

    if (gameState.witchSaveUsed && killedPlayerId) {
      killedPlayerId = null;
      gameState.witchSaveUsed = false;
    }

    const deadPlayers: string[] = [];

    if (killedPlayerId) {
      const player = room.players.find(p => p.id === killedPlayerId);
      if (player) {
        player.status = 'dead';
        deadPlayers.push(killedPlayerId);
        gameState.deadPlayers.push({
          playerId: killedPlayerId,
          reason: 'killed',
          day: gameState.day
        });
      }
    }

    if (poisonedPlayerId) {
      const player = room.players.find(p => p.id === poisonedPlayerId);
      if (player) {
        player.status = 'dead';
        deadPlayers.push(poisonedPlayerId);
        gameState.deadPlayers.push({
          playerId: poisonedPlayerId,
          reason: 'poisoned',
          day: gameState.day
        });
      }
    }

    gameState.lastKilledPlayer = killedPlayerId;

    // 狼王被狼人击杀时可开枪
    if (killedPlayerId) {
      const killedPlayer = room.players.find(p => p.id === killedPlayerId);
      if (killedPlayer && killedPlayer.role === Role.WOLF_KING) {
        gameState.wolfKingCanShoot = true;
      }
    }

    const winner = this.checkWinner(room);
    if (winner) {
      this.endGame(roomId, winner);
      return;
    }

    // 如果狼王需要开枪，进入狼王开枪阶段
    if (gameState.wolfKingCanShoot) {
      gameState.phase = GamePhase.WOLF_KING_SHOOT;
      this.io.to(roomId).emit('game:phaseChanged', { phase: GamePhase.WOLF_KING_SHOOT, timer: 15 });
      this.io.to(killedPlayerId!).emit('game:wolfKingRequired', { playerId: killedPlayerId! });

      const timeout = setTimeout(() => {
        gameState.wolfKingCanShoot = false;
        this.startDayPhase(roomId, deadPlayers);
      }, 15000);
      this.phaseTimers.set(roomId, timeout);
      return;
    }

    this.startDayPhase(roomId, deadPlayers);
  }

  private startDayPhase(roomId: string, deadPlayers: string[]): void {
    const room = this.roomManager.getRoom(roomId);
    const gameState = this.gameStates.get(roomId);
    if (!room || !gameState) return;

    gameState.phase = GamePhase.DAY_ANNOUNCE;

    if (deadPlayers.length === 0) {
      this.io.to(roomId).emit('game:systemMessage', {
        id: generateMessageId(),
        content: '昨晚是平安夜，没有人死亡',
        timestamp: Date.now()
      });
    } else {
      deadPlayers.forEach(playerId => {
        const player = room.players.find(p => p.id === playerId);
        if (player) {
          this.io.to(roomId).emit('game:playerDead', {
            playerId,
            reason: 'killed'
          });

          if (player.role === Role.HUNTER) {
            this.io.to(playerId).emit('game:hunterRequired', { playerId });
          }
        }
      });
    }

    this.io.to(roomId).emit('game:phaseChanged', {
      phase: GamePhase.DAY_ANNOUNCE,
      timer: 5
    });

    // 5秒后进入发言阶段
    setTimeout(() => {
      this.startSpeakingPhase(roomId);
    }, 5000);
  }

  private startSpeakingPhase(roomId: string): void {
    const room = this.roomManager.getRoom(roomId);
    const gameState = this.gameStates.get(roomId);
    if (!room || !gameState) return;

    gameState.phase = GamePhase.DAY_SPEAKING;
    gameState.votes = {};

    // 随机打乱存活玩家的发言顺序
    const alivePlayers = room.players.filter(p => p.status === 'alive');
    const shuffled = [...alivePlayers].sort(() => Math.random() - 0.5);
    const speakingOrder = shuffled.map(p => p.id);

    const speaking: SpeakingState = {
      order: speakingOrder,
      currentIndex: 0,
      confirmed: []
    };

    gameState.speaking = speaking;

    this.io.to(roomId).emit('game:phaseChanged', {
      phase: GamePhase.DAY_SPEAKING,
      timer: 0,
      speaking
    });

    this.io.to(roomId).emit('game:speakingUpdate', { speaking });
  }

  speakingDone(socket: TypedSocket): void {
    const room = this.roomManager.getRoomBySocket(socket);
    if (!room) return;

    const gameState = this.gameStates.get(room.id);
    if (!gameState || gameState.phase !== GamePhase.DAY_SPEAKING) return;
    if (!gameState.speaking) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.status === 'dead') return;

    // 只有当前发言者可以确认
    const currentSpeakerId = gameState.speaking.order[gameState.speaking.currentIndex];
    if (socket.id !== currentSpeakerId) {
      socket.emit('game:error', { message: '还没轮到你发言' });
      return;
    }

    // 标记已确认
    if (!gameState.speaking.confirmed.includes(socket.id)) {
      gameState.speaking.confirmed.push(socket.id);
    }

    // 移到下一位发言者
    gameState.speaking.currentIndex++;

    // 广播更新
    this.io.to(room.id).emit('game:speakingUpdate', {
      speaking: gameState.speaking
    });

    // 所有人都发言完毕，进入投票
    if (gameState.speaking.currentIndex >= gameState.speaking.order.length) {
      this.startVotePhase(room.id);
    }
  }

  confirmRole(socket: TypedSocket): void {
    const room = this.roomManager.getRoomBySocket(socket);
    if (!room) return;

    const gameState = this.gameStates.get(room.id);
    if (!gameState || gameState.phase !== GamePhase.ROLE_CONFIRM) return;

    const confirmed = this.roleConfirmations.get(room.id);
    if (!confirmed) return;

    confirmed.add(socket.id);

    // 所有玩家确认完毕，进入夜晚
    if (confirmed.size >= room.players.length) {
      this.roleConfirmations.delete(room.id);
      this.startNightPhase(room.id);
    }
  }

  private startVotePhase(roomId: string): void {
    const room = this.roomManager.getRoom(roomId);
    const gameState = this.gameStates.get(roomId);
    if (!room || !gameState) return;

    gameState.phase = GamePhase.DAY_VOTE;
    gameState.votes = {};
    gameState.speaking = null;

    this.io.to(roomId).emit('game:phaseChanged', {
      phase: GamePhase.DAY_VOTE,
      timer: room.config.voteTime
    });

    const timeout = setTimeout(() => {
      this.resolveVote(roomId);
    }, room.config.voteTime * 1000);

    this.phaseTimers.set(roomId, timeout);
  }

  vote(socket: TypedSocket, targetId: string): void {
    const room = this.roomManager.getRoomBySocket(socket);
    if (!room) return;

    const gameState = this.gameStates.get(room.id);
    if (!gameState || gameState.phase !== GamePhase.DAY_VOTE) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.status === 'dead') return;

    gameState.votes[socket.id] = targetId;

    const alivePlayers = room.players.filter(p => p.status === 'alive');
    const allVoted = alivePlayers.every(p => gameState.votes[p.id]);

    if (allVoted) {
      const timeout = this.phaseTimers.get(room.id);
      if (timeout) clearTimeout(timeout);
      this.resolveVote(room.id);
    }
  }

  private resolveVote(roomId: string): void {
    const room = this.roomManager.getRoom(roomId);
    const gameState = this.gameStates.get(roomId);
    if (!room || !gameState) return;

    const voteCount: Record<string, number> = {};
    Object.values(gameState.votes).forEach(targetId => {
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

    if (isTie) {
      eliminatedId = null;
    }

    this.io.to(roomId).emit('game:voteResult', {
      votes: voteCount,
      eliminated: eliminatedId
    });

    if (eliminatedId) {
      const player = room.players.find(p => p.id === eliminatedId);
      if (player) {
        player.status = 'dead';
        gameState.deadPlayers.push({
          playerId: eliminatedId,
          reason: 'voted',
          day: gameState.day
        });

        this.io.to(roomId).emit('game:playerDead', {
          playerId: eliminatedId,
          reason: 'voted'
        });

        if (player.role === Role.HUNTER) {
          this.io.to(eliminatedId).emit('game:hunterRequired', { playerId: eliminatedId });
          return;
        }
      }
    }

    const winner = this.checkWinner(room);
    if (winner) {
      this.endGame(roomId, winner);
      return;
    }

    gameState.day++;
    setTimeout(() => {
      this.startNightPhase(roomId);
    }, 3000);
  }

  hunterShoot(socket: TypedSocket, targetId: string): void {
    const room = this.roomManager.getRoomBySocket(socket);
    if (!room) return;

    const gameState = this.gameStates.get(room.id);
    if (!gameState) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.role !== Role.HUNTER) return;

    const target = room.players.find(p => p.id === targetId);
    if (!target || target.status === 'dead') return;

    target.status = 'dead';
    gameState.deadPlayers.push({
      playerId: targetId,
      reason: 'shot',
      day: gameState.day
    });

    this.io.to(room.id).emit('game:playerDead', {
      playerId: targetId,
      reason: 'shot'
    });

    const winner = this.checkWinner(room);
    if (winner) {
      this.endGame(room.id, winner);
      return;
    }

    if (gameState.phase === GamePhase.DAY_ANNOUNCE || gameState.phase === GamePhase.DAY_VOTE) {
      gameState.day++;
      setTimeout(() => {
        this.startNightPhase(room.id);
      }, 3000);
    }
  }

  wolfKingShoot(socket: TypedSocket, targetId: string): void {
    const room = this.roomManager.getRoomBySocket(socket);
    if (!room) return;

    const gameState = this.gameStates.get(room.id);
    if (!gameState || gameState.phase !== GamePhase.WOLF_KING_SHOOT) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.role !== Role.WOLF_KING) return;

    const target = room.players.find(p => p.id === targetId);
    if (!target || target.status === 'dead') return;

    target.status = 'dead';
    gameState.deadPlayers.push({
      playerId: targetId,
      reason: 'shot',
      day: gameState.day
    });

    this.io.to(room.id).emit('game:playerDead', {
      playerId: targetId,
      reason: 'shot'
    });

    gameState.wolfKingCanShoot = false;

    const timeout = this.phaseTimers.get(room.id);
    if (timeout) clearTimeout(timeout);

    const winner = this.checkWinner(room);
    if (winner) {
      this.endGame(room.id, winner);
      return;
    }

    this.startDayPhase(room.id, [gameState.lastKilledPlayer!, targetId]);
  }

  private checkWinner(room: Room): 'villager' | 'werewolf' | null {
    const hybridSet = new Set(room.config.hybridRoles || []);
    const alivePlayers = room.players.filter(p => p.status === 'alive');

    const aliveWolves = alivePlayers.filter(p => p.role !== null && isWolfRole(p.role));
    if (aliveWolves.length === 0) return 'villager';

    const isHybrid = (p: Player) => p.role !== null && hybridSet.has(p.role);

    // 神职存活数（含神民同体）
    const aliveGods = alivePlayers.filter(p => (p.role !== null && isGodRole(p.role)) || isHybrid(p));
    // 平民存活数（纯平民 + 神民同体）
    const aliveVillagers = alivePlayers.filter(p => p.role === Role.VILLAGER || isHybrid(p));

    // 屠神：所有神职出局
    if (aliveGods.length === 0) return 'werewolf';
    // 屠民：所有平民出局（神民同体同时计入平民）
    if (aliveVillagers.length === 0) return 'werewolf';

    return null;
  }

  private endGame(roomId: string, winner: 'villager' | 'werewolf'): void {
    const room = this.roomManager.getRoom(roomId);
    const gameState = this.gameStates.get(roomId);
    if (!room || !gameState) return;

    gameState.phase = GamePhase.GAME_OVER;
    gameState.winner = winner;

    room.status = 'finished';

    this.io.to(roomId).emit('game:over', {
      winner,
      players: room.players
    });

    const timeout = this.phaseTimers.get(roomId);
    if (timeout) clearTimeout(timeout);
    this.phaseTimers.delete(roomId);
    this.gameStates.delete(roomId);
    this.nightActions.delete(roomId);
  }

  private getCurrentNightPhases(room: Room): GamePhase[] {
    const phases: GamePhase[] = [GamePhase.NIGHT_WEREWOLF];

    if (room.config.roles.includes(Role.SEER)) {
      phases.push(GamePhase.NIGHT_SEER);
    }
    if (room.config.roles.includes(Role.GUARD)) {
      phases.push(GamePhase.NIGHT_GUARD);
    }
    if (room.config.roles.includes(Role.WITCH)) {
      phases.push(GamePhase.NIGHT_WITCH);
    }

    return phases;
  }
}
