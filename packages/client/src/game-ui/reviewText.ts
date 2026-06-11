import { PublicDeathReason, ReviewEvent, Role, ROLES } from '@werewolf/shared';
import type { ReviewFilter } from '../components/game/ReviewDrawer';

export const REVIEW_FILTER_OPTIONS: Array<{ value: ReviewFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'night', label: '夜晚' },
  { value: 'vote', label: '投票' },
  { value: 'skill', label: '技能' }
];

const DEATH_REASON_NAMES: Record<PublicDeathReason, string> = {
  night: '夜间死亡',
  voted: '投票放逐',
  skill: '技能带走',
  self_exposed: '自曝出局',
  exploded: '自曝带走'
};

const DEATH_REASON_CLASSES: Record<PublicDeathReason, string> = {
  night: 'bg-blood/15 text-blood-400 border-blood/20',
  voted: 'bg-gold/15 text-gold border-gold/20',
  skill: 'bg-amber-500/15 text-amber-300 border-amber-500/20',
  self_exposed: 'bg-blood/20 text-blood-300 border-blood/30',
  exploded: 'bg-purple-500/15 text-purple-300 border-purple-500/20'
};

export function getDeathReasonName(reason: PublicDeathReason): string {
  return DEATH_REASON_NAMES[reason];
}

export function getDeathReasonClass(reason: PublicDeathReason): string {
  return DEATH_REASON_CLASSES[reason];
}

interface ReviewTextContext {
  getPlayerName: (playerId: string | null) => string;
  getRevealedRoleName: (playerId?: string | null) => string | null;
}

function formatPlayerWithRole(playerId: string | null | undefined, context: ReviewTextContext): string {
  const playerName = context.getPlayerName(playerId ?? null);
  const roleName = context.getRevealedRoleName(playerId);
  return roleName ? `${roleName} ${playerName}` : playerName;
}

export function getReviewPlayerName(playerId: string | null, context: ReviewTextContext): string {
  if (playerId === null) return '弃票';
  return formatPlayerWithRole(playerId, context);
}

export function getReviewSummary(event: ReviewEvent, context: ReviewTextContext): string {
  switch (event.type) {
    case 'night_result': {
      const deaths = event.deaths ?? [];
      if (deaths.length === 0) return '平安夜';
      return `${deaths.map(death => getReviewPlayerName(death.playerId, context)).join('、')} 夜间死亡`;
    }
    case 'vote_result':
      if (event.eliminated) return `${getReviewPlayerName(event.eliminated, context)} 被投票放逐`;
      return event.isTie ? '平票，无人出局' : '无人出局';
    case 'self_reveal':
      return `${formatPlayerWithRole(event.actorId, context)} 自曝出局，白天流程中断`;
    case 'self_reveal_take':
      return `${formatPlayerWithRole(event.actorId, context)} 自曝带走 ${getReviewPlayerName(event.targetId ?? null, context)}，白天流程中断`;
    case 'skill_take': {
      const actorRole = context.getRevealedRoleName(event.actorId);
      const actor = formatPlayerWithRole(event.actorId, context);
      const target = getReviewPlayerName(event.targetId ?? null, context);
      // 只有终局复盘拿到真实身份后，才展示“开枪”等更具体动作；局中保持技能来源脱敏。
      if (actorRole === ROLES[Role.HUNTER].name || actorRole === ROLES[Role.WOLF_KING].name) {
        return `${actor} 开枪带走 ${target}`;
      }
      return `${actor} 发动技能带走 ${target}`;
    }
    case 'skill_pass':
      return `${formatPlayerWithRole(event.actorId, context)} 选择不发动技能`;
  }
}

export function getReviewFilter(event: ReviewEvent): ReviewFilter {
  if (event.type === 'night_result') return 'night';
  if (event.type === 'vote_result') return 'vote';
  return 'skill';
}

export function getReviewTagName(event: ReviewEvent): string {
  if (event.type === 'night_result') return '夜晚';
  if (event.type === 'vote_result') return '投票';
  if (event.type === 'self_reveal' || event.type === 'self_reveal_take') return '自曝';
  return '技能';
}

export function getReviewTagClass(event: ReviewEvent): string {
  if (event.type === 'night_result') return 'bg-blood/15 text-blood-400 border-blood/20';
  if (event.eliminated) return 'bg-blood/15 text-blood-400 border-blood/20';
  if (event.isTie) return 'bg-gold/10 text-gold border-gold/20';
  if (event.interrupted) return 'bg-purple-500/15 text-purple-300 border-purple-500/20';
  return 'bg-white/[0.04] text-moon-mist border-white/[0.04]';
}
