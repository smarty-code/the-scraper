/**
 * A simple, lightweight, and typed FIFO Task Queue with concurrency control.
 * Ideal for serializing browser automation requests.
 */
export class TaskQueue {
  private queue: (() => Promise<void>)[] = [];
  private activeCount = 0;
  private concurrency: number;

  constructor(concurrency = 1) {
    this.concurrency = concurrency;
  }

  /**
   * Adds an asynchronous task to the queue and returns its promise.
   * 
   * @param task A function that returns a Promise
   */
  public async add<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await task();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      this.next();
    });
  }

  /**
   * Processes the next task in the queue if concurrency limit allows.
   */
  private next() {
    if (this.activeCount >= this.concurrency || this.queue.length === 0) {
      return;
    }

    this.activeCount++;
    const nextTask = this.queue.shift()!;

    nextTask().finally(() => {
      this.activeCount--;
      this.next();
    });
  }

  /**
   * Returns the number of tasks waiting in the queue.
   */
  public getPendingLength(): number {
    return this.queue.length;
  }

  /**
   * Returns the number of currently running tasks.
   */
  public getActiveCount(): number {
    return this.activeCount;
  }
}
