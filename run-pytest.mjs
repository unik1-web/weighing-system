import { spawnSync } from 'node:child_process';

const pytestArgs = process.argv.slice(2);
const candidates = process.platform === 'win32'
  ? [
      ['py', ['-3', '-m', 'pytest', ...pytestArgs]],
      ['python', ['-m', 'pytest', ...pytestArgs]],
      ['python3', ['-m', 'pytest', ...pytestArgs]],
    ]
  : [
      ['python3', ['-m', 'pytest', ...pytestArgs]],
      ['python', ['-m', 'pytest', ...pytestArgs]],
      ['py', ['-3', '-m', 'pytest', ...pytestArgs]],
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
