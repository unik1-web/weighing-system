import { spawnSync } from 'node:child_process';

const pythonArgs = process.argv.slice(2);

if (pythonArgs.length === 0) {
  console.error('Usage: node run-python.mjs <python-args...>');
  process.exit(1);
}

const candidates = process.platform === 'win32'
  ? [
      ['py', ['-3', ...pythonArgs]],
      ['python', pythonArgs],
      ['python3', pythonArgs],
    ]
  : [
      ['python3', pythonArgs],
      ['python', pythonArgs],
      ['py', ['-3', ...pythonArgs]],
    ];

for (const [command, args] of candidates) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (!result.error) {
    process.exit(result.status ?? 0);
  }

  if (result.error.code !== 'ENOENT') {
    throw result.error;
  }
}

console.error(
  `Python interpreter not found. Tried: ${candidates.map(([command]) => command).join(', ')}`,
);
process.exit(1);
