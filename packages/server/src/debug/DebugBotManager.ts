import {
  GamePhase,
  Player,
  Role,
  RoleAbility,
  isWolfRole,
  roleHasAbility
} from '@werewolf/shared';
import { RoomManager } from '../rooms/RoomManager';
import { GameManager } from '../game/GameManager';

const DEBUG_PLAYER_PREFIX = 'debug_';

export interface DebugPerspective {
  playerId: string;
  name: string;
  seatIndex: number;
  playerNumber?: number;
  role: Role | null;
  isHost: boolean;
}

export class DebugBotManager {
  constructor(
    private readonly roomManager: RoomManager,
    private readonly gameManager: GameManager
  ) {}

  fillRoom(roomId: string): { added: number; total: number } {
    const room = this.roomManager.getRoom(roomId);
    if (!room || room.status !== 'waiting') return { added: 0, total: 0 };

    const missing = room.config.maxPlayers - room.players.length;
    const created = this.roomManager.addDebugPlayers(roomId, missing);
    return { added: created.length, total: room.players.length };
  }

  runCurrentPhase(roomId: string): { acted: number; phase: GamePhase | null } {
    const room = this.roomManager.getRoom(roomId);
    const gameState = this.gameManager.getGameState(roomId);
    if (!room || !gameState || gameState.paused) return { acted: 0, phase: gameState?.phase ?? null };

    const bots = room.players.filter(player => this.isDebugPlayer(player));
    let acted = 0;

    switch (gameState.phase) {
      case GamePhase.ROLE_CONFIRM:
        bots.forEach(bot => {
          if (this.gameManager.confirmRoleByPlayer(roomId, bot.id)) acted++;
        });
        break;
      case GamePhase.NIGHT_WEREWOLF:
        bots
          .filter(bot => bot.status === 'alive' && bot.role && roleHasAbility(bot.role, RoleAbility.WEREWOLF_KILL))
          .forEach(bot => {
            const target = this.pickWolfTarget(room.players, bot, room.config.hybridRoles);
            if (!target) return;
            const selected = this.gameManager.werewolfKillByPlayer(roomId, bot.id, target.id);
            const confirmed = selected && this.gameManager.wolfConfirmVoteByPlayer(roomId, bot.id);
            if (confirmed) acted++;
          });
        break;
      case GamePhase.NIGHT_SEER:
        acted += this.runSingleRoleAction(roomId, bots, RoleAbility.SEER_CHECK, bot => {
          const target = this.pickAliveOther(room.players, bot);
          return target ? this.gameManager.seerCheckByPlayer(roomId, bot.id, target.id) : false;
        });
        break;
      case GamePhase.NIGHT_GUARD:
        acted += this.runSingleRoleAction(roomId, bots, RoleAbility.GUARD_PROTECT, bot => {
          const target = this.pickAliveOther(room.players, bot) ?? bot;
          return this.gameManager.guardProtectByPlayer(roomId, bot.id, target.id);
        });
        break;
      case GamePhase.NIGHT_WITCH:
        acted += this.runSingleRoleAction(roomId, bots, RoleAbility.WITCH_POISON, bot => {
          return this.gameManager.witchPassByPlayer(roomId, bot.id);
        });
        acted += this.runSingleRoleAction(roomId, bots, RoleAbility.WITCH_SAVE, bot => {
          return this.gameManager.witchPassByPlayer(roomId, bot.id);
        });
        break;
      case GamePhase.DAY_SPEAKING:
      case GamePhase.LAST_WORDS: {
        let currentSpeakerId = gameState.speaking?.order[gameState.speaking.currentIndex];
        let currentBot = bots.find(bot => bot.id === currentSpeakerId);
        while (currentBot && this.gameManager.speakingDoneByPlayer(roomId, currentBot.id)) {
          acted++;
          currentSpeakerId = gameState.speaking?.order[gameState.speaking.currentIndex];
          currentBot = bots.find(bot => bot.id === currentSpeakerId);
        }
        break;
      }
      case GamePhase.DAY_VOTE:
        bots
          .filter(bot => bot.status === 'alive')
          .forEach(bot => {
            const target = this.pickAliveOther(room.players, bot);
            if (target && this.gameManager.voteByPlayer(roomId, bot.id, target.id)) acted++;
          });
        break;
      case GamePhase.HUNTER_SHOOT:
        acted += this.runSingleRoleAction(roomId, bots, RoleAbility.HUNTER_SHOOT, bot => {
          const target = this.pickAliveOther(room.players, bot);
          return target
            ? this.gameManager.hunterShootByPlayer(roomId, bot.id, target.id)
            : this.gameManager.hunterPassByPlayer(roomId, bot.id);
        }, false);
        break;
      case GamePhase.WOLF_KING_SHOOT:
        acted += this.runSingleRoleAction(roomId, bots, RoleAbility.WOLF_KING_SHOOT, bot => {
          const target = this.pickAliveOther(room.players, bot);
          return target ? this.gameManager.wolfKingShootByPlayer(roomId, bot.id, target.id) : false;
        }, false);
        break;
    }

    return { acted, phase: gameState.phase };
  }

  getPerspectives(roomId: string): { players: DebugPerspective[]; wolfTeam: string[] } {
    const room = this.roomManager.getRoom(roomId);
    if (!room) return { players: [], wolfTeam: [] };

    const wolfTeam = room.players
      .filter(player => player.role !== null && isWolfRole(player.role, room.config.hybridRoles))
      .map(player => player.id);

    return {
      players: room.players
        .slice()
        .sort((a, b) => a.seatIndex - b.seatIndex)
        .map(player => ({
          playerId: player.id,
          name: player.name,
          seatIndex: player.seatIndex,
          playerNumber: player.playerNumber,
          role: player.role,
          isHost: player.isHost
        })),
      wolfTeam
    };
  }

  private isDebugPlayer(player: Player): boolean {
    return player.sessionId.startsWith(DEBUG_PLAYER_PREFIX);
  }

  private runSingleRoleAction(
    roomId: string,
    bots: Player[],
    ability: RoleAbility,
    action: (bot: Player) => boolean,
    requireAlive = true
  ): number {
    const bot = bots.find(candidate => {
      if (requireAlive && candidate.status !== 'alive') return false;
      return candidate.role !== null && roleHasAbility(candidate.role, ability);
    });
    return bot && action(bot) ? 1 : 0;
  }

  private pickAliveOther(players: Player[], actor: Player): Player | null {
    return players.find(player => player.status === 'alive' && player.id !== actor.id) ?? null;
  }

  private pickWolfTarget(players: Player[], actor: Player, hybridRoles: Role[]): Player | null {
    const nonWolfTarget = players.find(player => {
      return player.status === 'alive' && player.id !== actor.id && !(player.role && isWolfRole(player.role, hybridRoles));
    });
    return nonWolfTarget ?? this.pickAliveOther(players, actor);
  }
}
