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
  private roleConfirmations: Map<string, Set<string>> = new Map();  // roomId → confirmed player IDs
  private wolfVotes: Map<string, Map<string, string>> = new Map();  // roomId → (wolfId → targetId) 已确认
  private wolfSelections: Map<string, Map<string, string>> = new Map();  // roomId → (wolfId → targetId) 仅选择

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

    // 确认身份：手动确认 + 倒计时双重机制
    const confirmTime = room.config.roleConfirmTime;
    this.io.to(room.id).emit('game:phaseChanged', { phase: GamePhase.ROLE_CONFIRM, timer: confirmTime });

    const timeout = setTimeout(() => {
      this.startNightPhase(room.id);
    }, confirmTime * 1000);

    this.phaseTimers.set(room.id, timeout);
  }

  confirmRole(socket: TypedSocket): void {
    const room = this.roomManager.getRoomBySocket(socket);
    if (!room) return;

    const gameState = this.gameStates.get(room.id);
    if (!gameState || gameState.phase !== GamePhase.ROLE_CONFIRM) return;

    const confirmed = this.roleConfirmations.get(room.id);
    if (!confirmed || confirmed.has(socket.id)) return;

    confirmed.add(socket.id);

    // 广播给房间内所有人（让客户端显示谁已确认）
    this.io.to(room.id).emit('game:roleConfirmed', { playerId: socket.id });

    // 所有玩家都确认，立即进入夜晚
    if (confirmed.size >= room.players.length) {
      const timeout = this.phaseTimers.get(room.id);
      if (timeout) clearTimeout(timeout);
      this.startNightPhase(room.id);
    }
  }

  // ============ 夜晚阶段 ============

  private startNightPhase(roomId: string): void {
    const room = this.roomManager.getRoom(roomId);
    const gameState = this.gameStates.get(roomId);
    if (!room || !gameState) return;

    this.nightActions.set(roomId, new Map());
    this.wolfVotes.set(roomId, new Map());
    this.wolfSelections.set(roomId, new Map());
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
    this.io.to(roomId).emit('game:phaseChanged', { phase, timer: 180 });

    const timeout = setTimeout(() => {
      // 狼人阶段超时：用已确认的投票结算（未确认=弃票）
      if (phase === GamePhase.NIGHT_WEREWOLF) {
        this.resolveWolfPhase(roomId);
      } else {
        this.runNightPhases(roomId, phases, index + 1);
      }
    }, 180000);

    this.phaseTimers.set(roomId, timeout);
  }

  werewolfKill(socket: TypedSocket, targetId: string): void {
    const ctx = this.validateContext(socket, GamePhase.NIGHT_WEREWOLF);
    if (!ctx || !ctx.player.role || !isWolfRole(ctx.player.role) || ctx.player.status === 'dead') return;

    const target = ctx.room.players.find(p => p.id === targetId);
    if (!target || target.status === 'dead') return;

    // 记录选择（仅本地广播，不确认投票）
    let selections = this.wolfSelections.get(ctx.room.id);
    if (!selections) {
      selections = new Map();
      this.wolfSelections.set(ctx.room.id, selections);
    }
    selections.set(socket.id, targetId);

    // 广播选择更新给房间内所有人（让狼队友看到谁选了谁）
    const selectionsObj: Record<string, string> = {};
    selections.forEach((tid, wid) => { selectionsObj[wid] = tid; });
    this.io.to(ctx.room.id).emit('game:wolfSelectionUpdate', { selections: selectionsObj });
  }

  wolfConfirmVote(socket: TypedSocket): void {
    const ctx = this.validateContext(socket, GamePhase.NIGHT_WEREWOLF);
    if (!ctx || !ctx.player.role || !isWolfRole(ctx.player.role) || ctx.player.status === 'dead') return;

    const selections = this.wolfSelections.get(ctx.room.id);
    const targetId = selections?.get(socket.id);
    if (!targetId) {
      socket.emit('game:error', { message: '请先选择目标' });
      return;
    }

    // 确认投票
    let votes = this.wolfVotes.get(ctx.room.id);
    if (!votes) {
      votes = new Map();
      this.wolfVotes.set(ctx.room.id, votes);
    }
    votes.set(socket.id, targetId);

    // 广播投票确认
    const wolfVotesObj: Record<string, string> = {};
    votes.forEach((tid, wid) => { wolfVotesObj[wid] = tid; });
    this.io.to(ctx.room.id).emit('game:wolfVoteUpdate', { wolfVotes: wolfVotesObj });

    // 检查所有存活狼人是否都已确认投票
    const wolves = ctx.room.players.filter(p => p.role !== null && isWolfRole(p.role) && p.status === 'alive');
    const allVoted = wolves.every(w => votes.has(w.id));

    if (allVoted) {
      this.resolveWolfPhase(ctx.room.id);
    }
  }

  /** 狼人阶段结算：全部弃票=平安夜，平票随机，否则多数票 */
  private resolveWolfPhase(roomId: string): void {
    const room = this.roomManager.getRoom(roomId);
    const votes = this.wolfVotes.get(roomId);
    if (!room) return;

    const wolves = room.players.filter(p => p.role !== null && isWolfRole(p.role) && p.status === 'alive');
    const finalTarget = this.resolveWolfVote(votes || new Map(), wolves);

    const actions = this.nightActions.get(roomId);
    if (actions && finalTarget) actions.set(Role.WEREWOLF, { targetId: finalTarget });

    const timeout = this.phaseTimers.get(roomId);
    if (timeout) clearTimeout(timeout);
    this.advanceNightPhase(roomId, GamePhase.NIGHT_WEREWOLF);
  }

  /** 狼人投票结算：全部弃票=null，平票随机，否则多数票 */
  private resolveWolfVote(votes: Map<string, string>, wolves: Player[]): string | null {
    const counts: Record<string, number> = {};
    wolves.forEach(w => {
      const target = votes.get(w.id);
      if (target) counts[target] = (counts[target] || 0) + 1;
    });

    const entries = Object.entries(counts);
    if (entries.length === 0) return null;  // 全部弃票 → 平安夜

    // 找出最高票数
    let maxCount = 0;
    entries.forEach(([, count]) => { if (count > maxCount) maxCount = count; });

    // 收集最高票候选
    const candidates = entries.filter(([, count]) => count === maxCount).map(([id]) => id);
    return candidates[Math.floor(Math.random() * candidates.length)];
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
      this.io.to(roomId).emit('game:phaseChanged', { phase: GamePhase.WOLF_KING_SHOOT, timer: 180 });
      this.io.to(result.killedPlayerId!).emit('game:wolfKingRequired', { playerId: result.killedPlayerId! });

      const timeout = setTimeout(() => {
        gameState.wolfKingCanShoot = false;
        this.startDayPhase(roomId, result.deadPlayerIds);
      }, 180000);
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

    this.io.to(roomId).emit('game:phaseChanged', { phase: GamePhase.DAY_ANNOUNCE, timer: 180 });
    setTimeout(() => this.startSpeakingPhase(roomId), 180000);
  }

  private startSpeakingPhase(roomId: string): void {
    const room = this.roomManager.getRoom(roomId);
    const gameState = this.gameStates.get(roomId);
    if (!room || !gameState) return;

    gameState.phase = GamePhase.DAY_SPEAKING;
    gameState.votes = {};

    const speaking: SpeakingState = {
      order: this.engine.buildSpeakingOrder(room, gameState.lastKilledPlayer),
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
      setTimeout(() => this.startNightPhase(ctx.room.id), 180000);
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
    setTimeout(() => this.startNightPhase(roomId), 180000);
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
    this.wolfVotes.delete(roomId);
    this.wolfSelections.delete(roomId);
  }
}
