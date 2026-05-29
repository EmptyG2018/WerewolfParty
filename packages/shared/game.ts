import { Role } from './roles';

export enum GamePhase {
  WAITING = 'waiting',
  ROLE_CONFIRM = 'role_confirm',
  NIGHT_WEREWOLF = 'night_werewolf',
  NIGHT_SEER = 'night_seer',
  NIGHT_WITCH = 'night_witch',
  NIGHT_GUARD = 'night_guard',
  DAY_ANNOUNCE = 'day_announce',
  DAY_SPEAKING = 'day_speaking',
  DAY_VOTE = 'day_vote',
  HUNTER_SHOOT = 'hunter_shoot',
  WOLF_KING_SHOOT = 'wolf_king_shoot',
  GAME_OVER = 'game_over'
}

export interface Player {
  id: string;
  name: string;
  roomId: string;
  role: Role | null;
  status: 'alive' | 'dead';
  isHost: boolean;
  voteTarget: string | null;
  skillUsed: {
    witchSave: boolean;
    witchPoison: boolean;
    lastGuardTarget: string | null;
  };
}

export interface NightAction {
  playerId: string;
  role: Role;
  action: string;
  targetId: string;
  timestamp: number;
}

export interface DeadPlayer {
  playerId: string;
  reason: 'killed' | 'voted' | 'poisoned' | 'shot';
  day: number;
}

export interface SystemMessage {
  id: string;
  content: string;
  timestamp: number;
}

export interface SpeakingState {
  order: string[];
  currentIndex: number;
  confirmed: string[];
}

export interface GameState {
  phase: GamePhase;
  day: number;
  nightActions: NightAction[];
  deadPlayers: DeadPlayer[];
  systemMessages: SystemMessage[];
  phaseTimer: number;
  winner: 'villager' | 'werewolf' | null;
  votes: Record<string, string>;
  seerCheckResult: { playerId: string; isWerewolf: boolean } | null;
  witchSaveUsed: boolean;
  witchPoisonUsed: boolean;
  lastKilledPlayer: string | null;
  lastGuardTarget: string | null;
  speaking: SpeakingState | null;
  wolfKingCanShoot: boolean;
}
