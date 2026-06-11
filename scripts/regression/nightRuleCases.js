// 夜晚规则回归，覆盖狼队目标限制、女巫自救、随机刀和同守同救。
const { GAME_ERROR_MESSAGES } = require('../../packages/shared/messages.ts');
const { GamePhase, Role, assert } = require('./constants.js');
const { createStartedRoom, disconnectAll, sleep, waitForPhase, waitForSkillState, waitForWitchInfo } = require('./helpers.js');
const { driveNightToWitchWithoutWitchAction } = require('./phaseDrivers.js');

async function testWolfFriendlyFireEnabled(serverUrl) {
  const { roomId, clients } = await createStartedRoom(serverUrl, 'wolf-friendly-', {
    allowWolfFriendlyFire: true
  });

  try {
    const wolves = clients.filter(client =>
      client.role === Role.WEREWOLF ||
      client.role === Role.WOLF_KING ||
      client.role === Role.WHITE_WOLF_KING
    );
    const wolf = wolves[0];
    const wolfTeammate = wolves.find(client => client.playerId !== wolf?.playerId);
    const nonWolf = clients.find(client => !wolves.some(wolfClient => wolfClient.playerId === client.playerId));
    if (!wolf || !wolfTeammate || !nonWolf) throw new Error('Missing wolf friendly-fire enabled roles');

    clients.forEach(client => client.socket.emit('game:confirmRole'));
    await waitForPhase(clients, GamePhase.NIGHT_WEREWOLF);

    wolf.socket.emit('game:werewolfKill', { targetId: wolfTeammate.playerId });
    await sleep(200);
    wolf.socket.emit('game:wolfConfirmVote');
    await sleep(200);

    const friendlySelectionRecorded = wolf.wolfSelections.some(selections => selections[wolf.playerId] === wolfTeammate.playerId);
    const friendlyVoteRecorded = wolf.wolfVotes.some(votes => votes[wolf.playerId] === wolfTeammate.playerId);
    const selectionSyncedToWolfTeam = wolfTeammate.wolfSelections.some(selections => selections[wolf.playerId] === wolfTeammate.playerId);
    const voteSyncedToWolfTeam = wolfTeammate.wolfVotes.some(votes => votes[wolf.playerId] === wolfTeammate.playerId);
    const selectionLeakedToNonWolf = nonWolf.wolfSelections.some(selections => selections[wolf.playerId] === wolfTeammate.playerId);
    const voteLeakedToNonWolf = nonWolf.wolfVotes.some(votes => votes[wolf.playerId] === wolfTeammate.playerId);

    assert(!wolf.errors.includes(GAME_ERROR_MESSAGES.wolfFriendlyFireForbidden), 'wolf teammate target was rejected when friendly fire enabled');
    assert(friendlySelectionRecorded, 'wolf teammate target was not recorded as selection when friendly fire enabled');
    assert(friendlyVoteRecorded, 'wolf teammate target was not confirmed as vote when friendly fire enabled');
    assert(selectionSyncedToWolfTeam, 'wolf teammate selection was not synced to wolf team');
    assert(voteSyncedToWolfTeam, 'wolf teammate vote was not synced to wolf team');
    assert(!selectionLeakedToNonWolf, 'wolf teammate selection leaked to non-wolf player');
    assert(!voteLeakedToNonWolf, 'wolf teammate vote leaked to non-wolf player');

    return {
      roomId,
      wolf: wolf.name,
      target: wolfTeammate.name,
      selectionSyncedToWolfTeam,
      voteSyncedToWolfTeam
    };
  } finally {
    disconnectAll(clients);
  }
}

async function testWolfFriendlyFireDisabled(serverUrl) {
  const { roomId, clients } = await createStartedRoom(serverUrl, 'wolf-target-', {
    allowWolfFriendlyFire: false
  });

  try {
    const wolves = clients.filter(client => client.role === Role.WEREWOLF || client.role === Role.WOLF_KING);
    const wolf = wolves[0];
    const wolfTeammate = wolves.find(client => client.playerId !== wolf?.playerId);
    const nonWolf = clients.find(client => client.playerId !== wolf?.playerId && client.role !== Role.WEREWOLF && client.role !== Role.WOLF_KING);
    if (!wolf || !wolfTeammate || !nonWolf) throw new Error('Missing wolf targeting regression roles');

    clients.forEach(client => client.socket.emit('game:confirmRole'));
    await waitForPhase(clients, GamePhase.NIGHT_WEREWOLF);

    wolf.socket.emit('game:werewolfKill', { targetId: wolfTeammate.playerId });
    await sleep(200);

    const rejectedFriendlyTarget = wolf.errors.includes(GAME_ERROR_MESSAGES.wolfFriendlyFireForbidden);
    const friendlySelectionRecorded = wolf.wolfSelections.some(selections => selections[wolf.playerId] === wolfTeammate.playerId);

    wolf.socket.emit('game:werewolfKill', { targetId: nonWolf.playerId });
    await sleep(200);
    wolf.socket.emit('game:wolfConfirmVote');
    await sleep(200);

    const nonWolfSelectionRecorded = wolf.wolfSelections.some(selections => selections[wolf.playerId] === nonWolf.playerId);
    const nonWolfVoteRecorded = wolf.wolfVotes.some(votes => votes[wolf.playerId] === nonWolf.playerId);
    const selectionSyncedToWolfTeam = wolfTeammate.wolfSelections.some(selections => selections[wolf.playerId] === nonWolf.playerId);
    const voteSyncedToWolfTeam = wolfTeammate.wolfVotes.some(votes => votes[wolf.playerId] === nonWolf.playerId);
    const selectionLeakedToNonWolf = nonWolf.wolfSelections.some(selections => selections[wolf.playerId] === nonWolf.playerId);
    const voteLeakedToNonWolf = nonWolf.wolfVotes.some(votes => votes[wolf.playerId] === nonWolf.playerId);

    assert(rejectedFriendlyTarget, 'wolf friendly target was not rejected when friendly fire disabled');
    assert(!friendlySelectionRecorded, 'rejected wolf friendly target was recorded as selection');
    assert(nonWolfSelectionRecorded, 'valid non-wolf target was not recorded as selection');
    assert(nonWolfVoteRecorded, 'valid non-wolf target was not confirmed as vote');
    assert(selectionSyncedToWolfTeam, 'wolf selection was not synced to wolf teammate');
    assert(voteSyncedToWolfTeam, 'wolf confirmed vote was not synced to wolf teammate');
    assert(!selectionLeakedToNonWolf, 'wolf selection leaked to non-wolf player');
    assert(!voteLeakedToNonWolf, 'wolf confirmed vote leaked to non-wolf player');

    return {
      roomId,
      wolf: wolf.name,
      rejectedTarget: wolfTeammate.name,
      acceptedTarget: nonWolf.name,
      selectionSyncedToWolfTeam,
      voteSyncedToWolfTeam
    };
  } finally {
    disconnectAll(clients);
  }
}

async function testWitchSelfSaveEnabled(serverUrl) {
  const { roomId, clients } = await createStartedRoom(serverUrl, 'witch-save-on-', {
    allowWitchSelfSave: true
  });

  try {
    const witch = clients.find(client => client.role === Role.WITCH);
    if (!witch) throw new Error('Missing witch');

    await driveNightToWitchWithoutWitchAction(clients, witch.playerId);
    const witchInfo = await waitForWitchInfo(witch, data => data.killedPlayerId === witch.playerId);

    witch.socket.emit('game:witchSave');
    await waitForPhase(clients, GamePhase.DAY_ANNOUNCE);
    await sleep(200);

    const witchDeaths = clients.flatMap(client => client.deaths).filter(death => death.playerId === witch.playerId);
    const witchDeathReviews = clients
      .flatMap(client => client.reviewEvents)
      .filter(event => (event.deaths ?? []).some(death => death.playerId === witch.playerId));
    const usedState = witch.skillStates.find(data => data.witch?.saveAvailable === false);

    assert(witchInfo, 'witch did not receive private self wolf-kill target');
    assert(usedState, 'witch private skill state did not update after self save');
    assert(witchDeaths.length === 0, 'witch died after self save when self save was enabled');
    assert(witchDeathReviews.length === 0, 'review recorded witch death after self save when self save was enabled');

    return {
      roomId,
      witch: witch.name,
      saveAvailable: usedState.witch.saveAvailable,
      deathEvents: witchDeaths.length
    };
  } finally {
    disconnectAll(clients);
  }
}

async function testWitchSelfSaveDisabled(serverUrl) {
  const { roomId, clients } = await createStartedRoom(serverUrl, 'witch-save-off-', {
    allowWitchSelfSave: false
  });

  try {
    const witch = clients.find(client => client.role === Role.WITCH);
    if (!witch) throw new Error('Missing witch');

    await driveNightToWitchWithoutWitchAction(clients, witch.playerId);
    const witchInfo = await waitForWitchInfo(witch, data => data.killedPlayerId === witch.playerId);

    witch.socket.emit('game:witchSave');
    await sleep(200);

    const rejectedSelfSave = witch.errors.includes(GAME_ERROR_MESSAGES.witchSelfSaveForbidden);
    const stayedInWitchPhase = witch.gameState?.phase === GamePhase.NIGHT_WITCH;

    witch.socket.emit('game:witchPass');
    await waitForPhase(clients, GamePhase.DAY_ANNOUNCE);
    await sleep(200);

    const deathReceivers = clients.filter(client =>
      client.deaths.some(death => death.playerId === witch.playerId && death.reason === 'night')
    );
    const usedState = witch.skillStates.find(data => data.witch?.saveAvailable === false);

    assert(witchInfo, 'witch did not receive private self wolf-kill target with self save disabled');
    assert(rejectedSelfSave, 'witch self save was not rejected when disabled');
    assert(stayedInWitchPhase, 'witch self save rejection should not advance phase');
    assert(!usedState, 'witch save should not be consumed after rejected self save');
    assert(deathReceivers.length === clients.length, 'witch death was not announced after rejected self save and pass');

    return {
      roomId,
      witch: witch.name,
      rejectedSelfSave,
      deathReceivers: deathReceivers.length
    };
  } finally {
    disconnectAll(clients);
  }
}

async function testWolfTimeoutRandomKillsNonWolf(serverUrl) {
  const { roomId, clients } = await createStartedRoom(serverUrl, 'wolf-timeout-', {
    voteTime: 3
  });

  try {
    const seer = clients.find(client => client.role === Role.SEER);
    const witch = clients.find(client => client.role === Role.WITCH);
    if (!seer || !witch) throw new Error('Missing seer or witch');

    clients.forEach(client => client.socket.emit('game:confirmRole'));
    await waitForPhase(clients, GamePhase.NIGHT_WEREWOLF);

    await waitForPhase(clients, GamePhase.NIGHT_SEER, 35000);
    const seerTarget = clients.find(client => client.playerId !== seer.playerId);
    seer.socket.emit('game:seerCheck', { targetId: seerTarget.playerId });

    await waitForPhase(clients, GamePhase.NIGHT_WITCH);
    const witchInfo = await waitForWitchInfo(witch, data => Boolean(data.killedPlayerId));
    const killedClient = clients.find(client => client.playerId === witchInfo.killedPlayerId);
    if (!killedClient) throw new Error(`Missing random killed client ${witchInfo.killedPlayerId}`);

    witch.socket.emit('game:witchPass');
    await waitForPhase(clients, GamePhase.DAY_ANNOUNCE);
    await sleep(200);

    const killedIsWolf = killedClient.role === Role.WEREWOLF ||
      killedClient.role === Role.WOLF_KING ||
      killedClient.role === Role.WHITE_WOLF_KING;
    const deathReceivers = clients.filter(client =>
      client.deaths.some(death => death.playerId === killedClient.playerId && death.reason === 'night')
    );
    const wolfVotesRecorded = clients.some(client =>
      client.wolfVotes.some(votes => Object.keys(votes).length > 0)
    );

    assert(!killedIsWolf, 'wolf timeout random kill selected a wolf player');
    assert(!wolfVotesRecorded, 'wolf timeout random kill should not depend on confirmed wolf votes');
    assert(deathReceivers.length === clients.length, 'wolf timeout random kill death was not announced to all clients');

    return {
      roomId,
      killed: killedClient.name,
      killedRole: killedClient.role,
      deathReceivers: deathReceivers.length
    };
  } finally {
    disconnectAll(clients);
  }
}

async function testSameGuardAndSaveKillsTarget(serverUrl) {
  const { roomId, clients } = await createStartedRoom(serverUrl, 'guard-save-', {
    maxPlayers: 9,
    roles: [Role.WEREWOLF, Role.SEER, Role.WITCH, Role.HUNTER, Role.GUARD],
    wolfCount: 3
  });

  try {
    const wolves = clients.filter(client => client.role === Role.WEREWOLF || client.role === Role.WOLF_KING);
    const seer = clients.find(client => client.role === Role.SEER);
    const witch = clients.find(client => client.role === Role.WITCH);
    const guard = clients.find(client => client.role === Role.GUARD);
    const target = clients.find(client =>
      client.playerId !== witch?.playerId &&
      client.role !== Role.WEREWOLF &&
      client.role !== Role.WOLF_KING
    );
    if (!wolves.length || !seer || !witch || !guard || !target) {
      throw new Error(`Missing same guard/save roles: wolves=${wolves.length}, seer=${Boolean(seer)}, witch=${Boolean(witch)}, guard=${Boolean(guard)}, target=${Boolean(target)}`);
    }

    const initialWitchState = await waitForSkillState(witch, data =>
      data.witch?.saveAvailable === true && data.witch?.poisonAvailable === true
    );
    const initialGuardState = await waitForSkillState(guard, data =>
      data.guard?.lastGuardTargetId === null
    );
    const witchStateReceivers = clients.filter(client =>
      client.playerId !== witch.playerId && client.skillStates.some(data => data.witch)
    );
    const guardStateReceivers = clients.filter(client =>
      client.playerId !== guard.playerId && client.skillStates.some(data => data.guard)
    );

    clients.forEach(client => client.socket.emit('game:confirmRole'));
    await waitForPhase(clients, GamePhase.NIGHT_WEREWOLF);

    for (const wolf of wolves) {
      wolf.socket.emit('game:werewolfKill', { targetId: target.playerId });
      await sleep(20);
      wolf.socket.emit('game:wolfConfirmVote');
      await sleep(20);
    }

    await waitForPhase(clients, GamePhase.NIGHT_SEER);
    const seerTarget = clients.find(client => client.playerId !== seer.playerId);
    seer.socket.emit('game:seerCheck', { targetId: seerTarget.playerId });

    await waitForPhase(clients, GamePhase.NIGHT_GUARD);
    guard.socket.emit('game:guardProtect', { targetId: target.playerId });
    const guardUsedState = await waitForSkillState(guard, data =>
      data.guard?.lastGuardTargetId === target.playerId
    );

    await waitForPhase(clients, GamePhase.NIGHT_WITCH);
    const witchInfo = await waitForWitchInfo(witch, data => data.killedPlayerId === target.playerId);
    witch.socket.emit('game:witchSave');
    const witchUsedState = await waitForSkillState(witch, data =>
      data.witch?.saveAvailable === false && data.witch?.poisonAvailable === true
    );

    await waitForPhase(clients, GamePhase.DAY_ANNOUNCE);
    await sleep(200);

    const deathReceivers = clients.filter(client =>
      client.deaths.some(death => death.playerId === target.playerId && death.reason === 'night')
    );
    const reviewReceivers = clients.filter(client =>
      client.reviewEvents.some(event =>
        event.type === 'night_result' &&
        (event.deaths ?? []).some(death => death.playerId === target.playerId && death.reason === 'night')
      )
    );

    assert(deathReceivers.length === clients.length, `same guard/save night death was not announced to all clients for ${target.name}`);
    assert(reviewReceivers.length === clients.length, `same guard/save review event was not announced to all clients for ${target.name}`);
    assert(initialWitchState.witch.saveAvailable && initialWitchState.witch.poisonAvailable, 'witch initial private skill state was not available');
    assert(initialGuardState.guard.lastGuardTargetId === null, 'guard initial private skill state should have no previous target');
    assert(guardUsedState.guard.lastGuardTargetId === target.playerId, 'guard private skill state did not persist protected target');
    assert(witchInfo, 'witch did not receive private wolf-kill target');
    assert(!witchUsedState.witch.saveAvailable && witchUsedState.witch.poisonAvailable, 'witch private skill state did not update after save');
    assert(witchStateReceivers.length === 0, `witch skill state leaked to ${witchStateReceivers.map(client => client.name).join(', ')}`);
    assert(guardStateReceivers.length === 0, `guard skill state leaked to ${guardStateReceivers.map(client => client.name).join(', ')}`);

    return {
      roomId,
      target: target.name,
      guard: guard.name,
      witch: witch.name,
      deathReceivers: deathReceivers.length,
      guardLastTarget: guardUsedState.guard.lastGuardTargetId,
      witchSaveAvailable: witchUsedState.witch.saveAvailable
    };
  } finally {
    disconnectAll(clients);
  }
}
module.exports = {
  testWolfFriendlyFireEnabled,
  testWolfFriendlyFireDisabled,
  testWitchSelfSaveEnabled,
  testWitchSelfSaveDisabled,
  testWolfTimeoutRandomKillsNonWolf,
  testSameGuardAndSaveKillsTarget
};
