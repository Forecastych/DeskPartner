import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, renameSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const tauri = join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');

function run(command, args, capture = false) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? result.signal}`);
  return result.stdout;
}

const metadata = JSON.parse(run('cargo', ['metadata', '--format-version', '1', '--no-deps', '--manifest-path', 'src-tauri/Cargo.toml'], true));
const { version } = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const bundle = join(metadata.target_directory, 'release', 'bundle', 'nsis');
const normalName = `DeskPartner_${version}_x64-setup.exe`;
const normal = join(bundle, normalName);
const iris = join(bundle, `DeskPartner_IRIS_${version}_x64.exe`);

run(process.execPath, [tauri, 'build']);
const staging = mkdtempSync(join(bundle, '.standard-'));
const staged = join(staging, normalName);
renameSync(normal, staged);
try {
  run(process.execPath, [tauri, 'bundle', '--config', 'src-tauri/windows/iris-installer.json']);
  renameSync(normal, iris);
} finally {
  renameSync(staged, normal);
  rmdirSync(staging);
}
