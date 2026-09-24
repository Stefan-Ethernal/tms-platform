import net from 'node:net';

export type FaultMode = 'forward' | 'refuse' | 'blackhole';

export interface FaultProxy {
  /** Local port to put into DATABASE_URL instead of the real one. */
  readonly port: number;
  /** Connections accepted so far, in every mode. */
  readonly accepted: number;
  /** Switching away from `forward` also drops every open connection. */
  setMode(mode: FaultMode): void;
  close(): Promise<void>;
}

/**
 * In-process TCP proxy on 127.0.0.1 for database failure tests: `forward` pipes to `upstream`,
 * `refuse` accepts and drops at once, `blackhole` accepts and never answers (a bare `nc -l`
 * closes immediately, so a real listener that stays open and silent is needed instead).
 * Without an upstream the proxy is a black hole.
 */
export async function startFaultProxy(
  options: { upstream?: { host: string; port: number }; mode?: FaultMode } = {},
): Promise<FaultProxy> {
  const { upstream } = options;
  let mode: FaultMode = options.mode ?? (upstream ? 'forward' : 'blackhole');
  let accepted = 0;
  const sockets = new Set<net.Socket>();
  const track = (socket: net.Socket): net.Socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    return socket;
  };

  const server = net.createServer((client) => {
    accepted += 1;
    track(client);
    if (mode === 'refuse') {
      client.destroy();
      return;
    }
    if (mode === 'blackhole' || !upstream) return;
    const target = track(net.connect(upstream.port, upstream.host));
    client.pipe(target).pipe(client);
    client.on('close', () => target.destroy());
    target.on('close', () => client.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;

  return {
    port,
    get accepted() {
      return accepted;
    },
    setMode(next) {
      mode = next;
      if (next !== 'forward') for (const socket of sockets) socket.destroy();
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const socket of sockets) socket.destroy();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
