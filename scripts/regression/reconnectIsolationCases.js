// 重连和信息隔离回归，确保恢复状态只包含当前玩家有权看到的信息。
const { GamePhase, INTERNAL_GAME_KEYS, Role, assert } = require('./constants.js');
const { createStartedRoom, disconnectAll, reconnectClient, sleep, waitForPhase, waitForSkillState, waitForWitchInfo } = require('./helpers.js');
const { driveFirstNightToWitch, driveNightToWitchWithoutWitchAction, finishSpeakingPhase } = require('./phaseDrivers.js');

async function testWerewolfReconnectRestoresTeamState(serverUrl) {
  const { roomId, clients } = await createStartedRoom(serverUrl, 'wolf-reconnect-');

  try {
    const wolves = clients.filter(client =>
      client.role === Role.WEREWOLF ||
      client.role === Role.WOLF_KING ||
      client.role === Role.WHITE_WOLF_KING
    );
    const actor = wolves[0];
    const reconnectingWolf = wolves.find(client => client.playerId !== actor?.playerId);
    const target = clients.find(client => !wolves.some(wolf => wolf.playerId === client.playerId));
    const nonWolf = target;
    if (!actor || !reconnectingWolf || !target || !nonWolf) throw new Error('Missing wolf reconnect roles');

    clients.forEach(client => client.socket.emit('game:confirmRole'));
    await waitForPhase(clients, GamePhase.NIGHT_WEREWOLF);

    actor.socket.emit('game:werewolfKill', { targetId: target.playerId });
    await sleep(100);
    actor.socket.emit('game:wolfConfirmVote');
    await sleep(100);

    const oldSocketId = reconnectingWolf.socket.id;
    reconnectingWolf.socket.disconnect();
    await sleep(100);
    const reconnectedWolf = await reconnectClient(serverUrl, reconnectingWolf, 'wolf');
    const reconnectedNonWolf = await reconnectClient(serverUrl, nonWolf, 'nonwolf');

    const restoredSelection = reconnectedWolf.wolfSelections.some(selections => selections[actor.playerId] === target.playerId);
    const restoredVote = reconnectedWolf.wolfVotes.some(votes => votes[actor.playerId] === target.playerId);
    const restoredWolfTeam = reconnectedWolf.wolfTeam.length === wolves.length &&
      wolves.every(wolf => reconnectedWolf.wolfTeam.includes(wolf.playerId));
    const nonWolfGotWolfTeam = reconnectedNonWolf.wolfTeam.length > 0;
    const nonWolfSelectionLeak = reconnectedNonWolf.wolfSelections.length > 0;
    const nonWolfVoteLeak = reconnectedNonWolf.wolfVotes.length > 0;

    assert(reconnectedWolf.playerId === reconnectingWolf.playerId, 'reconnected wolf did not keep stable player id');
    assert(reconnectedWolf.socket.id !== oldSocketId, 'reconnected wolf should use a new socket id');
    assert(restoredWolfTeam, 'reconnected wolf did not restore wolf team');
    assert(restoredSelection, 'reconnected wolf did not restore wolf selection state');
    assert(restoredVote, 'reconnected wolf did not restore wolf confirmed vote state');
    assert(!nonWolfGotWolfTeam, 'non-wolf reconnect received wolf team');
    assert(!nonWolfSelectionLeak, 'wolf selection leaked to non-wolf reconnect');
    assert(!nonWolfVoteLeak, 'wolf vote leaked to non-wolf reconnect');

    return {
      roomId,
      wolf: reconnectedWolf.name,
      restoredWolfTeam: reconnectedWolf.wolfTeam.length,
      restoredSelection,
      restoredVote
    };
  } finally {
    disconnectAll(clients);
  }
}

async function testWitchReconnectRestoresPrivateInfo(serverUrl) {
  const { roomId, clients } = await createStartedRoom(serverUrl, 'witch-reconnect-');

  try {
    const witch = clients.find(client => client.role === Role.WITCH);
    const target = clients.find(client =>
      client.playerId !== witch?.playerId &&
      client.role !== Role.WEREWOLF &&
      client.role !== Role.WOLF_KING &&
      client.role !== Role.WHITE_WOLF_KING
    );
    const nonWitch = clients.find(client => client.playerId !== witch?.playerId);
    if (!witch || !target || !nonWitch) throw new Error('Missing witch reconnect roles');

    await driveNightToWitchWithoutWitchAction(clients, target.playerId);

    witch.socket.disconnect();
    nonWitch.socket.disconnect();
    await sleep(100);

    const reconnectedWitch = await reconnectClient(serverUrl, witch, 'witch');
    const reconnectedNonWitch = await reconnectClient(serverUrl, nonWitch, 'nonwitch');
    const witchInfo = await waitForWitchInfo(reconnectedWitch, data => data.killedPlayerId === target.playerId);
    const witchState = await waitForSkillState(reconnectedWitch, data =>
      data.witch?.saveAvailable === true && data.witch?.poisonAvailable === true
    );

    const nonWitchInfoLeak = reconnectedNonWitch.witchInfo.length > 0;
    const nonWitchSkillLeak = reconnectedNonWitch.skillStates.some(data => data.witch);

    assert(reconnectedWitch.role === Role.WITCH, 'reconnected witch did not restore role');
    assert(witchInfo.killedPlayerId === target.playerId, 'reconnected witch did not restore private killed target');
    assert(witchState.witch.saveAvailable && witchState.witch.poisonAvailable, 'reconnected witch did not restore private medicine state');
    assert(!nonWitchInfoLeak, 'witch killed target leaked to non-witch reconnect');
    assert(!nonWitchSkillLeak, 'witch skill state leaked to non-witch reconnect');

    return {
      roomId,
      witch: reconnectedWitch.name,
      killedPlayerId: witchInfo.killedPlayerId,
      saveAvailable: witchState.witch.saveAvailable
    };
  } finally {
    disconnectAll(clients);
  }
}

async function testVoteReconnectOnlyRestoresOwnVote(serverUrl) {
  const { roomId, clients } = await createStartedRoom(serverUrl, 'vote-reconnect-', { voteTime: 10 });

  try {
    const nightTarget = clients.find(client =>
      client.role !== Role.WEREWOLF &&
      client.role !== Role.WOLF_KING &&
      client.role !== Role.WHITE_WOLF_KING &&
      client.role !== Role.HUNTER
    );
    if (!nightTarget) throw new Error('Missing night target for vote reconnect');

    await driveFirstNightToWitch(clients, nightTarget.playerId);
    await waitForPhase(clients, GamePhase.DAY_ANNOUNCE);
    await finishSpeakingPhase(clients);

    const deadPlayerIds = new Set([
      ...(clients[0].gameState?.deadPlayers ?? []).map(dead => dead.playerId),
      ...clients[0].deaths.map(death => death.playerId)
    ]);
    const aliveClients = clients.filter(client => client.playerId && !deadPlayerIds.has(client.playerId));
    const voterA = aliveClients[0];
    const voterB = aliveClients[1];
    const observer = aliveClients[2];
    const targetA = aliveClients.find(client => client.playerId !== voterA.playerId);
    const targetB = aliveClients.find(client => client.playerId !== voterB.playerId && client.playerId !== targetA?.playerId) ?? targetA;
    if (!voterA || !voterB || !observer || !targetA || !targetB) throw new Error('Missing vote reconnect players');

    voterA.socket.emit('game:vote', { targetId: targetA.playerId });
    voterB.socket.emit('game:vote', { targetId: targetB.playerId });
    await sleep(200);

    voterA.socket.disconnect();
    observer.socket.disconnect();
    await sleep(100);

    const reconnectedVoter = await reconnectClient(serverUrl, voterA, 'voter');
    const reconnectedObserver = await reconnectClient(serverUrl, observer, 'observer');
    const voterVoteKeys = Object.keys(reconnectedVoter.gameState?.votes ?? {});
    const observerVoteKeys = Object.keys(reconnectedObserver.gameState?.votes ?? {});

    assert(voterVoteKeys.length === 1 && voterVoteKeys[0] === voterA.playerId, 'reconnected voter should only restore own current vote');
    assert(reconnectedVoter.gameState.votes[voterA.playerId] === targetA.playerId, 'reconnected voter restored wrong vote target');
    assert(observerVoteKeys.length === 0, 'reconnected observer should not see other players realtime votes');

    return {
      roomId,
      voter: reconnectedVoter.name,
      restoredVoteKeys: voterVoteKeys.length,
      observerVoteKeys: observerVoteKeys.length
    };
  } finally {
    disconnectAll(clients);
  }
}

async function testPublicStateIsolation(serverUrl) {
  const { roomId, clients } = await createStartedRoom(serverUrl, 'public-');
  try {
    await sleep(200);

    const publicRoleLeakBeforeStart = clients
      .flatMap(client => [...client.joinedRooms, ...client.updatedRooms])
      .some(room => room.players.some(player => player.role !== null));

    const internalKeyLeaks = clients.flatMap(client => {
      return INTERNAL_GAME_KEYS.filter(key => Object.prototype.hasOwnProperty.call(client.gameState, key));
    });
    const deadReasonLeaks = clients
      .flatMap(client => client.gameState.deadPlayers ?? [])
      .filter(dead => dead.reason === 'killed' || dead.reason === 'poisoned');
    const reviewDeathReasonLeaks = clients
      .flatMap(client => client.gameState.reviewEvents ?? [])
      .flatMap(event => event.deaths ?? [])
      .filter(dead => dead.reason === 'killed' || dead.reason === 'poisoned' || dead.reason === 'shot');
    const votesScopedToViewer = clients.every(client => {
      const voteKeys = Object.keys(client.gameState.votes ?? {});
      return voteKeys.length === 0 || voteKeys.every(key => key === client.playerId);
    });

    const seer = clients.find(client => client.role === Role.SEER);
    const target = clients.find(client => client.playerId !== seer?.playerId);
    if (!seer || !target) throw new Error('Missing seer or target');

    await driveFirstNightToWitch(clients, target.playerId);
    await sleep(300);

    const nonSeerResultReceivers = clients.filter(client => client.playerId !== seer.playerId && client.seerResults.length > 0);
    const seerResult = seer.seerResults[0];

    assert(!publicRoleLeakBeforeStart, 'public room leaked roles');
    assert(internalKeyLeaks.length === 0, `public gameState leaked internal keys: ${internalKeyLeaks.join(', ')}`);
    assert(deadReasonLeaks.length === 0, 'public gameState leaked internal death reasons');
    assert(reviewDeathReasonLeaks.length === 0, 'public review events leaked internal death reasons');
    assert(votesScopedToViewer, 'public gameState leaked realtime votes');
    assert(seerResult && typeof seerResult.day === 'number', 'seer result did not include day');
    assert(nonSeerResultReceivers.length === 0, `seer result leaked to ${nonSeerResultReceivers.map(client => client.name).join(', ')}`);

    return {
      roomId,
      seer: seer.name,
      seerResultDay: seerResult.day,
      publicRoleLeakBeforeStart,
      internalKeyLeaks: internalKeyLeaks.length,
      nonSeerResultReceivers: nonSeerResultReceivers.length
    };
  } finally {
    disconnectAll(clients);
  }
}
module.exports = {
  testWerewolfReconnectRestoresTeamState,
  testWitchReconnectRestoresPrivateInfo,
  testVoteReconnectOnlyRestoresOwnVote,
  testPublicStateIsolation
};
