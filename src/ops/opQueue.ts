// Yazma işlemlerini sıraya sokan basit kuyruk: aynı anda tek işlem çalışır, sıradakiler bekler.

export type BusyListener = (busy: boolean) => void;

export class OpQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private readonly listeners: BusyListener[] = [];

  /** Kuyruğa iş ekler; önceki işler bitince (başarılı ya da hatalı) çalışır. */
  run<T>(fn: () => Promise<T>): Promise<T> {
    this.setPending(this.pending + 1);
    const result = this.tail.then(fn);
    this.tail = result.then(
      () => this.setPending(this.pending - 1),
      () => this.setPending(this.pending - 1),
    );
    return result;
  }

  /** Çalışan ya da bekleyen işlem var mı? */
  get busy(): boolean {
    return this.pending > 0;
  }

  /** busy değiştiğinde çağrılır; aboneliği kaldıran fonksiyonu döner. */
  onDidChangeBusy(listener: BusyListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  private setPending(n: number): void {
    const was = this.busy;
    this.pending = n;
    if (was !== this.busy) for (const l of [...this.listeners]) l(this.busy);
  }
}
