import { Injectable } from '@nestjs/common';

/** Time port (spec section 3): services never call `new Date()` themselves. */
export abstract class Clock {
  abstract now(): Date;
}

@Injectable()
export class SystemClock extends Clock {
  override now(): Date {
    return new Date();
  }
}

/** Test clock: returns the same instant until moved with `set` or `advance`. */
export class FixedClock extends Clock {
  private current: number;

  constructor(at: Date) {
    super();
    this.current = at.getTime();
  }

  override now(): Date {
    return new Date(this.current);
  }

  set(at: Date): void {
    this.current = at.getTime();
  }

  advance(ms: number): void {
    this.current += ms;
  }
}
