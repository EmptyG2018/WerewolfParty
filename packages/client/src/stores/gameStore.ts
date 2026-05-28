import { create } from 'zustand';
import { Room, Player, GameState, Role, GamePhase, SpeakingState, SystemMessage } from '@werewolf/shared';
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

  // 系统消息
  systemMessages: SystemMessage[];
  addSystemMessage: (msg: SystemMessage) => void;

  // 发言状态
  speaking: SpeakingState | null;
  setSpeaking: (state: SpeakingState | null) => void;

  // 游戏结果
  seerResult: { playerId: string; isWerewolf: boolean } | null;
  setSeerResult: (result: { playerId: string; isWerewolf: boolean } | null) => void;

  // 错误信息
  error: string | null;
  setError: (error: string | null) => void;

  // 初始化socket监听
  initSocket: () => void;

  // 房间操作
  createRoom: (playerName: string, config?: Partial<import('@werewolf/shared').RoomConfig>) => void;
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
  speakingDone: () => void;
  hunterShoot: (targetId: string) => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  currentView: 'home',
  room: null,
  myId: null,
  myRole: null,
  gameState: null,
  systemMessages: [],
  speaking: null,
  seerResult: null,
  error: null,

  setCurrentView: (view) => set({ currentView: view }),
  setRoom: (room) => set({ room }),
  setMyRole: (role) => set({ myRole: role }),
  setGameState: (state) => set({ gameState: state }),
  addSystemMessage: (msg) => set((state) => ({ systemMessages: [...state.systemMessages, msg] })),
  setSpeaking: (speaking) => set({ speaking }),
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
        systemMessages: [],
        speaking: null
      });
    });

    socket.on('game:phaseChanged', ({ phase, timer, speaking }) => {
      const gameState = get().gameState;
      if (gameState) {
        const update: Partial<GameState> = { phase, phaseTimer: timer };
        if (speaking !== undefined) {
          update.speaking = speaking;
          set({ speaking });
        }
        set({ gameState: { ...gameState, ...update } });
      }
    });

    socket.on('game:speakingUpdate', ({ speaking }) => {
      set({ speaking });
      const gameState = get().gameState;
      if (gameState) {
        set({ gameState: { ...gameState, speaking } });
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

    socket.on('game:systemMessage', (message) => {
      get().addSystemMessage(message);
    });

    socket.on('game:voteResult', ({ votes, eliminated }) => {
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
      console.log('Hunter required:', playerId);
    });
  },

  createRoom: (playerName, config) => {
    socket.emit('room:create', { playerName, config: config || {} });
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

  speakingDone: () => {
    socket.emit('game:speakingDone');
  },

  hunterShoot: (targetId) => {
    socket.emit('game:hunterShoot', { targetId });
  }
}));
