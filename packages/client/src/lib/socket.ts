import { io } from 'socket.io-client';
import { ClientToServerEvents, ServerToClientEvents } from '@werewolf/shared';

const URL = import.meta.env.DEV
  ? 'http://localhost:3001'
  : window.location.origin;

export const socket = io(URL, {
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000
});

socket.on('connect', () => {
  console.log('Connected to server:', socket.id);
});

socket.on('disconnect', () => {
  console.log('Disconnected from server');
});

socket.on('connect_error', (error) => {
  console.error('Connection error:', error);
});
