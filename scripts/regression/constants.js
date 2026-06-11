// 回归脚本共享常量。集中放在这里，避免每个拆分后的用例文件重复定义。
const Role = {
  VILLAGER: 'villager',
  WEREWOLF: 'werewolf',
  WOLF_KING: 'wolf_king',
  WHITE_WOLF_KING: 'white_wolf_king',
  SEER: 'seer',
  WITCH: 'witch',
  HUNTER: 'hunter',
  GUARD: 'guard'
};

const GamePhase = {
  NIGHT_WEREWOLF: 'night_werewolf',
  NIGHT_SEER: 'night_seer',
  NIGHT_GUARD: 'night_guard',
  NIGHT_WITCH: 'night_witch',
  DAY_ANNOUNCE: 'day_announce',
  DAY_RESOLVING: 'day_resolving',
  DAY_SPEAKING: 'day_speaking',
  DAY_VOTE: 'day_vote',
  LAST_WORDS: 'last_words',
  HUNTER_SHOOT: 'hunter_shoot',
  WOLF_KING_SHOOT: 'wolf_king_shoot'
};

const INTERNAL_GAME_KEYS = [
  'nightActions',
  'seerCheckResult',
  'witchSaveUsed',
  'witchPoisonUsed',
  'skillState',
  'lastKilledPlayer',
  'lastGuardTarget',
  'wolfKingCanShoot',
  'wolfVotes'
];

// 轻量断言工具：不引入测试框架，失败时直接抛出可读错误。
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

module.exports = {
  GamePhase,
  INTERNAL_GAME_KEYS,
  Role,
  assert
};
