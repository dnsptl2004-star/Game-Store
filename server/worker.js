import { processGameJob } from "./gameExtractor.js";
import Game from "./models/Game.js";

class ProcessingQueue {
  constructor(concurrency = 2) {
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
  }

  enqueue(jobData) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        jobData,
        resolve,
        reject,
        enqueuedAt: new Date(),
      });
      console.log(`[WORKER] Job enqueued for ${jobData.gameId}. Queue length: ${this.queue.length}`);
      this.next();
    });
  }

  async next() {
    if (this.running >= this.concurrency || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift();
    this.running++;

    try {
      const result = await processGameJob(item.jobData);
      item.resolve(result);
    } catch (err) {
      item.reject(err);
    } finally {
      this.running--;
      this.next();
    }
  }

  /**
   * Recovers any games left interrupted in 'verifying' or 'extracting' state
   */
  async recoverInterruptedJobs() {
    try {
      const pending = await Game.find({
        status: { $in: ["verifying", "extracting"] },
      });
      for (const game of pending) {
        if (game.uploadId) {
          console.log(`[WORKER] Recovering interrupted game: ${game.id} (${game.title})`);
          this.enqueue({
            gameId: game.id,
            uploadId: game.uploadId,
            title: game.title,
            ownerId: game.ownerId,
            sizeBytes: game.sizeBytes,
            metadata: {
              logoUrl: game.logoUrl,
              coverImage: game.coverImage,
              description: game.description,
              version: game.version,
              systemRequirements: game.systemRequirements,
            },
          }).catch((err) => {
            console.error(`[WORKER] Recovery error for ${game.id}:`, err.message);
          });
        }
      }
    } catch (err) {
      console.warn("[WORKER] Error checking interrupted jobs:", err.message);
    }
  }
}

export const processingQueue = new ProcessingQueue(2);

export default processingQueue;
