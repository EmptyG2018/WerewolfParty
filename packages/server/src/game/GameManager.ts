import { Server, Socket } from 'socket.io';
import {
  Room, Player, Role, GamePhase, GameState, SpeakingState, DeathReason,
  PublicDeathReason, PublicGameState, ReviewEvent, ClientToServerEvents, ServerToClientEvents,
  RoleAbility, isWolfRole, roleHasAbility, roleRevealsAsWolf,
  GAME_ERROR_MESSAGES, PHASE_ADVANCE_DELAY_MS, PHASE_DURATION_SECONDS, SYSTEM_MESSAGES,
  isNightDeathReason, roomNotFullMessage, toPublicDeathReason,
  whiteWolfKingExplodeMessage, wolfSelfRevealMessage
} from '@werewolf/shared';
import { RoomManager } from '../rooms/RoomManager';
import { GameEngine, NightActionKey } from './GameEngine';
import { WolfSelfRevealAction } from './actions/WolfSelfRevealAction';
import { WhiteWolfKingExplodeAction } from './actions/WhiteWolfKingExplodeAction';
import { generateMessageId } from '../utils';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

interface ActionContext {
  room: Room;
  gameState: GameState;
  player: Player;
}

type DeathRecord = {
  playerId: string;
  reason: DeathReason;
};

type WolfConfirmResult = 'ok' | 'missing_target' | 'invalid_target';

export class GameManager {
  private roomManager: RoomManager;
  private engine: GameEngine;
  private wolfSelfRevealAction: WolfSelfRevealAction;
  private whiteWolfKingExplodeAction: WhiteWolfKingExplodeAction;
  private io: TypedServer;
  private gameStates: Map<string, GameState> = new Map();
  private phaseTimers: Map<string, NodeJS.Timeout> = new Map();
  // 暂停阶段时保留原回调，恢复后继续挂回同一个阶段推进逻辑。
  private phaseTimeoutCallbacks: Map<string, () => void> = new Map();
  private nightActions: Map<string, Map<NightActionKey, { targetId: string }>> = new Map();
  private roleConfirmations: Map<string, Set<string>> = new Map();  // roomId → confirmed player IDs
  private wolfVotes: Map<string, Map<string, string>> = new Map();  // roomId → (wolfId → targetId) 已确认
  private wolfSelections: Map<string, Map<string, string>> = new Map();  // roomId → (wolfId → targetId) 仅选择
  private witchSavedTonight: Map<string, boolean> = new Map();
  private phaseAdvancingRooms: Set<string> = new Set();
  // 房间同一时刻只会有一个待处理死亡技能；resume 用来回到被中断的主流程。
  private pendingHunterShots: Map<string, { playerId: string; resume: () => void }> = new Map();
  private hunterShotsUsed: Set<string> = new Set();

  constructor(roomManager: RoomManager, io: TypedServer) {
    this.roomManager = roomManager;
    this.engine = new GameEngine();
    this.wolfSelfRevealAction = new WolfSelfRevealAction(this.engine);
    this.whiteWolfKingExplodeAction = new WhiteWolfKingExplodeAction(this.engine);
    this.io = io;
  }

  // ============ 验证辅助 ============

  /** 验证并获取操作上下文，失败时通过 socket 返回错误 */
  private validateContext(socket: TypedSocket, expectedPhase?: GamePhase): ActionContext | null {
    const room = this.roomManager.getRoomBySocket(socket);
    if (!room) return null;

    const gameState = this.gameStates.get(room.id);
    if (!gameState) return null;
    if (gameState.paused) {
      socket.emit('game:error', { message: GAME_ERROR_MESSAGES.paused });
      return null;
    }
    if (this.phaseAdvancingRooms.has(room.id)) return null;
    if (expectedPhase && gameState.phase !== expectedPhase) return null;

    const player = this.roomManager.getPlayerBySocket(socket);
    if (!player) return null;

    return { room, gameState, player };
  }

  private getAliveTarget(room: Room, targetId: string): Player | null {
    const target = room.players.find(p => p.id === targetId);
    return target?.status === 'alive' ? target : null;
  }

  private getPlayerNumber(player: Player): number {
    return player.seatIndex + 1;
  }

  private isWolfPlayer(room: Room, player: Player): boolean {
    return player.role !== null && isWolfRole(player.role, room.config.hybridRoles);
  }

  private getWolfTeam(room: Room): string[] {
    return room.players
      .filter(player => this.isWolfPlayer(room, player))
      .map(player => player.id);
  }

  private getAliveWolves(room: Room): Player[] {
    return room.players.filter(player => this.isWolfPlayer(room, player) && player.status === 'alive');
  }

  private getAlivePlayers(room: Room): Player[] {
    return room.players.filter(player => player.status === 'alive');
  }

  private getWolfSelections(roomId: string): Map<string, string> {
    let selections = this.wolfSelections.get(roomId);
    if (!selections) {
      selections = new Map();
      this.wolfSelections.set(roomId, selections);
    }
    return selections;
  }

  private getWolfVotes(roomId: string): Map<string, string> {
    let votes = this.wolfVotes.get(roomId);
    if (!votes) {
      votes = new Map();
      this.wolfVotes.set(roomId, votes);
    }
    return votes;
  }

  private mapToRecord(map?: Map<string, string>): Record<string, string> {
    const record: Record<string, string> = {};
    map?.forEach((value, key) => {
      record[key] = value;
    });
    return record;
  }

  private emitWolfSelectionUpdate(room: Room, selections: Map<string, string>): void {
    // 狼队夜晚协商数据只能发给狼队成员，不能通过公共广播泄露给好人阵营。
    const payload = { selections: this.mapToRecord(selections) };
    room.players
      .filter(player => this.isWolfPlayer(room, player))
      .forEach(player => this.io.to(player.id).emit('game:wolfSelectionUpdate', payload));
  }

  private emitWolfVoteUpdate(room: Room, votes: Map<string, string>): void {
    // 确认刀票同样只属于狼队私有信息，避免非狼人通过实时状态推断夜晚结果。
    const payload = { wolfVotes: this.mapToRecord(votes) };
    room.players
      .filter(player => this.isWolfPlayer(room, player))
      .forEach(player => this.io.to(player.id).emit('game:wolfVoteUpdate', payload));
  }

  private hasAliveActorForPhase(room: Room, phase: GamePhase): boolean {
    const phaseAbilities: Partial<Record<GamePhase, RoleAbility[]>> = {
      [GamePhase.NIGHT_WEREWOLF]: [RoleAbility.WEREWOLF_KILL],
      [GamePhase.NIGHT_SEER]: [RoleAbility.SEER_CHECK],
      [GamePhase.NIGHT_GUARD]: [RoleAbility.GUARD_PROTECT],
      [GamePhase.NIGHT_WITCH]: [RoleAbility.WITCH_SAVE, RoleAbility.WITCH_POISON]
    };
    const abilities = phaseAbilities[phase];
    if (!abilities) return true;

    return room.players.some(player => {
      return player.status === 'alive' &&
        player.role !== null &&
        abilities.some(ability => roleHasAbility(player.role!, ability));
    });
  }

  getGameState(roomId: string): GameState | undefined {
    return this.gameStates.get(roomId);
  }

  private validatePlayerContext(roomId: string, playerId: string, expectedPhase?: GamePhase): ActionContext | null {
    const room = this.roomManager.getRoom(roomId);
    if (!room) return null;

    const gameState = this.gameStates.get(roomId);
    if (!gameState || gameState.paused) return null;
    if (this.phaseAdvancingRooms.has(roomId)) return null;
    if (expectedPhase && gameState.phase !== expectedPhase) return null;

    const player = room.players.find(roomPlayer => roomPlayer.id === playerId);
    if (!player) return null;

    return { room, gameState, player };
  }

  private setPhaseClock(gameState: GameState, phase: GamePhase, timer: number): number | null {
    // 所有阶段时间以服务端 endsAt 为准，客户端只做展示和本地倒计时校正。
    const endsAt = timer > 0 ? Date.now() + timer * 1000 : null;
    gameState.phase = phase;
    gameState.phaseTimer = timer;
    gameState.phaseEndsAt = endsAt;
    gameState.paused = false;
    gameState.pausedAt = null;
    gameState.remainingMs = null;
    return endsAt;
  }

  private emitPhaseChanged(roomId: string, phase: GamePhase, timer: number, speaking?: SpeakingState): number | null {
    const gameState = this.gameStates.get(roomId);
    const endsAt = gameState ? this.setPhaseClock(gameState, phase, timer) : (timer > 0 ? Date.now() + timer * 1000 : null);
    this.io.to(roomId).emit('game:phaseChanged', { phase, timer, endsAt, speaking });
    return endsAt;
  }

  private setHiddenPhase(roomId: string, phase: GamePhase, timer: number): number | null {
    const gameState = this.gameStates.get(roomId);
    return gameState ? this.setPhaseClock(gameState, phase, timer) : (timer > 0 ? Date.now() + timer * 1000 : null);
  }

  private toPublicDeathReason(reason: DeathReason): PublicDeathReason {
    return toPublicDeathReason(reason);
  }

  private addReviewEvent(
    roomId: string,
    event: Omit<ReviewEvent, 'id' | 'timestamp'>
  ): ReviewEvent | null {
    const gameState = this.gameStates.get(roomId);
    if (!gameState) return null;

    const reviewEvent: ReviewEvent = {
      ...event,
      id: generateMessageId(),
      timestamp: Date.now()
    };
    gameState.reviewEvents.push(reviewEvent);
    this.io.to(roomId).emit('game:reviewEvent', { event: reviewEvent });
    return reviewEvent;
  }

  private addNightResultReview(roomId: string, gameState: GameState, deadPlayers: DeathRecord[]): void {
    const nightDeaths = deadPlayers.filter(deadPlayer => isNightDeathReason(deadPlayer.reason));
    this.addReviewEvent(roomId, {
      day: gameState.day,
      phase: GamePhase.DAY_ANNOUNCE,
      type: 'night_result',
      deaths: nightDeaths.map(deadPlayer => ({
        playerId: deadPlayer.playerId,
        reason: toPublicDeathReason(deadPlayer.reason),
        day: gameState.day
      }))
    });
  }

  private addSkillTakeReview(roomId: string, gameState: GameState, actorId: string, targetId: string): void {
    this.addReviewEvent(roomId, {
      day: gameState.day,
      phase: GamePhase.DAY_RESOLVING,
      type: 'skill_take',
      actorId,
      targetId,
      deaths: [{ playerId: targetId, reason: toPublicDeathReason('shot'), day: gameState.day }]
    });
  }

  private shouldExposeDeadPlayer(dead: { reason: DeathReason; day: number }, gameState: GameState): boolean {
    // 狼王夜刀死亡会先进入隐藏开枪窗口；天亮公告前不能把夜晚死亡名单通过重连状态泄露出去。
    if (
      gameState.phase === GamePhase.WOLF_KING_SHOOT &&
      dead.day === gameState.day &&
      isNightDeathReason(dead.reason)
    ) {
      return false;
    }
    return true;
  }

  private getPublicGameState(gameState: GameState, viewerId?: string, phaseOverride?: GamePhase): PublicGameState {
    const {
      nightActions: _nightActions,
      seerCheckResult: _seerCheckResult,
      witchSaveUsed: _witchSaveUsed,
      witchPoisonUsed: _witchPoisonUsed,
      lastKilledPlayer: _lastKilledPlayer,
      lastGuardTarget: _lastGuardTarget,
      wolfKingCanShoot: _wolfKingCanShoot,
      wolfVotes: _wolfVotes,
      deadPlayers,
      votes,
      ...publicState
    } = gameState;

    return {
      ...publicState,
      phase: phaseOverride ?? gameState.phase,
      votes: viewerId && Object.prototype.hasOwnProperty.call(votes, viewerId)
        ? { [viewerId]: votes[viewerId] }
        : {},
      deadPlayers: deadPlayers
        .filter(dead => this.shouldExposeDeadPlayer(dead, gameState))
        .map(dead => ({
          ...dead,
          reason: this.toPublicDeathReason(dead.reason)
        }))
    };
  }

  private getHiddenPhaseActorId(roomId: string, gameState: GameState): string | null {
    if (gameState.phase === GamePhase.HUNTER_SHOOT) {
      return this.pendingHunterShots.get(roomId)?.playerId ?? null;
    }
    if (gameState.phase === GamePhase.WOLF_KING_SHOOT) {
      return gameState.lastKilledPlayer;
    }
    return null;
  }

  private isHiddenDeathSkillPhase(phase: GamePhase): boolean {
    return phase === GamePhase.HUNTER_SHOOT || phase === GamePhase.WOLF_KING_SHOOT;
  }

  private emitPrivateHiddenPhase(player: Player, gameState: GameState, timer: number, endsAt: number | null): void {
    if (gameState.phase === GamePhase.HUNTER_SHOOT) {
      this.io.to(player.id).emit('game:hunterRequired', { playerId: player.id, timer, endsAt });
      return;
    }
    if (gameState.phase === GamePhase.WOLF_KING_SHOOT) {
      this.io.to(player.id).emit('game:wolfKingRequired', { playerId: player.id, timer, endsAt });
    }
  }

  private emitPhaseToPlayer(player: Player, gameState: GameState, timer: number, endsAt: number | null, event: 'game:phaseChanged' | 'game:resumed'): void {
    if (this.isHiddenDeathSkillPhase(gameState.phase)) {
      const actorId = this.getHiddenPhaseActorId(player.roomId, gameState);
      if (actorId === player.id) {
        this.emitPrivateHiddenPhase(player, gameState, timer, endsAt);
      } else {
        this.io.to(player.id).emit(event, {
          phase: GamePhase.DAY_RESOLVING,
          timer,
          endsAt
        });
      }
      return;
    }

    this.io.to(player.id).emit(event, {
      phase: gameState.phase,
      timer,
      endsAt,
      speaking: gameState.speaking ?? undefined
    });
  }

  private emitPlayerDead(roomId: string, playerId: string, reason: DeathReason, day: number): void {
    this.io.to(roomId).emit('game:playerDead', {
      playerId,
      reason: this.toPublicDeathReason(reason),
      day
    });
  }

  private emitDeathRecords(roomId: string, deaths: DeathRecord[], day: number): void {
    deaths.forEach(death => {
      this.emitPlayerDead(roomId, death.playerId, death.reason, day);
    });
  }

  private emitWitchInfo(room: Room, player?: Player): void {
    const actions = this.nightActions.get(room.id);
    const killedPlayerId = actions?.get('wolfKill')?.targetId ?? null;
    const recipients = player ? [player] : room.players;

    recipients
      .filter(candidate =>
        candidate.status === 'alive' &&
        candidate.role !== null &&
        (
          roleHasAbility(candidate.role, RoleAbility.WITCH_SAVE) ||
          roleHasAbility(candidate.role, RoleAbility.WITCH_POISON)
        )
      )
      .forEach(candidate => {
        this.io.to(candidate.id).emit('game:witchInfo', { killedPlayerId });
      });
  }

  private emitSkillState(room: Room, player?: Player): void {
    const recipients = player ? [player] : room.players;

    recipients
      .filter(candidate => candidate.role !== null)
      .forEach(candidate => {
        const skillState: {
          witch?: { saveAvailable: boolean; poisonAvailable: boolean };
          guard?: { lastGuardTargetId: string | null };
        } = {};

        if (
          candidate.role &&
          (
            roleHasAbility(candidate.role, RoleAbility.WITCH_SAVE) ||
            roleHasAbility(candidate.role, RoleAbility.WITCH_POISON)
          )
        ) {
          skillState.witch = {
            saveAvailable: !candidate.skillUsed.witchSave,
            poisonAvailable: !candidate.skillUsed.witchPoison
          };
        }

        if (candidate.role && roleHasAbility(candidate.role, RoleAbility.GUARD_PROTECT)) {
          skillState.guard = {
            lastGuardTargetId: candidate.skillUsed.lastGuardTarget
          };
        }

        if (skillState.witch || skillState.guard) {
          this.io.to(candidate.id).emit('game:skillState', skillState);
        }
      });
  }

  private clearPhaseTimer(roomId: string, clearCallback = true): void {
    const timeout = this.phaseTimers.get(roomId);
    if (timeout) clearTimeout(timeout);
    this.phaseTimers.delete(roomId);
    if (clearCallback) {
      this.phaseTimeoutCallbacks.delete(roomId);
      this.phaseAdvancingRooms.delete(roomId);
    }
  }

  private schedulePhaseTimeout(roomId: string, ms: number, callback: () => void): void {
    this.clearPhaseTimer(roomId);
    this.phaseTimeoutCallbacks.set(roomId, callback);

    const timeout = setTimeout(() => {
      this.phaseTimers.delete(roomId);
      this.phaseTimeoutCallbacks.delete(roomId);

      const gameState = this.gameStates.get(roomId);
      if (!gameState || gameState.paused) return;

      callback();
    }, Math.max(0, ms));

    this.phaseTimers.set(roomId, timeout);
  }

  private schedulePhaseAdvance(roomId: string, callback: () => void): void {
    this.schedulePhaseTimeout(roomId, PHASE_ADVANCE_DELAY_MS, () => {
      this.phaseAdvancingRooms.delete(roomId);
      callback();
    });
    this.phaseAdvancingRooms.add(roomId);
  }

  private startHunterShot(roomId: string, hunterId: string, resume: () => void): void {
    const room = this.roomManager.getRoom(roomId);
    const gameState = this.gameStates.get(roomId);
    if (!room || !gameState || this.hunterShotsUsed.has(hunterId)) {
      resume();
      return;
    }

    this.pendingHunterShots.set(roomId, { playerId: hunterId, resume });
    const timer = PHASE_DURATION_SECONDS.deathSkill;
    const endsAt = this.setHiddenPhase(roomId, GamePhase.HUNTER_SHOOT, timer);
    // 只通知猎人本人显示操作入口；其他玩家只看到安全的结算等待阶段。
    room.players.forEach(player => {
      this.emitPhaseToPlayer(player, gameState, timer, endsAt, 'game:phaseChanged');
    });

    this.schedulePhaseTimeout(roomId, timer * 1000, () => {
      const pending = this.pendingHunterShots.get(roomId);
      if (pending?.playerId !== hunterId) return;
      this.hunterShotsUsed.add(hunterId);
      this.pendingHunterShots.delete(roomId);
      this.addReviewEvent(roomId, {
        day: gameState.day,
        phase: GamePhase.DAY_RESOLVING,
        type: 'skill_pass',
        actorId: hunterId
      });
      resume();
    });
  }

  private passHunterShot(roomId: string, hunterId: string): boolean {
    const pending = this.pendingHunterShots.get(roomId);
    if (!pending || pending.playerId !== hunterId) return false;
    const gameState = this.gameStates.get(roomId);

    this.hunterShotsUsed.add(hunterId);
    this.pendingHunterShots.delete(roomId);
    this.clearPhaseTimer(roomId);
    if (gameState) {
      this.addReviewEvent(roomId, {
        day: gameState.day,
        phase: GamePhase.DAY_RESOLVING,
        type: 'skill_pass',
        actorId: hunterId
      });
    }
    pending.resume();
    return true;
  }

  private executeHunterShot(ctx: ActionContext, targetId: string): boolean {
    const pending = this.pendingHunterShots.get(ctx.room.id);
    if (!pending || pending.playerId !== ctx.player.id || this.hunterShotsUsed.has(ctx.player.id)) return false;

    const target = this.getAliveTarget(ctx.room, targetId);
    if (!target) return false;

    this.hunterShotsUsed.add(ctx.player.id);
    // 被猎人开枪带走的目标只记录死亡，不再触发新的猎人/狼王死亡技能。
    const shotPlayer = this.engine.killPlayer(ctx.room, ctx.gameState, targetId, 'shot');
    if (shotPlayer) {
      this.emitPlayerDead(ctx.room.id, targetId, 'shot', ctx.gameState.day);
      this.addSkillTakeReview(ctx.room.id, ctx.gameState, ctx.player.id, targetId);
    }
    this.pendingHunterShots.delete(ctx.room.id);
    this.clearPhaseTimer(ctx.room.id);

    const winner = this.engine.checkWinner(ctx.room);
    if (winner) {
      this.endGame(ctx.room.id, winner);
      return true;
    }

    pending.resume();
    return true;
  }

  private executeWolfKingShot(ctx: ActionContext, targetId: string): boolean {
    if (!ctx.gameState.wolfKingCanShoot) return false;

    const target = this.getAliveTarget(ctx.room, targetId);
    if (!target) return false;

    // 狼王开枪同样不触发二次死亡技能，避免技能链式结算。
    const shotPlayer = this.engine.killPlayer(ctx.room, ctx.gameState, targetId, 'shot');

    ctx.gameState.wolfKingCanShoot = false;
    this.clearPhaseTimer(ctx.room.id);

    const deaths: DeathRecord[] = [
      { playerId: ctx.gameState.lastKilledPlayer!, reason: 'killed' }
    ];
    if (shotPlayer) deaths.push({ playerId: targetId, reason: 'shot' });

    const winner = this.engine.checkWinner(ctx.room);
    if (winner) {
      this.addNightResultReview(ctx.room.id, ctx.gameState, deaths);
      if (shotPlayer) {
        this.addSkillTakeReview(ctx.room.id, ctx.gameState, ctx.player.id, targetId);
      }
      this.emitDeathRecords(ctx.room.id, deaths, ctx.gameState.day);
      this.endGame(ctx.room.id, winner);
      return true;
    }

    this.startDayPhase(ctx.room.id, deaths);
    return true;
  }

  private startLastWords(roomId: string, playerId: string, resume: () => void): void {
    const gameState = this.gameStates.get(roomId);
    if (!gameState) {
      resume();
      return;
    }
    // 遗言复用 SpeakingState，使客户端同一套“发言完毕”按钮可以完成遗言。
    const speaking = { order: [playerId], currentIndex: 0, confirmed: [] };
    gameState.speaking = speaking;
    const timer = PHASE_DURATION_SECONDS.lastWords;
    this.emitPhaseChanged(roomId, GamePhase.LAST_WORDS, timer);
    this.io.to(roomId).emit('game:speakingUpdate', { speaking });
    this.schedulePhaseTimeout(roomId, timer * 1000, resume);
  }

  private completeLastWords(roomId: string, playerId?: string): void {
    const gameState = this.gameStates.get(roomId);
    if (!gameState || gameState.phase !== GamePhase.LAST_WORDS || !gameState.speaking) return;

    const currentSpeakerId = gameState.speaking.order[gameState.speaking.currentIndex];
    if (playerId && playerId !== currentSpeakerId) return;

    if (currentSpeakerId && !gameState.speaking.confirmed.includes(currentSpeakerId)) {
      gameState.speaking.confirmed.push(currentSpeakerId);
    }
    this.io.to(roomId).emit('game:speakingUpdate', { speaking: gameState.speaking });

    const callback = this.phaseTimeoutCallbacks.get(roomId);
    this.clearPhaseTimer(roomId);
    gameState.speaking = null;
    callback?.();
  }

  /** 清除当前阶段计时器并推进到下一个夜晚子阶段 */
  private advanceNightPhase(roomId: string, currentPhase: GamePhase): void {
    const room = this.roomManager.getRoom(roomId);
    if (!room) return;

    this.clearPhaseTimer(roomId);

    const phases = this.engine.getNightPhases(room);
    const currentIndex = phases.indexOf(currentPhase);
    this.schedulePhaseAdvance(roomId, () => this.runNightPhases(roomId, phases, currentIndex + 1));
  }

  // ============ 游戏生命周期 ============

  startGame(socket: TypedSocket): void {
    const room = this.roomManager.getRoomBySocket(socket);
    if (!room) {
      socket.emit('game:error', { message: GAME_ERROR_MESSAGES.roomNotFound });
      return;
    }
    const host = this.roomManager.getPlayerBySocket(socket);
    if (!host || room.hostId !== host.id) {
      socket.emit('game:error', { message: GAME_ERROR_MESSAGES.hostOnlyStart });
      return;
    }
    if (room.players.length !== room.config.maxPlayers) {
      socket.emit('game:error', { message: roomNotFullMessage(room.config.maxPlayers) });
      return;
    }
    if (room.players.some(player => !player.online)) {
      socket.emit('game:error', { message: GAME_ERROR_MESSAGES.playerOffline });
      return;
    }
    if (room.players.some(player => player.id !== room.hostId && !player.isReady)) {
      socket.emit('game:error', { message: GAME_ERROR_MESSAGES.nonHostPlayersNotReady });
      return;
    }

    room.players.forEach(player => {
      player.role = null;
      player.status = 'alive';
      player.voteTarget = null;
      player.skillUsed = { witchSave: false, witchPoison: false, lastGuardTarget: null };
    });

    this.engine.assignRoles(room);

    const gameState = this.engine.createInitialGameState();
    room.status = 'playing';
    this.gameStates.set(room.id, gameState);
    this.nightActions.set(room.id, new Map());
    this.roleConfirmations.set(room.id, new Set());
    this.witchSavedTonight.delete(room.id);
    this.pendingHunterShots.delete(room.id);
    room.players.forEach(player => this.hunterShotsUsed.delete(player.id));

    const confirmTime = room.config.roleConfirmTime;
    this.setPhaseClock(gameState, GamePhase.ROLE_CONFIRM, confirmTime);
    // 狼队成员只发给狼人，避免好人客户端拿到完整狼队列表。
    const wolfTeam = this.getWolfTeam(room);
    room.players.forEach(player => {
      this.io.to(player.id).emit('game:started', {
        gameState: this.getPublicGameState(gameState, player.id),
        myRole: player.role!,
        wolfTeam: this.isWolfPlayer(room, player) ? wolfTeam : undefined
      });
      this.emitSkillState(room, player);
    });

    // 确认身份：手动确认 + 倒计时双重机制
    this.io.to(room.id).emit('game:phaseChanged', {
      phase: GamePhase.ROLE_CONFIRM,
      timer: confirmTime,
      endsAt: gameState.phaseEndsAt
    });

    this.schedulePhaseTimeout(room.id, confirmTime * 1000, () => {
      this.startNightPhase(room.id);
    });
  }

  confirmRole(socket: TypedSocket): void {
    const room = this.roomManager.getRoomBySocket(socket);
    if (!room) return;

    const gameState = this.gameStates.get(room.id);
    if (!gameState || gameState.phase !== GamePhase.ROLE_CONFIRM) return;
    if (gameState.paused) {
      socket.emit('game:error', { message: GAME_ERROR_MESSAGES.paused });
      return;
    }

    const confirmed = this.roleConfirmations.get(room.id);
    const player = this.roomManager.getPlayerBySocket(socket);
    if (!player || !confirmed || confirmed.has(player.id)) return;

    confirmed.add(player.id);

    // 广播给房间内所有人（让客户端显示谁已确认）
    this.io.to(room.id).emit('game:roleConfirmed', { playerId: player.id });

    // 所有玩家都确认，立即进入夜晚
    if (confirmed.size >= room.players.length) {
      this.clearPhaseTimer(room.id);
      this.startNightPhase(room.id);
    }
  }

  confirmRoleByPlayer(roomId: string, playerId: string): boolean {
    const ctx = this.validatePlayerContext(roomId, playerId, GamePhase.ROLE_CONFIRM);
    if (!ctx) return false;

    const confirmed = this.roleConfirmations.get(roomId);
    if (!confirmed || confirmed.has(playerId)) return false;

    confirmed.add(playerId);
    this.io.to(roomId).emit('game:roleConfirmed', { playerId });

    if (confirmed.size >= ctx.room.players.length) {
      this.clearPhaseTimer(roomId);
      this.startNightPhase(roomId);
    }
    return true;
  }

  reconnect(socket: TypedSocket, sessionId: string): void {
    const room = this.roomManager.reconnectRoom(socket, sessionId);
    if (!room) return;

    const player = this.roomManager.getPlayerBySocket(socket);
    if (!player || room.status === 'waiting') return;

    const gameState = this.gameStates.get(room.id);
    if (!gameState) return;

    // 重连时重放私有信息和当前阶段，否则刷新页面会丢失身份/狼队视图。
    const wolfTeam = this.getWolfTeam(room);

    const isHiddenPhase = this.isHiddenDeathSkillPhase(gameState.phase);
    const isHiddenActor = this.getHiddenPhaseActorId(room.id, gameState) === player.id;
    const publicPhase = isHiddenPhase && !isHiddenActor
      ? GamePhase.DAY_RESOLVING
      : undefined;

    this.io.to(player.id).emit('game:started', {
      gameState: this.getPublicGameState(gameState, player.id, publicPhase),
      myRole: player.role!,
      wolfTeam: this.isWolfPlayer(room, player) ? wolfTeam : undefined
    });
    this.emitSkillState(room, player);

    if (gameState.paused) {
      this.io.to(player.id).emit('game:paused', { remainingMs: gameState.remainingMs });
    } else {
      this.emitPhaseToPlayer(player, gameState, gameState.phaseTimer, gameState.phaseEndsAt, 'game:phaseChanged');
    }

    const confirmed = this.roleConfirmations.get(room.id);
    confirmed?.forEach(playerId => {
      this.io.to(player.id).emit('game:roleConfirmed', { playerId });
    });

    if (this.isWolfPlayer(room, player)) {
      this.io.to(player.id).emit('game:wolfSelectionUpdate', {
        selections: this.mapToRecord(this.wolfSelections.get(room.id))
      });
      this.io.to(player.id).emit('game:wolfVoteUpdate', {
        wolfVotes: this.mapToRecord(this.wolfVotes.get(room.id))
      });
    }

    if (gameState.phase === GamePhase.NIGHT_WITCH) {
      this.emitWitchInfo(room, player);
    }
  }

  pauseGame(socket: TypedSocket): void {
    const room = this.roomManager.getRoomBySocket(socket);
    const player = this.roomManager.getPlayerBySocket(socket);
    if (!room || !player) return;
    if (room.hostId !== player.id) {
      socket.emit('game:error', { message: GAME_ERROR_MESSAGES.hostOnlyPause });
      return;
    }
    if (room.status !== 'playing') {
      socket.emit('game:error', { message: GAME_ERROR_MESSAGES.pauseOnlyWhenPlaying });
      return;
    }

    const gameState = this.gameStates.get(room.id);
    if (!gameState || gameState.phase === GamePhase.GAME_OVER) return;
    if (gameState.paused) return;

    const now = Date.now();
    const remainingMs = gameState.phaseEndsAt !== null
      ? Math.max(0, gameState.phaseEndsAt - now)
      : gameState.phaseTimer > 0
      ? gameState.phaseTimer * 1000
      : null;

    this.clearPhaseTimer(room.id, false);
    gameState.paused = true;
    gameState.pausedAt = now;
    gameState.remainingMs = remainingMs;
    gameState.phaseEndsAt = null;
    gameState.phaseTimer = remainingMs !== null ? Math.ceil(remainingMs / 1000) : 0;

    this.io.to(room.id).emit('game:paused', { remainingMs });
  }

  resumeGame(socket: TypedSocket): void {
    const room = this.roomManager.getRoomBySocket(socket);
    const player = this.roomManager.getPlayerBySocket(socket);
    if (!room || !player) return;
    if (room.hostId !== player.id) {
      socket.emit('game:error', { message: GAME_ERROR_MESSAGES.hostOnlyResume });
      return;
    }

    const gameState = this.gameStates.get(room.id);
    if (!gameState || !gameState.paused || gameState.phase === GamePhase.GAME_OVER) return;

    const remainingMs = gameState.remainingMs ?? 0;
    const timer = Math.ceil(remainingMs / 1000);
    const endsAt = remainingMs > 0 ? Date.now() + remainingMs : null;
    const callback = this.phaseTimeoutCallbacks.get(room.id);
    const wasAdvancing = this.phaseAdvancingRooms.has(room.id);

    gameState.paused = false;
    gameState.pausedAt = null;
    gameState.remainingMs = null;
    gameState.phaseTimer = timer;
    gameState.phaseEndsAt = endsAt;

    if (callback) {
      this.schedulePhaseTimeout(room.id, remainingMs, callback);
      if (wasAdvancing) this.phaseAdvancingRooms.add(room.id);
    }

    room.players.forEach(roomPlayer => {
      this.emitPhaseToPlayer(roomPlayer, gameState, timer, endsAt, 'game:resumed');
    });
  }

  // ============ 夜晚阶段 ============

  private startNightPhase(roomId: string): void {
    const room = this.roomManager.getRoom(roomId);
    const gameState = this.gameStates.get(roomId);
    if (!room || !gameState) return;

    this.nightActions.set(roomId, new Map());
    this.wolfVotes.set(roomId, new Map());
    this.wolfSelections.set(roomId, new Map());
    this.witchSavedTonight.set(roomId, false);
    const phases = this.engine.getNightPhases(room);
    this.runNightPhases(roomId, phases, 0);
  }

  private emitNightPhasePrivateInfo(room: Room, phase: GamePhase): void {
    if (phase === GamePhase.NIGHT_WITCH) {
      this.emitWitchInfo(room);
      this.emitSkillState(room);
    }
    if (phase === GamePhase.NIGHT_GUARD) {
      this.emitSkillState(room);
    }
  }

  private handleNightPhaseTimeout(roomId: string, phases: GamePhase[], index: number, phase: GamePhase): void {
    // 狼人阶段超时：未确认视为弃票，按已确认狼票结算。
    if (phase === GamePhase.NIGHT_WEREWOLF) {
      this.resolveWolfPhase(roomId, true);
      return;
    }
    this.runNightPhases(roomId, phases, index + 1);
  }

  private runNightPhases(roomId: string, phases: GamePhase[], index: number): void {
    if (index >= phases.length) {
      this.resolveNight(roomId);
      return;
    }

    const room = this.roomManager.getRoom(roomId);
    const gameState = this.gameStates.get(roomId);
    if (!room || !gameState) return;

    const phase = phases[index];
    if (!this.hasAliveActorForPhase(room, phase)) {
      // 对应角色不存在或已死亡时跳过该夜晚子阶段，保证自动流程不停住。
      this.runNightPhases(roomId, phases, index + 1);
      return;
    }

    const timer = PHASE_DURATION_SECONDS.nightAction;
    this.emitPhaseChanged(roomId, phase, timer);
    this.emitNightPhasePrivateInfo(room, phase);

    this.schedulePhaseTimeout(roomId, timer * 1000, () => {
      this.handleNightPhaseTimeout(roomId, phases, index, phase);
    });
  }

  private executeWolfSelection(ctx: ActionContext, targetId: string): boolean {
    if (!ctx.player.role || !roleHasAbility(ctx.player.role, RoleAbility.WEREWOLF_KILL) || ctx.player.status === 'dead') return false;

    const target = this.getAliveTarget(ctx.room, targetId);
    if (!target || !this.canWolfTarget(ctx.room, target)) return false;

    const selections = this.getWolfSelections(ctx.room.id);
    selections.set(ctx.player.id, targetId);
    this.emitWolfSelectionUpdate(ctx.room, selections);
    return true;
  }

  private executeWolfConfirmVote(ctx: ActionContext): WolfConfirmResult {
    if (!ctx.player.role || !roleHasAbility(ctx.player.role, RoleAbility.WEREWOLF_KILL) || ctx.player.status === 'dead') return 'invalid_target';

    const selections = this.wolfSelections.get(ctx.room.id);
    const targetId = selections?.get(ctx.player.id);
    if (!targetId) return 'missing_target';

    const target = this.getAliveTarget(ctx.room, targetId);
    if (!target || !this.canWolfTarget(ctx.room, target)) {
      selections?.delete(ctx.player.id);
      return 'invalid_target';
    }

    const votes = this.getWolfVotes(ctx.room.id);
    votes.set(ctx.player.id, targetId);
    this.emitWolfVoteUpdate(ctx.room, votes);

    if (this.getAliveWolves(ctx.room).every(wolf => votes.has(wolf.id))) {
      this.resolveWolfPhase(ctx.room.id);
    }
    return 'ok';
  }

  werewolfKill(socket: TypedSocket, targetId: string): void {
    const ctx = this.validateContext(socket, GamePhase.NIGHT_WEREWOLF);
    if (!ctx || !ctx.player.role || !roleHasAbility(ctx.player.role, RoleAbility.WEREWOLF_KILL) || ctx.player.status === 'dead') return;

    const target = this.getAliveTarget(ctx.room, targetId);
    if (!target) return;
    if (!this.canWolfTarget(ctx.room, target)) {
      socket.emit('game:error', { message: GAME_ERROR_MESSAGES.wolfFriendlyFireForbidden });
      return;
    }

    this.executeWolfSelection(ctx, targetId);
  }

  werewolfKillByPlayer(roomId: string, playerId: string, targetId: string): boolean {
    const ctx = this.validatePlayerContext(roomId, playerId, GamePhase.NIGHT_WEREWOLF);
    if (!ctx) return false;
    return this.executeWolfSelection(ctx, targetId);
  }

  wolfConfirmVote(socket: TypedSocket): void {
    const ctx = this.validateContext(socket, GamePhase.NIGHT_WEREWOLF);
    if (!ctx || !ctx.player.role || !roleHasAbility(ctx.player.role, RoleAbility.WEREWOLF_KILL) || ctx.player.status === 'dead') return;

    const result = this.executeWolfConfirmVote(ctx);
    if (result === 'missing_target') {
      socket.emit('game:error', { message: GAME_ERROR_MESSAGES.wolfTargetRequired });
      return;
    }
    if (result === 'invalid_target') {
      socket.emit('game:error', { message: GAME_ERROR_MESSAGES.wolfFriendlyFireForbidden });
    }
  }

  wolfConfirmVoteByPlayer(roomId: string, playerId: string): boolean {
    const ctx = this.validatePlayerContext(roomId, playerId, GamePhase.NIGHT_WEREWOLF);
    if (!ctx) return false;
    return this.executeWolfConfirmVote(ctx) === 'ok';
  }

  wolfSelfReveal(socket: TypedSocket): void {
    const ctx = this.validateContext(socket);
    if (!ctx) return;

    const result = this.executeWolfSelfReveal(ctx.room, ctx.gameState, ctx.player);
    if (!result.ok && result.error) {
      socket.emit('game:error', { message: result.error });
    }
  }

  wolfSelfRevealByPlayer(roomId: string, playerId: string): boolean {
    const ctx = this.validatePlayerContext(roomId, playerId);
    if (!ctx) return false;

    return this.executeWolfSelfReveal(ctx.room, ctx.gameState, ctx.player).ok;
  }

  whiteWolfKingExplode(socket: TypedSocket, targetId: string): void {
    const ctx = this.validateContext(socket);
    if (!ctx) return;

    const result = this.executeWhiteWolfKingExplode(ctx.room, ctx.gameState, ctx.player, targetId);
    if (!result.ok && result.error) {
      socket.emit('game:error', { message: result.error });
    }
  }

  whiteWolfKingExplodeByPlayer(roomId: string, playerId: string, targetId: string): boolean {
    const ctx = this.validatePlayerContext(roomId, playerId);
    if (!ctx) return false;

    return this.executeWhiteWolfKingExplode(ctx.room, ctx.gameState, ctx.player, targetId).ok;
  }

  private executeWolfSelfReveal(room: Room, gameState: GameState, player: Player): { ok: boolean; error?: string } {
    const result = this.wolfSelfRevealAction.execute(room, gameState, player);
    if (!result.ok) return { ok: false, error: result.error };

    this.clearPhaseTimer(room.id);
    gameState.speaking = null;
    gameState.votes = {};
    this.wolfVotes.set(room.id, new Map());
    this.wolfSelections.set(room.id, new Map());

    this.emitPlayerDead(room.id, player.id, 'self_exposed', gameState.day);
    this.addReviewEvent(room.id, {
      day: gameState.day,
      phase: gameState.phase,
      type: 'self_reveal',
      actorId: player.id,
      interrupted: true,
      deaths: [{ playerId: player.id, reason: 'self_exposed', day: gameState.day }]
    });
    this.io.to(room.id).emit('game:systemMessage', {
      id: generateMessageId(),
      content: wolfSelfRevealMessage(this.getPlayerNumber(player), player.name),
      timestamp: Date.now()
    });

    if (result.winner) {
      this.endGame(room.id, result.winner);
      return { ok: true };
    }

    gameState.day++;
    const transitionSeconds = PHASE_DURATION_SECONDS.selfRevealTransition;
    this.emitPhaseChanged(room.id, GamePhase.DAY_SELF_REVEAL, transitionSeconds);
    this.schedulePhaseTimeout(room.id, transitionSeconds * 1000, () => this.startNightPhase(room.id));
    return { ok: true };
  }

  private executeWhiteWolfKingExplode(
    room: Room,
    gameState: GameState,
    player: Player,
    targetId: string
  ): { ok: boolean; error?: string } {
    const target = room.players.find(candidate => candidate.id === targetId);
    const result = this.whiteWolfKingExplodeAction.execute(room, gameState, player, targetId);
    if (!result.ok) return { ok: false, error: result.error };

    this.clearPhaseTimer(room.id);
    gameState.speaking = null;
    gameState.votes = {};
    this.wolfVotes.set(room.id, new Map());
    this.wolfSelections.set(room.id, new Map());

    this.emitPlayerDead(room.id, player.id, 'self_exposed', gameState.day);
    this.emitPlayerDead(room.id, targetId, 'exploded', gameState.day);
    this.addReviewEvent(room.id, {
      day: gameState.day,
      phase: gameState.phase,
      type: 'self_reveal_take',
      actorId: player.id,
      targetId,
      interrupted: true,
      deaths: [
        { playerId: player.id, reason: 'self_exposed', day: gameState.day },
        { playerId: targetId, reason: 'exploded', day: gameState.day }
      ]
    });
    this.io.to(room.id).emit('game:systemMessage', {
      id: generateMessageId(),
      content: whiteWolfKingExplodeMessage(
        this.getPlayerNumber(player),
        player.name,
        target ? `${this.getPlayerNumber(target)}号 ${target.name}` : '一名玩家'
      ),
      timestamp: Date.now()
    });

    if (result.winner) {
      this.endGame(room.id, result.winner);
      return { ok: true };
    }

    gameState.day++;
    const transitionSeconds = PHASE_DURATION_SECONDS.selfRevealTransition;
    this.emitPhaseChanged(room.id, GamePhase.DAY_SELF_REVEAL, transitionSeconds);
    this.schedulePhaseTimeout(room.id, transitionSeconds * 1000, () => this.startNightPhase(room.id));
    return { ok: true };
  }

  /** 狼人阶段结算：未确认=弃票；无已确认狼票时随机刀存活非狼人，平票随机，否则多数票 */
  private resolveWolfPhase(roomId: string, _timedOut = false): void {
    const room = this.roomManager.getRoom(roomId);
    const votes = this.wolfVotes.get(roomId);
    if (!room) return;

    const wolves = this.getAliveWolves(room);
    const finalTarget = (votes && votes.size > 0)
      ? this.resolveWolfVote(votes, wolves)
      : this.pickRandomAliveNonWolf(room);

    const actions = this.nightActions.get(roomId);
    if (actions && finalTarget) actions.set('wolfKill', { targetId: finalTarget });

    this.clearPhaseTimer(roomId);
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

  private pickRandomAliveNonWolf(room: Room): string | null {
    const candidates = room.players.filter(player =>
      player.status === 'alive' &&
      !this.isWolfPlayer(room, player)
    );
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)].id;
  }

  private canWolfTarget(room: Room, target: Player): boolean {
    if (room.config.allowWolfFriendlyFire) return true;
    return !this.isWolfPlayer(room, target);
  }

  seerCheck(socket: TypedSocket, targetId: string): void {
    const ctx = this.validateContext(socket, GamePhase.NIGHT_SEER);
    if (!ctx || !ctx.player.role || !roleHasAbility(ctx.player.role, RoleAbility.SEER_CHECK) || ctx.player.status === 'dead') return;

    const target = this.getAliveTarget(ctx.room, targetId);
    if (!target) return;

    socket.emit('game:seerResult', {
      playerId: targetId,
      isWerewolf: target.role !== null && roleRevealsAsWolf(target.role),
      day: ctx.gameState.day
    });
    this.advanceNightPhase(ctx.room.id, GamePhase.NIGHT_SEER);
  }

  seerCheckByPlayer(roomId: string, playerId: string, targetId: string): boolean {
    const ctx = this.validatePlayerContext(roomId, playerId, GamePhase.NIGHT_SEER);
    if (!ctx || !ctx.player.role || !roleHasAbility(ctx.player.role, RoleAbility.SEER_CHECK) || ctx.player.status === 'dead') return false;

    const target = this.getAliveTarget(ctx.room, targetId);
    if (!target) return false;

    this.advanceNightPhase(ctx.room.id, GamePhase.NIGHT_SEER);
    return true;
  }

  witchSave(socket: TypedSocket): void {
    const ctx = this.validateContext(socket, GamePhase.NIGHT_WITCH);
    if (!ctx || !ctx.player.role || !roleHasAbility(ctx.player.role, RoleAbility.WITCH_SAVE) || ctx.player.status === 'dead') return;

    const actions = this.nightActions.get(ctx.room.id);
    const killedTargetId = actions?.get('wolfKill')?.targetId ?? null;
    if (!killedTargetId) {
      socket.emit('game:error', { message: GAME_ERROR_MESSAGES.witchNoSaveTarget });
      return;
    }
    if (killedTargetId === ctx.player.id && !ctx.room.config.allowWitchSelfSave) {
      socket.emit('game:error', { message: GAME_ERROR_MESSAGES.witchSelfSaveForbidden });
      return;
    }
    if (ctx.player.skillUsed.witchSave) {
      socket.emit('game:error', { message: GAME_ERROR_MESSAGES.witchSaveUsed });
      return;
    }
    if (ctx.gameState.witchSaveUsed) {
      socket.emit('game:error', { message: GAME_ERROR_MESSAGES.witchSaveUsedThisGame });
      return;
    }

    ctx.player.skillUsed.witchSave = true;
    ctx.gameState.witchSaveUsed = true;
    this.witchSavedTonight.set(ctx.room.id, true);
    this.emitSkillState(ctx.room, ctx.player);
    this.advanceNightPhase(ctx.room.id, GamePhase.NIGHT_WITCH);
  }

  witchPass(socket: TypedSocket): void {
    const ctx = this.validateContext(socket, GamePhase.NIGHT_WITCH);
    if (
      !ctx ||
      !ctx.player.role ||
      (
        !roleHasAbility(ctx.player.role, RoleAbility.WITCH_SAVE) &&
        !roleHasAbility(ctx.player.role, RoleAbility.WITCH_POISON)
      ) ||
      ctx.player.status === 'dead'
    ) {
      return;
    }

    this.advanceNightPhase(ctx.room.id, GamePhase.NIGHT_WITCH);
  }

  witchPoison(socket: TypedSocket, targetId: string): void {
    const ctx = this.validateContext(socket, GamePhase.NIGHT_WITCH);
    if (!ctx || !ctx.player.role || !roleHasAbility(ctx.player.role, RoleAbility.WITCH_POISON) || ctx.player.status === 'dead') return;

    if (ctx.player.skillUsed.witchPoison) {
      socket.emit('game:error', { message: GAME_ERROR_MESSAGES.witchPoisonUsed });
      return;
    }

    const target = this.getAliveTarget(ctx.room, targetId);
    if (!target || target.id === ctx.player.id) return;

    const actions = this.nightActions.get(ctx.room.id);
    if (actions) actions.set('witchPoison', { targetId });

    ctx.player.skillUsed.witchPoison = true;
    ctx.gameState.witchPoisonUsed = true;
    this.emitSkillState(ctx.room, ctx.player);
    this.advanceNightPhase(ctx.room.id, GamePhase.NIGHT_WITCH);
  }

  witchPassByPlayer(roomId: string, playerId: string): boolean {
    const ctx = this.validatePlayerContext(roomId, playerId, GamePhase.NIGHT_WITCH);
    if (
      !ctx ||
      !ctx.player.role ||
      (
        !roleHasAbility(ctx.player.role, RoleAbility.WITCH_SAVE) &&
        !roleHasAbility(ctx.player.role, RoleAbility.WITCH_POISON)
      ) ||
      ctx.player.status === 'dead'
    ) {
      return false;
    }

    this.advanceNightPhase(ctx.room.id, GamePhase.NIGHT_WITCH);
    return true;
  }

  guardProtect(socket: TypedSocket, targetId: string): void {
    const ctx = this.validateContext(socket, GamePhase.NIGHT_GUARD);
    if (!ctx || !ctx.player.role || !roleHasAbility(ctx.player.role, RoleAbility.GUARD_PROTECT) || ctx.player.status === 'dead') return;

    if (ctx.player.skillUsed.lastGuardTarget === targetId) {
      socket.emit('game:error', { message: GAME_ERROR_MESSAGES.guardCannotRepeatTarget });
      return;
    }

    const target = this.getAliveTarget(ctx.room, targetId);
    if (!target) return;

    const actions = this.nightActions.get(ctx.room.id);
    if (actions) actions.set('guardProtect', { targetId });

    ctx.player.skillUsed.lastGuardTarget = targetId;
    this.emitSkillState(ctx.room, ctx.player);
    this.advanceNightPhase(ctx.room.id, GamePhase.NIGHT_GUARD);
  }

  guardProtectByPlayer(roomId: string, playerId: string, targetId: string): boolean {
    const ctx = this.validatePlayerContext(roomId, playerId, GamePhase.NIGHT_GUARD);
    if (!ctx || !ctx.player.role || !roleHasAbility(ctx.player.role, RoleAbility.GUARD_PROTECT) || ctx.player.status === 'dead') return false;
    if (ctx.player.skillUsed.lastGuardTarget === targetId) return false;

    const target = this.getAliveTarget(ctx.room, targetId);
    if (!target) return false;

    const actions = this.nightActions.get(ctx.room.id);
    if (actions) actions.set('guardProtect', { targetId });

    ctx.player.skillUsed.lastGuardTarget = targetId;
    this.emitSkillState(ctx.room, ctx.player);
    this.advanceNightPhase(ctx.room.id, GamePhase.NIGHT_GUARD);
    return true;
  }

  private resolveNight(roomId: string): void {
    const room = this.roomManager.getRoom(roomId);
    const gameState = this.gameStates.get(roomId);
    const actions = this.nightActions.get(roomId);
    if (!room || !gameState || !actions) return;

    const result = this.engine.resolveNight(room, gameState, actions, this.witchSavedTonight.get(roomId) ?? false);

    const deathRecords: DeathRecord[] = [];

    // 应用死亡
    result.deadPlayerIds.forEach(playerId => {
      const reason = playerId === result.killedPlayerId ? 'killed' : 'poisoned';
      const player = this.engine.killPlayer(room, gameState, playerId, reason);
      if (player) {
        deathRecords.push({ playerId, reason });
      }
    });

    gameState.lastKilledPlayer = result.killedPlayerId;
    gameState.wolfKingCanShoot = result.wolfKingCanShoot;

    const winner = this.engine.checkWinner(room);
    if (winner) {
      this.addNightResultReview(roomId, gameState, deathRecords);
      this.emitDeathRecords(roomId, deathRecords, gameState.day);
      this.endGame(roomId, winner);
      return;
    }

    if (result.wolfKingCanShoot) {
      // 狼王先于天亮公告开枪；只通知狼王本人，其他玩家只看到安全的结算等待阶段。
      const timer = PHASE_DURATION_SECONDS.deathSkill;
      const endsAt = this.setHiddenPhase(roomId, GamePhase.WOLF_KING_SHOOT, timer);
      room.players.forEach(player => {
        this.emitPhaseToPlayer(player, gameState, timer, endsAt, 'game:phaseChanged');
      });

      this.schedulePhaseTimeout(roomId, timer * 1000, () => {
        gameState.wolfKingCanShoot = false;
        this.startDayPhase(roomId, deathRecords);
      });
      return;
    }

    this.startDayPhase(roomId, deathRecords);
  }

  // ============ 白天阶段 ============

  private startDayPhase(roomId: string, deadPlayers: DeathRecord[]): void {
    const room = this.roomManager.getRoom(roomId);
    const gameState = this.gameStates.get(roomId);
    if (!room || !gameState) return;

    const announceSeconds = PHASE_DURATION_SECONDS.dayAnnounce;
    this.setPhaseClock(gameState, GamePhase.DAY_ANNOUNCE, announceSeconds);
    this.addNightResultReview(roomId, gameState, deadPlayers);
    const wolfKingSkillDeath = deadPlayers.find(deadPlayer => deadPlayer.reason === 'shot');
    if (wolfKingSkillDeath && gameState.lastKilledPlayer) {
      this.addSkillTakeReview(roomId, gameState, gameState.lastKilledPlayer, wolfKingSkillDeath.playerId);
    }
    this.emitDeathRecords(roomId, deadPlayers, gameState.day);
    // 当前规则只让被狼人夜刀的猎人在天亮公告后触发技能；被毒或技能带走不会触发。
    const hunterToShoot = deadPlayers
      .filter(deadPlayer => deadPlayer.reason === 'killed')
      .map(deadPlayer => room.players.find(p => p.id === deadPlayer.playerId))
      .find(player => player?.role && roleHasAbility(player.role, RoleAbility.HUNTER_SHOOT) && !this.hunterShotsUsed.has(player.id));

    if (deadPlayers.length === 0) {
      this.io.to(roomId).emit('game:systemMessage', {
        id: generateMessageId(),
        content: SYSTEM_MESSAGES.peacefulNight,
        timestamp: Date.now()
      });
    }

    this.io.to(roomId).emit('game:phaseChanged', {
      phase: GamePhase.DAY_ANNOUNCE,
      timer: announceSeconds,
      endsAt: gameState.phaseEndsAt
    });
    this.schedulePhaseTimeout(roomId, announceSeconds * 1000, () => {
      if (hunterToShoot) {
        // 猎人技能会临时打断白天流程，处理完后继续进入白天发言。
        this.startHunterShot(roomId, hunterToShoot.id, () => this.startSpeakingPhase(roomId));
      } else {
        this.startSpeakingPhase(roomId);
      }
    });
  }

  private startSpeakingPhase(roomId: string): void {
    const room = this.roomManager.getRoom(roomId);
    const gameState = this.gameStates.get(roomId);
    if (!room || !gameState) return;

    const speakingSeconds = PHASE_DURATION_SECONDS.daySpeaking;
    this.setPhaseClock(gameState, GamePhase.DAY_SPEAKING, speakingSeconds);
    gameState.votes = {};

    const speaking: SpeakingState = {
      order: this.engine.buildSpeakingOrder(room, gameState.lastKilledPlayer),
      currentIndex: 0,
      confirmed: []
    };
    gameState.speaking = speaking;

    this.io.to(roomId).emit('game:phaseChanged', {
      phase: GamePhase.DAY_SPEAKING,
      timer: speakingSeconds,
      endsAt: gameState.phaseEndsAt,
      speaking
    });
    this.io.to(roomId).emit('game:speakingUpdate', { speaking });
    this.scheduleSpeakingTimeout(roomId);
  }

  private scheduleSpeakingTimeout(roomId: string): void {
    this.schedulePhaseTimeout(roomId, PHASE_DURATION_SECONDS.daySpeaking * 1000, () => this.advanceSpeaking(roomId));
  }

  private getCurrentSpeakerId(gameState: GameState): string | null {
    return gameState.speaking?.order[gameState.speaking.currentIndex] ?? null;
  }

  private finishCurrentSpeaker(roomId: string, gameState: GameState): void {
    const currentSpeakerId = this.getCurrentSpeakerId(gameState);
    if (currentSpeakerId && !gameState.speaking?.confirmed.includes(currentSpeakerId)) {
      gameState.speaking?.confirmed.push(currentSpeakerId);
    }
    if (gameState.speaking) {
      gameState.speaking.currentIndex++;
      this.io.to(roomId).emit('game:speakingUpdate', { speaking: gameState.speaking });
    }
  }

  private canPlayerFinishSpeaking(ctx: ActionContext): boolean {
    return this.getCurrentSpeakerId(ctx.gameState) === ctx.player.id;
  }

  private advanceSpeaking(roomId: string, playerId?: string): void {
    const room = this.roomManager.getRoom(roomId);
    const gameState = this.gameStates.get(roomId);
    if (!room || !gameState || gameState.phase !== GamePhase.DAY_SPEAKING || !gameState.speaking) return;

    const currentSpeakerId = this.getCurrentSpeakerId(gameState);
    if (playerId && playerId !== currentSpeakerId) return;

    this.finishCurrentSpeaker(roomId, gameState);

    if (gameState.speaking.currentIndex >= gameState.speaking.order.length) {
      this.clearPhaseTimer(roomId);
      this.startVotePhase(roomId);
      return;
    }

    this.emitPhaseChanged(roomId, GamePhase.DAY_SPEAKING, PHASE_DURATION_SECONDS.daySpeaking, gameState.speaking);
    this.scheduleSpeakingTimeout(roomId);
  }

  speakingDone(socket: TypedSocket): void {
    const ctx = this.validateContext(socket);
    if (!ctx || !ctx.gameState.speaking) return;
    if (ctx.gameState.phase === GamePhase.LAST_WORDS) {
      this.completeLastWords(ctx.room.id, ctx.player.id);
      return;
    }
    if (ctx.gameState.phase !== GamePhase.DAY_SPEAKING || ctx.player.status === 'dead') return;
    if (!this.canPlayerFinishSpeaking(ctx)) {
      socket.emit('game:error', { message: GAME_ERROR_MESSAGES.notYourTurnToSpeak });
      return;
    }

    this.advanceSpeaking(ctx.room.id, ctx.player.id);
  }

  speakingDoneByPlayer(roomId: string, playerId: string): boolean {
    const ctx = this.validatePlayerContext(roomId, playerId);
    if (!ctx || !ctx.gameState.speaking) return false;
    if (ctx.gameState.phase === GamePhase.LAST_WORDS) {
      this.completeLastWords(ctx.room.id, ctx.player.id);
      return true;
    }
    if (ctx.gameState.phase !== GamePhase.DAY_SPEAKING || ctx.player.status === 'dead') return false;
    if (!this.canPlayerFinishSpeaking(ctx)) return false;

    this.advanceSpeaking(ctx.room.id, ctx.player.id);
    return true;
  }

  private startVotePhase(roomId: string): void {
    const room = this.roomManager.getRoom(roomId);
    const gameState = this.gameStates.get(roomId);
    if (!room || !gameState) return;

    gameState.votes = {};
    gameState.speaking = null;

    this.emitPhaseChanged(roomId, GamePhase.DAY_VOTE, room.config.voteTime);
    this.schedulePhaseTimeout(roomId, room.config.voteTime * 1000, () => this.resolveVote(roomId));
  }

  private hasAllAlivePlayersVoted(room: Room, gameState: GameState): boolean {
    return this.getAlivePlayers(room).every(player => {
      return Object.prototype.hasOwnProperty.call(gameState.votes, player.id);
    });
  }

  private recordVoteAndMaybeResolve(ctx: ActionContext, targetId: string | null): void {
    ctx.gameState.votes[ctx.player.id] = targetId;

    if (this.hasAllAlivePlayersVoted(ctx.room, ctx.gameState)) {
      this.clearPhaseTimer(ctx.room.id);
      this.resolveVote(ctx.room.id);
    }
  }

  vote(socket: TypedSocket, targetId: string): void {
    const ctx = this.validateContext(socket, GamePhase.DAY_VOTE);
    if (!ctx || ctx.player.status === 'dead') return;

    const target = this.getAliveTarget(ctx.room, targetId);
    if (!target || target.id === ctx.player.id) return;

    this.recordVoteAndMaybeResolve(ctx, targetId);
  }

  abstainVote(socket: TypedSocket): void {
    const ctx = this.validateContext(socket, GamePhase.DAY_VOTE);
    if (!ctx || ctx.player.status === 'dead') return;

    this.recordVoteAndMaybeResolve(ctx, null);
  }

  voteByPlayer(roomId: string, playerId: string, targetId: string): boolean {
    const ctx = this.validatePlayerContext(roomId, playerId, GamePhase.DAY_VOTE);
    if (!ctx || ctx.player.status === 'dead') return false;

    const target = this.getAliveTarget(ctx.room, targetId);
    if (!target || target.id === ctx.player.id) return false;

    this.recordVoteAndMaybeResolve(ctx, targetId);
    return true;
  }

  private resolveVote(roomId: string): void {
    const room = this.roomManager.getRoom(roomId);
    const gameState = this.gameStates.get(roomId);
    if (!room || !gameState) return;

    room.players
      .filter(player => player.status === 'alive')
      .forEach(player => {
        // 超时未投票视为弃票，保证投票历史完整记录每个存活玩家。
        if (!Object.prototype.hasOwnProperty.call(gameState.votes, player.id)) {
          gameState.votes[player.id] = null;
        }
      });
    const result = this.engine.resolveVote(gameState.votes);
    const details = { ...gameState.votes };
    const historyEntry = {
      day: gameState.day,
      votes: details,
      voteCount: { ...result.voteCount },
      eliminated: result.eliminatedId,
      abstained: result.abstained,
      isTie: result.isTie
    };
    this.addReviewEvent(roomId, {
      day: gameState.day,
      phase: GamePhase.DAY_VOTE,
      type: 'vote_result',
      votes: details,
      voteCount: { ...result.voteCount },
      eliminated: result.eliminatedId,
      abstained: result.abstained,
      isTie: result.isTie
    });
    const existingHistoryIndex = gameState.voteHistory.findIndex(entry => entry.day === gameState.day);
    if (existingHistoryIndex >= 0) {
      gameState.voteHistory[existingHistoryIndex] = historyEntry;
    } else {
      gameState.voteHistory.push(historyEntry);
    }

    this.io.to(roomId).emit('game:voteResult', {
      votes: result.voteCount,
      eliminated: result.eliminatedId,
      abstained: result.abstained,
      isTie: result.isTie,
      details
    });

    const eliminatedId = result.eliminatedId;
    if (eliminatedId) {
      const player = this.engine.killPlayer(room, gameState, eliminatedId, 'voted');
      if (!player) {
        this.afterDeathCheck(roomId);
        return;
      }
      this.emitPlayerDead(roomId, eliminatedId, 'voted', gameState.day);

      this.startLastWords(roomId, eliminatedId, () => {
        if (player.role && roleHasAbility(player.role, RoleAbility.HUNTER_SHOOT)) {
          // 白天被放逐的猎人先遗言，再决定是否开枪。
          this.startHunterShot(roomId, eliminatedId, () => this.afterDeathCheck(roomId));
          return;
        }
        this.afterDeathCheck(roomId);
      });
      return;
    }

    this.afterDeathCheck(roomId);
  }

  // ============ 特殊角色 ============

  hunterPass(socket: TypedSocket): void {
    const ctx = this.validateContext(socket, GamePhase.HUNTER_SHOOT);
    if (!ctx || !ctx.player.role || !roleHasAbility(ctx.player.role, RoleAbility.HUNTER_SHOOT)) return;
    this.passHunterShot(ctx.room.id, ctx.player.id);
  }

  hunterPassByPlayer(roomId: string, playerId: string): boolean {
    const ctx = this.validatePlayerContext(roomId, playerId, GamePhase.HUNTER_SHOOT);
    if (!ctx || !ctx.player.role || !roleHasAbility(ctx.player.role, RoleAbility.HUNTER_SHOOT)) return false;
    return this.passHunterShot(ctx.room.id, ctx.player.id);
  }

  hunterShoot(socket: TypedSocket, targetId: string): void {
    const ctx = this.validateContext(socket, GamePhase.HUNTER_SHOOT);
    if (!ctx || !ctx.player.role || !roleHasAbility(ctx.player.role, RoleAbility.HUNTER_SHOOT)) return;

    this.executeHunterShot(ctx, targetId);
  }

  hunterShootByPlayer(roomId: string, playerId: string, targetId: string): boolean {
    const ctx = this.validatePlayerContext(roomId, playerId, GamePhase.HUNTER_SHOOT);
    if (!ctx || !ctx.player.role || !roleHasAbility(ctx.player.role, RoleAbility.HUNTER_SHOOT)) return false;

    return this.executeHunterShot(ctx, targetId);
  }

  wolfKingShoot(socket: TypedSocket, targetId: string): void {
    const ctx = this.validateContext(socket, GamePhase.WOLF_KING_SHOOT);
    if (!ctx || !ctx.player.role || !roleHasAbility(ctx.player.role, RoleAbility.WOLF_KING_SHOOT) || !ctx.gameState.wolfKingCanShoot) return;

    this.executeWolfKingShot(ctx, targetId);
  }

  wolfKingShootByPlayer(roomId: string, playerId: string, targetId: string): boolean {
    const ctx = this.validatePlayerContext(roomId, playerId, GamePhase.WOLF_KING_SHOOT);
    if (!ctx || !ctx.player.role || !roleHasAbility(ctx.player.role, RoleAbility.WOLF_KING_SHOOT) || !ctx.gameState.wolfKingCanShoot) return false;

    return this.executeWolfKingShot(ctx, targetId);
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
    const transitionSeconds = PHASE_DURATION_SECONDS.afterDeathTransition;
    gameState.phaseTimer = transitionSeconds;
    gameState.phaseEndsAt = Date.now() + transitionSeconds * 1000;
    this.schedulePhaseTimeout(roomId, transitionSeconds * 1000, () => this.startNightPhase(roomId));
  }

  private endGame(roomId: string, winner: 'villager' | 'werewolf'): void {
    const room = this.roomManager.getRoom(roomId);
    const gameState = this.gameStates.get(roomId);
    if (!room || !gameState) return;

    gameState.phase = GamePhase.GAME_OVER;
    gameState.phaseEndsAt = null;
    gameState.phaseTimer = 0;
    gameState.winner = winner;
    room.status = 'finished';

    this.io.to(roomId).emit('game:over', { winner, players: room.players });

    this.cleanup(roomId);
  }

  /** 清理游戏状态，防止内存泄漏 */
  cleanup(roomId: string): void {
    this.clearPhaseTimer(roomId);
    this.gameStates.delete(roomId);
    this.nightActions.delete(roomId);
    this.roleConfirmations.delete(roomId);
    this.wolfVotes.delete(roomId);
    this.wolfSelections.delete(roomId);
    this.witchSavedTonight.delete(roomId);
    this.pendingHunterShots.delete(roomId);
    this.phaseTimeoutCallbacks.delete(roomId);
  }
}
