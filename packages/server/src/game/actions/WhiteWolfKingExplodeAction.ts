import {
  GamePhase,
  GameState,
  Player,
  RoleAbility,
  Room,
  roleHasAbility
} from '@werewolf/shared';
import { GameEngine } from '../GameEngine';

export interface WhiteWolfKingExplodeResult {
  ok: boolean;
  error?: string;
  winner?: 'villager' | 'werewolf';
}

export class WhiteWolfKingExplodeAction {
  constructor(private readonly engine: GameEngine) {}

  canExecute(gameState: GameState, player: Player): boolean {
    return (
      player.status === 'alive' &&
      player.role !== null &&
      roleHasAbility(player.role, RoleAbility.WHITE_WOLF_KING_EXPLODE) &&
      (gameState.phase === GamePhase.DAY_SPEAKING || gameState.phase === GamePhase.DAY_VOTE)
    );
  }

  execute(room: Room, gameState: GameState, player: Player, targetId: string): WhiteWolfKingExplodeResult {
    if (!this.canExecute(gameState, player)) {
      return { ok: false, error: '当前阶段不能发动白狼王自曝' };
    }

    const target = room.players.find(candidate => candidate.id === targetId);
    if (!target || target.status !== 'alive' || target.id === player.id) {
      return { ok: false, error: '请选择一名存活的其他玩家' };
    }

    const explodedPlayer = this.engine.killPlayer(room, gameState, player.id, 'self_exposed');
    if (!explodedPlayer) {
      return { ok: false, error: '自曝失败' };
    }

    const takenPlayer = this.engine.killPlayer(room, gameState, target.id, 'exploded');
    if (!takenPlayer) {
      return { ok: false, error: '带走目标失败' };
    }

    const winner = this.engine.checkWinner(room);
    return { ok: true, winner: winner ?? undefined };
  }
}
