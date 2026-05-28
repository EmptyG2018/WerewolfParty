import { Server, Socket } from 'socket.io';
import {
  Room, Player, Role, GamePhase, GameState,
  ClientToServerEvents, ServerToClientEvents, ROLES
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

    if (room.players.length < 4) {
      socket.emit('game:error', { message: '至少需要4名玩家' });
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
      messages: [],
      phaseTimer: 0,
      winner: null,
      votes: {},
      seerCheckResult: null,
      witchSaveUsed: false,
      witchPoisonUsed: false,
      lastKilledPlayer: null,
      lastGuardTarget: null
    };

    room.status = 'playing';
    this.gameStates.set(room.id, gameState);
    this.nightActions.set(room.id, new Map());

    // 通知所有玩家游戏开始
    room.players.forEach(player => {
      const playerSocket = this.io.sockets.sockets.get(player.id);
      if (playerSocket) {
        playerSocket.emit('game:started', { gameState, myRole: player.role! });
      }
    });

    // 开始夜晚阶段
    this.startNightPhase(room.id);
  }

  private assignRoles(room: Room): void {
    const { roles, wolfCount } = room.config;
    const players = [...room.players];

    // 确保有狼人
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

    // 根据配置的角色决定夜晚行动顺序
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

    // 设置超时自动跳过
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
    if (!player || player.role !== Role.WEREWOLF || player.status === 'dead') return;

    const target = room.players.find(p => p.id === targetId);
    if (!target || target.status === 'dead') return;

    const nightActions = this.nightActions.get(room.id);
    if (nightActions) {
      nightActions.set(Role.WEREWOLF, { targetId });
    }

    // 检查是否所有狼人都已行动
    const wolves = room.players.filter(p => p.role === Role.WEREWOLF && p.status === 'alive');
    const wolvesActed = wolves.every(w => {
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

    socket.emit('game:message', {
      id: generateMessageId(),
      playerId: 'system',
      playerName: '系统',
      content: '你使用了解药',
      timestamp: Date.now(),
      type: 'system'
    });

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

    // 获取狼人击杀目标
    const wolfAction = nightActions.get(Role.WEREWOLF);
    if (wolfAction) {
      killedPlayerId = wolfAction.targetId;
    }

    // 获取女巫毒药目标
    const witchAction = nightActions.get(Role.WITCH);
    if (witchAction) {
      poisonedPlayerId = witchAction.targetId;
    }

    // 检查守卫保护
    const guardAction = nightActions.get(Role.GUARD);
    if (guardAction && guardAction.targetId === killedPlayerId) {
      killedPlayerId = null; // 守卫保护成功
    }

    // 检查女巫解药
    if (gameState.witchSaveUsed && killedPlayerId) {
      killedPlayerId = null; // 解药救活
      gameState.witchSaveUsed = false;
    }

    // 处理死亡
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

    // 检查胜负
    const winner = this.checkWinner(room);
    if (winner) {
      this.endGame(roomId, winner);
      return;
    }

    // 进入白天阶段
    this.startDayPhase(roomId, deadPlayers);
  }

  private startDayPhase(roomId: string, deadPlayers: string[]): void {
    const room = this.roomManager.getRoom(roomId);
    const gameState = this.gameStates.get(roomId);
    if (!room || !gameState) return;

    // 公布死亡信息
    gameState.phase = GamePhase.DAY_ANNOUNCE;

    if (deadPlayers.length === 0) {
      this.io.to(roomId).emit('game:message', {
        id: generateMessageId(),
        playerId: 'system',
        playerName: '系统',
        content: '昨晚是平安夜，没有人死亡',
        timestamp: Date.now(),
        type: 'system'
      });
    } else {
      deadPlayers.forEach(playerId => {
        const player = room.players.find(p => p.id === playerId);
        if (player) {
          this.io.to(roomId).emit('game:playerDead', {
            playerId,
            reason: 'killed'
          });

          // 检查猎人是否需要开枪
          if (player.role === Role.HUNTER) {
            this.io.to(playerId).emit('game:hunterRequired', { playerId });
            // 猎人死亡处理会在hunterShoot中完成
          }
        }
      });
    }

    this.io.to(roomId).emit('game:phaseChanged', {
      phase: GamePhase.DAY_ANNOUNCE,
      timer: 5
    });

    // 5秒后进入讨论阶段
    setTimeout(() => {
      this.startDiscussPhase(roomId);
    }, 5000);
  }

  private startDiscussPhase(roomId: string): void {
    const room = this.roomManager.getRoom(roomId);
    const gameState = this.gameStates.get(roomId);
    if (!room || !gameState) return;

    gameState.phase = GamePhase.DAY_DISCUSS;
    gameState.votes = {};

    this.io.to(roomId).emit('game:phaseChanged', {
      phase: GamePhase.DAY_DISCUSS,
      timer: room.config.discussTime
    });

    // 讨论时间结束
    const timeout = setTimeout(() => {
      this.startVotePhase(roomId);
    }, room.config.discussTime * 1000);

    this.phaseTimers.set(roomId, timeout);
  }

  private startVotePhase(roomId: string): void {
    const room = this.roomManager.getRoom(roomId);
    const gameState = this.gameStates.get(roomId);
    if (!room || !gameState) return;

    gameState.phase = GamePhase.DAY_VOTE;
    gameState.votes = {};

    this.io.to(roomId).emit('game:phaseChanged', {
      phase: GamePhase.DAY_VOTE,
      timer: room.config.voteTime
    });

    // 投票时间结束
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

    // 检查是否所有存活玩家都已投票
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

    // 统计投票
    const voteCount: Record<string, number> = {};
    Object.values(gameState.votes).forEach(targetId => {
      voteCount[targetId] = (voteCount[targetId] || 0) + 1;
    });

    // 找出最高票数
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

    // 平票则无人出局
    if (isTie) {
      eliminatedId = null;
    }

    // 发送投票结果
    this.io.to(roomId).emit('game:voteResult', {
      votes: voteCount,
      eliminated: eliminatedId
    });

    // 处理淘汰
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

        // 检查猎人
        if (player.role === Role.HUNTER) {
          this.io.to(eliminatedId).emit('game:hunterRequired', { playerId: eliminatedId });
          return; // 猎人死亡处理会在hunterShoot中完成
        }
      }
    }

    // 检查胜负
    const winner = this.checkWinner(room);
    if (winner) {
      this.endGame(roomId, winner);
      return;
    }

    // 进入下一晚
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

    // 检查胜负
    const winner = this.checkWinner(room);
    if (winner) {
      this.endGame(room.id, winner);
      return;
    }

    // 继续游戏
    if (gameState.phase === GamePhase.DAY_ANNOUNCE || gameState.phase === GamePhase.DAY_VOTE) {
      // 白天阶段，继续到下一晚
      gameState.day++;
      setTimeout(() => {
        this.startNightPhase(room.id);
      }, 3000);
    }
  }

  chat(socket: TypedSocket, message: string): void {
    const room = this.roomManager.getRoomBySocket(socket);
    if (!room) return;

    const gameState = this.gameStates.get(room.id);
    if (!gameState) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.status === 'dead') return;

    const chatMessage = {
      id: generateMessageId(),
      playerId: socket.id,
      playerName: player.name,
      content: message,
      timestamp: Date.now(),
      type: 'normal' as const
    };

    gameState.messages.push(chatMessage);
    this.io.to(room.id).emit('game:message', chatMessage);
  }

  private checkWinner(room: Room): 'villager' | 'werewolf' | null {
    const alivePlayers = room.players.filter(p => p.status === 'alive');
    const aliveWolves = alivePlayers.filter(p => p.role === Role.WEREWOLF);
    const aliveVillagers = alivePlayers.filter(p => p.role !== Role.WEREWOLF);

    if (aliveWolves.length === 0) return 'villager';
    if (aliveWolves.length >= aliveVillagers.length) return 'werewolf';
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

    // 清理定时器
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
