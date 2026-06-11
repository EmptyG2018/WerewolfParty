// 房间和投票回归，覆盖准备门禁、白天投票提前结算和投票明细落库。
const { GAME_ERROR_MESSAGES } = require('../../packages/shared/messages.ts');
const { GamePhase, Role, assert } = require('./constants.js');
const { createStartedRoom, disconnectAll, makeClient, once, sleep, waitForPhase, waitForRoomState, waitForVoteResult } = require('./helpers.js');
const { driveFirstNightToWitch, finishSpeakingPhase } = require('./phaseDrivers.js');

async function testRoomReadyGate(serverUrl) {
  const clients = Array.from({ length: 9 }, (_, index) => {
    return makeClient(serverUrl, `ready-${index + 1}`);
  });

  try {
    await Promise.all(clients.map(client => once(client.socket, 'connect')));
    clients[0].socket.emit('room:create', {
      playerName: clients[0].name,
      config: {
        roleConfirmTime: 1,
        voteTime: 3
      }
    });
    await once(clients[0].socket, 'room:joined');
    const roomId = clients[0].room.id;

    for (let index = 1; index < clients.length; index++) {
      clients[index].socket.emit('room:join', { roomId, playerName: clients[index].name });
      await once(clients[index].socket, 'room:joined');
    }

    const nonHostPlayersReady = (room) => {
      const hostId = room.hostId;
      return room.players
        .filter(player => player.id !== hostId)
        .every(player => player.isReady);
    };
    const hostIsUnready = (room) => {
      return room.players.find(player => player.id === room.hostId)?.isReady === false;
    };

    clients[0].socket.emit('room:ready', { ready: true });
    await sleep(100);
    const hostReadyIgnored = hostIsUnready(clients[0].room);

    clients.slice(1, -1).forEach(client => client.socket.emit('room:ready', { ready: true }));
    await waitForRoomState(clients, room => {
      return room.players.length === room.config.maxPlayers &&
        hostIsUnready(room) &&
        !room.players.find(player => player.id === clients[clients.length - 1].playerId)?.isReady &&
        !nonHostPlayersReady(room);
    });

    clients[0].socket.emit('room:start');
    await sleep(300);

    const blockedWithoutAllReady = clients[0].errors.includes(GAME_ERROR_MESSAGES.nonHostPlayersNotReady);
    const startedTooEarly = clients.some(client => client.gameState !== null);

    clients[clients.length - 1].socket.emit('room:ready', { ready: true });
    await waitForRoomState(clients, room => {
      return room.players.length === room.config.maxPlayers &&
        hostIsUnready(room) &&
        nonHostPlayersReady(room);
    });

    clients[0].socket.emit('room:start');
    await Promise.all(clients.map(client => once(client.socket, 'game:started')));

    assert(hostReadyIgnored, 'host ready event should be ignored');
    assert(blockedWithoutAllReady, 'room start was not blocked when a non-host player was unready');
    assert(!startedTooEarly, 'room started before all non-host players were ready');
    assert(clients.every(client => client.gameState !== null), 'room did not start after all non-host players became ready');

    return {
      roomId,
      hostReadyIgnored,
      blockedWithoutAllReady,
      startedPlayers: clients.filter(client => client.gameState !== null).length
    };
  } finally {
    disconnectAll(clients);
  }
}

async function testDayVoteEarlyResolution(serverUrl) {
  const { roomId, clients } = await createStartedRoom(serverUrl, 'vote-fast-', { voteTime: 5 });

  try {
    const nonWolfTarget = clients.find(client => client.role === Role.VILLAGER) ??
      clients.find(client =>
        client.role !== Role.WEREWOLF &&
        client.role !== Role.WOLF_KING &&
        client.role !== Role.HUNTER
      );
    if (!nonWolfTarget) throw new Error('Missing non-wolf target');

    await driveFirstNightToWitch(clients, nonWolfTarget.playerId);
    await waitForPhase(clients, GamePhase.DAY_ANNOUNCE);
    await waitForPhase(clients, GamePhase.DAY_SPEAKING, 8000);

    while (clients[0].gameState?.phase === GamePhase.DAY_SPEAKING) {
      const speaking = clients[0].gameState.speaking;
      const currentSpeakerId = speaking?.order?.[speaking.currentIndex];
      if (!currentSpeakerId) break;
      const speaker = clients.find(client => client.playerId === currentSpeakerId);
      if (!speaker) throw new Error(`Missing speaker client ${currentSpeakerId}`);
      speaker.socket.emit('game:speakingDone');
      await sleep(50);
    }

    await waitForPhase(clients, GamePhase.DAY_VOTE, 5000);
    const deadPlayerIds = new Set([
      ...(clients[0].gameState?.deadPlayers ?? []).map(dead => dead.playerId),
      ...clients[0].deaths.map(death => death.playerId)
    ]);
    const aliveClients = clients.filter(client => {
      return client.playerId && !deadPlayerIds.has(client.playerId);
    });
    const voteResultPromise = waitForVoteResult(clients[0], 1200);
    aliveClients.forEach((client, index) => {
      const target = aliveClients[(index + 1) % aliveClients.length];
      client.socket.emit('game:vote', { targetId: target.playerId });
    });

    const voteResult = await voteResultPromise;
    assert(voteResult.details && Object.keys(voteResult.details).length === aliveClients.length, 'early vote result did not include all alive voters');

    return {
      roomId,
      aliveVoters: aliveClients.length,
      voteDetails: Object.keys(voteResult.details).length
    };
  } finally {
    disconnectAll(clients);
  }
}
module.exports = {
  testRoomReadyGate,
  testDayVoteEarlyResolution
};
