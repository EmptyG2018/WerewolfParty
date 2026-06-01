import { Express, Request, Response } from 'express';
import { RoomManager } from '../rooms/RoomManager';
import { GameManager } from '../game/GameManager';
import { DebugBotManager } from './DebugBotManager';

export function registerDebugRoutes(
  app: Express,
  roomManager: RoomManager,
  gameManager: GameManager
): void {
  const debugBots = new DebugBotManager(roomManager, gameManager);

  app.post('/api/debug/rooms/:roomId/fill', (req: Request, res: Response) => {
    const result = debugBots.fillRoom(req.params.roomId);
    res.json(result);
  });

  app.post('/api/debug/rooms/:roomId/auto-act', (req: Request, res: Response) => {
    const result = debugBots.runCurrentPhase(req.params.roomId);
    res.json(result);
  });

  app.get('/api/debug/rooms/:roomId/perspectives', (req: Request, res: Response) => {
    const result = debugBots.getPerspectives(req.params.roomId);
    res.json(result);
  });
}
