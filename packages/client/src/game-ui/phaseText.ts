import { GamePhase } from '@werewolf/shared';

const PHASE_NAMES: Record<GamePhase, string> = {
  [GamePhase.WAITING]: '等待中',
  [GamePhase.ROLE_CONFIRM]: '确认身份',
  [GamePhase.NIGHT_WEREWOLF]: '月黑风高',
  [GamePhase.NIGHT_SEER]: '预言时刻',
  [GamePhase.NIGHT_WITCH]: '魔药抉择',
  [GamePhase.NIGHT_GUARD]: '暗中守护',
  [GamePhase.DAY_ANNOUNCE]: '天亮了',
  [GamePhase.DAY_RESOLVING]: '结算中',
  [GamePhase.DAY_SPEAKING]: '轮流发言',
  [GamePhase.DAY_VOTE]: '投票处决',
  [GamePhase.LAST_WORDS]: '遗言时间',
  [GamePhase.DAY_SELF_REVEAL]: '狼人自曝',
  [GamePhase.HUNTER_SHOOT]: '临终一击',
  [GamePhase.WOLF_KING_SHOOT]: '临终一击',
  [GamePhase.GAME_OVER]: '尘埃落定'
};

const PHASE_ICONS: Record<GamePhase, string> = {
  [GamePhase.WAITING]: '⏳',
  [GamePhase.ROLE_CONFIRM]: '🎭',
  [GamePhase.NIGHT_WEREWOLF]: '🌑',
  [GamePhase.NIGHT_SEER]: '🔮',
  [GamePhase.NIGHT_WITCH]: '🧪',
  [GamePhase.NIGHT_GUARD]: '🛡️',
  [GamePhase.DAY_ANNOUNCE]: '☀️',
  [GamePhase.DAY_RESOLVING]: '⌛',
  [GamePhase.DAY_SPEAKING]: '🎤',
  [GamePhase.DAY_VOTE]: '⚔️',
  [GamePhase.LAST_WORDS]: '🕯️',
  [GamePhase.DAY_SELF_REVEAL]: '💥',
  [GamePhase.HUNTER_SHOOT]: '🎯',
  [GamePhase.WOLF_KING_SHOOT]: '🎯',
  [GamePhase.GAME_OVER]: '🏆'
};

const PHASE_SUBTITLES: Record<GamePhase, string> = {
  [GamePhase.WAITING]: '等待玩家入座',
  [GamePhase.ROLE_CONFIRM]: '确认你的身份牌',
  [GamePhase.NIGHT_WEREWOLF]: '夜晚行动中',
  [GamePhase.NIGHT_SEER]: '夜晚行动中',
  [GamePhase.NIGHT_WITCH]: '夜晚行动中',
  [GamePhase.NIGHT_GUARD]: '夜晚行动中',
  [GamePhase.DAY_ANNOUNCE]: '公布昨夜结果',
  [GamePhase.DAY_RESOLVING]: '等待游戏结算',
  [GamePhase.DAY_SPEAKING]: '按顺序发言',
  [GamePhase.DAY_VOTE]: '所有存活玩家投票',
  [GamePhase.LAST_WORDS]: '放逐玩家发表遗言',
  [GamePhase.DAY_SELF_REVEAL]: '白天中断，即将入夜',
  [GamePhase.HUNTER_SHOOT]: '可选择是否发动技能',
  [GamePhase.WOLF_KING_SHOOT]: '可选择是否发动技能',
  [GamePhase.GAME_OVER]: '揭示所有身份'
};

export function getPhaseName(phase: GamePhase): string {
  return PHASE_NAMES[phase] ?? phase;
}

export function getPhaseIcon(phase: GamePhase): string {
  return PHASE_ICONS[phase] ?? '🌙';
}

export function getPhaseSubtitle(phase: GamePhase): string {
  return PHASE_SUBTITLES[phase] ?? '';
}
