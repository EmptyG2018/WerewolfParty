// 用例清单只负责描述“跑哪些测试”和“按什么顺序跑”。
// 具体测试函数由调用方注入，后续拆分 case 文件时不需要改主执行流程。
function buildRegressionCases(tests) {
  return [
    { group: 'engine', name: 'night resolution branches', run: () => tests.testNightResolutionBranches() },
    { group: 'engine', name: 'white wolf king rules', run: () => tests.testWhiteWolfKingRules() },
    { group: 'hidden', name: 'hunter hidden phase', run: (serverUrl) => tests.testHunterHiddenPhase(serverUrl) },
    { group: 'hidden', name: 'wolf king hidden phase', run: (serverUrl) => tests.testWolfKingHiddenPhase(serverUrl) },
    { group: 'death-skill', name: 'voted hunter last words then shoot', run: (serverUrl) => tests.testVotedHunterLastWordsThenShoot(serverUrl) },
    { group: 'death-skill', name: 'poisoned hunter cannot shoot', run: (serverUrl) => tests.testPoisonedHunterCannotShoot(serverUrl) },
    { group: 'death-skill', name: 'wolf king shot hunter cannot shoot', run: (serverUrl) => tests.testWolfKingShotHunterCannotShoot(serverUrl) },
    { group: 'reconnect', name: 'werewolf reconnect restores team state', run: (serverUrl) => tests.testWerewolfReconnectRestoresTeamState(serverUrl) },
    { group: 'reconnect', name: 'witch reconnect restores private info', run: (serverUrl) => tests.testWitchReconnectRestoresPrivateInfo(serverUrl) },
    { group: 'reconnect', name: 'vote reconnect only restores own vote', run: (serverUrl) => tests.testVoteReconnectOnlyRestoresOwnVote(serverUrl) },
    { group: 'reconnect', name: 'hidden hunter reconnect isolation', run: (serverUrl) => tests.testHiddenHunterReconnectIsolation(serverUrl) },
    { group: 'isolation', name: 'public state isolation', run: (serverUrl) => tests.testPublicStateIsolation(serverUrl) },
    { group: 'room', name: 'room ready gate', run: (serverUrl) => tests.testRoomReadyGate(serverUrl) },
    { group: 'vote', name: 'day vote early resolution', run: (serverUrl) => tests.testDayVoteEarlyResolution(serverUrl) },
    { group: 'werewolf', name: 'wolf friendly fire enabled', run: (serverUrl) => tests.testWolfFriendlyFireEnabled(serverUrl) },
    { group: 'werewolf', name: 'wolf friendly fire disabled', run: (serverUrl) => tests.testWolfFriendlyFireDisabled(serverUrl) },
    { group: 'witch', name: 'witch self save enabled', run: (serverUrl) => tests.testWitchSelfSaveEnabled(serverUrl) },
    { group: 'witch', name: 'witch self save disabled', run: (serverUrl) => tests.testWitchSelfSaveDisabled(serverUrl) },
    { group: 'werewolf', name: 'wolf timeout random kills non-wolf', run: (serverUrl) => tests.testWolfTimeoutRandomKillsNonWolf(serverUrl) },
    { group: 'night', name: 'same guard and save kills target', run: (serverUrl) => tests.testSameGuardAndSaveKillsTarget(serverUrl) }
  ];
}

module.exports = { buildRegressionCases };
