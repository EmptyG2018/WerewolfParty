import { Socket, Server } from 'socket.io';
import {
  Room, Player, PublicRoom, PublicPlayer, RoomConfig, SeatSwapRequest,
  DEFAULT_ROOM_CONFIG, ROOM_ERROR_MESSAGES, ROOM_RESULT_MESSAGES,
  ClientToServerEvents, ServerToClientEvents, playerSwapBusyMessage, validateConfig
} from '@werewolf/shared';
import { generateRoomId, generateSessionId } from '../utils';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  // socketId 只代表当前连接；sessionId/playerId 才是可重连的稳定玩家身份。
  private playerRooms: Map<string, string> = new Map();
  private socketPlayers: Map<string, string> = new Map();
  private sessionRooms: Map<string, string> = new Map();
  private pendingSwaps: Map<string, SeatSwapRequest> = new Map(); // fromPlayerId -> pending request
  private io: TypedServer | null = null;
  private onRoomDeleted: ((roomId: string) => void) | null = null;

  setIO(io: TypedServer): void {
    this.io = io;
  }

  setOnRoomDeleted(callback: (roomId: string) => void): void {
    this.onRoomDeleted = callback;
  }

  getRoomCount(): number {
    return this.rooms.size;
  }

  getPublicRooms(): Array<{ id: string; playerCount: number; maxPlayers: number; status: string }> {
    return Array.from(this.rooms.values())
      .filter(room => room.status === 'waiting')
      .map(room => ({
        id: room.id,
        playerCount: room.players.length,
        maxPlayers: room.config.maxPlayers,
        status: room.status
      }));
  }

  private getPublicRoom(room: Room): PublicRoom {
    return {
      ...room,
      players: room.players.map(player => ({
        ...player,
        role: null
      }))
    };
  }

  private getPublicPlayer(player: Player): PublicPlayer {
    return {
      ...player,
      role: null
    };
  }

  private isHost(room: Room, player: Player): boolean {
    return room.hostId === player.id;
  }

  private resetReadyStates(room: Room): void {
    // 规则配置变化或重新开局后，所有玩家都需要重新确认准备；房主无需准备但状态保持 false。
    room.players.forEach(player => {
      player.isReady = false;
    });
  }

  private resetPlayerForWaiting(player: Player): void {
    player.role = null;
    player.status = 'alive';
    player.isReady = false;
    player.voteTarget = null;
    player.skillUsed = { witchSave: false, witchPoison: false, lastGuardTarget: null };
  }

  private emitSwapResult(playerId: string, success: boolean, message: string): void {
    this.io?.to(playerId).emit('room:swapResult', { success, message });
  }

  private emitSwapCancelled(playerId: string, request: SeatSwapRequest, message: string): void {
    this.io?.to(playerId).emit('room:swapCancelled', { request, message });
  }

  addDebugPlayers(roomId: string, count: number): Player[] {
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'waiting') return [];

    const created: Player[] = [];
    for (let i = 0; i < count; i++) {
      if (room.players.length >= room.config.maxPlayers) break;

      const seatIndex = this.findNextSeat(room);
      if (seatIndex < 0) break;

      const sessionId = `debug_${generateSessionId()}`;
      const playerNumber = this.findNextPlayerNumber(room);
      const player: Player = {
        id: sessionId,
        sessionId,
        name: `调试${seatIndex + 1}号`,
        roomId,
        playerNumber,
        seatIndex,
        role: null,
        status: 'alive',
        online: true,
        isHost: false,
        isReady: true,
        voteTarget: null,
        skillUsed: { witchSave: false, witchPoison: false, lastGuardTarget: null }
      };

      room.players.push(player);
      this.sessionRooms.set(sessionId, roomId);
      created.push(player);
      this.io?.to(roomId).emit('room:playerJoined', { player: this.getPublicPlayer(player) });
    }

    if (created.length > 0) {
      this.broadcastRoomUpdate(roomId);
    }
    return created;
  }

  /** 找到下一个可用座位号 */
  private findNextSeat(room: Room): number {
    const occupied = new Set(room.players.map(p => p.seatIndex));
    for (let i = 0; i < room.config.maxPlayers; i++) {
      if (!occupied.has(i)) return i;
    }
    return -1;
  }

  private findNextPlayerNumber(room: Room): number {
    // playerNumber 用于局内口头称呼，离线重连或换座时不变化。
    const used = new Set(room.players.map(player => player.playerNumber ?? player.seatIndex + 1));
    for (let i = 1; i <= room.config.maxPlayers; i++) {
      if (!used.has(i)) return i;
    }
    return room.players.length + 1;
  }

  createRoom(socket: TypedSocket, playerName: string, config?: Partial<RoomConfig>): void {
    const roomId = generateRoomId();
    const roomConfig: RoomConfig = { ...DEFAULT_ROOM_CONFIG, ...config };
    const error = validateConfig(roomConfig);
    if (error) {
      socket.emit('room:error', { message: error });
      return;
    }
    const sessionId = generateSessionId();

    const player: Player = {
      id: sessionId,
      sessionId,
      name: playerName,
      roomId,
      playerNumber: 1,
      seatIndex: 0,
      role: null,
      status: 'alive',
      online: true,
      isHost: true,
      isReady: false,
      voteTarget: null,
      skillUsed: { witchSave: false, witchPoison: false, lastGuardTarget: null }
    };

    const room: Room = {
      id: roomId,
      hostId: sessionId,
      players: [player],
      config: roomConfig,
      status: 'waiting',
      createdAt: Date.now()
    };

    this.rooms.set(roomId, room);
    this.playerRooms.set(socket.id, roomId);
    this.socketPlayers.set(socket.id, sessionId);
    this.sessionRooms.set(sessionId, roomId);

    socket.join(roomId);
    socket.join(sessionId);
    socket.emit('room:created', { roomId });
    socket.emit('room:joined', { room: this.getPublicRoom(room), sessionId, playerId: sessionId });
  }

  joinRoom(socket: TypedSocket, roomId: string, playerName: string): void {
    const room = this.rooms.get(roomId);

    if (!room) {
      socket.emit('room:error', { message: ROOM_ERROR_MESSAGES.roomNotFound });
      return;
    }
    if (room.status !== 'waiting') {
      socket.emit('room:error', { message: ROOM_ERROR_MESSAGES.gameAlreadyStarted });
      return;
    }
    if (room.players.length >= room.config.maxPlayers) {
      socket.emit('room:error', { message: ROOM_ERROR_MESSAGES.roomFull });
      return;
    }
    if (room.players.some(p => p.name === playerName)) {
      socket.emit('room:error', { message: ROOM_ERROR_MESSAGES.duplicatedName });
      return;
    }

    const seatIndex = this.findNextSeat(room);
    const playerNumber = this.findNextPlayerNumber(room);
    const sessionId = generateSessionId();

    const player: Player = {
      id: sessionId,
      sessionId,
      name: playerName,
      roomId,
      playerNumber,
      seatIndex,
      role: null,
      status: 'alive',
      online: true,
      isHost: false,
      isReady: false,
      voteTarget: null,
      skillUsed: { witchSave: false, witchPoison: false, lastGuardTarget: null }
    };

    room.players.push(player);
    this.playerRooms.set(socket.id, roomId);
    this.socketPlayers.set(socket.id, sessionId);
    this.sessionRooms.set(sessionId, roomId);

    socket.join(roomId);
    socket.join(sessionId);
    socket.emit('room:joined', { room: this.getPublicRoom(room), sessionId, playerId: sessionId });
    socket.to(roomId).emit('room:playerJoined', { player: this.getPublicPlayer(player) });
    this.broadcastRoomUpdate(roomId);
  }

  reconnectRoom(socket: TypedSocket, sessionId: string): Room | null {
    const roomId = this.sessionRooms.get(sessionId);
    if (!roomId) {
      socket.emit('room:reconnectFailed', { message: ROOM_ERROR_MESSAGES.sessionExpired });
      return null;
    }

    const room = this.rooms.get(roomId);
    const player = room?.players.find(p => p.sessionId === sessionId);
    if (!room || !player) {
      this.sessionRooms.delete(sessionId);
      socket.emit('room:reconnectFailed', { message: ROOM_ERROR_MESSAGES.roomExpired });
      return null;
    }

    player.online = true;
    // 新 socket 重新加入房间广播频道和个人私密频道，用于接收身份/技能提示。
    this.playerRooms.set(socket.id, roomId);
    this.socketPlayers.set(socket.id, player.id);
    socket.join(roomId);
    socket.join(player.id);
    socket.emit('room:reconnected', { room: this.getPublicRoom(room), sessionId, playerId: player.id });
    this.broadcastRoomUpdate(roomId);
    return room;
  }

  leaveRoom(socket: TypedSocket): void {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (!room) return;
    const playerId = this.socketPlayers.get(socket.id);
    if (!playerId) return;

    // 清理该玩家相关的待处理交换请求
    this.cancelPendingSwap(playerId, roomId);

    room.players = room.players.filter(p => p.id !== playerId);
    this.playerRooms.delete(socket.id);
    this.socketPlayers.delete(socket.id);
    this.sessionRooms.delete(playerId);
    socket.leave(roomId);
    socket.leave(playerId);

    if (room.players.length === 0) {
      this.rooms.delete(roomId);
      this.onRoomDeleted?.(roomId);
    } else if (room.hostId === playerId) {
      // 房主离开时把房主权限交给当前列表第一位玩家。
      room.hostId = room.players[0].id;
      room.players[0].isHost = true;
    }

    socket.to(roomId).emit('room:playerLeft', { playerId });
    this.broadcastRoomUpdate(roomId);
  }

  updateConfig(socket: TypedSocket, config: Partial<RoomConfig>): void {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (!room) return;
    const player = this.getPlayerBySocket(socket);
    if (!player) return;

    if (!this.isHost(room, player)) {
      socket.emit('room:error', { message: ROOM_ERROR_MESSAGES.hostOnlyUpdateConfig });
      return;
    }
    if (room.status !== 'waiting') {
      socket.emit('room:error', { message: ROOM_ERROR_MESSAGES.cannotUpdateConfigAfterStart });
      return;
    }

    const error = validateConfig({ ...room.config, ...config });
    if (error) {
      socket.emit('room:error', { message: error });
      return;
    }

    room.config = { ...room.config, ...config };
    this.resetReadyStates(room);
    this.broadcastRoomUpdate(roomId);
  }

  setReady(socket: TypedSocket, ready: boolean): void {
    const room = this.getRoomBySocket(socket);
    if (!room) return;
    const player = this.getPlayerBySocket(socket);
    if (!player) return;

    if (room.status !== 'waiting') {
      socket.emit('room:error', { message: ROOM_ERROR_MESSAGES.cannotReadyAfterStart });
      return;
    }
    if (this.isHost(room, player)) {
      if (player.isReady) {
        player.isReady = false;
        this.broadcastRoomUpdate(room.id);
      }
      return;
    }

    player.isReady = ready;
    this.broadcastRoomUpdate(room.id);
  }

  resetRoom(socket: TypedSocket): boolean {
    const room = this.getRoomBySocket(socket);
    const player = this.getPlayerBySocket(socket);
    if (!room || !player) return false;

    if (!this.isHost(room, player)) {
      socket.emit('room:error', { message: ROOM_ERROR_MESSAGES.hostOnlyReset });
      return false;
    }
    if (room.status !== 'finished') {
      socket.emit('room:error', { message: ROOM_ERROR_MESSAGES.resetOnlyAfterFinished });
      return false;
    }

    room.status = 'waiting';
    room.players.forEach(roomPlayer => {
      this.resetPlayerForWaiting(roomPlayer);
    });

    this.broadcastRoomUpdate(room.id);
    return true;
  }

  // ============ 座位交换 ============

  private findPendingSwapByPlayer(roomId: string, playerId: string): SeatSwapRequest | null {
    return Array.from(this.pendingSwaps.values()).find(request => {
      return request.fromId === playerId || request.targetId === playerId;
    }) ?? null;
  }

  private getPendingSwapFromPlayer(roomId: string, playerId: string): SeatSwapRequest | null {
    const request = this.pendingSwaps.get(playerId);
    return request?.fromId === playerId ? request : null;
  }

  swapSeat(socket: TypedSocket, targetSeat: number): void {
    const room = this.getRoomBySocket(socket);
    if (!room || room.status !== 'waiting') return;

    const player = this.getPlayerBySocket(socket);
    if (!player) return;

    if (targetSeat < 0 || targetSeat >= room.config.maxPlayers) {
      socket.emit('room:error', { message: ROOM_ERROR_MESSAGES.invalidSeat });
      return;
    }
    if (player.seatIndex === targetSeat) return;

    const targetPlayer = room.players.find(p => p.seatIndex === targetSeat);
    const myPending = this.findPendingSwapByPlayer(room.id, player.id);
    if (myPending) {
      socket.emit('room:error', { message: ROOM_ERROR_MESSAGES.swapAlreadyPending });
      return;
    }
    if (targetPlayer && this.findPendingSwapByPlayer(room.id, targetPlayer.id)) {
      socket.emit('room:error', { message: playerSwapBusyMessage(targetPlayer.name) });
      return;
    }

    if (!targetPlayer) {
      // 空座，直接交换
      player.seatIndex = targetSeat;
      this.broadcastRoomUpdate(room.id);
    } else {
      // 需要对方同意
      const request: SeatSwapRequest = {
        fromId: player.id,
        fromSeat: player.seatIndex,
        targetSeat,
        targetId: targetPlayer.id
      };
      this.pendingSwaps.set(player.id, request);

      this.io?.to(targetPlayer.id).emit('room:swapRequest', request);
      this.emitSwapResult(player.id, true, ROOM_RESULT_MESSAGES.swapRequestSent);
    }
  }

  cancelSwap(socket: TypedSocket): void {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;
    const playerId = this.socketPlayers.get(socket.id);
    if (!playerId) return;

    const pending = this.getPendingSwapFromPlayer(roomId, playerId);
    if (!pending || pending.fromId !== playerId) {
      socket.emit('room:error', { message: ROOM_ERROR_MESSAGES.noCancelableSwap });
      return;
    }

    this.pendingSwaps.delete(pending.fromId);
    if (pending.targetId) {
      this.emitSwapCancelled(pending.targetId, pending, ROOM_RESULT_MESSAGES.swapCancelledByPeer);
    }
    this.emitSwapResult(playerId, false, ROOM_RESULT_MESSAGES.swapCancelledBySelf);
  }

  acceptSwap(socket: TypedSocket): void {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;
    const playerId = this.socketPlayers.get(socket.id);
    if (!playerId) return;

    const pending = this.findPendingSwapByPlayer(roomId, playerId);
    if (!pending || pending.targetId !== playerId) {
      socket.emit('room:error', { message: ROOM_ERROR_MESSAGES.noPendingSwap });
      return;
    }

    const room = this.rooms.get(roomId);
    if (!room) return;

    const fromPlayer = room.players.find(p => p.id === pending.fromId);
    const targetPlayer = room.players.find(p => p.id === pending.targetId);
    if (!fromPlayer || !targetPlayer) {
      this.pendingSwaps.delete(pending.fromId);
      this.emitSwapResult(pending.fromId, false, ROOM_RESULT_MESSAGES.swapPeerLeft);
      if (pending.targetId) {
        this.emitSwapCancelled(pending.targetId, pending, ROOM_RESULT_MESSAGES.swapPeerLeft);
      }
      return;
    }

    // 交换座位
    fromPlayer.seatIndex = pending.targetSeat;
    targetPlayer.seatIndex = pending.fromSeat;
    this.pendingSwaps.delete(pending.fromId);

    this.emitSwapResult(pending.fromId, true, ROOM_RESULT_MESSAGES.swapSuccess);
    if (pending.targetId) {
      this.emitSwapResult(pending.targetId, true, ROOM_RESULT_MESSAGES.swapSuccess);
    }
    this.broadcastRoomUpdate(roomId);
  }

  rejectSwap(socket: TypedSocket): void {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;
    const playerId = this.socketPlayers.get(socket.id);
    if (!playerId) return;

    const pending = this.findPendingSwapByPlayer(roomId, playerId);
    if (!pending || pending.targetId !== playerId) {
      socket.emit('room:error', { message: ROOM_ERROR_MESSAGES.noPendingSwap });
      return;
    }

    this.pendingSwaps.delete(pending.fromId);

    // 通知发起者
    this.emitSwapResult(pending.fromId, false, ROOM_RESULT_MESSAGES.swapRejected);
  }

  private cancelPendingSwap(playerId: string, roomId: string): void {
    const pending = this.findPendingSwapByPlayer(roomId, playerId);
    if (!pending) return;

    if (pending.fromId === playerId || pending.targetId === playerId) {
      this.pendingSwaps.delete(pending.fromId);
      if (pending.fromId === playerId && pending.targetId) {
        this.emitSwapCancelled(pending.targetId, pending, ROOM_RESULT_MESSAGES.swapPeerLeft);
      } else {
        this.emitSwapResult(pending.fromId, false, ROOM_RESULT_MESSAGES.swapPeerLeft);
      }
    }
  }

  // ============ 工具方法 ============

  getRoomBySocket(socket: TypedSocket): Room | undefined {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return undefined;
    return this.rooms.get(roomId);
  }

  getPlayerBySocket(socket: TypedSocket): Player | undefined {
    const room = this.getRoomBySocket(socket);
    const playerId = this.socketPlayers.get(socket.id);
    if (!room || !playerId) return undefined;
    return room.players.find(p => p.id === playerId);
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  handleDisconnect(socket: TypedSocket): void {
    const roomId = this.playerRooms.get(socket.id);
    const playerId = this.socketPlayers.get(socket.id);
    if (!roomId || !playerId) return;

    const room = this.rooms.get(roomId);
    const player = room?.players.find(p => p.id === playerId);
    if (player) {
      // 断线不立即移除玩家，保留 sessionId 以便刷新或网络恢复后重连。
      player.online = false;
      this.cancelPendingSwap(playerId, roomId);
      this.broadcastRoomUpdate(roomId);
    }

    this.playerRooms.delete(socket.id);
    this.socketPlayers.delete(socket.id);
  }

  private broadcastRoomUpdate(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room && this.io) {
      this.io.to(roomId).emit('room:updated', { room: this.getPublicRoom(room) });
    }
  }
}
