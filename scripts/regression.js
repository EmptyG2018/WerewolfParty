require('tsx/cjs');
const { testNightResolutionBranches, testWhiteWolfKingRules } = require('./regression/engineCases.js');
const { buildRegressionCases } = require('./regression/cases.js');
const {
  testHiddenHunterReconnectIsolation,
  testHunterHiddenPhase,
  testPoisonedHunterCannotShoot,
  testVotedHunterLastWordsThenShoot,
  testWolfKingHiddenPhase,
  testWolfKingShotHunterCannotShoot
} = require('./regression/hiddenDeathCases.js');
const {
  testPublicStateIsolation,
  testVoteReconnectOnlyRestoresOwnVote,
  testWerewolfReconnectRestoresTeamState,
  testWitchReconnectRestoresPrivateInfo
} = require('./regression/reconnectIsolationCases.js');
const {
  testSameGuardAndSaveKillsTarget,
  testWolfFriendlyFireDisabled,
  testWolfFriendlyFireEnabled,
  testWolfTimeoutRandomKillsNonWolf,
  testWitchSelfSaveDisabled,
  testWitchSelfSaveEnabled
} = require('./regression/nightRuleCases.js');
const {
  testDayVoteEarlyResolution,
  testRoomReadyGate
} = require('./regression/roomVoteCases.js');
const {
  startServer,
  waitForHealth
} = require('./regression/helpers.js');


const REGRESSION_CASES = buildRegressionCases({
  testNightResolutionBranches,
  testWhiteWolfKingRules,
  testHunterHiddenPhase,
  testWolfKingHiddenPhase,
  testVotedHunterLastWordsThenShoot,
  testPoisonedHunterCannotShoot,
  testWolfKingShotHunterCannotShoot,
  testWerewolfReconnectRestoresTeamState,
  testWitchReconnectRestoresPrivateInfo,
  testVoteReconnectOnlyRestoresOwnVote,
  testHiddenHunterReconnectIsolation,
  testPublicStateIsolation,
  testRoomReadyGate,
  testDayVoteEarlyResolution,
  testWolfFriendlyFireEnabled,
  testWolfFriendlyFireDisabled,
  testWitchSelfSaveEnabled,
  testWitchSelfSaveDisabled,
  testWolfTimeoutRandomKillsNonWolf,
  testSameGuardAndSaveKillsTarget
});

async function main() {
  const port = Number(process.env.REGRESSION_PORT ?? (3200 + Math.floor(Math.random() * 1000)));
  const serverUrl = `http://localhost:${port}`;
  const server = startServer(port);

  try {
    await waitForHealth(port);
    const results = [];
    for (const testCase of REGRESSION_CASES) {
      results.push([testCase, await testCase.run(serverUrl)]);
    }

    console.log('Regression checks passed:');
    for (const [testCase, result] of results) {
      console.log(`- [${testCase.group}] ${testCase.name}: ${JSON.stringify(result)}`);
    }
  } catch (error) {
    console.error('Regression checks failed.');
    console.error(error.stack || error.message);
    if (server.logs.length > 0) {
      console.error('Server logs:');
      console.error(server.logs.join(''));
    }
    process.exitCode = 1;
  } finally {
    await server.stop();
  }
}

main();
