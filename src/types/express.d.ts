import 'express';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role?: 'member' | 'host' | 'owner' | 'admin';
      };
    }
  }
}

export {};
