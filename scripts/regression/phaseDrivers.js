const { GamePhase, Role } = require('./constants.js');
const { sleep, waitForPhase } = require('./helpers.js');

async function finishSpeakingPhase(clients) {
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
}

async function driveFirstNightToWitch(clients, targetId) {
  const wolves = clients.filter(client => client.role === Role.WEREWOLF || client.role === Role.WOLF_KING);
  const seer = clients.find(client => client.role === Role.SEER);
  const witch = clients.find(client => client.role === Role.WITCH);
  if (!wolves.length || !seer || !witch) {
    throw new Error(`Missing roles: wolves=${wolves.length}, seer=${Boolean(seer)}, witch=${Boolean(witch)}`);
  }

  clients.forEach(client => client.socket.emit('game:confirmRole'));
  await waitForPhase(clients, GamePhase.NIGHT_WEREWOLF);

  for (const wolf of wolves) {
    wolf.socket.emit('game:werewolfKill', { targetId });
    await sleep(20);
    wolf.socket.emit('game:wolfConfirmVote');
    await sleep(20);
  }

  await waitForPhase(clients, GamePhase.NIGHT_SEER);
  const seerTarget = clients.find(client => client.playerId !== seer.playerId);
  seer.socket.emit('game:seerCheck', { targetId: seerTarget.playerId });

  await waitForPhase(clients, GamePhase.NIGHT_WITCH);
  witch.socket.emit('game:witchPass');

  return { wolves, seer, witch };
}

async function driveNightToWitchWithoutWitchAction(clients, targetId) {
  const wolves = clients.filter(client =>
    client.role === Role.WEREWOLF ||
    client.role === Role.WOLF_KING ||
    client.role === Role.WHITE_WOLF_KING
  );
  const seer = clients.find(client => client.role === Role.SEER);
  const witch = clients.find(client => client.role === Role.WITCH);
  if (!wolves.length || !seer || !witch) {
    throw new Error(`Missing roles: wolves=${wolves.length}, seer=${Boolean(seer)}, witch=${Boolean(witch)}`);
  }

  clients.forEach(client => client.socket.emit('game:confirmRole'));
  await waitForPhase(clients, GamePhase.NIGHT_WEREWOLF);

  for (const wolf of wolves) {
    wolf.socket.emit('game:werewolfKill', { targetId });
    await sleep(20);
    wolf.socket.emit('game:wolfConfirmVote');
    await sleep(20);
  }

  await waitForPhase(clients, GamePhase.NIGHT_SEER);
  const seerTarget = clients.find(client => client.playerId !== seer.playerId);
  seer.socket.emit('game:seerCheck', { targetId: seerTarget.playerId });

  await waitForPhase(clients, GamePhase.NIGHT_WITCH);
  return { wolves, seer, witch };
}

module.exports = {
  driveFirstNightToWitch,
  driveNightToWitchWithoutWitchAction,
  finishSpeakingPhase
};
