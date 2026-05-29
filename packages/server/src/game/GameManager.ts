import { Server, Socket } from 'socket.io';
import {
  Room, Player, Role, GamePhase, GameState, SpeakingState,
  ClientToServerEvents, ServerToClientEvents, ROLES, MIN_PLAYERS,
  isWolfRole, isGodRole
} from '@werewolf/shared';
import { RoomManager } from '../rooms/RoomManager';
import { GameEngine } from './GameEngine';
import { generateMessageId } from '../utils';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

interface ActionContext {
  room: Room;
  gameState: GameState;
  player: Player;
}

export class GameManager {
  private roomManager: RoomManager;
  private engine: GameEngine;
  private io: TypedServer;
  private gameStates: Map<string, GameState> = new Map();
  private phaseTimers: Map<string, NodeJS.Timeout> = new Map();
  private nightActions: Map<string, Map<Role, { targetId: string }>> = new Map();
  private roleConfirmations: Map<string, Set<string>> = new Map();

  constructor(roomManager: RoomManager, io: TypedServer) {
    this.roomManager = roomManager;
    this.engine = new GameEngine();
    this.io = io;
  }

  // ============ 验证辅助 ============

  /** 验证并获取操作上下文，失败时通过 socket 返回错误 */
  private validateContext(socket: TypedSocket, expectedPhase?: GamePhase): ActionContext | null {
    const room = this.roomManager.getRoomBySocket(socket);
    if (!room) return null;

    const gameState = this.gameStates.get(room.id);
    if (!gameState) return null;
    if (expectedPhase && gameState.phase !== expectedPhase) return null;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return null;

    return { room, gameState, player };
  }

  /** 清除当前阶段计时器并推进到下一个夜晚子阶段 */
  private advanceNightPhase(roomId: string, currentPhase: GamePhase): void {
    const room = this.roomManager.getRoom(roomId);
    if (!room) return;

    const timeout = this.phaseTimers.get(roomId);
    if (timeout) clearTimeout(timeout);

    const phases = this.engine.getNightPhases(room);
    const currentIndex = phases.indexOf(currentPhase);
    this.runNightPhases(roomId, phases, currentIndex + 1);
  }

  // ============ 游戏生命周期 ============

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

    this.engine.assignRoles(room);

    const gameState = this.engine.createInitialGameState();
    room.status = 'playing';
    this.gameStates.set(room.id, gameState);
    this.nightActions.set(room.id, new Map());
    this.roleConfirmations.set(room.id, new Set());

    gameState.phase = GamePhase.ROLE_CONFIRM;
    room.players.forEach(player => {
      const playerSocket = this.io.sockets.sockets.get(player.id);
      if (playerSocket) {
        playerSocket.emit('game:started', { gameState, myRole: player.role! });
      }
    });
  }

  confirmRole(socket: TypedSocket): void {
    const ctx = this.validateContext(socket, GamePhase.ROLE_CONFIRM);
    if (!ctx) return;

    const confirmed = this.roleConfirmations.get(ctx.room.id);
    if (!confirmed) return;

    confirmed.add(socket.id);

    if (confirmed.size >= ctx.room.players.length) {
      this.roleConfirmations.delete(ctx.room.id);
      this.startNightPhase(ctx.room.id);
    }
  }

  // ============ 夜晚阶段 ============

  private startNightPhase(roomId: string): void {
    const room = this.roomManager.getRoom(roomId);
    const gameState = this.gameStates.get(roomId);
    if (!room || !gameState) return;

    this.nightActions.set(roomId, new Map());
    const phases = this.engine.getNightPhases(room);
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
    const ctx = this.validateContext(socket, GamePhase.NIGHT_WEREWOLF);
    if (!ctx || !ctx.player.role || !isWolfRole(ctx.player.role) || ctx.player.status === 'dead') return;

    const target = ctx.room.players.find(p => p.id === targetId);
    if (!target || target.status === 'dead') return;

    const actions = this.nightActions.get(ctx.room.id);
    if (actions) actions.set(Role.WEREWOLF, { targetId });

    // 检查所有狼人是否已行动
    const wolves = ctx.room.players.filter(p => p.role !== null && isWolfRole(p.role) && p.status === 'alive');
    const wolvesActed = wolves.every(() => actions?.has(Role.WEREWOLF));

    if (wolvesActed) {
      this.advanceNightPhase(ctx.room.id, GamePhase.NIGHT_WEREWOLF);
    }
  }

  seerCheck(socket: TypedSocket, targetId: string): void {
    const ctx = this.validateContext(socket, GamePhase.NIGHT_SEER);
    if (!ctx || ctx.player.role !== Role.SEER || ctx.player.status === 'dead') return;

    const target = ctx.room.players.find(p => p.id === targetId);
    if (!target || target.status === 'dead') return;

    socket.emit('game:seerResult', { playerId: targetId, isWerewolf: target.role === Role.WEREWOLF });
    this.advanceNightPhase(ctx.room.id, GamePhase.NIGHT_SEER);
  }

  witchSave(socket: TypedSocket): void {
    const ctx = this.validateContext(socket, GamePhase.NIGHT_WITCH);
    if (!ctx || ctx.player.role !== Role.WITCH || ctx.player.status === 'dead') return;

    if (ctx.player.skillUsed.witchSave) {
      socket.emit('game:error', { message: '解药已使用' });
      return;
    }
    if (ctx.gameState.witchSaveUsed) {
      socket.emit('game:error', { message: '本局解药已使用' });
      return;
    }

    ctx.player.skillUsed.witchSave = true;
    ctx.gameState.witchSaveUsed = true;
    this.advanceNightPhase(ctx.room.id, GamePhase.NIGHT_WITCH);
  }

  witchPoison(socket: TypedSocket, targetId: string): void {
    const ctx = this.validateContext(socket, GamePhase.NIGHT_WITCH);
    if (!ctx || ctx.player.role !== Role.WITCH || ctx.player.status === 'dead') return;

    if (ctx.player.skillUsed.witchPoison) {
      socket.emit('game:error', { message: '毒药已使用' });
      return;
    }

    const actions = this.nightActions.get(ctx.room.id);
    if (actions) actions.set(Role.WITCH, { targetId });

    ctx.player.skillUsed.witchPoison = true;
    this.advanceNightPhase(ctx.room.id, GamePhase.NIGHT_WITCH);
  }

  guardProtect(socket: TypedSocket, targetId: string): void {
    const ctx = this.validateContext(socket, GamePhase.NIGHT_GUARD);
    if (!ctx || ctx.player.role !== Role.GUARD || ctx.player.status === 'dead') return;

    if (ctx.player.skillUsed.lastGuardTarget === targetId) {
      socket.emit('game:error', { message: '不能连续两晚守护同一人' });
      return;
    }

    const actions = this.nightActions.get(ctx.room.id);
    if (actions) actions.set(Role.GUARD, { targetId });

    ctx.player.skillUsed.lastGuardTarget = targetId;
    this.advanceNightPhase(ctx.room.id, GamePhase.NIGHT_GUARD);
  }

  private resolveNight(roomId: string): void {
    const room = this.roomManager.getRoom(roomId);
    const gameState = this.gameStates.get(roomId);
    const actions = this.nightActions.get(roomId);
    if (!room || !gameState || !actions) return;

    const result = this.engine.resolveNight(room, gameState, actions);

    // 应用死亡
    result.deadPlayerIds.forEach(playerId => {
      const reason = playerId === result.killedPlayerId ? 'killed' : 'poisoned';
      this.engine.killPlayer(room, gameState, playerId, reason);
      this.io.to(roomId).emit('game:playerDead', { playerId, reason });
    });

    gameState.lastKilledPlayer = result.killedPlayerId;
    gameState.wolfKingCanShoot = result.wolfKingCanShoot;

    const winner = this.engine.checkWinner(room);
    if (winner) {
      this.endGame(roomId, winner);
      return;
    }

    if (result.wolfKingCanShoot) {
      gameState.phase = GamePhase.WOLF_KING_SHOOT;
      this.io.to(roomId).emit('game:phaseChanged', { phase: GamePhase.WOLF_KING_SHOOT, timer: 15 });
      this.io.to(result.killedPlayerId!).emit('game:wolfKingRequired', { playerId: result.killedPlayerId! });

      const timeout = setTimeout(() => {
        gameState.wolfKingCanShoot = false;
        this.startDayPhase(roomId, result.deadPlayerIds);
      }, 15000);
      this.phaseTimers.set(roomId, timeout);
      return;
    }

    this.startDayPhase(roomId, result.deadPlayerIds);
  }

  // ============ 白天阶段 ============

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
          this.io.to(roomId).emit('game:playerDead', { playerId, reason: 'killed' });
          if (player.role === Role.HUNTER) {
            this.io.to(playerId).emit('game:hunterRequired', { playerId });
          }
        }
      });
    }

    this.io.to(roomId).emit('game:phaseChanged', { phase: GamePhase.DAY_ANNOUNCE, timer: 5 });
    setTimeout(() => this.startSpeakingPhase(roomId), 5000);
  }

  private startSpeakingPhase(roomId: string): void {
    const room = this.roomManager.getRoom(roomId);
    const gameState = this.gameStates.get(roomId);
    if (!room || !gameState) return;

    gameState.phase = GamePhase.DAY_SPEAKING;
    gameState.votes = {};

    const speaking: SpeakingState = {
      order: this.engine.buildSpeakingOrder(room),
      currentIndex: 0,
      confirmed: []
    };
    gameState.speaking = speaking;

    this.io.to(roomId).emit('game:phaseChanged', { phase: GamePhase.DAY_SPEAKING, timer: 0, speaking });
    this.io.to(roomId).emit('game:speakingUpdate', { speaking });
  }

  speakingDone(socket: TypedSocket): void {
    const ctx = this.validateContext(socket, GamePhase.DAY_SPEAKING);
    if (!ctx || !ctx.gameState.speaking || ctx.player.status === 'dead') return;

    const currentSpeakerId = ctx.gameState.speaking.order[ctx.gameState.speaking.currentIndex];
    if (socket.id !== currentSpeakerId) {
      socket.emit('game:error', { message: '还没轮到你发言' });
      return;
    }

    if (!ctx.gameState.speaking.confirmed.includes(socket.id)) {
      ctx.gameState.speaking.confirmed.push(socket.id);
    }
    ctx.gameState.speaking.currentIndex++;

    this.io.to(ctx.room.id).emit('game:speakingUpdate', { speaking: ctx.gameState.speaking });

    if (ctx.gameState.speaking.currentIndex >= ctx.gameState.speaking.order.length) {
      this.startVotePhase(ctx.room.id);
    }
  }

  private startVotePhase(roomId: string): void {
    const room = this.roomManager.getRoom(roomId);
    const gameState = this.gameStates.get(roomId);
    if (!room || !gameState) return;

    gameState.phase = GamePhase.DAY_VOTE;
    gameState.votes = {};
    gameState.speaking = null;

    this.io.to(roomId).emit('game:phaseChanged', { phase: GamePhase.DAY_VOTE, timer: room.config.voteTime });

    const timeout = setTimeout(() => this.resolveVote(roomId), room.config.voteTime * 1000);
    this.phaseTimers.set(roomId, timeout);
  }

  vote(socket: TypedSocket, targetId: string): void {
    const ctx = this.validateContext(socket, GamePhase.DAY_VOTE);
    if (!ctx || ctx.player.status === 'dead') return;

    ctx.gameState.votes[socket.id] = targetId;

    const alivePlayers = ctx.room.players.filter(p => p.status === 'alive');
    const allVoted = alivePlayers.every(p => ctx.gameState.votes[p.id]);

    if (allVoted) {
      const timeout = this.phaseTimers.get(ctx.room.id);
      if (timeout) clearTimeout(timeout);
      this.resolveVote(ctx.room.id);
    }
  }

  private resolveVote(roomId: string): void {
    const room = this.roomManager.getRoom(roomId);
    const gameState = this.gameStates.get(roomId);
    if (!room || !gameState) return;

    const result = this.engine.resolveVote(gameState.votes);

    this.io.to(roomId).emit('game:voteResult', { votes: result.voteCount, eliminated: result.eliminatedId });

    if (result.eliminatedId) {
      const player = this.engine.killPlayer(room, gameState, result.eliminatedId, 'voted');
      this.io.to(roomId).emit('game:playerDead', { playerId: result.eliminatedId, reason: 'voted' });

      if (player?.role === Role.HUNTER) {
        this.io.to(result.eliminatedId).emit('game:hunterRequired', { playerId: result.eliminatedId });
        return;
      }
    }

    this.afterDeathCheck(roomId);
  }

  // ============ 特殊角色 ============

  hunterShoot(socket: TypedSocket, targetId: string): void {
    const ctx = this.validateContext(socket);
    if (!ctx || ctx.player.role !== Role.HUNTER) return;

    const target = ctx.room.players.find(p => p.id === targetId);
    if (!target || target.status === 'dead') return;

    this.engine.killPlayer(ctx.room, ctx.gameState, targetId, 'shot');
    this.io.to(ctx.room.id).emit('game:playerDead', { playerId: targetId, reason: 'shot' });

    const winner = this.engine.checkWinner(ctx.room);
    if (winner) {
      this.endGame(ctx.room.id, winner);
      return;
    }

    if (ctx.gameState.phase === GamePhase.DAY_ANNOUNCE || ctx.gameState.phase === GamePhase.DAY_VOTE) {
      ctx.gameState.day++;
      setTimeout(() => this.startNightPhase(ctx.room.id), 3000);
    }
  }

  wolfKingShoot(socket: TypedSocket, targetId: string): void {
    const ctx = this.validateContext(socket, GamePhase.WOLF_KING_SHOOT);
    if (!ctx || ctx.player.role !== Role.WOLF_KING) return;

    const target = ctx.room.players.find(p => p.id === targetId);
    if (!target || target.status === 'dead') return;

    this.engine.killPlayer(ctx.room, ctx.gameState, targetId, 'shot');
    this.io.to(ctx.room.id).emit('game:playerDead', { playerId: targetId, reason: 'shot' });

    ctx.gameState.wolfKingCanShoot = false;
    const timeout = this.phaseTimers.get(ctx.room.id);
    if (timeout) clearTimeout(timeout);

    const winner = this.engine.checkWinner(ctx.room);
    if (winner) {
      this.endGame(ctx.room.id, winner);
      return;
    }

    this.startDayPhase(ctx.room.id, [ctx.gameState.lastKilledPlayer!, targetId]);
  }

  // ============ 通用流程 ============

  /** 死亡后检查：胜负判定 → 继续夜晚 */
  private afterDeathCheck(roomId: string): void {
    const room = this.roomManager.getRoom(roomId);
    const gameState = this.gameStates.get(roomId);
    if (!room || !gameState) return;

    const winner = this.engine.checkWinner(room);
    if (winner) {
      this.endGame(roomId, winner);
      return;
    }

    gameState.day++;
    setTimeout(() => this.startNightPhase(roomId), 3000);
  }

  private endGame(roomId: string, winner: 'villager' | 'werewolf'): void {
    const room = this.roomManager.getRoom(roomId);
    const gameState = this.gameStates.get(roomId);
    if (!room || !gameState) return;

    gameState.phase = GamePhase.GAME_OVER;
    gameState.winner = winner;
    room.status = 'finished';

    this.io.to(roomId).emit('game:over', { winner, players: room.players });

    this.cleanup(roomId);
  }

  /** 清理游戏状态，防止内存泄漏 */
  cleanup(roomId: string): void {
    const timeout = this.phaseTimers.get(roomId);
    if (timeout) clearTimeout(timeout);
    this.phaseTimers.delete(roomId);
    this.gameStates.delete(roomId);
    this.nightActions.delete(roomId);
    this.roleConfirmations.delete(roomId);
  }
}
