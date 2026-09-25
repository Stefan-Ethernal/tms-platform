import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AUTH_OPTIONS, type AdminAuthOptions } from '../options';

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

@Injectable()
export class SessionCookie {
  readonly name: string;
  private readonly secure: boolean;

  constructor(@Inject(AUTH_OPTIONS) options: Pick<AdminAuthOptions, 'session'>) {
    this.secure = options.session.cookieSecure;
    this.name = this.secure ? '__Host-tms_admin_sid' : 'tms_admin_sid';
  }

  read(req: Request): string | null {
    const value = (req.cookies as Record<string, unknown> | undefined)?.[this.name];
    return typeof value === 'string' && TOKEN_SHAPE.test(value) ? value : null;
  }

  write(res: Response, token: string): void {
    res.cookie(this.name, token, {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'strict',
      path: '/',
    });
  }

  clear(res: Response): void {
    res.clearCookie(this.name, {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'strict',
      path: '/',
    });
  }
}
