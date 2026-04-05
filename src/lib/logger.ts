/**
 * Structured JSON logger.
 * Each line is a JSON object — easy to read in Railway log viewer and any log aggregator.
 *
 * Levels:
 *   info  – normal operation (requests, check-ins, credit changes)
 *   warn  – handled errors (400/404/409/422 AppErrors)
 *   error – unexpected errors (500, DB failures, unhandled exceptions)
 */

type Level = 'info' | 'warn' | 'error';

type LogEntry = {
  timestamp: string;
  level: Level;
  message: string;
  [key: string]: unknown;
};

function log(
  level: Level,
  message: string,
  context?: Record<string, unknown>
): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  };

  const line = JSON.stringify(entry);

  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (message: string, context?: Record<string, unknown>) =>
    log('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) =>
    log('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) =>
    log('error', message, context),
};
