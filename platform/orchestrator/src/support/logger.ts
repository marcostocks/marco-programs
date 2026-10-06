/**
 * Logger port.
 *
 * Structured, pino-compatible. Kept as an interface so tests can capture output
 * and so nothing in the domain imports a logging library.
 *
 * Never log a raw account number, a private key, a bearer token, or a full
 * webhook body. Log the reference, not the payload.
 */

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(fields: LogFields, message: string): void;
  info(fields: LogFields, message: string): void;
  warn(fields: LogFields, message: string): void;
  error(fields: LogFields, message: string): void;
  child(bindings: LogFields): Logger;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_ORDER: Record<Exclude<LogLevel, 'silent'>, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface CapturedLog {
  readonly level: Exclude<LogLevel, 'silent'>;
  readonly message: string;
  readonly fields: LogFields;
}

/** Console logger with level filtering. bigint is stringified, not thrown on. */
export class ConsoleLogger implements Logger {
  constructor(
    private readonly level: LogLevel = 'info',
    private readonly bindings: LogFields = {},
  ) {}

  private write(level: Exclude<LogLevel, 'silent'>, fields: LogFields, message: string): void {
    if (this.level === 'silent' || LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
    const payload = { level, time: new Date().toISOString(), ...this.bindings, ...fields, message };
    const line = JSON.stringify(payload, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  }

  debug(fields: LogFields, message: string): void {
    this.write('debug', fields, message);
  }
  info(fields: LogFields, message: string): void {
    this.write('info', fields, message);
  }
  warn(fields: LogFields, message: string): void {
    this.write('warn', fields, message);
  }
  error(fields: LogFields, message: string): void {
    this.write('error', fields, message);
  }

  child(bindings: LogFields): Logger {
    return new ConsoleLogger(this.level, { ...this.bindings, ...bindings });
  }
}

/** Collects log lines so a test can assert on them. */
export class MemoryLogger implements Logger {
  readonly lines: CapturedLog[];

  constructor(
    private readonly bindings: LogFields = {},
    shared: CapturedLog[] = [],
  ) {
    this.lines = shared;
  }

  private write(level: Exclude<LogLevel, 'silent'>, fields: LogFields, message: string): void {
    this.lines.push({ level, message, fields: { ...this.bindings, ...fields } });
  }

  debug(fields: LogFields, message: string): void {
    this.write('debug', fields, message);
  }
  info(fields: LogFields, message: string): void {
    this.write('info', fields, message);
  }
  warn(fields: LogFields, message: string): void {
    this.write('warn', fields, message);
  }
  error(fields: LogFields, message: string): void {
    this.write('error', fields, message);
  }

  child(bindings: LogFields): Logger {
    return new MemoryLogger({ ...this.bindings, ...bindings }, this.lines);
  }
}

export const silentLogger: Logger = new ConsoleLogger('silent');
