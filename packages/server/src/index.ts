import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { RoomManager } from './rooms/RoomManager';
import { GameManager } from './game/GameManager';
import { ClientToServerEvents, ServerToClientEvents } from '@werewolf/shared';

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

  socket.on('room:leave', () => {
    roomManager.leaveRoom(socket);
  });

  socket.on('room:updateConfig', (data) => {
    roomManager.updateConfig(socket, data);
  });

  socket.on('room:start', () => {
    gameManager.startGame(socket);
  });

  // 游戏事件
  socket.on('game:werewolfKill', (data) => {
    gameManager.werewolfKill(socket, data.targetId);
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

  socket.on('game:guardProtect', (data) => {
    gameManager.guardProtect(socket, data.targetId);
  });

  socket.on('game:vote', (data) => {
    gameManager.vote(socket, data.targetId);
  });

  socket.on('game:speakingDone', () => {
    gameManager.speakingDone(socket);
  });

  socket.on('game:hunterShoot', (data) => {
    gameManager.hunterShoot(socket, data.targetId);
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
