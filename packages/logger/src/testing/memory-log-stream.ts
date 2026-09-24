import { Writable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';

export type LogRecord = Record<string, unknown> & { level: number; time: number; msg?: string };

export interface WaitForOptions {
  /** Only records at or after this `mark()`. */
  from?: number;
  timeoutMs?: number;
}

/** In-memory pino destination for tests: override `LOG_DESTINATION` with an instance. */
export class MemoryLogStream extends Writable {
  readonly lines: string[] = [];

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.lines.push(
      ...chunk
        .toString()
        .split('\n')
        .filter((line) => line.length > 0),
    );
    callback();
  }

  records(): LogRecord[] {
    return this.lines.map((line) => JSON.parse(line) as LogRecord);
  }

  text(): string {
    return this.lines.join('\n');
  }

  mark(): number {
    return this.lines.length;
  }

  since(mark: number): LogRecord[] {
    return this.records().slice(mark);
  }

  /** pino-http logs on the response `finish` event, which can trail the client by a tick. */
  async waitFor(
    predicate: (record: LogRecord) => boolean,
    { from = 0, timeoutMs = 2000 }: WaitForOptions = {},
  ): Promise<LogRecord> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const match = this.since(from).find(predicate);
      if (match) return match;
      if (Date.now() > deadline) throw new Error(`no log record matched within ${timeoutMs} ms`);
      await sleep(10);
    }
  }
}
