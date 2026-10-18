import { mkdtemp, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runGit } from '../src/git/gitRunner';
import { countLines, listTrackedFiles } from '../src/git/lineCounter';

describe('lineCounter', () => {
  let dir = '';

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'gitatlas-revrev-lines-'));
    await runGit(['init', '-q', '-b', 'main'], dir);
    await mkdir(path.join(dir, 'src', 'alt klasör'), { recursive: true });
    await writeFile(path.join(dir, 'three.txt'), 'a\nb\nc\n');
    await writeFile(path.join(dir, 'no-eol.txt'), 'a\nb');
    await writeFile(path.join(dir, 'empty.txt'), '');
    await writeFile(path.join(dir, 'crlf.txt'), 'a\r\nb\r\n');
    await writeFile(path.join(dir, 'src', 'alt klasör', 'çalışma.ts'), 'x\n');
    await writeFile(path.join(dir, 'bin.dat'), Buffer.from([65, 0, 66, 10]));
    // NUL 8000. byte'tan sonra: metin sayılır.
    await writeFile(path.join(dir, 'late-nul.txt'), Buffer.concat([Buffer.from('x\n'.repeat(4000)), Buffer.from([0])]));
    await writeFile(path.join(dir, 'gone.txt'), 'silinecek\n');
    await runGit(['-c', 'core.autocrlf=false', 'add', '-A'], dir);
    await unlink(path.join(dir, 'gone.txt'));
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  it('listTrackedFiles "/" ayraçlı, tırnaksız yollar döner', async () => {
    const files = await listTrackedFiles(dir);
    expect(files.sort()).toEqual(
      ['bin.dat', 'crlf.txt', 'empty.txt', 'gone.txt', 'late-nul.txt', 'no-eol.txt', 'src/alt klasör/çalışma.ts', 'three.txt'].sort(),
    );
  });

  it('countLines: binary ve silinmiş dosyayı atlar, satırları doğru sayar', async () => {
    const files = await listTrackedFiles(dir);
    const counts = await countLines(dir, [...files, 'hiç-yok.txt']);
    expect(counts).toEqual({
      'three.txt': 3,
      'no-eol.txt': 2,
      'empty.txt': 0,
      'crlf.txt': 2,
      'src/alt klasör/çalışma.ts': 1,
      'late-nul.txt': 4001,
    });
    expect('bin.dat' in counts).toBe(false);
    expect('gone.txt' in counts).toBe(false);
  });

  it('boş liste', async () => {
    expect(await countLines(dir, [])).toEqual({});
  });
});
