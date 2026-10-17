// SAF: webview de "Çalışacak komut" önizlemesi için kullanabilir.

/**
 * PR'ın branch'ini yerelde checkout etmek için git argümanları ('git' hariç), sırayla.
 * Fork PR'ı remote-tracking ref'e (<remote>/pr/<n>) çekilir; lokal pr/<n> checkout edilmiş olsa bile fetch reddedilmez.
 */
export function prCheckoutCommands(
  pr: { number: number; headRef: string; isCrossRepository: boolean },
  localBranches: string[],
  remote = 'origin',
): string[][] {
  const locals = new Set(localBranches);
  if (!pr.isCrossRepository) {
    const tracking = `${remote}/${pr.headRef}`;
    const fetch = ['fetch', remote, `+refs/heads/${pr.headRef}:refs/remotes/${tracking}`];
    return locals.has(pr.headRef)
      ? [fetch, ['switch', pr.headRef], ['merge', '--ff-only', tracking]]
      : [fetch, ['switch', '--track', tracking]];
  }
  const local = `pr/${pr.number}`;
  const tracking = `${remote}/pr/${pr.number}`;
  const fetch = ['fetch', remote, `+refs/pull/${pr.number}/head:refs/remotes/${tracking}`];
  // --no-track: yanlışlıkla origin'e pr/<n> branch'i push edilmesin.
  return locals.has(local)
    ? [fetch, ['switch', local], ['merge', '--ff-only', tracking]]
    : [fetch, ['switch', '--no-track', '-c', local, tracking]];
}
