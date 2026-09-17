import { execSync } from 'node:child_process';

const DEFAULT_PORT = Number(process.env.PORT || 4000);

function log(message) {
  process.stdout.write(`[clean-port] ${message}\n`);
}

function isNumericPid(value) {
  return /^\d+$/.test(String(value || ''));
}

function isEndpointOnPort(endpoint, port) {
  return Boolean(endpoint) && endpoint.endsWith(`:${port}`);
}

function parseWindowsPids(output = '', port) {
  const pids = new Set();
  const lines = output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length < 4) {
      continue;
    }

    const protocol = parts[0].toUpperCase();
    if (protocol === 'TCP') {
      const localEndpoint = parts[1];
      const pid = parts[4];
      if (isEndpointOnPort(localEndpoint, port) && isNumericPid(pid)) {
        pids.add(pid);
      }
      continue;
    }

    if (protocol === 'UDP') {
      const localEndpoint = parts[1];
      const pid = parts[parts.length - 1];
      if (isEndpointOnPort(localEndpoint, port) && isNumericPid(pid)) {
        pids.add(pid);
      }
    }
  }

  return [...pids];
}

function killPid(pid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
    } else {
      execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
    }
    log(`PID ${pid} stopped.`);
  } catch (error) {
    log(`Unable to stop PID ${pid} (${error.message}).`);
  }
}

function cleanPort(port) {
  log(`Cleaning port ${port}...`);

  if (process.platform === 'win32') {
    try {
      const output = execSync('netstat -ano', { encoding: 'utf8' });
      const pids = parseWindowsPids(output, port);
      if (!pids.length) {
        log('No process found on this port.');
        return;
      }
      pids.forEach(killPid);
    } catch (error) {
      log(`Could not inspect active ports (${error.message}).`);
    }
    return;
  }

  try {
    const output = execSync(`lsof -ti :${port}`, { encoding: 'utf8' }).trim();
    if (!output) {
      log('No process found on this port.');
      return;
    }
    [...new Set(output.split(/\s+/).filter(Boolean))].forEach(killPid);
  } catch (error) {
    log(`No process to terminate (${error.message}).`);
  }
}

cleanPort(DEFAULT_PORT);
