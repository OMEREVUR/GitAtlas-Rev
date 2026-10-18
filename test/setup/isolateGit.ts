import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Testler makinenin git ayarlarından etkilenmesin: sistem ayarı okunmaz, global ayar yerine
// yalnızca kimliği içeren geçici bir dosya kullanılır (url.insteadOf, init.defaultBranch,
// core.autocrlf, commit.gpgsign gibi ayarlar sonucu değiştirmesin; CI'da kimlik de olsun).
const dir = path.join(os.tmpdir(), 'gitatlas-rev-test-git');
mkdirSync(dir, { recursive: true });
const globalConfig = path.join(dir, 'gitconfig');
writeFileSync(globalConfig, '[user]\n\tname = Test\n\temail = test@example.com\n[commit]\n\tgpgsign = false\n[tag]\n\tgpgsign = false\n');

process.env.GIT_CONFIG_GLOBAL = globalConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';
delete process.env.GIT_CONFIG_PARAMETERS;
delete process.env.GIT_CONFIG_COUNT;
