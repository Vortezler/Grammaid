// Runs the built extension in Waterfox via web-ext. Set WATERFOX_BIN to override the binary path.
import { spawn } from 'node:child_process';

const defaults = {
  win32: 'C:\\Program Files\\Waterfox\\waterfox.exe',
  darwin: '/Applications/Waterfox.app/Contents/MacOS/waterfox',
  linux: '/usr/bin/waterfox',
};
const bin = process.env.WATERFOX_BIN || defaults[process.platform] || defaults.linux;
const child = spawn('npx', ['web-ext', 'run', '--source-dir', 'dist', '--firefox', `"${bin}"`], {
  stdio: 'inherit',
  shell: true,
});
child.on('exit', (code) => process.exit(code ?? 0));
