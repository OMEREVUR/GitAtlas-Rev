import { randomBytes } from 'node:crypto';
import { chmod, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

// Token betiğe yazılmaz; betik RR_ASKPASS_TOKEN ortam değişkenini basar.
const CMD_SCRIPT = [
  '@echo off',
  'setlocal EnableDelayedExpansion',
  'set "RR_PROMPT=%~1"',
  'if /i "!RR_PROMPT:~0,8!"=="Username" (',
  '  echo x-access-token',
  ') else (',
  '  echo(!RR_ASKPASS_TOKEN!',
  ')',
  '',
].join('\r\n');

const SH_SCRIPT = [
  '#!/bin/sh',
  'case "$1" in',
  '  Username*|username*) printf "%s\\n" "x-access-token" ;;',
  '  *) printf "%s\\n" "$RR_ASKPASS_TOKEN" ;;',
  'esac',
  '',
].join('\n');

/** push/pull için GIT_ASKPASS yedeği: kullanıcı adı "x-access-token", parola token. */
export async function createAskpassEnv(token: string): Promise<{ env: Record<string, string>; dispose: () => Promise<void> }> {
  const win = process.platform === 'win32';
  const file = path.join(os.tmpdir(), `rewiewrev-askpass-${randomBytes(8).toString('hex')}${win ? '.cmd' : '.sh'}`);
  await writeFile(file, win ? CMD_SCRIPT : SH_SCRIPT, { encoding: 'utf8', mode: 0o700 });
  if (!win) await chmod(file, 0o700);
  return {
    env: { GIT_ASKPASS: file, RR_ASKPASS_TOKEN: token, GIT_TERMINAL_PROMPT: '0' },
    dispose: () => rm(file, { force: true }),
  };
}
