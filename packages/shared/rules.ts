import type { DeathReason, PublicDeathReason } from './game';

export const ROOM_RULE_DEFAULTS = {
  maxPlayers: 9,
  wolfCount: 3,
  voteTime: 60,
  roleConfirmTime: 30,
  allowWitchSelfSave: true,
  allowWolfFriendlyFire: true
} as const;

export const PHASE_DURATION_SECONDS = {
  roleConfirm: 30,
  nightAction: 30,
  dayAnnounce: 5,
  daySpeaking: 60,
  lastWords: 30,
  deathSkill: 15,
  selfRevealTransition: 3,
  afterDeathTransition: 3
} as const;

export const PHASE_ADVANCE_DELAY_MS = 2000;

// 局中公开死亡原因必须脱敏，避免通过死亡来源反推出身份或夜晚行动。
export function toPublicDeathReason(reason: DeathReason): PublicDeathReason {
  if (reason === 'killed' || reason === 'poisoned') return 'night';
  if (reason === 'shot') return 'skill';
  return reason;
}

export function isNightDeathReason(reason: DeathReason): boolean {
  return reason === 'killed' || reason === 'poisoned';
}
