const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');
const { ROOM_RULE_DEFAULTS } = require('../../packages/shared/rules.ts');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 等待一次性 Socket 事件。默认超时略长，避免完整套件连接量较大时偶发失败。
function once(socket, event, timeout = 10000) {
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
      // 服务还在启动中，继续轮询健康检查。
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

// 构造回归测试客户端，并在本地维护一份最小状态镜像。
// 这些状态用于断言“重连恢复”和“信息隔离”，不能在这里补服务端没有发送的数据。
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
    reviewEvents: [],
    joinedRooms: [],
    reconnectedRooms: [],
    reconnectedClients: [],
    updatedRooms: [],
    wolfTeam: [],
    reconnectFailures: [],
    errors: []
  };

  socket.on('room:joined', data => {
    client.playerId = data.playerId;
    client.sessionId = data.sessionId;
    client.room = data.room;
    client.joinedRooms.push(data.room);
  });
  socket.on('room:reconnected', data => {
    client.playerId = data.playerId;
    client.sessionId = data.sessionId;
    client.room = data.room;
    client.reconnectedRooms.push(data.room);
  });
  socket.on('room:reconnectFailed', data => client.reconnectFailures.push(data.message));
  socket.on('room:updated', ({ room }) => {
    client.room = room;
    client.updatedRooms.push(room);
  });
  socket.on('game:started', ({ gameState, myRole, wolfTeam }) => {
    client.gameState = gameState;
    client.role = myRole;
    client.wolfTeam = wolfTeam || [];
  });
  socket.on('game:phaseChanged', data => {
    client.phases.push(data);
    if (client.gameState) {
      client.gameState = {
        ...client.gameState,
        phase: data.phase,
        phaseTimer: data.timer,
        phaseEndsAt: data.endsAt,
        speaking: data.speaking ?? client.gameState.speaking
      };
    }
  });
  socket.on('game:speakingUpdate', data => {
    if (client.gameState) {
      client.gameState = {
        ...client.gameState,
        speaking: data.speaking
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
  socket.on('game:playerDead', data => {
    client.deaths.push(data);
    // 测试客户端没有真实前端 store，这里只同步公开死亡状态，方便后续阶段筛选存活玩家。
    if (client.room) {
      client.room = {
        ...client.room,
        players: client.room.players.map(player =>
          player.id === data.playerId ? { ...player, status: 'dead' } : player
        )
      };
    }
    if (client.gameState) {
      const currentDeaths = client.gameState.deadPlayers ?? [];
      const alreadyRecorded = currentDeaths.some(dead =>
        dead.playerId === data.playerId && dead.day === data.day && dead.reason === data.reason
      );
      client.gameState = {
        ...client.gameState,
        deadPlayers: alreadyRecorded ? currentDeaths : [...currentDeaths, data]
      };
    }
  });
  socket.on('game:reviewEvent', data => {
    client.reviewEvents.push(data.event);
    if (client.gameState) {
      client.gameState = {
        ...client.gameState,
        reviewEvents: [...(client.gameState.reviewEvents ?? []), data.event]
      };
    }
  });
  socket.on('game:error', data => client.errors.push(data.message));
  return client;
}

async function createStartedRoom(serverUrl, prefix, config = {}) {
  const clients = Array.from({ length: config.maxPlayers ?? 9 }, (_, index) => {
    return makeClient(serverUrl, `${prefix}${index + 1}`);
  });

  await Promise.all(clients.map(client => once(client.socket, 'connect')));
  const createdPromise = once(clients[0].socket, 'room:joined');
  clients[0].socket.emit('room:create', {
    playerName: clients[0].name,
    config: {
      roleConfirmTime: 1,
      voteTime: Math.min(ROOM_RULE_DEFAULTS.voteTime, 3),
      ...config
    }
  });
  await createdPromise;
  const roomId = clients[0].room.id;

  for (let index = 1; index < clients.length; index++) {
    const joinedPromise = once(clients[index].socket, 'room:joined');
    clients[index].socket.emit('room:join', { roomId, playerName: clients[index].name });
    await joinedPromise;
  }

  clients.slice(1).forEach(client => client.socket.emit('room:ready', { ready: true }));
  await waitForRoomState(clients, room => {
    return room.players.length === room.config.maxPlayers &&
      room.players.find(player => player.id === room.hostId)?.isReady === false &&
      room.players
        .filter(player => player.id !== room.hostId)
        .every(player => player.isReady);
  });

  const startedPromises = clients.map(client => once(client.socket, 'game:started'));
  clients[0].socket.emit('room:start');
  await Promise.all(startedPromises);
  return { roomId, clients };
}

function disconnectAll(clients) {
  const seen = new Set();
  const disconnectClient = (client) => {
    if (!client || seen.has(client)) return;
    seen.add(client);
    // 重连会创建新 socket；统一挂在原 client 下，避免完整回归后半段连接泄漏。
    client.reconnectedClients?.forEach(disconnectClient);
    client.socket.disconnect();
  };
  clients.forEach(disconnectClient);
}

async function reconnectClient(serverUrl, oldClient, suffix = 'reconnect') {
  const reconnected = makeClient(serverUrl, `${oldClient.name}-${suffix}`);
  await once(reconnected.socket, 'connect');
  const reconnectedPromise = once(reconnected.socket, 'room:reconnected');
  const startedPromise = once(reconnected.socket, 'game:started');
  reconnected.socket.emit('room:reconnect', { sessionId: oldClient.sessionId });
  await reconnectedPromise;
  await startedPromise;
  await sleep(100);
  // 记录到原 client，确保 disconnectAll 能清理重连产生的新连接。
  oldClient.reconnectedClients.push(reconnected);
  return reconnected;
}

// 等待任意客户端进入指定阶段。阶段广播可能先于调用发生，所以先检查历史记录。
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

function waitForVoteResult(client, timeout = 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.socket.off('game:voteResult', handler);
      reject(new Error('Timeout waiting early game:voteResult'));
    }, timeout);

    const handler = data => {
      clearTimeout(timer);
      client.socket.off('game:voteResult', handler);
      resolve(data);
    };
    client.socket.on('game:voteResult', handler);
  });
}

module.exports = {
  createStartedRoom,
  disconnectAll,
  makeClient,
  once,
  reconnectClient,
  sleep,
  startServer,
  waitForHealth,
  waitForPhase,
  waitForPrivateEvent,
  waitForRoomState,
  waitForSkillState,
  waitForVoteResult,
  waitForWitchInfo
};
