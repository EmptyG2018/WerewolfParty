import { Socket, Server } from 'socket.io';
import { Room, Player, RoomConfig, SeatSwapRequest, DEFAULT_ROOM_CONFIG, validateConfig, ClientToServerEvents, ServerToClientEvents } from '@werewolf/shared';
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
        voteTarget: null,
        skillUsed: { witchSave: false, witchPoison: false, lastGuardTarget: null }
      };

      room.players.push(player);
      this.sessionRooms.set(sessionId, roomId);
      created.push(player);
      this.io?.to(roomId).emit('room:playerJoined', { player });
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
    socket.emit('room:joined', { room, sessionId, playerId: sessionId });
  }

  joinRoom(socket: TypedSocket, roomId: string, playerName: string): void {
    const room = this.rooms.get(roomId);

    if (!room) {
      socket.emit('room:error', { message: '房间不存在' });
      return;
    }
    if (room.status !== 'waiting') {
      socket.emit('room:error', { message: '游戏已经开始' });
      return;
    }
    if (room.players.length >= room.config.maxPlayers) {
      socket.emit('room:error', { message: '房间已满' });
      return;
    }
    if (room.players.some(p => p.name === playerName)) {
      socket.emit('room:error', { message: '昵称已被使用' });
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
      voteTarget: null,
      skillUsed: { witchSave: false, witchPoison: false, lastGuardTarget: null }
    };

    room.players.push(player);
    this.playerRooms.set(socket.id, roomId);
    this.socketPlayers.set(socket.id, sessionId);
    this.sessionRooms.set(sessionId, roomId);

    socket.join(roomId);
    socket.join(sessionId);
    socket.emit('room:joined', { room, sessionId, playerId: sessionId });
    socket.to(roomId).emit('room:playerJoined', { player });
    this.broadcastRoomUpdate(roomId);
  }

  reconnectRoom(socket: TypedSocket, sessionId: string): Room | null {
    const roomId = this.sessionRooms.get(sessionId);
    if (!roomId) {
      socket.emit('room:reconnectFailed', { message: '会话已失效' });
      return null;
    }

    const room = this.rooms.get(roomId);
    const player = room?.players.find(p => p.sessionId === sessionId);
    if (!room || !player) {
      this.sessionRooms.delete(sessionId);
      socket.emit('room:reconnectFailed', { message: '房间已不存在' });
      return null;
    }

    player.online = true;
    // 新 socket 重新加入房间广播频道和个人私密频道，用于接收身份/技能提示。
    this.playerRooms.set(socket.id, roomId);
    this.socketPlayers.set(socket.id, player.id);
    socket.join(roomId);
    socket.join(player.id);
    socket.emit('room:reconnected', { room, sessionId, playerId: player.id });
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

    if (room.hostId !== player.id) {
      socket.emit('room:error', { message: '只有房主可以修改配置' });
      return;
    }
    if (room.status !== 'waiting') {
      socket.emit('room:error', { message: '游戏已经开始，无法修改配置' });
      return;
    }

    const error = validateConfig({ ...room.config, ...config });
    if (error) {
      socket.emit('room:error', { message: error });
      return;
    }

    room.config = { ...room.config, ...config };
    this.broadcastRoomUpdate(roomId);
  }

  resetRoom(socket: TypedSocket): boolean {
    const room = this.getRoomBySocket(socket);
    const player = this.getPlayerBySocket(socket);
    if (!room || !player) return false;

    if (room.hostId !== player.id) {
      socket.emit('room:error', { message: '只有房主可以重新开局' });
      return false;
    }
    if (room.status !== 'finished') {
      socket.emit('room:error', { message: '游戏结束后才能重新开局' });
      return false;
    }

    room.status = 'waiting';
    room.players.forEach(roomPlayer => {
      roomPlayer.role = null;
      roomPlayer.status = 'alive';
      roomPlayer.voteTarget = null;
      roomPlayer.skillUsed = { witchSave: false, witchPoison: false, lastGuardTarget: null };
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
      socket.emit('room:error', { message: '无效的座位号' });
      return;
    }
    if (player.seatIndex === targetSeat) return;

    const targetPlayer = room.players.find(p => p.seatIndex === targetSeat);
    const myPending = this.findPendingSwapByPlayer(room.id, player.id);
    if (myPending) {
      socket.emit('room:error', { message: '你已有座位交换正在处理中' });
      return;
    }
    if (targetPlayer && this.findPendingSwapByPlayer(room.id, targetPlayer.id)) {
      socket.emit('room:error', { message: `${targetPlayer.name} 正在与其他玩家交换位置` });
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
      socket.emit('room:swapResult', { success: true, message: '已发送交换请求，等待对方确认' });
    }
  }

  cancelSwap(socket: TypedSocket): void {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;
    const playerId = this.socketPlayers.get(socket.id);
    if (!playerId) return;

    const pending = this.getPendingSwapFromPlayer(roomId, playerId);
    if (!pending || pending.fromId !== playerId) {
      socket.emit('room:error', { message: '没有可取消的交换请求' });
      return;
    }

    this.pendingSwaps.delete(pending.fromId);
    if (pending.targetId) {
      this.io?.to(pending.targetId).emit('room:swapCancelled', {
        request: pending,
        message: '对方已取消交换请求'
      });
    }
    socket.emit('room:swapResult', { success: false, message: '已取消交换请求' });
  }

  acceptSwap(socket: TypedSocket): void {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;
    const playerId = this.socketPlayers.get(socket.id);
    if (!playerId) return;

    const pending = this.findPendingSwapByPlayer(roomId, playerId);
    if (!pending || pending.targetId !== playerId) {
      socket.emit('room:error', { message: '没有待处理的交换请求' });
      return;
    }

    const room = this.rooms.get(roomId);
    if (!room) return;

    const fromPlayer = room.players.find(p => p.id === pending.fromId);
    const targetPlayer = room.players.find(p => p.id === pending.targetId);
    if (!fromPlayer || !targetPlayer) {
      this.pendingSwaps.delete(pending.fromId);
      this.io?.to(pending.fromId).emit('room:swapResult', { success: false, message: '对方已离开，交换取消' });
      if (pending.targetId) {
        this.io?.to(pending.targetId).emit('room:swapCancelled', {
          request: pending,
          message: '对方已离开，交换取消'
        });
      }
      return;
    }

    // 交换座位
    fromPlayer.seatIndex = pending.targetSeat;
    targetPlayer.seatIndex = pending.fromSeat;
    this.pendingSwaps.delete(pending.fromId);

    this.io?.to(pending.fromId).emit('room:swapResult', { success: true, message: '交换位置成功' });
    if (pending.targetId) {
      this.io?.to(pending.targetId).emit('room:swapResult', { success: true, message: '交换位置成功' });
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
      socket.emit('room:error', { message: '没有待处理的交换请求' });
      return;
    }

    this.pendingSwaps.delete(pending.fromId);

    // 通知发起者
    this.io?.to(pending.fromId).emit('room:swapResult', { success: false, message: '对方拒绝了交换请求' });
  }

  private cancelPendingSwap(playerId: string, roomId: string): void {
    const pending = this.findPendingSwapByPlayer(roomId, playerId);
    if (!pending) return;

    if (pending.fromId === playerId || pending.targetId === playerId) {
      this.pendingSwaps.delete(pending.fromId);
      if (pending.fromId === playerId && pending.targetId) {
        this.io?.to(pending.targetId).emit('room:swapCancelled', {
          request: pending,
          message: '对方已离开，交换取消'
        });
      } else {
        this.io?.to(pending.fromId).emit('room:swapResult', { success: false, message: '对方已离开，交换取消' });
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
      this.io.to(roomId).emit('room:updated', { room });
    }
  }
}
