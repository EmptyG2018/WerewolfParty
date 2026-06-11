// 隐藏阶段和死亡技能回归，重点保护猎人/狼王私有行动不泄露给非行动者。
const { GamePhase, Role, assert } = require('./constants.js');
const {
  createStartedRoom,
  disconnectAll,
  reconnectClient,
  sleep,
  waitForPhase,
  waitForPrivateEvent
} = require('./helpers.js');
const { driveFirstNightToWitch, driveNightToWitchWithoutWitchAction, finishSpeakingPhase } = require('./phaseDrivers.js');

async function testHunterHiddenPhase(serverUrl) {
  const { roomId, clients } = await createStartedRoom(serverUrl, 'hunter-');
  try {
    const hunter = clients.find(client => client.role === Role.HUNTER);
    if (!hunter) throw new Error('Missing hunter');

    await driveFirstNightToWitch(clients, hunter.playerId);
    await waitForPhase(clients, GamePhase.DAY_ANNOUNCE);
    await sleep(5600);
    await waitForPrivateEvent(hunter, 'hunterRequired', 'game:hunterRequired');

    clients[0].socket.emit('game:pause');
    await sleep(300);
    clients[0].socket.emit('game:resume');
    await sleep(500);

    const nonActors = clients.filter(client => client.playerId !== hunter.playerId);
    const leakedHunterPhase = nonActors.filter(client => {
      return client.phases.some(entry => entry.phase === GamePhase.HUNTER_SHOOT) ||
        client.resumed.some(entry => entry.phase === GamePhase.HUNTER_SHOOT);
    });
    const nonActorPrivate = nonActors.filter(client => client.hunterRequired.length > 0);
    const nonActorResolving = nonActors.filter(client => {
      return client.phases.some(entry => entry.phase === GamePhase.DAY_RESOLVING) ||
        client.resumed.some(entry => entry.phase === GamePhase.DAY_RESOLVING);
    });

    assert(hunter.hunterRequired.length > 0, 'hunter actor did not receive private event');
    assert(nonActorResolving.length === nonActors.length, 'not all hunter non-actors saw day_resolving');
    assert(leakedHunterPhase.length === 0, `hunter phase leaked to ${leakedHunterPhase.map(client => client.name).join(', ')}`);
    assert(nonActorPrivate.length === 0, `hunter private event leaked to ${nonActorPrivate.map(client => client.name).join(', ')}`);

    return {
      roomId,
      hunter: hunter.name,
      nonActorResolving: nonActorResolving.length,
      pauseEvents: clients.reduce((sum, client) => sum + client.paused.length, 0)
    };
  } finally {
    disconnectAll(clients);
  }
}

async function testVotedHunterLastWordsThenShoot(serverUrl) {
  const { roomId, clients } = await createStartedRoom(serverUrl, 'hunter-vote-', { voteTime: 5 });

  try {
    const hunter = clients.find(client => client.role === Role.HUNTER);
    const nightTarget = clients.find(client =>
      client.playerId !== hunter?.playerId &&
      client.role !== Role.WEREWOLF &&
      client.role !== Role.WOLF_KING &&
      client.role !== Role.WHITE_WOLF_KING
    );
    if (!hunter || !nightTarget) throw new Error('Missing voted hunter regression roles');

    await driveFirstNightToWitch(clients, nightTarget.playerId);
    await waitForPhase(clients, GamePhase.DAY_ANNOUNCE);
    await finishSpeakingPhase(clients);

    const aliveClients = clients.filter(client => client.room?.players.find(player => player.id === client.playerId)?.status === 'alive');
    const fallbackTarget = aliveClients.find(client => client.playerId !== hunter.playerId);
    if (!fallbackTarget) throw new Error('Missing fallback vote target for hunter');

    const lastWordsPromise = waitForPhase(clients, GamePhase.LAST_WORDS, 3000);
    aliveClients.forEach(client => {
      const targetId = client.playerId === hunter.playerId ? fallbackTarget.playerId : hunter.playerId;
      client.socket.emit('game:vote', { targetId });
    });
    await lastWordsPromise;
    await sleep(200);

    const hunterDeathReceivers = clients.filter(client =>
      client.deaths.some(death => death.playerId === hunter.playerId && death.reason === 'voted')
    );
    const hunterRequiredBeforeLastWordsDone = clients.filter(client => client.hunterRequired.length > 0);
    const lastWordsSpeakers = clients
      .map(client => client.gameState?.speaking?.order?.[0])
      .filter(playerId => playerId === hunter.playerId);

    hunter.socket.emit('game:speakingDone');
    await waitForPrivateEvent(hunter, 'hunterRequired', 'game:hunterRequired', 3000);

    const nonActorPrivate = clients.filter(client =>
      client.playerId !== hunter.playerId && client.hunterRequired.length > 0
    );
    hunter.socket.emit('game:hunterPass');
    await sleep(200);

    assert(hunterDeathReceivers.length === clients.length, 'voted hunter death was not announced to all clients');
    assert(hunterRequiredBeforeLastWordsDone.length === 0, 'hunter shoot prompt appeared before last words completed');
    assert(lastWordsSpeakers.length === clients.length, 'last words speaking state did not point to voted hunter for all clients');
    assert(hunter.hunterRequired.length > 0, 'voted hunter did not receive private shoot prompt after last words');
    assert(nonActorPrivate.length === 0, 'voted hunter private shoot prompt leaked to non-actors');

    return {
      roomId,
      hunter: hunter.name,
      lastWordsReceivers: lastWordsSpeakers.length,
      hunterDeathReceivers: hunterDeathReceivers.length
    };
  } finally {
    disconnectAll(clients);
  }
}

async function testPoisonedHunterCannotShoot(serverUrl) {
  const { roomId, clients } = await createStartedRoom(serverUrl, 'hunter-poison-', {
    allowWitchSelfSave: true
  });

  try {
    const hunter = clients.find(client => client.role === Role.HUNTER);
    const witch = clients.find(client => client.role === Role.WITCH);
    const nightTarget = clients.find(client =>
      client.playerId !== hunter?.playerId &&
      client.playerId !== witch?.playerId &&
      client.role !== Role.WEREWOLF &&
      client.role !== Role.WOLF_KING &&
      client.role !== Role.WHITE_WOLF_KING
    );
    if (!hunter || !witch || !nightTarget) throw new Error('Missing poisoned hunter regression roles');

    await driveNightToWitchWithoutWitchAction(clients, nightTarget.playerId);
    witch.socket.emit('game:witchPoison', { targetId: hunter.playerId });
    await waitForPhase(clients, GamePhase.DAY_ANNOUNCE);
    await sleep(5600);

    const hunterDeathReceivers = clients.filter(client =>
      client.deaths.some(death => death.playerId === hunter.playerId && death.reason === 'night')
    );
    const privateReceivers = clients.filter(client => client.hunterRequired.length > 0);
    const lastWordsReceivers = clients.filter(client =>
      client.phases.some(entry => entry.phase === GamePhase.LAST_WORDS)
    );

    assert(hunterDeathReceivers.length === clients.length, 'poisoned hunter death was not announced to all clients');
    assert(privateReceivers.length === 0, 'poisoned hunter should not receive or leak hunter shoot prompt');
    assert(lastWordsReceivers.length === 0, 'poisoned hunter should not trigger last words');

    return {
      roomId,
      hunter: hunter.name,
      deathReceivers: hunterDeathReceivers.length,
      hunterPromptReceivers: privateReceivers.length
    };
  } finally {
    disconnectAll(clients);
  }
}

async function testWolfKingShotHunterCannotShoot(serverUrl) {
  const { roomId, clients } = await createStartedRoom(serverUrl, 'wolfking-shot-hunter-', {
    maxPlayers: 9,
    roles: [Role.WEREWOLF, Role.WOLF_KING, Role.SEER, Role.WITCH, Role.HUNTER],
    wolfCount: 2
  });

  try {
    const wolfKing = clients.find(client => client.role === Role.WOLF_KING);
    const hunter = clients.find(client => client.role === Role.HUNTER);
    if (!wolfKing || !hunter) throw new Error('Missing wolf king or hunter');

    await driveFirstNightToWitch(clients, wolfKing.playerId);
    await waitForPrivateEvent(wolfKing, 'wolfKingRequired', 'game:wolfKingRequired');

    wolfKing.socket.emit('game:wolfKingShoot', { targetId: hunter.playerId });
    await waitForPhase(clients, GamePhase.DAY_ANNOUNCE);
    await sleep(5600);

    const hunterDeathReceivers = clients.filter(client =>
      client.deaths.some(death => death.playerId === hunter.playerId && death.reason === 'skill')
    );
    const hunterPrivateReceivers = clients.filter(client => client.hunterRequired.length > 0);
    const lastWordsReceivers = clients.filter(client =>
      client.phases.some(entry => entry.phase === GamePhase.LAST_WORDS)
    );
    const skillReviewReceivers = clients.filter(client =>
      client.reviewEvents.some(event =>
        event.type === 'skill_take' &&
        event.actorId === wolfKing.playerId &&
        event.targetId === hunter.playerId
      )
    );

    assert(hunterDeathReceivers.length === clients.length, 'wolf king shot hunter death was not announced as skill to all clients');
    assert(hunterPrivateReceivers.length === 0, 'wolf king shot hunter should not trigger hunter shoot prompt');
    assert(lastWordsReceivers.length === 0, 'wolf king shot hunter should not trigger last words');
    assert(skillReviewReceivers.length === clients.length, 'wolf king shot hunter skill review was not sent to all clients');

    return {
      roomId,
      wolfKing: wolfKing.name,
      hunter: hunter.name,
      deathReceivers: hunterDeathReceivers.length,
      skillReviewReceivers: skillReviewReceivers.length
    };
  } finally {
    disconnectAll(clients);
  }
}

async function testHiddenHunterReconnectIsolation(serverUrl) {
  const { roomId, clients } = await createStartedRoom(serverUrl, 'hunter-reconnect-');

  try {
    const hunter = clients.find(client => client.role === Role.HUNTER);
    const nonActor = clients.find(client => client.playerId !== hunter?.playerId);
    if (!hunter || !nonActor) throw new Error('Missing hunter reconnect roles');

    await driveFirstNightToWitch(clients, hunter.playerId);
    await waitForPhase(clients, GamePhase.DAY_ANNOUNCE);
    await sleep(5600);
    await waitForPrivateEvent(hunter, 'hunterRequired', 'game:hunterRequired');

    hunter.socket.disconnect();
    nonActor.socket.disconnect();
    await sleep(100);

    const reconnectedHunter = await reconnectClient(serverUrl, hunter, 'hunter');
    const reconnectedNonActor = await reconnectClient(serverUrl, nonActor, 'nonactor');
    await waitForPrivateEvent(reconnectedHunter, 'hunterRequired', 'game:hunterRequired');

    const hunterPublicPhase = reconnectedHunter.gameState?.phase;
    const nonActorPublicPhase = reconnectedNonActor.gameState?.phase;
    const nonActorGotPrivatePrompt = reconnectedNonActor.hunterRequired.length > 0;
    const nonActorSawHiddenPhase = reconnectedNonActor.phases.some(entry => entry.phase === GamePhase.HUNTER_SHOOT);

    reconnectedHunter.socket.emit('game:hunterPass');
    await sleep(200);

    assert(hunterPublicPhase === GamePhase.HUNTER_SHOOT, 'reconnected hunter did not restore private hidden hunter phase');
    assert(nonActorPublicPhase === GamePhase.DAY_RESOLVING, 'reconnected non-actor did not receive safe resolving phase');
    assert(!nonActorGotPrivatePrompt, 'hunter hidden prompt leaked to reconnected non-actor');
    assert(!nonActorSawHiddenPhase, 'hidden hunter phase leaked through phaseChanged to non-actor reconnect');

    return {
      roomId,
      hunter: reconnectedHunter.name,
      hunterPhase: hunterPublicPhase,
      nonActorPhase: nonActorPublicPhase
    };
  } finally {
    disconnectAll(clients);
  }
}

async function testWolfKingHiddenPhase(serverUrl) {
  const { roomId, clients } = await createStartedRoom(serverUrl, 'wolfking-', {
    maxPlayers: 9,
    roles: [Role.WEREWOLF, Role.WOLF_KING, Role.SEER, Role.WITCH, Role.HUNTER],
    wolfCount: 2
  });

  try {
    const wolfKing = clients.find(client => client.role === Role.WOLF_KING);
    if (!wolfKing) throw new Error('Missing wolf king');

    await driveFirstNightToWitch(clients, wolfKing.playerId);
    await waitForPrivateEvent(wolfKing, 'wolfKingRequired', 'game:wolfKingRequired');

    clients[0].socket.emit('game:pause');
    await sleep(300);
    clients[0].socket.emit('game:resume');
    await sleep(500);

    const nonActors = clients.filter(client => client.playerId !== wolfKing.playerId);
    const leakedWolfKingPhase = nonActors.filter(client => {
      return client.phases.some(entry => entry.phase === GamePhase.WOLF_KING_SHOOT) ||
        client.resumed.some(entry => entry.phase === GamePhase.WOLF_KING_SHOOT);
    });
    const nonActorPrivate = nonActors.filter(client => client.wolfKingRequired.length > 0);
    const nonActorResolving = nonActors.filter(client => {
      return client.phases.some(entry => entry.phase === GamePhase.DAY_RESOLVING) ||
        client.resumed.some(entry => entry.phase === GamePhase.DAY_RESOLVING);
    });
    const earlyDeathReceivers = clients.filter(client => client.deaths.length > 0);

    assert(wolfKing.wolfKingRequired.length > 0, 'wolf king actor did not receive private event');
    assert(nonActorResolving.length === nonActors.length, 'not all wolf king non-actors saw day_resolving');
    assert(leakedWolfKingPhase.length === 0, `wolf king phase leaked to ${leakedWolfKingPhase.map(client => client.name).join(', ')}`);
    assert(nonActorPrivate.length === 0, `wolf king private event leaked to ${nonActorPrivate.map(client => client.name).join(', ')}`);
    assert(earlyDeathReceivers.length === 0, `night death leaked before day announce to ${earlyDeathReceivers.map(client => client.name).join(', ')}`);

    return {
      roomId,
      wolfKing: wolfKing.name,
      nonActorResolving: nonActorResolving.length,
      pauseEvents: clients.reduce((sum, client) => sum + client.paused.length, 0)
    };
  } finally {
    disconnectAll(clients);
  }
}
module.exports = {
  testHunterHiddenPhase,
  testVotedHunterLastWordsThenShoot,
  testPoisonedHunterCannotShoot,
  testWolfKingShotHunterCannotShoot,
  testHiddenHunterReconnectIsolation,
  testWolfKingHiddenPhase
};
