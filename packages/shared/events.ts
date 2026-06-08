import { Role } from './roles';
import { GamePhase, Player, PublicDeathReason, PublicGameState, PublicPlayer, SeatSwapRequest, SpeakingState, SystemMessage } from './game';
import { PublicRoom, RoomConfig } from './room';

export interface ClientToServerEvents {
  'room:create': (data: { playerName: string; config: Partial<RoomConfig> }) => void;
  'room:join': (data: { roomId: string; playerName: string }) => void;
  'room:reconnect': (data: { sessionId: string }) => void;
  'room:leave': () => void;
  'room:updateConfig': (data: Partial<RoomConfig>) => void;
  'room:ready': (data: { ready: boolean }) => void;
  'room:start': () => void;
  'room:reset': () => void;
  'room:swapSeat': (data: { targetSeat: number }) => void;
  'room:cancelSwap': () => void;
  'room:acceptSwap': () => void;
  'room:rejectSwap': () => void;
  'game:confirmRole': () => void;
  'game:pause': () => void;
  'game:resume': () => void;
  'game:werewolfKill': (data: { targetId: string }) => void;
  'game:wolfConfirmVote': () => void;
  'game:wolfSelfReveal': () => void;
  'game:whiteWolfKingExplode': (data: { targetId: string }) => void;
  'game:seerCheck': (data: { targetId: string }) => void;
  'game:witchSave': () => void;
  'game:witchPoison': (data: { targetId: string }) => void;
  'game:witchPass': () => void;
  'game:guardProtect': (data: { targetId: string }) => void;
  'game:vote': (data: { targetId: string }) => void;
  'game:abstainVote': () => void;
  'game:speakingDone': () => void;
  'game:hunterShoot': (data: { targetId: string }) => void;
  'game:hunterPass': () => void;
  'game:wolfKingShoot': (data: { targetId: string }) => void;
}

export interface ServerToClientEvents {
  'room:created': (data: { roomId: string }) => void;
  'room:joined': (data: { room: PublicRoom; sessionId: string; playerId: string }) => void;
  'room:reconnected': (data: { room: PublicRoom; sessionId: string; playerId: string }) => void;
  'room:reconnectFailed': (data: { message: string }) => void;
  'room:updated': (data: { room: PublicRoom }) => void;
  'room:error': (data: { message: string }) => void;
  'room:playerJoined': (data: { player: PublicPlayer }) => void;
  'room:playerLeft': (data: { playerId: string }) => void;
  'room:swapRequest': (data: SeatSwapRequest) => void;
  'room:swapCancelled': (data: { request: SeatSwapRequest; message: string }) => void;
  'room:swapResult': (data: { success: boolean; message?: string }) => void;
  'game:started': (data: { gameState: PublicGameState; myRole: Role; wolfTeam?: string[] }) => void;
  'game:phaseChanged': (data: { phase: GamePhase; timer: number; endsAt: number | null; speaking?: SpeakingState }) => void;
  'game:paused': (data: { remainingMs: number | null }) => void;
  'game:resumed': (data: { phase: GamePhase; timer: number; endsAt: number | null; speaking?: SpeakingState }) => void;
  'game:speakingUpdate': (data: { speaking: SpeakingState }) => void;
  'game:playerDead': (data: { playerId: string; reason: PublicDeathReason; day: number }) => void;
  'game:seerResult': (data: { playerId: string; isWerewolf: boolean; day: number }) => void;
  'game:witchInfo': (data: { killedPlayerId: string | null }) => void;
  'game:skillState': (data: {
    witch?: { saveAvailable: boolean; poisonAvailable: boolean };
    guard?: { lastGuardTargetId: string | null };
  }) => void;
  'game:wolfVoteUpdate': (data: { wolfVotes: Record<string, string> }) => void;
  'game:wolfSelectionUpdate': (data: { selections: Record<string, string> }) => void;
  'game:roleConfirmed': (data: { playerId: string }) => void;
  'game:voteResult': (data: { votes: Record<string, number>; eliminated: string | null; abstained: number; isTie: boolean; details: Record<string, string | null> }) => void;
  'game:over': (data: { winner: 'villager' | 'werewolf'; players: Player[] }) => void;
  'game:systemMessage': (data: SystemMessage) => void;
  'game:error': (data: { message: string }) => void;
  'game:hunterRequired': (data: { playerId: string; timer: number; endsAt: number | null }) => void;
  'game:wolfKingRequired': (data: { playerId: string; timer: number; endsAt: number | null }) => void;
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
