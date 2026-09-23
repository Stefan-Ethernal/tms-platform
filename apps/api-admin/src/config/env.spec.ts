import { loadEnv } from './env';

describe('loadEnv', () => {
  it('applies defaults', () => {
    expect(loadEnv({})).toEqual({ NODE_ENV: 'development', PORT: 3001 });
  });

  it('coerces PORT from a string', () => {
    expect(loadEnv({ PORT: '3005' }).PORT).toBe(3005);
  });

  it.each(['abc', '0', '70000', '-1', '3001.5'])('rejects PORT=%s naming the variable', (port) => {
    expect(() => loadEnv({ PORT: port })).toThrow(/PORT/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => loadEnv({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('ignores unrelated variables', () => {
    expect(loadEnv({ HOME: '/home/x', PATH: '/bin' })).toEqual({
      NODE_ENV: 'development',
      PORT: 3001,
    });
  });
});
