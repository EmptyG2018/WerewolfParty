import { Socket, Server } from 'socket.io';
import { Room, Player, RoomConfig, SeatSwapRequest, DEFAULT_ROOM_CONFIG, validateConfig, ClientToServerEvents, ServerToClientEvents } from '@werewolf/shared';
import { generateRoomId } from '../utils';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private playerRooms: Map<string, string> = new Map();
  private pendingSwaps: Map<string, SeatSwapRequest> = new Map(); // roomId -> pending request
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

  /** 找到下一个可用座位号 */
  private findNextSeat(room: Room): number {
    const occupied = new Set(room.players.map(p => p.seatIndex));
    for (let i = 0; i < room.config.maxPlayers; i++) {
      if (!occupied.has(i)) return i;
    }
    return -1;
  }

  createRoom(socket: TypedSocket, playerName: string, config?: Partial<RoomConfig>): void {
    const roomId = generateRoomId();
    const roomConfig: RoomConfig = { ...DEFAULT_ROOM_CONFIG, ...config };

    const player: Player = {
      id: socket.id,
      name: playerName,
      roomId,
      seatIndex: 0,
      role: null,
      status: 'alive',
      isHost: true,
      voteTarget: null,
      skillUsed: { witchSave: false, witchPoison: false, lastGuardTarget: null }
    };

    const room: Room = {
      id: roomId,
      hostId: socket.id,
      players: [player],
      config: roomConfig,
      status: 'waiting',
      createdAt: Date.now()
    };

    this.rooms.set(roomId, room);
    this.playerRooms.set(socket.id, roomId);

    socket.join(roomId);
    socket.emit('room:created', { roomId });
    socket.emit('room:joined', { room });
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

    const player: Player = {
      id: socket.id,
      name: playerName,
      roomId,
      seatIndex,
      role: null,
      status: 'alive',
      isHost: false,
      voteTarget: null,
      skillUsed: { witchSave: false, witchPoison: false, lastGuardTarget: null }
    };

    room.players.push(player);
    this.playerRooms.set(socket.id, roomId);

    socket.join(roomId);
    socket.emit('room:joined', { room });
    socket.to(roomId).emit('room:playerJoined', { player });
    this.broadcastRoomUpdate(roomId);
  }

  leaveRoom(socket: TypedSocket): void {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (!room) return;

    // 清理该玩家相关的待处理交换请求
    this.cancelPendingSwap(socket.id, roomId);

    room.players = room.players.filter(p => p.id !== socket.id);
    this.playerRooms.delete(socket.id);
    socket.leave(roomId);

    if (room.players.length === 0) {
      this.rooms.delete(roomId);
      this.onRoomDeleted?.(roomId);
    } else if (room.hostId === socket.id) {
      room.hostId = room.players[0].id;
      room.players[0].isHost = true;
    }

    socket.to(roomId).emit('room:playerLeft', { playerId: socket.id });
    this.broadcastRoomUpdate(roomId);
  }

  updateConfig(socket: TypedSocket, config: Partial<RoomConfig>): void {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (!room) return;

    if (room.hostId !== socket.id) {
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

  // ============ 座位交换 ============

  swapSeat(socket: TypedSocket, targetSeat: number): void {
    const room = this.getRoomBySocket(socket);
    if (!room || room.status !== 'waiting') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    if (targetSeat < 0 || targetSeat >= room.config.maxPlayers) {
      socket.emit('room:error', { message: '无效的座位号' });
      return;
    }
    if (player.seatIndex === targetSeat) return;

    // 检查是否已有待处理的交换请求
    if (this.pendingSwaps.has(room.id)) {
      socket.emit('room:error', { message: '有其他交换请求正在处理中' });
      return;
    }

    const targetPlayer = room.players.find(p => p.seatIndex === targetSeat);

    if (!targetPlayer) {
      // 空座，直接交换
      player.seatIndex = targetSeat;
      this.broadcastRoomUpdate(room.id);
    } else {
      // 需要对方同意
      const request: SeatSwapRequest = {
        fromId: socket.id,
        fromSeat: player.seatIndex,
        targetSeat,
        targetId: targetPlayer.id
      };
      this.pendingSwaps.set(room.id, request);

      const targetSocket = this.io?.sockets.sockets.get(targetPlayer.id);
      if (targetSocket) {
        targetSocket.emit('room:swapRequest', request);
      }
      socket.emit('room:swapResult', { success: true, message: '已发送交换请求，等待对方确认' });
    }
  }

  acceptSwap(socket: TypedSocket): void {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;

    const pending = this.pendingSwaps.get(roomId);
    if (!pending || pending.targetId !== socket.id) {
      socket.emit('room:error', { message: '没有待处理的交换请求' });
      return;
    }

    const room = this.rooms.get(roomId);
    if (!room) return;

    const fromPlayer = room.players.find(p => p.id === pending.fromId);
    const targetPlayer = room.players.find(p => p.id === pending.targetId);
    if (!fromPlayer || !targetPlayer) {
      this.pendingSwaps.delete(roomId);
      return;
    }

    // 交换座位
    fromPlayer.seatIndex = pending.targetSeat;
    targetPlayer.seatIndex = pending.fromSeat;
    this.pendingSwaps.delete(roomId);

    this.broadcastRoomUpdate(roomId);
  }

  rejectSwap(socket: TypedSocket): void {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;

    const pending = this.pendingSwaps.get(roomId);
    if (!pending || pending.targetId !== socket.id) {
      socket.emit('room:error', { message: '没有待处理的交换请求' });
      return;
    }

    this.pendingSwaps.delete(roomId);

    // 通知发起者
    const fromSocket = this.io?.sockets.sockets.get(pending.fromId);
    if (fromSocket) {
      fromSocket.emit('room:swapResult', { success: false, message: '对方拒绝了交换请求' });
    }
  }

  private cancelPendingSwap(socketId: string, roomId: string): void {
    const pending = this.pendingSwaps.get(roomId);
    if (!pending) return;

    if (pending.fromId === socketId || pending.targetId === socketId) {
      this.pendingSwaps.delete(roomId);
      // 通知另一方
      const otherId = pending.fromId === socketId ? pending.targetId : pending.fromId;
      if (otherId) {
        const otherSocket = this.io?.sockets.sockets.get(otherId);
        otherSocket?.emit('room:swapResult', { success: false, message: '对方已离开，交换取消' });
      }
    }
  }

  // ============ 工具方法 ============

  getRoomBySocket(socket: TypedSocket): Room | undefined {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return undefined;
    return this.rooms.get(roomId);
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  handleDisconnect(socket: TypedSocket): void {
    this.leaveRoom(socket);
  }

  private broadcastRoomUpdate(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room && this.io) {
      this.io.to(roomId).emit('room:updated', { room });
    }
  }
}
