import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { RoomManager } from './rooms/RoomManager';
import { GameManager } from './game/GameManager';
import { ClientToServerEvents, ServerToClientEvents } from '@werewolf/shared';
import { registerDebugRoutes } from './debug/debugRoutes';

const app = express();
const httpServer = createServer(app);

app.use(cors());
app.use(express.json());

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const roomManager = new RoomManager();
roomManager.setIO(io);
const gameManager = new GameManager(roomManager, io);

// 房间删除时清理游戏状态
roomManager.setOnRoomDeleted((roomId) => gameManager.cleanup(roomId));

if (process.env.NODE_ENV === 'development' || process.env.ENABLE_DEBUG_TOOLS === 'true') {
  registerDebugRoutes(app, roomManager, gameManager);
}

// 健康检查接口
app.get('/health', (req, res) => {
  res.json({ status: 'ok', rooms: roomManager.getRoomCount() });
});

// 获取房间列表
app.get('/api/rooms', (req, res) => {
  res.json(roomManager.getPublicRooms());
});

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // 房间事件
  socket.on('room:create', (data) => {
    roomManager.createRoom(socket, data.playerName, data.config);
  });

  socket.on('room:join', (data) => {
    roomManager.joinRoom(socket, data.roomId, data.playerName);
  });

  socket.on('room:reconnect', (data) => {
    gameManager.reconnect(socket, data.sessionId);
  });

  socket.on('room:leave', () => {
    roomManager.leaveRoom(socket);
  });

  socket.on('room:updateConfig', (data) => {
    roomManager.updateConfig(socket, data);
  });

  socket.on('room:swapSeat', (data) => {
    roomManager.swapSeat(socket, data.targetSeat);
  });

  socket.on('room:acceptSwap', () => {
    roomManager.acceptSwap(socket);
  });

  socket.on('room:rejectSwap', () => {
    roomManager.rejectSwap(socket);
  });

  socket.on('room:start', () => {
    gameManager.startGame(socket);
  });

  socket.on('room:reset', () => {
    const room = roomManager.getRoomBySocket(socket);
    if (roomManager.resetRoom(socket) && room) {
      gameManager.cleanup(room.id);
    }
  });

  // 游戏事件
  socket.on('game:confirmRole', () => {
    gameManager.confirmRole(socket);
  });

  socket.on('game:pause', () => {
    gameManager.pauseGame(socket);
  });

  socket.on('game:resume', () => {
    gameManager.resumeGame(socket);
  });

  socket.on('game:werewolfKill', (data) => {
    gameManager.werewolfKill(socket, data.targetId);
  });

  socket.on('game:wolfConfirmVote', () => {
    gameManager.wolfConfirmVote(socket);
  });

  socket.on('game:wolfSelfReveal', () => {
    gameManager.wolfSelfReveal(socket);
  });

  socket.on('game:whiteWolfKingExplode', (data) => {
    gameManager.whiteWolfKingExplode(socket, data.targetId);
  });

  socket.on('game:seerCheck', (data) => {
    gameManager.seerCheck(socket, data.targetId);
  });

  socket.on('game:witchSave', () => {
    gameManager.witchSave(socket);
  });

  socket.on('game:witchPoison', (data) => {
    gameManager.witchPoison(socket, data.targetId);
  });

  socket.on('game:witchPass', () => {
    gameManager.witchPass(socket);
  });

  socket.on('game:guardProtect', (data) => {
    gameManager.guardProtect(socket, data.targetId);
  });

  socket.on('game:vote', (data) => {
    gameManager.vote(socket, data.targetId);
  });

  socket.on('game:abstainVote', () => {
    gameManager.abstainVote(socket);
  });

  socket.on('game:speakingDone', () => {
    gameManager.speakingDone(socket);
  });

  socket.on('game:hunterShoot', (data) => {
    gameManager.hunterShoot(socket, data.targetId);
  });

  socket.on('game:hunterPass', () => {
    gameManager.hunterPass(socket);
  });

  socket.on('game:wolfKingShoot', (data) => {
    gameManager.wolfKingShoot(socket, data.targetId);
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    roomManager.handleDisconnect(socket);
  });
});

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Socket.IO ready`);
});
