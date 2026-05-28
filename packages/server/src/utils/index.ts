export function generateRoomId(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export function generateMessageId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}
