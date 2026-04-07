import net from "node:net";

export const DEFAULT_DESKTOP_SHELL_DEV_HOST = "127.0.0.1";
export const DEFAULT_DESKTOP_SHELL_DEV_PORT = 3001;

const FALLBACK_DESKTOP_SHELL_DEV_PORTS = [
  ...Array.from({ length: 10 }, (_, index) => 3301 + index),
  ...Array.from({ length: 10 }, (_, index) => 43001 + index),
];

export async function resolveDesktopShellDevPort(options = {}) {
  const host = options.host ?? DEFAULT_DESKTOP_SHELL_DEV_HOST;
  const preferredPort = normalizePort(options.preferredPort ?? DEFAULT_DESKTOP_SHELL_DEV_PORT);
  const additionalPorts = Array.isArray(options.additionalPorts) ? options.additionalPorts : [];

  if (!Number.isInteger(preferredPort) || preferredPort <= 0) {
    throw new Error(`Invalid preferred desktop-shell dev port: ${options.preferredPort}`);
  }

  const preferredProbe = await probePortAvailability(preferredPort, host);
  if (preferredProbe.available) {
    return {
      host,
      port: preferredPort,
      requestedPort: preferredPort,
      usedFallback: false,
      fallbackReason: null,
    };
  }

  const candidatePorts = dedupePorts([...additionalPorts, ...FALLBACK_DESKTOP_SHELL_DEV_PORTS]);
  for (const candidatePort of candidatePorts) {
    if (candidatePort === preferredPort) {
      continue;
    }
    const probe = await probePortAvailability(candidatePort, host);
    if (probe.available) {
      return {
        host,
        port: candidatePort,
        requestedPort: preferredPort,
        usedFallback: true,
        fallbackReason: preferredProbe.reason,
      };
    }
  }

  throw new Error(
    `Unable to find an available desktop-shell dev port for ${host}. Tried ${[
      preferredPort,
      ...candidatePorts.filter((port) => port !== preferredPort),
    ].join(", ")}.`,
  );
}

export async function probePortAvailability(port, host = DEFAULT_DESKTOP_SHELL_DEV_HOST) {
  const normalizedPort = normalizePort(port);
  if (!Number.isInteger(normalizedPort) || normalizedPort <= 0) {
    return {
      available: false,
      reason: "EINVAL",
    };
  }

  return new Promise((resolve) => {
    const server = net.createServer();
    let settled = false;

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    server.unref();
    server.on("error", (error) => {
      finish({
        available: false,
        reason: typeof error?.code === "string" ? error.code : "UNKNOWN",
      });
    });
    server.listen({ host, port: normalizedPort, exclusive: true }, () => {
      server.close((error) => {
        if (error) {
          finish({
            available: false,
            reason: typeof error?.code === "string" ? error.code : "UNKNOWN",
          });
          return;
        }
        finish({
          available: true,
          reason: null,
        });
      });
    });
  });
}

function normalizePort(port) {
  return Number.parseInt(String(port), 10);
}

function dedupePorts(ports) {
  const seen = new Set();
  const result = [];
  for (const port of ports) {
    const normalizedPort = normalizePort(port);
    if (!Number.isInteger(normalizedPort) || normalizedPort <= 0 || seen.has(normalizedPort)) {
      continue;
    }
    seen.add(normalizedPort);
    result.push(normalizedPort);
  }
  return result;
}
