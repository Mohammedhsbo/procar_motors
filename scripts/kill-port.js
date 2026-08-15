/**
 * Kill process(es) listening on a TCP port (Windows / Unix).
 * Usage: node scripts/kill-port.js [port]
 * Default port: 3000
 */
const { execSync } = require('child_process');

const port = Number(process.argv[2] || 3000);
if (!Number.isFinite(port) || port <= 0) {
  console.error('Invalid port');
  process.exit(1);
}

function killWindows(p) {
  try {
    const out = execSync(`netstat -ano | findstr :${p}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes('LISTENING')) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
        console.log(`Killed PID ${pid} on port ${p}`);
      } catch {
        /* already gone */
      }
    }
    if (!pids.size) console.log(`No LISTENING process on port ${p}`);
  } catch {
    console.log(`No LISTENING process on port ${p}`);
  }
}

function killUnix(p) {
  try {
    const out = execSync(`lsof -ti tcp:${p} -sTCP:LISTEN`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    for (const pid of out.split(/\s+/).filter(Boolean)) {
      try {
        process.kill(Number(pid), 'SIGTERM');
        console.log(`Killed PID ${pid} on port ${p}`);
      } catch {
        /* already gone */
      }
    }
  } catch {
    console.log(`No LISTENING process on port ${p}`);
  }
}

if (process.platform === 'win32') killWindows(port);
else killUnix(port);
