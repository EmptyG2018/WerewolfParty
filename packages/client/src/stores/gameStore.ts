import { create } from 'zustand';
import { Room, Player, GameState, Role, GamePhase, ChatMessage } from '@werewolf/shared';
import { socket } from '../lib/socket';

type View = 'home' | 'room' | 'game';

interface GameStore {
  // 视图状态
  currentView: View;
  setCurrentView: (view: View) => void;

  // 房间状态
  room: Room | null;
  setRoom: (room: Room | null) => void;

  // 玩家信息
  myId: string | null;
  myRole: Role | null;
  setMyRole: (role: Role | null) => void;

  // 游戏状态
  gameState: GameState | null;
  setGameState: (state: GameState | null) => void;

  // 聊天消息
  messages: ChatMessage[];
  addMessage: (message: ChatMessage) => void;

  // 游戏结果
  seerResult: { playerId: string; isWerewolf: boolean } | null;
  setSeerResult: (result: { playerId: string; isWerewolf: boolean } | null) => void;

  // 错误信息
  error: string | null;
  setError: (error: string | null) => void;

  // 初始化socket监听
  initSocket: () => void;

  // 房间操作
  createRoom: (playerName: string) => void;
  joinRoom: (roomId: string, playerName: string) => void;
  leaveRoom: () => void;
  startGame: () => void;

  // 游戏操作
  werewolfKill: (targetId: string) => void;
  seerCheck: (targetId: string) => void;
  witchSave: () => void;
  witchPoison: (targetId: string) => void;
  guardProtect: (targetId: string) => void;
  vote: (targetId: string) => void;
  sendChat: (message: string) => void;
  hunterShoot: (targetId: string) => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  currentView: 'home',
  room: null,
  myId: null,
  myRole: null,
  gameState: null,
  messages: [],
  seerResult: null,
  error: null,

  setCurrentView: (view) => set({ currentView: view }),
  setRoom: (room) => set({ room }),
  setMyRole: (role) => set({ myRole: role }),
  setGameState: (state) => set({ gameState: state }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  setSeerResult: (result) => set({ seerResult: result }),
  setError: (error) => set({ error }),

  initSocket: () => {
    socket.on('room:created', ({ roomId }) => {
      console.log('Room created:', roomId);
    });

    socket.on('room:joined', ({ room }) => {
      set({ room, currentView: 'room', myId: socket.id });
    });

    socket.on('room:updated', ({ room }) => {
      set({ room });
    });

    socket.on('room:error', ({ message }) => {
      set({ error: message });
      setTimeout(() => set({ error: null }), 3000);
    });

    socket.on('room:playerJoined', ({ player }) => {
      const room = get().room;
      if (room) {
        set({ room: { ...room, players: [...room.players, player] } });
      }
    });

    socket.on('room:playerLeft', ({ playerId }) => {
      const room = get().room;
      if (room) {
        set({ room: { ...room, players: room.players.filter(p => p.id !== playerId) } });
      }
    });

    socket.on('game:started', ({ gameState, myRole }) => {
      set({
        gameState,
        myRole,
        currentView: 'game',
        messages: []
      });
    });

    socket.on('game:phaseChanged', ({ phase, timer }) => {
      const gameState = get().gameState;
      if (gameState) {
        set({ gameState: { ...gameState, phase, phaseTimer: timer } });
      }
    });

    socket.on('game:playerDead', ({ playerId }) => {
      const room = get().room;
      if (room) {
        set({
          room: {
            ...room,
            players: room.players.map(p =>
              p.id === playerId ? { ...p, status: 'dead' } : p
            )
          }
        });
      }
    });

    socket.on('game:seerResult', ({ playerId, isWerewolf }) => {
      set({ seerResult: { playerId, isWerewolf } });
    });

    socket.on('game:message', (message) => {
      get().addMessage(message);
    });

    socket.on('game:voteResult', ({ votes, eliminated }) => {
      // 可以在这里显示投票结果
      console.log('Vote result:', votes, eliminated);
    });

    socket.on('game:over', ({ winner, players }) => {
      const gameState = get().gameState;
      if (gameState) {
        set({ gameState: { ...gameState, winner, phase: GamePhase.GAME_OVER } });
      }
    });

    socket.on('game:error', ({ message }) => {
      set({ error: message });
      setTimeout(() => set({ error: null }), 3000);
    });

    socket.on('game:hunterRequired', ({ playerId }) => {
      // 猎人需要选择目标
      console.log('Hunter required:', playerId);
    });
  },

  createRoom: (playerName) => {
    socket.emit('room:create', { playerName, config: {} });
  },

  joinRoom: (roomId, playerName) => {
    socket.emit('room:join', { roomId, playerName });
  },

  leaveRoom: () => {
    socket.emit('room:leave');
    set({ room: null, currentView: 'home' });
  },

  startGame: () => {
    socket.emit('room:start');
  },

  werewolfKill: (targetId) => {
    socket.emit('game:werewolfKill', { targetId });
  },

  seerCheck: (targetId) => {
    socket.emit('game:seerCheck', { targetId });
  },

  witchSave: () => {
    socket.emit('game:witchSave');
  },

  witchPoison: (targetId) => {
    socket.emit('game:witchPoison', { targetId });
  },

  guardProtect: (targetId) => {
    socket.emit('game:guardProtect', { targetId });
  },

  vote: (targetId) => {
    socket.emit('game:vote', { targetId });
  },

  sendChat: (message) => {
    socket.emit('game:chat', { message });
  },

  hunterShoot: (targetId) => {
    socket.emit('game:hunterShoot', { targetId });
  }
}));
