import { Socket, Server } from 'socket.io';
import { Room, Player, RoomConfig, DEFAULT_ROOM_CONFIG, validateConfig, ClientToServerEvents, ServerToClientEvents } from '@werewolf/shared';
import { generateRoomId } from '../utils';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private playerRooms: Map<string, string> = new Map();
  private io: TypedServer | null = null;
  private onRoomDeleted: ((roomId: string) => void) | null = null;

  setIO(io: TypedServer): void {
    this.io = io;
  }

  /** 注册房间删除回调（用于清理游戏状态） */
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

  createRoom(socket: TypedSocket, playerName: string, config?: Partial<RoomConfig>): void {
    const roomId = generateRoomId();
    const roomConfig: RoomConfig = { ...DEFAULT_ROOM_CONFIG, ...config };

    const player: Player = {
      id: socket.id,
      name: playerName,
      roomId,
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

    const player: Player = {
      id: socket.id,
      name: playerName,
      roomId,
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
