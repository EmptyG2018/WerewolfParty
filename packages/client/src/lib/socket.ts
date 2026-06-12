import { io, Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@werewolf/shared';

export const SERVER_URL = import.meta.env.DEV
  ? (import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001')
  : window.location.origin;

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL, {
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000
});

socket.on('connect_error', (error) => {
  console.error('Connection error:', error);
});
