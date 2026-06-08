const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');
require('tsx/cjs');
const { GameEngine } = require('../packages/server/src/game/GameEngine.ts');
const { WhiteWolfKingExplodeAction } = require('../packages/server/src/game/actions/WhiteWolfKingExplodeAction.ts');
const { WolfSelfRevealAction } = require('../packages/server/src/game/actions/WolfSelfRevealAction.ts');
const { ROLE_PRESETS, RoleAbility, roleHasAbility } = require('../packages/shared/roles.ts');

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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function once(socket, event, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeout);
    socket.once(event, data => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

async function waitForHealth(port, timeout = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    try {
      const response = await fetch(`http://localhost:${port}/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await sleep(100);
  }
  throw new Error(`Server did not become healthy on port ${port}`);
}

function startServer(port) {
  const child = spawn(process.execPath, ['--require', require.resolve('tsx/cjs'), 'packages/server/src/index.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      ENABLE_DEBUG_TOOLS: 'true'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const logs = [];
  child.stdout.on('data', chunk => logs.push(chunk.toString()));
  child.stderr.on('data', chunk => logs.push(chunk.toString()));

  return {
    child,
    logs,
    stop: async () => {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 1500);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  };
}

function makeClient(serverUrl, name) {
  const socket = io(serverUrl, { transports: ['websocket'], reconnection: false, forceNew: true });
  const client = {
    name,
    socket,
    playerId: null,
    sessionId: null,
    room: null,
    role: null,
    gameState: null,
    phases: [],
    resumed: [],
    paused: [],
    hunterRequired: [],
    wolfKingRequired: [],
    seerResults: [],
    witchInfo: [],
    skillStates: [],
    wolfSelections: [],
    wolfVotes: [],
    deaths: [],
    joinedRooms: [],
    updatedRooms: [],
    errors: []
  };

  socket.on('room:joined', data => {
    client.playerId = data.playerId;
    client.sessionId = data.sessionId;
    client.room = data.room;
    client.joinedRooms.push(data.room);
  });
  socket.on('room:updated', ({ room }) => {
    client.room = room;
    client.updatedRooms.push(room);
  });
  socket.on('game:started', ({ gameState, myRole }) => {
    client.gameState = gameState;
    client.role = myRole;
  });
  socket.on('game:phaseChanged', data => {
    client.phases.push(data);
    if (client.gameState) {
      client.gameState = {
        ...client.gameState,
        phase: data.phase,
        phaseTimer: data.timer,
        phaseEndsAt: data.endsAt
      };
    }
  });
  socket.on('game:resumed', data => client.resumed.push(data));
  socket.on('game:paused', data => client.paused.push(data));
  socket.on('game:hunterRequired', data => client.hunterRequired.push(data));
  socket.on('game:wolfKingRequired', data => client.wolfKingRequired.push(data));
  socket.on('game:seerResult', data => client.seerResults.push(data));
  socket.on('game:witchInfo', data => client.witchInfo.push(data));
  socket.on('game:skillState', data => client.skillStates.push(data));
  socket.on('game:wolfSelectionUpdate', data => client.wolfSelections.push(data.selections));
  socket.on('game:wolfVoteUpdate', data => client.wolfVotes.push(data.wolfVotes));
  socket.on('game:playerDead', data => client.deaths.push(data));
  socket.on('game:error', data => client.errors.push(data.message));
  return client;
}

async function createStartedRoom(serverUrl, prefix, config = {}) {
  const clients = Array.from({ length: config.maxPlayers ?? 9 }, (_, index) => {
    return makeClient(serverUrl, `${prefix}${index + 1}`);
  });

  await Promise.all(clients.map(client => once(client.socket, 'connect')));
  clients[0].socket.emit('room:create', {
    playerName: clients[0].name,
    config: {
      roleConfirmTime: 1,
      voteTime: 3,
      ...config
    }
  });
  await once(clients[0].socket, 'room:joined');
  const roomId = clients[0].room.id;

  for (let index = 1; index < clients.length; index++) {
    clients[index].socket.emit('room:join', { roomId, playerName: clients[index].name });
    await once(clients[index].socket, 'room:joined');
  }

  clients.forEach(client => client.socket.emit('room:ready', { ready: true }));
  await waitForRoomState(clients, room => {
    return room.players.length === room.config.maxPlayers && room.players.every(player => player.isReady);
  });

  clients[0].socket.emit('room:start');
  await Promise.all(clients.map(client => once(client.socket, 'game:started')));
  return { roomId, clients };
}

function disconnectAll(clients) {
  clients.forEach(client => client.socket.disconnect());
}

function waitForPhase(clients, phase, timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (clients.some(client => client.phases.some(entry => entry.phase === phase))) return resolve();

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout waiting phase ${phase}`));
    }, timeout);

    const handlers = clients.map(client => {
      const handler = data => {
        if (data.phase === phase) {
          cleanup();
          resolve();
        }
      };
      client.socket.on('game:phaseChanged', handler);
      return { socket: client.socket, handler };
    });

    function cleanup() {
      clearTimeout(timer);
      handlers.forEach(({ socket, handler }) => socket.off('game:phaseChanged', handler));
    }
  });
}

function waitForRoomState(clients, predicate, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const current = clients.find(client => client.room && predicate(client.room));
    if (current) return resolve(current.room);

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timeout waiting room state'));
    }, timeout);

    const handlers = clients.map(client => {
      const handler = ({ room }) => {
        if (predicate(room)) {
          cleanup();
          resolve(room);
        }
      };
      client.socket.on('room:updated', handler);
      return { socket: client.socket, handler };
    });

    function cleanup() {
      clearTimeout(timer);
      handlers.forEach(({ socket, handler }) => socket.off('room:updated', handler));
    }
  });
}

function waitForPrivateEvent(client, eventKey, socketEvent, timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (client[eventKey].length > 0) return resolve();

    const timer = setTimeout(() => {
      client.socket.off(socketEvent, handler);
      reject(new Error(`Timeout waiting ${socketEvent}`));
    }, timeout);

    const handler = () => {
      clearTimeout(timer);
      client.socket.off(socketEvent, handler);
      resolve();
    };
    client.socket.on(socketEvent, handler);
  });
}

function waitForSkillState(client, predicate, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const existing = client.skillStates.find(predicate);
    if (existing) return resolve(existing);

    const timer = setTimeout(() => {
      client.socket.off('game:skillState', handler);
      reject(new Error('Timeout waiting game:skillState'));
    }, timeout);

    const handler = data => {
      if (!predicate(data)) return;
      clearTimeout(timer);
      client.socket.off('game:skillState', handler);
      resolve(data);
    };
    client.socket.on('game:skillState', handler);
  });
}

function waitForWitchInfo(client, predicate, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const existing = client.witchInfo.find(predicate);
    if (existing) return resolve(existing);

    const timer = setTimeout(() => {
      client.socket.off('game:witchInfo', handler);
      reject(new Error('Timeout waiting game:witchInfo'));
    }, timeout);

    const handler = data => {
      if (!predicate(data)) return;
      clearTimeout(timer);
      client.socket.off('game:witchInfo', handler);
      resolve(data);
    };
    client.socket.on('game:witchInfo', handler);
  });
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

    const rejectedFriendlyTarget = wolf.errors.includes('当前规则禁止狼人自刀或刀狼队友');
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

    clients.slice(0, -1).forEach(client => client.socket.emit('room:ready', { ready: true }));
    await waitForRoomState(clients, room => {
      return room.players.length === room.config.maxPlayers &&
        room.players.filter(player => player.isReady).length === clients.length - 1;
    });

    clients[0].socket.emit('room:start');
    await sleep(300);

    const blockedWithoutAllReady = clients[0].errors.includes('所有玩家准备后才能开始游戏');
    const startedTooEarly = clients.some(client => client.gameState !== null);

    clients[clients.length - 1].socket.emit('room:ready', { ready: true });
    await waitForRoomState(clients, room => {
      return room.players.length === room.config.maxPlayers && room.players.every(player => player.isReady);
    });

    clients[0].socket.emit('room:start');
    await Promise.all(clients.map(client => once(client.socket, 'game:started')));

    assert(blockedWithoutAllReady, 'room start was not blocked when a player was unready');
    assert(!startedTooEarly, 'room started before all players were ready');
    assert(clients.every(client => client.gameState !== null), 'room did not start after all players became ready');

    return {
      roomId,
      blockedWithoutAllReady,
      startedPlayers: clients.filter(client => client.gameState !== null).length
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

    assert(deathReceivers.length === clients.length, `same guard/save night death was not announced to all clients for ${target.name}`);
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
      voteTime: 60,
      roleConfirmTime: 30,
      allowWitchSelfSave: false,
      allowWolfFriendlyFire: true,
      hybridRoles: []
    },
    status: 'playing',
    createdAt: Date.now()
  };
}

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const port = Number(process.env.REGRESSION_PORT ?? (3200 + Math.floor(Math.random() * 1000)));
  const serverUrl = `http://localhost:${port}`;
  const server = startServer(port);

  try {
    await waitForHealth(port);
    const results = [];
    results.push(['night resolution branches', testNightResolutionBranches()]);
    results.push(['white wolf king rules', testWhiteWolfKingRules()]);
    results.push(['hunter hidden phase', await testHunterHiddenPhase(serverUrl)]);
    results.push(['wolf king hidden phase', await testWolfKingHiddenPhase(serverUrl)]);
    results.push(['public state isolation', await testPublicStateIsolation(serverUrl)]);
    results.push(['room ready gate', await testRoomReadyGate(serverUrl)]);
    results.push(['wolf friendly fire disabled', await testWolfFriendlyFireDisabled(serverUrl)]);
    results.push(['same guard and save kills target', await testSameGuardAndSaveKillsTarget(serverUrl)]);

    console.log('Regression checks passed:');
    for (const [name, result] of results) {
      console.log(`- ${name}: ${JSON.stringify(result)}`);
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
