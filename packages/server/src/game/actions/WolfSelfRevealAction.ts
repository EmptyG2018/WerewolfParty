import {
  GamePhase,
  GameState,
  Player,
  RoleAbility,
  Room,
  roleHasAbility
} from '@werewolf/shared';
import { GameEngine } from '../GameEngine';

export interface WolfSelfRevealResult {
  ok: boolean;
  error?: string;
  winner?: 'villager' | 'werewolf';
}

export class WolfSelfRevealAction {
  constructor(private readonly engine: GameEngine) {}

  canExecute(gameState: GameState, player: Player): boolean {
    return (
      player.status === 'alive' &&
      player.role !== null &&
      roleHasAbility(player.role, RoleAbility.WOLF_SELF_REVEAL) &&
      (gameState.phase === GamePhase.DAY_SPEAKING || gameState.phase === GamePhase.DAY_VOTE)
    );
  }

  execute(room: Room, gameState: GameState, player: Player): WolfSelfRevealResult {
    if (!this.canExecute(gameState, player)) {
      return { ok: false, error: '当前阶段不能自曝' };
    }

    const deadPlayer = this.engine.killPlayer(room, gameState, player.id, 'self_exposed');
    if (!deadPlayer) {
      return { ok: false, error: '自曝失败' };
    }

    const winner = this.engine.checkWinner(room);
    return { ok: true, winner: winner ?? undefined };
  }
}
