import { create } from 'zustand';
import { Player, PublicGameState, PublicRoom, Role, GamePhase, SeatSwapRequest, SpeakingState, SystemMessage, PublicDeathReason, ReviewEvent } from '@werewolf/shared';
import { socket } from '../lib/socket';
import { ERROR_TOAST_DURATION_MS } from '../game-ui/timing';

type View = 'home' | 'create' | 'room' | 'game';
const SESSION_STORAGE_KEY = 'werewolf.sessionId';
// React 严格模式下组件可能重复挂载，用模块级标记避免重复注册 socket 监听。
let socketInitialized = false;

const getRemainingPhaseSeconds = (timer: number, endsAt: number | null): number => {
  return endsAt ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : timer;
};

const buildPhaseUpdate = (
  phase: GamePhase,
  timer: number,
  endsAt: number | null,
  speaking: SpeakingState | undefined,
  resetVoteState = false
): Partial<PublicGameState> => {
  const update: Partial<PublicGameState> = {
    phase,
    phaseTimer: getRemainingPhaseSeconds(timer, endsAt),
    phaseEndsAt: endsAt,
    paused: false,
    pausedAt: null,
    remainingMs: null,
    speaking: speaking ?? null
  };

  if (resetVoteState && phase === GamePhase.DAY_VOTE) {
    update.votes = {};
  }
  return update;
};

const getRuntimeResetState = (): Partial<GameStore> => ({
  myRole: null,
  gameState: null,
  speaking: null,
  seerResult: null,
  witchInfo: null,
  skillState: null,
  roleConfirmed: false,
  confirmedPlayers: [],
  wolfVotes: {},
  wolfSelections: {},
  wolfTeam: [],
  deathEvents: [],
  voteResult: null,
  revealedPlayers: null
});

const getHiddenDeathSkillState = (
  gameState: PublicGameState,
  phase: GamePhase.HUNTER_SHOOT | GamePhase.WOLF_KING_SHOOT,
  timer: number,
  endsAt: number | null
): Partial<GameStore> => ({
  speaking: null,
  witchInfo: null,
  gameState: {
    ...gameState,
    ...buildPhaseUpdate(phase, timer, endsAt, undefined)
  }
});

const getPhaseScopedState = (
  phase: GamePhase,
  speaking: SpeakingState | undefined,
  resetWolfState: boolean
): Partial<GameStore> => {
  const scoped: Partial<GameStore> = {};

  scoped.speaking = speaking ?? null;
  if (resetWolfState) {
    scoped.wolfVotes = {};
    scoped.wolfSelections = {};
  }
  if (phase === GamePhase.NIGHT_WEREWOLF) {
    scoped.voteResult = null;
    scoped.witchInfo = null;
  }
  if (phase === GamePhase.NIGHT_SEER) {
    scoped.seerResult = null;
  }
  if (phase !== GamePhase.NIGHT_WITCH) {
    scoped.witchInfo = null;
  }
  if (phase === GamePhase.DAY_VOTE) {
    scoped.voteResult = null;
  }
  if (phase !== GamePhase.ROLE_CONFIRM) {
    scoped.roleConfirmed = false;
    scoped.confirmedPlayers = [];
  }

  return scoped;
};

export interface DeathEvent {
  playerId: string;
  reason: PublicDeathReason;
  day: number;
}

export interface VoteResultState {
  votes: Record<string, number>;
  eliminated: string | null;
  abstained: number;
}

export interface SeerResultState {
  playerId: string;
  isWerewolf: boolean;
  day: number;
}

export interface SkillState {
  witch?: { saveAvailable: boolean; poisonAvailable: boolean };
  guard?: { lastGuardTargetId: string | null };
}

interface GameStore {
  // 视图状态
  currentView: View;
  setCurrentView: (view: View) => void;

  // 房间状态
  room: PublicRoom | null;
  setRoom: (room: PublicRoom | null) => void;

  // 待创建房间的玩家名
  pendingName: string | null;
  setPendingName: (name: string | null) => void;

  // 玩家信息
  myId: string | null;
  sessionId: string | null;
  myRole: Role | null;
  setMyRole: (role: Role | null) => void;

  // 游戏状态
  gameState: PublicGameState | null;
  setGameState: (state: PublicGameState | null) => void;

  // 系统消息
  systemMessages: SystemMessage[];
  addSystemMessage: (msg: SystemMessage) => void;

  // 发言状态
  speaking: SpeakingState | null;
  setSpeaking: (state: SpeakingState | null) => void;

  // 游戏结果
  seerResult: SeerResultState | null;
  setSeerResult: (result: SeerResultState | null) => void;
  witchInfo: { killedPlayerId: string | null } | null;
  skillState: SkillState | null;

  // 错误信息
  error: string | null;
  setError: (error: string | null) => void;

  // 座位交换
  pendingSwapRequest: SeatSwapRequest | null;
  setPendingSwapRequest: (req: SeatSwapRequest | null) => void;
  outgoingSwapRequest: SeatSwapRequest | null;
  setOutgoingSwapRequest: (req: SeatSwapRequest | null) => void;

  // 身份确认
  roleConfirmed: boolean;
  confirmedPlayers: string[];  // 已确认的玩家ID列表

  // 狼人投票
  wolfVotes: Record<string, string>;      // wolfId → targetId (已确认)
  wolfSelections: Record<string, string>; // wolfId → targetId (仅选择)
  wolfTeam: string[];

  deathEvents: DeathEvent[];
  voteResult: VoteResultState | null;
  revealedPlayers: Player[] | null;

  // 初始化socket监听
  initSocket: () => void;

  // 房间操作
  createRoom: (playerName: string, config?: Partial<import('@werewolf/shared').RoomConfig>) => void;
  joinRoom: (roomId: string, playerName: string) => void;
  leaveRoom: () => void;
  setReady: (ready: boolean) => void;
  startGame: () => void;
  resetRoom: () => void;

  // 房间配置
  updateConfig: (config: Partial<import('@werewolf/shared').RoomConfig>) => void;

  // 座位操作
  swapSeat: (targetSeat: number) => void;
  cancelSwap: () => void;
  acceptSwap: () => void;
  rejectSwap: () => void;

  // 游戏操作
  confirmRole: () => void;
  pauseGame: () => void;
  resumeGame: () => void;
  werewolfKill: (targetId: string) => void;
  wolfConfirmVote: () => void;
  wolfSelfReveal: () => void;
  whiteWolfKingExplode: (targetId: string) => void;
  seerCheck: (targetId: string) => void;
  witchSave: () => void;
  witchPoison: (targetId: string) => void;
  witchPass: () => void;
  guardProtect: (targetId: string) => void;
  vote: (targetId: string) => void;
  abstainVote: () => void;
  speakingDone: () => void;
  hunterShoot: (targetId: string) => void;
  hunterPass: () => void;
  wolfKingShoot: (targetId: string) => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  currentView: 'home',
  room: null,
  pendingName: null,
  myId: null,
  sessionId: null,
  myRole: null,
  gameState: null,
  systemMessages: [],
  speaking: null,
  seerResult: null,
  witchInfo: null,
  skillState: null,
  error: null,
  pendingSwapRequest: null,
  outgoingSwapRequest: null,
  roleConfirmed: false,
  confirmedPlayers: [],
  wolfVotes: {},
  wolfSelections: {},
  wolfTeam: [],
  deathEvents: [],
  voteResult: null,
  revealedPlayers: null,

  setCurrentView: (view) => set({ currentView: view }),
  setPendingName: (name) => set({ pendingName: name }),
  setRoom: (room) => set({ room }),
  setMyRole: (role) => set({ myRole: role }),
  setGameState: (state) => set({ gameState: state }),
  addSystemMessage: (msg) => set((state) => ({ systemMessages: [...state.systemMessages, msg] })),
  setSpeaking: (speaking) => set({ speaking }),
  setSeerResult: (result) => set({ seerResult: result }),
  setError: (error) => set({ error }),
  setPendingSwapRequest: (req) => set({ pendingSwapRequest: req }),
  setOutgoingSwapRequest: (req) => set({ outgoingSwapRequest: req }),

  initSocket: () => {
    if (socketInitialized) return;
    socketInitialized = true;

    const showError = (message: string, extraState: Partial<GameStore> = {}) => {
      set({ ...extraState, error: message });
      setTimeout(() => set({ error: null }), ERROR_TOAST_DURATION_MS);
    };

    socket.on('connect', () => {
      // 用稳定 sessionId 尝试恢复房间和身份，刷新页面不会直接丢局。
      const sessionId = localStorage.getItem(SESSION_STORAGE_KEY);
      if (sessionId) {
        socket.emit('room:reconnect', { sessionId });
      }
    });
    if (socket.connected) {
      const sessionId = localStorage.getItem(SESSION_STORAGE_KEY);
      if (sessionId) {
        socket.emit('room:reconnect', { sessionId });
      }
    }

    socket.on('room:joined', ({ room, sessionId, playerId }) => {
      localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
      set({ room, currentView: 'room', myId: playerId, sessionId });
    });

    socket.on('room:reconnected', ({ room, sessionId, playerId }) => {
      localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
      set({
        room,
        currentView: room.status === 'playing' ? 'game' : 'room',
        myId: playerId,
        sessionId
      });
    });

    socket.on('room:reconnectFailed', () => {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      set({ sessionId: null });
    });

    socket.on('room:updated', ({ room }) => {
      const nextState: Partial<GameStore> = { room };
      if (room.status === 'waiting' && get().currentView === 'game') {
        // 重新开局会把客户端从游戏页拉回房间，并清空上一局的私有/临时状态。
        Object.assign(nextState, getRuntimeResetState(), { currentView: 'room' });
      }
      set(nextState);
    });

    socket.on('room:error', ({ message }) => {
      showError(message, { outgoingSwapRequest: null });
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

    socket.on('room:swapRequest', (request) => {
      set({ pendingSwapRequest: request });
    });

    socket.on('room:swapResult', ({ success, message }) => {
      const isWaitingAck = success && message?.includes('等待对方确认');
      if (!isWaitingAck) {
        set({ outgoingSwapRequest: null });
      }
      if (!success && message) {
        showError(message);
      }
    });

    socket.on('room:swapCancelled', ({ message }) => {
      showError(message, { pendingSwapRequest: null });
    });

    socket.on('game:started', ({ gameState, myRole, wolfTeam }) => {
      set({
        gameState,
        myRole,
        currentView: 'game',
        systemMessages: [],
        speaking: gameState.speaking ?? null,
        witchInfo: null,
        skillState: null,
        roleConfirmed: false,
        confirmedPlayers: [],
        wolfVotes: {},
        wolfSelections: {},
        wolfTeam: wolfTeam || [],
        deathEvents: gameState.deadPlayers.map(dead => ({
          playerId: dead.playerId,
          reason: dead.reason,
          day: dead.day
        })),
        voteResult: null,
        revealedPlayers: null
      });
    });

    socket.on('game:phaseChanged', ({ phase, timer, endsAt, speaking }) => {
      const gameState = get().gameState;
      if (gameState) {
        // 服务端下发 endsAt，客户端按当前时间换算剩余秒数，保证多端显示一致。
        const update = buildPhaseUpdate(phase, timer, endsAt, speaking, true);
        set({
          ...getPhaseScopedState(phase, speaking, phase === GamePhase.NIGHT_WEREWOLF),
          gameState: { ...gameState, ...update }
        });
      }
    });

    socket.on('game:paused', ({ remainingMs }) => {
      const gameState = get().gameState;
      if (gameState) {
        set({
          gameState: {
            ...gameState,
            paused: true,
            pausedAt: Date.now(),
            remainingMs,
            phaseEndsAt: null,
            phaseTimer: remainingMs !== null ? Math.ceil(remainingMs / 1000) : 0
          }
        });
      }
    });

    socket.on('game:resumed', ({ phase, timer, endsAt, speaking }) => {
      const gameState = get().gameState;
      if (gameState) {
        set({
          ...getPhaseScopedState(phase, speaking, false),
          gameState: { ...gameState, ...buildPhaseUpdate(phase, timer, endsAt, speaking) }
        });
      }
    });

    socket.on('game:speakingUpdate', ({ speaking }) => {
      set({ speaking });
      const gameState = get().gameState;
      if (gameState) {
        set({ gameState: { ...gameState, speaking } });
      }
    });

    socket.on('game:playerDead', ({ playerId, reason, day }) => {
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
      const deathEvents = get().deathEvents;
      // 同一死亡事件可能随重连或房间更新重复到达，时间线按 player/reason/day 去重。
      if (!deathEvents.some(event => event.playerId === playerId && event.reason === reason && event.day === day)) {
        set({ deathEvents: [...deathEvents, { playerId, reason, day }] });
      }
    });

    socket.on('game:seerResult', ({ playerId, isWerewolf, day }) => {
      set({ seerResult: { playerId, isWerewolf, day } });
    });

    socket.on('game:witchInfo', ({ killedPlayerId }) => {
      set({ witchInfo: { killedPlayerId } });
    });

    socket.on('game:skillState', (skillState) => {
      set({ skillState });
    });

    socket.on('game:systemMessage', (message) => {
      get().addSystemMessage(message);
    });

    socket.on('game:voteResult', ({ votes, eliminated, abstained, isTie, details }) => {
      const gameState = get().gameState;
      const nextEntry = {
        day: gameState?.day ?? 0,
        votes: details,
        voteCount: votes,
        eliminated,
        abstained,
        isTie
      };
      const currentHistory = gameState?.voteHistory ?? [];
      // 同一天投票结果以最后一次服务端结算为准，避免历史抽屉出现重复天数。
      const nextHistory = currentHistory.some(entry => entry.day === nextEntry.day)
        ? currentHistory.map(entry => entry.day === nextEntry.day ? nextEntry : entry)
        : [...currentHistory, nextEntry];
      set({
        voteResult: { votes, eliminated, abstained },
        gameState: gameState ? {
          ...gameState,
          votes: details,
          voteHistory: nextHistory
        } : gameState
      });
    });

    socket.on('game:reviewEvent', ({ event }: { event: ReviewEvent }) => {
      const gameState = get().gameState;
      if (!gameState) return;
      const currentEvents = gameState.reviewEvents ?? [];
      if (currentEvents.some(current => current.id === event.id)) return;
      set({
        gameState: {
          ...gameState,
          reviewEvents: [...currentEvents, event]
        }
      });
    });

    socket.on('game:over', ({ winner, players }) => {
      const gameState = get().gameState;
      if (gameState) {
        set({ gameState: { ...gameState, winner, phase: GamePhase.GAME_OVER } });
      }
      set({ revealedPlayers: players });
    });

    socket.on('game:error', ({ message }) => {
      showError(message);
    });

    socket.on('game:hunterRequired', ({ timer, endsAt }) => {
      const gameState = get().gameState;
      if (gameState) {
        set(getHiddenDeathSkillState(gameState, GamePhase.HUNTER_SHOOT, timer, endsAt));
      }
    });

    socket.on('game:wolfKingRequired', ({ timer, endsAt }) => {
      const gameState = get().gameState;
      if (gameState) {
        set(getHiddenDeathSkillState(gameState, GamePhase.WOLF_KING_SHOOT, timer, endsAt));
      }
    });

    socket.on('game:roleConfirmed', ({ playerId }) => {
      const confirmed = get().confirmedPlayers;
      if (!confirmed.includes(playerId)) {
        set({ confirmedPlayers: [...confirmed, playerId] });
      }
      if (playerId === get().myId) {
        set({ roleConfirmed: true });
      }
    });

    socket.on('game:wolfVoteUpdate', ({ wolfVotes }) => {
      set({ wolfVotes });
    });

    socket.on('game:wolfSelectionUpdate', ({ selections }) => {
      set({ wolfSelections: selections });
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
    localStorage.removeItem(SESSION_STORAGE_KEY);
    set({
      ...getRuntimeResetState(),
      room: null,
      currentView: 'home',
      myId: null,
      sessionId: null
    });
  },

  startGame: () => {
    socket.emit('room:start');
  },

  setReady: (ready) => {
    socket.emit('room:ready', { ready });
  },

  resetRoom: () => {
    socket.emit('room:reset');
  },

  updateConfig: (config) => {
    socket.emit('room:updateConfig', config);
  },

  swapSeat: (targetSeat) => {
    const { room, myId } = get();
    const me = room?.players.find(player => player.id === myId);
    const targetPlayer = room?.players.find(player => player.seatIndex === targetSeat);
    if (me && targetPlayer) {
      set({
        outgoingSwapRequest: {
          fromId: me.id,
          fromSeat: me.seatIndex,
          targetSeat,
          targetId: targetPlayer.id
        }
      });
    }
    socket.emit('room:swapSeat', { targetSeat });
  },

  cancelSwap: () => {
    socket.emit('room:cancelSwap');
    set({ outgoingSwapRequest: null });
  },

  acceptSwap: () => {
    socket.emit('room:acceptSwap');
    set({ pendingSwapRequest: null });
  },

  rejectSwap: () => {
    socket.emit('room:rejectSwap');
    set({ pendingSwapRequest: null });
  },

  confirmRole: () => {
    socket.emit('game:confirmRole');
  },

  pauseGame: () => {
    socket.emit('game:pause');
  },

  resumeGame: () => {
    socket.emit('game:resume');
  },

  werewolfKill: (targetId) => {
    socket.emit('game:werewolfKill', { targetId });
  },

  wolfConfirmVote: () => {
    socket.emit('game:wolfConfirmVote');
  },

  wolfSelfReveal: () => {
    socket.emit('game:wolfSelfReveal');
  },

  whiteWolfKingExplode: (targetId) => {
    socket.emit('game:whiteWolfKingExplode', { targetId });
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

  witchPass: () => {
    socket.emit('game:witchPass');
  },

  guardProtect: (targetId) => {
    socket.emit('game:guardProtect', { targetId });
  },

  vote: (targetId) => {
    socket.emit('game:vote', { targetId });
    const { gameState, myId } = get();
    if (gameState && myId && gameState.phase === GamePhase.DAY_VOTE) {
      // 乐观标记自己已投票，避免等待服务端广播期间重复点击。
      set({ gameState: { ...gameState, votes: { ...gameState.votes, [myId]: targetId } } });
    }
  },

  abstainVote: () => {
    socket.emit('game:abstainVote');
    const { gameState, myId } = get();
    if (gameState && myId && gameState.phase === GamePhase.DAY_VOTE) {
      // null 与服务端约定一致，表示弃票而不是未投票。
      set({ gameState: { ...gameState, votes: { ...gameState.votes, [myId]: null } } });
    }
  },

  speakingDone: () => {
    socket.emit('game:speakingDone');
  },

  hunterShoot: (targetId) => {
    socket.emit('game:hunterShoot', { targetId });
  },

  hunterPass: () => {
    socket.emit('game:hunterPass');
  },

  wolfKingShoot: (targetId) => {
    socket.emit('game:wolfKingShoot', { targetId });
  }
}));
