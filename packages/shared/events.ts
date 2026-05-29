import { Role } from './roles';
import { GamePhase, GameState, Player, SpeakingState, SystemMessage } from './game';
import { Room, RoomConfig } from './room';

export interface ClientToServerEvents {
  'room:create': (data: { playerName: string; config: Partial<RoomConfig> }) => void;
  'room:join': (data: { roomId: string; playerName: string }) => void;
  'room:leave': () => void;
  'room:updateConfig': (data: Partial<RoomConfig>) => void;
  'room:start': () => void;
  'game:confirmRole': () => void;
  'game:werewolfKill': (data: { targetId: string }) => void;
  'game:seerCheck': (data: { targetId: string }) => void;
  'game:witchSave': () => void;
  'game:witchPoison': (data: { targetId: string }) => void;
  'game:guardProtect': (data: { targetId: string }) => void;
  'game:vote': (data: { targetId: string }) => void;
  'game:speakingDone': () => void;
  'game:hunterShoot': (data: { targetId: string }) => void;
  'game:wolfKingShoot': (data: { targetId: string }) => void;
}

export interface ServerToClientEvents {
  'room:created': (data: { roomId: string }) => void;
  'room:joined': (data: { room: Room }) => void;
  'room:updated': (data: { room: Room }) => void;
  'room:error': (data: { message: string }) => void;
  'room:playerJoined': (data: { player: Player }) => void;
  'room:playerLeft': (data: { playerId: string }) => void;
  'game:started': (data: { gameState: GameState; myRole: Role }) => void;
  'game:phaseChanged': (data: { phase: GamePhase; timer: number; speaking?: SpeakingState }) => void;
  'game:speakingUpdate': (data: { speaking: SpeakingState }) => void;
  'game:playerDead': (data: { playerId: string; reason: string }) => void;
  'game:seerResult': (data: { playerId: string; isWerewolf: boolean }) => void;
  'game:voteResult': (data: { votes: Record<string, number>; eliminated: string | null }) => void;
  'game:over': (data: { winner: 'villager' | 'werewolf'; players: Player[] }) => void;
  'game:systemMessage': (data: SystemMessage) => void;
  'game:error': (data: { message: string }) => void;
  'game:hunterRequired': (data: { playerId: string }) => void;
  'game:wolfKingRequired': (data: { playerId: string }) => void;
}

export interface BroadcastMessage {
  type: 'room_announce';
  roomId: string;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
  status: 'waiting' | 'playing';
  port: number;
}
