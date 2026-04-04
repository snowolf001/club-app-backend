import dotenv from 'dotenv';

dotenv.config();

export const port: number = parseInt(process.env.PORT ?? '3000', 10);
export const databaseUrl: string | undefined = process.env.DATABASE_URL;
