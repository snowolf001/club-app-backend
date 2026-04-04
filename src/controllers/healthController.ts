import { Request, Response } from 'express';

export function getRoot(_req: Request, res: Response): void {
  res.json({
    ok: true,
    message: 'Club App backend is running.',
  });
}

export function getHealth(_req: Request, res: Response): void {
  res.json({
    ok: true,
    service: 'club-app-backend',
    timestamp: new Date().toISOString(),
  });
}
