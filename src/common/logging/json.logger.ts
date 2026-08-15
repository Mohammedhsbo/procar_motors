import { ConsoleLogger, type LogLevel } from '@nestjs/common';

type JsonLog = {
  ts: string;
  level: string;
  context?: string;
  message: string;
  stack?: string;
};

/**
 * Production logger — one JSON object per line, no ANSI, no secrets.
 */
export class JsonLogger extends ConsoleLogger {
  override log(message: unknown, context?: string) {
    this.write('info', message, context);
  }

  override error(message: unknown, stackOrContext?: string, context?: string) {
    const stack = context !== undefined ? stackOrContext : undefined;
    const ctx = context ?? (stack === undefined ? stackOrContext : undefined);
    this.write('error', message, ctx, stack);
  }

  override warn(message: unknown, context?: string) {
    this.write('warn', message, context);
  }

  override debug(message: unknown, context?: string) {
    this.write('debug', message, context);
  }

  override verbose(message: unknown, context?: string) {
    this.write('verbose', message, context);
  }

  override fatal(message: unknown, context?: string) {
    this.write('fatal', message, context);
  }

  protected override printMessages(): void {
    // JSON logger writes via write(); skip Nest pretty-print.
  }

  private write(
    level: string,
    message: unknown, // ConsoleLogger accepts unknown
    context?: string,
    stack?: string,
  ) {
    const payload: JsonLog = {
      ts: new Date().toISOString(),
      level,
      message: this.stringify(message),
    };
    if (context) payload.context = context;
    if (stack) payload.stack = stack;
    const line = JSON.stringify(payload);
    if (level === 'error' || level === 'fatal') {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  }

  private stringify(message: unknown): string {
    if (typeof message === 'string') return message;
    if (message instanceof Error) return message.message;
    try {
      return JSON.stringify(message);
    } catch {
      return String(message);
    }
  }
}

export const JSON_LOG_LEVELS: LogLevel[] = [
  'log',
  'error',
  'warn',
  'debug',
  'verbose',
  'fatal',
];
