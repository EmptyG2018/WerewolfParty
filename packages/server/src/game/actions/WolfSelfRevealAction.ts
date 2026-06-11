import {
  GamePhase,
  GameState,
  Player,
  RoleAbility,
  Room,
  GAME_ERROR_MESSAGES,
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
    // 自曝只允许在白天发言/投票阶段，用来中断当天流程并立即入夜。
    return (
      player.status === 'alive' &&
      player.role !== null &&
      roleHasAbility(player.role, RoleAbility.WOLF_SELF_REVEAL) &&
      (gameState.phase === GamePhase.DAY_SPEAKING || gameState.phase === GamePhase.DAY_VOTE)
    );
  }

  execute(room: Room, gameState: GameState, player: Player): WolfSelfRevealResult {
    if (!this.canExecute(gameState, player)) {
      return { ok: false, error: GAME_ERROR_MESSAGES.selfRevealPhaseForbidden };
    }

    // 动作类只负责规则原子操作；广播、计时器和阶段推进由 GameManager 处理。
    const deadPlayer = this.engine.killPlayer(room, gameState, player.id, 'self_exposed');
    if (!deadPlayer) {
      return { ok: false, error: GAME_ERROR_MESSAGES.selfRevealFailed };
    }

    const winner = this.engine.checkWinner(room);
    return { ok: true, winner: winner ?? undefined };
  }
}
