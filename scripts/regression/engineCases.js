const { GameEngine } = require('../../packages/server/src/game/GameEngine.ts');
const { WhiteWolfKingExplodeAction } = require('../../packages/server/src/game/actions/WhiteWolfKingExplodeAction.ts');
const { WolfSelfRevealAction } = require('../../packages/server/src/game/actions/WolfSelfRevealAction.ts');
const { ROLE_PRESETS, RoleAbility, roleHasAbility } = require('../../packages/shared/roles.ts');
const { ROOM_RULE_DEFAULTS } = require('../../packages/shared/rules.ts');
const { GamePhase, Role, assert } = require('./constants.js');

// 纯逻辑玩家模型，只满足 GameEngine/action 单元级规则判断需要。
function makeEnginePlayer(id, role, status = 'alive') {
  return {
    id,
    sessionId: id,
    name: id,
    roomId: 'engine-room',
    playerNumber: 1,
    seatIndex: 0,
    role,
    status,
    online: true,
    isHost: false,
    isReady: true,
    voteTarget: null,
    skillUsed: { witchSave: false, witchPoison: false, lastGuardTarget: null }
  };
}

function makeEngineRoom(players) {
  return {
    id: 'engine-room',
    hostId: players[0].id,
    players,
    config: {
      maxPlayers: players.length,
      roles: [Role.WEREWOLF, Role.SEER, Role.WITCH, Role.HUNTER, Role.GUARD],
      wolfCount: 1,
      voteTime: ROOM_RULE_DEFAULTS.voteTime,
      roleConfirmTime: ROOM_RULE_DEFAULTS.roleConfirmTime,
      allowWitchSelfSave: false,
      allowWolfFriendlyFire: ROOM_RULE_DEFAULTS.allowWolfFriendlyFire,
      hybridRoles: []
    },
    status: 'playing',
    createdAt: Date.now()
  };
}

// 锁定夜晚结算的核心分支：守护、解药、同守同救、毒药合并。
function testNightResolutionBranches() {
  const engine = new GameEngine();
  const players = [
    makeEnginePlayer('wolf', Role.WEREWOLF),
    makeEnginePlayer('target', Role.SEER),
    makeEnginePlayer('poisoned', Role.HUNTER),
    makeEnginePlayer('guard', Role.GUARD),
    makeEnginePlayer('witch', Role.WITCH)
  ];
  const room = makeEngineRoom(players);
  const gameState = engine.createInitialGameState();

  const guardOnly = engine.resolveNight(
    room,
    gameState,
    new Map([
      ['wolfKill', { targetId: 'target' }],
      ['guardProtect', { targetId: 'target' }]
    ]),
    false
  );
  assert(guardOnly.killedPlayerId === null, 'guard-only protection should cancel wolf kill');
  assert(guardOnly.deadPlayerIds.length === 0, 'guard-only protection should produce no death');

  const saveOnly = engine.resolveNight(
    room,
    gameState,
    new Map([
      ['wolfKill', { targetId: 'target' }]
    ]),
    true
  );
  assert(saveOnly.killedPlayerId === null, 'witch save-only should cancel wolf kill');
  assert(saveOnly.deadPlayerIds.length === 0, 'witch save-only should produce no death');

  const sameGuardSaveWithPoison = engine.resolveNight(
    room,
    gameState,
    new Map([
      ['wolfKill', { targetId: 'target' }],
      ['guardProtect', { targetId: 'target' }],
      ['witchPoison', { targetId: 'poisoned' }]
    ]),
    true
  );
  assert(sameGuardSaveWithPoison.killedPlayerId === 'target', 'same guard/save should keep wolf kill');
  assert(sameGuardSaveWithPoison.poisonedPlayerId === 'poisoned', 'witch poison should still resolve with same guard/save');
  assert(
    sameGuardSaveWithPoison.deadPlayerIds.includes('target') &&
      sameGuardSaveWithPoison.deadPlayerIds.includes('poisoned') &&
      sameGuardSaveWithPoison.deadPlayerIds.length === 2,
    `same guard/save with poison should produce exactly two deaths, got ${sameGuardSaveWithPoison.deadPlayerIds.join(',')}`
  );

  return {
    guardOnlyDeaths: guardOnly.deadPlayerIds.length,
    saveOnlyDeaths: saveOnly.deadPlayerIds.length,
    sameGuardSaveDeaths: sameGuardSaveWithPoison.deadPlayerIds.length
  };
}

// 锁定 12 人进阶板子和白狼王自曝边界，避免后续身份调整误回退成狼王。
function testWhiteWolfKingRules() {
  const preset12 = ROLE_PRESETS.find(preset => preset.id === 'preset-12');
  assert(preset12, 'missing 12-player preset');
  assert(preset12.roles.includes(Role.WHITE_WOLF_KING), '12-player preset should include white wolf king');
  assert(!preset12.roles.includes(Role.WOLF_KING), '12-player preset should not include wolf king');
  assert(
    roleHasAbility(Role.WHITE_WOLF_KING, RoleAbility.WOLF_SELF_REVEAL),
    'white wolf king should be allowed to self reveal without taking a target'
  );

  const makeWhiteRoom = () => makeEngineRoom([
    makeEnginePlayer('white', Role.WHITE_WOLF_KING),
    makeEnginePlayer('target', Role.SEER),
    makeEnginePlayer('villager', Role.VILLAGER)
  ]);

  const speakingExplodeRoom = makeWhiteRoom();
  const speakingExplodeState = new GameEngine().createInitialGameState();
  speakingExplodeState.phase = GamePhase.DAY_SPEAKING;
  const speakingExplode = new WhiteWolfKingExplodeAction(new GameEngine()).execute(
    speakingExplodeRoom,
    speakingExplodeState,
    speakingExplodeRoom.players[0],
    speakingExplodeRoom.players[1].id
  );

  const selfRevealRoom = makeWhiteRoom();
  const selfRevealState = new GameEngine().createInitialGameState();
  selfRevealState.phase = GamePhase.DAY_SPEAKING;
  const selfReveal = new WolfSelfRevealAction(new GameEngine()).execute(
    selfRevealRoom,
    selfRevealState,
    selfRevealRoom.players[0]
  );

  const voteExplodeRoom = makeWhiteRoom();
  const voteExplodeState = new GameEngine().createInitialGameState();
  voteExplodeState.phase = GamePhase.DAY_VOTE;
  const voteExplode = new WhiteWolfKingExplodeAction(new GameEngine()).execute(
    voteExplodeRoom,
    voteExplodeState,
    voteExplodeRoom.players[0],
    voteExplodeRoom.players[1].id
  );

  assert(!speakingExplode.ok, 'white wolf king should not take a target during speaking phase');
  assert(selfReveal.ok, 'white wolf king should self reveal without taking a target during speaking phase');
  assert(selfRevealRoom.players[0].status === 'dead', 'white wolf king self reveal should kill self');
  assert(selfRevealRoom.players[1].status === 'alive', 'white wolf king self reveal should not kill target');
  assert(selfRevealState.deadPlayers.length === 1 && selfRevealState.deadPlayers[0].reason === 'self_exposed', 'white wolf king self reveal should only record self_exposed');
  assert(voteExplode.ok, 'white wolf king should take a target during vote phase');
  assert(voteExplodeRoom.players[0].status === 'dead', 'white wolf king explode should kill self');
  assert(voteExplodeRoom.players[1].status === 'dead', 'white wolf king explode should kill target');
  assert(
    voteExplodeState.deadPlayers.some(dead => dead.playerId === 'white' && dead.reason === 'self_exposed') &&
      voteExplodeState.deadPlayers.some(dead => dead.playerId === 'target' && dead.reason === 'exploded'),
    'white wolf king vote explode should record self_exposed and exploded deaths'
  );

  return {
    presetUsesWhiteWolfKing: true,
    speakingExplodeAllowed: speakingExplode.ok,
    selfRevealDeaths: selfRevealState.deadPlayers.length,
    voteExplodeDeaths: voteExplodeState.deadPlayers.length
  };
}

module.exports = {
  testNightResolutionBranches,
  testWhiteWolfKingRules
};
