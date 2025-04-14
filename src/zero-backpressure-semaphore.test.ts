import { ZeroBackpressureSemaphore, SemaphoreJob } from './zero-backpressure-semaphore';

type PromiseResolveCallbackType = (value?: unknown) => void;

interface CustomJobError extends Error {
  jobID: number;
}

/**
 * resolveFast
 *
 * The one-and-only purpose of this function, is triggerring an event-loop iteration.
 * It is relevant whenever a test needs to simulate tasks from the Node.js' micro-tasks queue.
 */
const resolveFast = async () => {
  expect(14).toBeGreaterThan(3);
};

const delay = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

describe('ZeroBackpressureSemaphore tests', () => {
  describe('Happy path tests', () => {
    // prettier-ignore
    test(
      'waitForCompletion: should process only one job at a time, ' +
      'when jobs happen to be scheduled sequentially (trivial case)',
      async () => {
        const maxConcurrentJobs = 7;
        const semaphore = new ZeroBackpressureSemaphore<void>(maxConcurrentJobs);
        let completeCurrentJob: PromiseResolveCallbackType;
        const numberOfJobs = 10;

        for (let ithJob = 0; ithJob < numberOfJobs; ++ithJob) {
          expect(semaphore.isAvailable).toBeTruthy();
          expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(0);
          expect(semaphore.maxConcurrentJobs).toBe(maxConcurrentJobs);

          const jobPromise = new Promise<void>((res) => (completeCurrentJob = res));
          const job = () => jobPromise;
          const waitForCompletionPromise: Promise<void> = semaphore.waitForCompletion(job);
          await Promise.race([waitForCompletionPromise, resolveFast()]);
          expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(1);

          // Trigger the completion of the current job.
          completeCurrentJob();
          await waitForCompletionPromise;
        }

        expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(0);
        expect(semaphore.amountOfUncaughtErrors).toBe(0);
      },
    );

    // prettier-ignore
    test(
      'waitForCompletion: should process only one job at a time, ' +
      'when max concurrency is 1 and jobs are scheduled concurrently',
      async () => {
        const maxConcurrentJobs = 1;
        const lock = new ZeroBackpressureSemaphore<void>(maxConcurrentJobs);
        const numberOfJobs = 10;
        const jobCompletionCallbacks: PromiseResolveCallbackType[] = [];
        const waitForCompletionPromises: Promise<void>[] = [];

        // Create a burst of jobs, inducing backpressure on the semaphore.
        for (let ithJob = 0; ithJob < numberOfJobs; ++ithJob) {
          const jobPromise = new Promise<void>((res) => (jobCompletionCallbacks[ithJob] = res));
          const job: SemaphoreJob<void> = () => jobPromise;

          // Jobs will be executed in the order in which they were registered.
          waitForCompletionPromises.push(lock.waitForCompletion(job));

          // Trigger the event loop to allow the semaphore to evaluate if the current job
          // can begin execution.
          // Based on this test's configuration, only the first job will be allowed to start.
          await Promise.race([
            waitForCompletionPromises[waitForCompletionPromises.length - 1],
            resolveFast(),
          ]);
        }

        for (let ithJob = 0; ithJob < numberOfJobs; ++ithJob) {
          // At this stage, all jobs are pending for execution, except one which has started.

          // At this stage, the ithJob has started its execution.
          expect(lock.isAvailable).toBe(false);
          expect(lock.amountOfCurrentlyExecutingJobs).toBe(1);
          expect(lock.maxConcurrentJobs).toBe(maxConcurrentJobs);

          // Complete the current job.
          // Note: the order in which jobs start execution corresponds to the order in which
          // `waitForCompletion` was invoked.
          const finishCurrentJob = jobCompletionCallbacks[ithJob];
          expect(finishCurrentJob).toBeDefined();
          finishCurrentJob();
          await waitForCompletionPromises[ithJob];
        }

        expect(lock.isAvailable).toBe(true);
        expect(lock.amountOfCurrentlyExecutingJobs).toBe(0);
        expect(lock.maxConcurrentJobs).toBe(maxConcurrentJobs);
        expect(lock.amountOfUncaughtErrors).toBe(0);
      },
    );

    // prettier-ignore
    test(
      'waitForCompletion: should not exceed max concurrently executing jobs, ' +
      'when the amont of pending jobs is bigger than the amount of slots',
      async () => {
        const maxConcurrentJobs = 5;
        const numberOfJobs = 17 * maxConcurrentJobs - 1;
        const jobCompletionCallbacks: PromiseResolveCallbackType[] = [];
        const waitForCompletionPromises: Promise<void>[] = [];

        const semaphore = new ZeroBackpressureSemaphore<void>(maxConcurrentJobs);

        // Create a burst of jobs, inducing backpressure on the semaphore.
        for (let ithJob = 0; ithJob < numberOfJobs; ++ithJob) {
          const jobPromise = new Promise<void>((res) => (jobCompletionCallbacks[ithJob] = res));
          const job: SemaphoreJob<void> = () => jobPromise;

          // Jobs will be executed in the order in which they were registered.
          waitForCompletionPromises.push(semaphore.waitForCompletion(job));

          // Triggering the event loop, allowing the semaphore to decide which jobs can
          // start their execution. Based on this test's configuration, only the first
          // `maxConcurrentJobs` jobs will be allowed to start.
          await Promise.race([
            waitForCompletionPromises[waitForCompletionPromises.length - 1],
            resolveFast(),
          ]);
        }

        for (let ithJob = 0; ithJob < numberOfJobs; ++ithJob) {
          // At this stage, jobs [ithJob, min(maxConcurrentJobs, ithJob + maxConcurrentJobs - 1)]
          // are executing.
          const remainedJobs = numberOfJobs - ithJob;
          const isAvailable = remainedJobs < maxConcurrentJobs;
          const amountOfCurrentlyExecutingJobs = isAvailable ? remainedJobs : maxConcurrentJobs;
          expect(semaphore.isAvailable).toBe(isAvailable);
          expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(amountOfCurrentlyExecutingJobs);
          expect(semaphore.maxConcurrentJobs).toBe(maxConcurrentJobs);

          // Complete the current job.
          // Note: the order in which jobs start execution corresponds to the order in which
          // `waitForCompletion` was invoked.
          const finishCurrentJob = jobCompletionCallbacks[ithJob];
          expect(finishCurrentJob).toBeDefined();
          finishCurrentJob();
          await waitForCompletionPromises[ithJob];
        }

        expect(semaphore.isAvailable).toBe(true);
        expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(0);
        expect(semaphore.maxConcurrentJobs).toBe(maxConcurrentJobs);
        expect(semaphore.amountOfUncaughtErrors).toBe(0);
      },
    );

    test('waitForCompletion: should return the expected value when succeeds', async () => {
      const maxConcurrentJobs = 18;
      const semaphore = new ZeroBackpressureSemaphore<number>(maxConcurrentJobs);
      const expectedReturnValue = -1723598;
      const job: SemaphoreJob<number> = () => Promise.resolve(expectedReturnValue);

      const actualReturnValue = await semaphore.waitForCompletion(job);

      expect(actualReturnValue).toBe(expectedReturnValue);
      expect(semaphore.amountOfUncaughtErrors).toBe(0);
    });

    test('waitForCompletion: should return the expected error when throws', async () => {
      const maxConcurrentJobs = 3;
      const semaphore = new ZeroBackpressureSemaphore<number>(maxConcurrentJobs);
      const expectedThrownError = new Error('mock error');
      const job: SemaphoreJob<number> = () => Promise.reject(expectedThrownError);

      try {
        await semaphore.waitForCompletion(job);
        expect(true).toBe(false); // The flow should not reach this point.
      } catch (actualThrownError) {
        expect(actualThrownError).toBe(expectedThrownError);
        expect(actualThrownError.message).toEqual(expectedThrownError.message);
      }

      // The semaphore stores uncaught errors only for background jobs triggered by
      // `startExecution`.
      expect(semaphore.amountOfUncaughtErrors).toBe(0);
    });

    // prettier-ignore
    test(
      'waitForAllExecutingJobsToComplete should resolve once all executing jobs have completed: ' +
      'Jobs are resolved in FIFO order in this test',
      async () => {
        const maxConcurrentJobs = 56;
        const jobCompletionCallbacks: PromiseResolveCallbackType[] = [];
        const waitForCompletionPromises: Promise<void>[] = [];

        const semaphore = new ZeroBackpressureSemaphore<void>(maxConcurrentJobs);

        for (let ithJob = 0; ithJob < maxConcurrentJobs; ++ithJob) {
          const jobPromise = new Promise<void>((res) => (jobCompletionCallbacks[ithJob] = res));
          const job: SemaphoreJob<void> = () => jobPromise;

          // Jobs will be executed in the order in which they were registered.
          waitForCompletionPromises.push(semaphore.waitForCompletion(job));

          // Trigger the event loop.
          await Promise.race([
            waitForCompletionPromises[waitForCompletionPromises.length - 1],
            resolveFast(),
          ]);
        }

        // At this point, the semaphore should be fully utilized.
        expect(semaphore.isAvailable).toBe(false);

        let allJobsCompleted = false;
        const waitForAllExecutingJobsToCompletePromise: Promise<void> = (async () => {
          await semaphore.waitForAllExecutingJobsToComplete();
          allJobsCompleted = true;
        })();
        // Trigger the event loop to verify that allJobsCompleted remains false.
        await Promise.race([waitForAllExecutingJobsToCompletePromise, resolveFast()]);

        // Resolve jobs one by one.
        for (let ithJob = 0; ithJob < maxConcurrentJobs; ++ithJob) {
          // Before resolving.
          expect(allJobsCompleted).toBe(false);
          expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(maxConcurrentJobs - ithJob);

          // Resolve one job.
          jobCompletionCallbacks[ithJob]();
          await Promise.race([
            waitForAllExecutingJobsToCompletePromise,
            waitForCompletionPromises[ithJob], // Always wins the race, except potentially in the last iteration.
          ]);

          // After resolving.
          expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(maxConcurrentJobs - ithJob - 1);
          expect(semaphore.isAvailable).toBe(true);
        }

        await waitForAllExecutingJobsToCompletePromise;
        expect(allJobsCompleted).toBe(true);
        expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(0);
        expect(semaphore.amountOfUncaughtErrors).toBe(0);
      },
    );

    // prettier-ignore
    test(
      'waitForAllExecutingJobsToComplete should resolve once all executing jobs have completed: ' +
      'Jobs are resolved in FILO order in this test',
      async () => {
        // FILO order for job completion times is less likely in real life, but it’s a good
        // edge case to test.
        // It ensures the semaphore can maintain a reference to an old job, even if its execution
        // time exceeds all others.
        const maxConcurrentJobs = 47;
        const jobCompletionCallbacks: PromiseResolveCallbackType[] = [];
        const waitForCompletionPromises: Promise<void>[] = [];

        const semaphore = new ZeroBackpressureSemaphore<void>(maxConcurrentJobs);

        for (let ithJob = 0; ithJob < maxConcurrentJobs; ++ithJob) {
          const jobPromise = new Promise<void>((res) => (jobCompletionCallbacks[ithJob] = res));
          const job: SemaphoreJob<void> = () => jobPromise;

          // Jobs will be executed in the order in which they were registered.
          waitForCompletionPromises.push(semaphore.waitForCompletion(job));

          // Trigger the event loop.
          await Promise.race([
            waitForCompletionPromises[waitForCompletionPromises.length - 1],
            resolveFast(),
          ]);
        }

        // At this point, the semaphore should be fully utilized.
        expect(semaphore.isAvailable).toBe(false);

        let allJobsCompleted = false;
        const waitForAllExecutingJobsToCompletePromise: Promise<void> = (async () => {
          await semaphore.waitForAllExecutingJobsToComplete();
          allJobsCompleted = true;
        })();
        // Trigger the event loop to verify that allJobsCompleted remains false.
        await Promise.race([waitForAllExecutingJobsToCompletePromise, resolveFast()]);

        // Resolve jobs one by one.
        let expectedAmountOfCurrentlyExecutingJobs = maxConcurrentJobs;
        for (let ithJob = maxConcurrentJobs - 1; ithJob >= 0; --ithJob) {
          // Before resolving.
          expect(allJobsCompleted).toBe(false);
          expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(
            expectedAmountOfCurrentlyExecutingJobs,
          );

          // Resolve one job.
          jobCompletionCallbacks.pop()();
          await Promise.race([
            waitForAllExecutingJobsToCompletePromise,
            waitForCompletionPromises.pop(), // Always wins the race, except potentially in the last iteration.
          ]);
          --expectedAmountOfCurrentlyExecutingJobs;

          // After resolving.
          expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(
            expectedAmountOfCurrentlyExecutingJobs,
          );
          expect(semaphore.isAvailable).toBe(true);
        }

        await waitForAllExecutingJobsToCompletePromise;
        expect(allJobsCompleted).toBe(true);
        expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(0);
        expect(semaphore.amountOfUncaughtErrors).toBe(0);
      },
    );

    // prettier-ignore
    test(
      'waitForAllExecutingJobsToComplete with the considerPendingJobsBackpressure flag set should ' +
      'resolve once all executing jobs and pending jobs (i.e., backpressure) have completed',
      async () => {
        jest.useFakeTimers();
        const maxConcurrentJobs = 24;
        const considerPendingJobsBackpressure = true;
        const fullConcurrencyCycles = 35;
        const lastCycleConcurrency = 9;
        const numberOfJobs = fullConcurrencyCycles * maxConcurrentJobs + lastCycleConcurrency;
        const jobDurationMs = 4000;
        const semaphore = new ZeroBackpressureSemaphore<void>(maxConcurrentJobs);
        let completedJobsCounter = 0;
        const job = async (): Promise<void> => {
          await delay(jobDurationMs);
          ++completedJobsCounter;
        };

        for (let ithJob = 0; ithJob < maxConcurrentJobs; ++ithJob) {
          // We do not await here, but in practice, the caller should await the result before
          // proceeding. The `waitForCompletion` method is typically used by multiple independent
          // callers.
          semaphore.waitForCompletion(job);
        }

        // We intentionally create the `waitForAllExecutingJobsToComplete` promise before adding
        // pending jobs, which cannot be executed immediately. By using the `considerPendingJobsBackpressure`
        // flag, the method will account for existing or future backpressure, even if it arises *after*
        // the method is invoked.
        let allJobsCompleted = false;
        const allJobsCompletedPromise = (async () => {
          await semaphore.waitForAllExecutingJobsToComplete(considerPendingJobsBackpressure);
          allJobsCompleted = true;
        })();

        // Induce backpressure of pending jobs.
        for (let ithJob = maxConcurrentJobs; ithJob < numberOfJobs; ++ithJob) {
          semaphore.waitForCompletion(job);
        }

        for (let ithCycle = 1; ithCycle <= fullConcurrencyCycles; ++ithCycle) {
          // Ensure that `waitForAllExecutingJobsToComplete` does not resolve prematurely.
          expect(allJobsCompleted).toBe(false);

          await Promise.race([
            jest.advanceTimersByTimeAsync(jobDurationMs), // The race winner.
            allJobsCompletedPromise,
          ]);
          expect(completedJobsCounter).toBe(ithCycle * maxConcurrentJobs);
        }

        // The final cycle does not use the full concurrency capacity.
        expect(allJobsCompleted).toBe(false);
        await jest.advanceTimersByTimeAsync(jobDurationMs);
        await allJobsCompletedPromise;
        expect(allJobsCompleted).toBe(true);
        expect(completedJobsCounter).toBe(numberOfJobs);

        jest.restoreAllMocks();
        jest.useRealTimers();
      },
    );

    test('startExecution: background jobs should not exceed the max given concurrency', async () => {
      const maxConcurrentJobs = 5;
      const numberOfJobs = 6 * maxConcurrentJobs - 1;
      const jobCompletionCallbacks: (() => void)[] = [];
      const semaphore = new ZeroBackpressureSemaphore<void>(maxConcurrentJobs);

      // Each main iteration starts execution of the current ithJob, and completes the
      // (ithJob - maxConcurrentJobs)th job if it exists, to free up a slot for the newly added job.
      // To validate complex scenarios, even-numbered jobs will succeed while odd-numbered jobs
      // will throw exceptions. From the semaphore's perspective, a completed job should release
      // its associated slot, regardless of whether it completed successfully or failed.
      let numberOfFailedJobs = 0;
      for (let ithJob = 0; ithJob < numberOfJobs; ++ithJob) {
        const shouldJobSucceed = ithJob % 2 === 0;
        if (!shouldJobSucceed) {
          ++numberOfFailedJobs;
        }

        // prettier-ignore
        const jobPromise = new Promise<void>((res, rej) => {
          jobCompletionCallbacks[ithJob] = shouldJobSucceed
            ? () => res()
            : () => rej(new Error('Why bad things happen to good semaphores?'));
        });
        const job: SemaphoreJob<void> = () => jobPromise;

        // Jobs will be executed in the order in which they were registered.
        const waitUntilExecutionStartsPromise = semaphore.startExecution(job);

        if (ithJob < maxConcurrentJobs) {
          // Should start immediately.
          await waitUntilExecutionStartsPromise;
          expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(ithJob + 1);
          expect(semaphore.maxConcurrentJobs).toBe(maxConcurrentJobs);
          continue;
        }

        // At this stage, jobs [ithJob - maxConcurrentJobs, jobNo - 1] are executing,
        // while the ithJob cannot start yet (none of the currently executing ones has completed).
        expect(semaphore.isAvailable).toBe(false);
        expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(maxConcurrentJobs);
        expect(semaphore.maxConcurrentJobs).toBe(maxConcurrentJobs);

        // Complete the oldest job (the first to begin execution among the currently running jobs),
        // to free up an execution slot.
        const completeOldestJob = jobCompletionCallbacks[ithJob - maxConcurrentJobs];
        expect(completeOldestJob).toBeDefined();
        completeOldestJob();

        // After ensuring there is an available slot for the current job, wait until
        // it starts execution.
        await waitUntilExecutionStartsPromise;
      }

      // Completing the remaining "tail" of still-executing jobs:
      // Each iteration of the main loop completes the current job.
      const remainedJobsSuffixStart = numberOfJobs - maxConcurrentJobs;
      let expectedAmountOfCurrentlyExecutingJobs = maxConcurrentJobs;
      for (let ithJob = remainedJobsSuffixStart; ithJob < numberOfJobs; ++ithJob) {
        const completeCurrentJob = jobCompletionCallbacks[ithJob];
        expect(completeCurrentJob).toBeDefined();
        completeCurrentJob();

        // Trigger the event loop.
        await resolveFast();
        --expectedAmountOfCurrentlyExecutingJobs;

        expect(semaphore.isAvailable).toBe(true);
        expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(
          expectedAmountOfCurrentlyExecutingJobs,
        );
        expect(semaphore.maxConcurrentJobs).toBe(maxConcurrentJobs);
      }

      expect(semaphore.isAvailable).toBe(true);
      expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(0);
      expect(semaphore.amountOfUncaughtErrors).toBe(numberOfFailedJobs);
    });

    test('waitForAvailability: should resolve once at least one slot is available', async () => {
      const maxConcurrentJobs = 11;
      const jobCompletionCallbacks: PromiseResolveCallbackType[] = [];

      const semaphore = new ZeroBackpressureSemaphore<void>(maxConcurrentJobs);

      for (let ithJob = 0; ithJob < maxConcurrentJobs; ++ithJob) {
        expect(semaphore.isAvailable).toBe(true);
        const jobPromise = new Promise<void>((res) => (jobCompletionCallbacks[ithJob] = res));
        await semaphore.startExecution(() => jobPromise); // Should resolve immediately.
      }

      expect(semaphore.isAvailable).toBe(false);

      let finishedWaitingForAvailability = false;
      const waitForAvailabilityPromise = (async (): Promise<void> => {
        await semaphore.waitForAvailability();
        finishedWaitingForAvailability = true;
      })();

      // Perform some event loop iterations, without resolving any ongoing semaphore job.
      // We expect `waitForAvailabilityPromise` to not be resolved.
      const numberOfEventLoopIterationsWithoutExpectedChange = 197;
      for (
        let eventLoopIteration = 0;
        eventLoopIteration < numberOfEventLoopIterationsWithoutExpectedChange;
        ++eventLoopIteration
      ) {
        await Promise.race([waitForAvailabilityPromise, resolveFast()]);
        expect(semaphore.isAvailable).toBe(false);
        expect(finishedWaitingForAvailability).toBe(false);
      }

      // Resolve one random job.
      const randomJobIndexToResolveFirst = Math.floor(Math.random() * maxConcurrentJobs);
      jobCompletionCallbacks[randomJobIndexToResolveFirst]();
      const deleteCount = 1;
      jobCompletionCallbacks.splice(randomJobIndexToResolveFirst, deleteCount);

      // Now, we expect the semaphore to become available.
      await waitForAvailabilityPromise;
      expect(semaphore.isAvailable).toBe(true);
      expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(maxConcurrentJobs - 1);
      expect(finishedWaitingForAvailability).toBe(true);

      // Clean pending promises.
      for (const jobCompletionCallback of jobCompletionCallbacks) {
        jobCompletionCallback();
      }

      await semaphore.waitForAllExecutingJobsToComplete();
      expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(0);
    });

    // prettier-ignore
    test(
      'when _waitForAvailableSlot resolves, its awaiters should be executed according to ' +
      'their order in the microtasks queue', async () => {
      // This test does not directly assess the semaphore component. Instead, it verifies the
      // correctness of the slot-acquire mechanism, ensuring it honors the FIFO order of callers
      // requesting an available slot.
      // In JavaScript, it is common for a caller to create a promise (as the sole owner of
      // this promise instance) and await its resolution. It is less common for multiple promises
      // to await concurrently on the same shared promise instance. In that scenario, a pertinent
      // question arises:
      // In which *order* will the multiple awaiters be executed?
      // Short answer: according to their order in the Node.js microtasks queue.
      // Long answer:
      // When a promise is resolved, the callbacks attached to it (other promises awaiting
      // its resolution) are *queued* as microtasks. Therefore, if multiple awaiters are waiting on
      // the same shared promise instance, and the awaiters were created in a *specific* order, the
      // first awaiter will be executed first once the shared promise is resolved. This is because
      // adding a microtask (such as an async function awaiting a promise) ensures its position in
      // the microtasks queue, guaranteeing its execution before subsequent microtasks in the queue.
      // This holds true for any position, i.e., it can be generalized.

      // In the following test, a relatively large number of awaiters is chosen. The motive is
      // to observe statistical errors, which should *not* exist regardless of the input size.
      const numberOfAwaiters = 384;
      const actualExecutionOrderOfAwaiters: number[] = [];

      // This specific usage of one promise instance being awaited by multiple other promises
      // may remind those with a C++ background of a condition_variable.
      let notifyAvailableSlotExists: PromiseResolveCallbackType;
      const waitForAvailableSlot = new Promise((res) => (notifyAvailableSlotExists = res));

      const awaiterAskingForSlot = async (awaiterID: number): Promise<void> => {
        await waitForAvailableSlot;
        actualExecutionOrderOfAwaiters.push(awaiterID);
        // Other awaiters in the microtasks queue will now be notified about the
        // fulfillment of 'waitForAvailableSlot'.
      };

      const expectedExecutionOrder: number[] = [];
      const awaiterPromises: Promise<void>[] = [];
      for (let awaiterID = 0; awaiterID < numberOfAwaiters; ++awaiterID) {
        expectedExecutionOrder.push(awaiterID);
        awaiterPromises.push(awaiterAskingForSlot(awaiterID));
      }

      // Initially, no awaiter should be able to make progress.
      await Promise.race([...awaiterPromises, resolveFast()]);
      expect(actualExecutionOrderOfAwaiters.length).toBe(0);

      // Notify that a slot is available, triggering the awaiters in order.
      notifyAvailableSlotExists();
      await Promise.all(awaiterPromises);

      // The execution order should match the expected order.
      expect(actualExecutionOrderOfAwaiters).toEqual(expectedExecutionOrder);
    });
  });

  describe('Negative path tests', () => {
    test('should throw when maxConcurrentJobs is non-positive', () => {
      expect(() => new ZeroBackpressureSemaphore<void>(-5)).toThrow();
      expect(() => new ZeroBackpressureSemaphore<void>(0)).toThrow();
    });

    test('should throw when maxConcurrentJobs is non-natural', () => {
      expect(() => new ZeroBackpressureSemaphore<void>(0.01)).toThrow();
      expect(() => new ZeroBackpressureSemaphore<void>(1.99)).toThrow();
      expect(() => new ZeroBackpressureSemaphore<void>(17.41)).toThrow();
    });

    test('should capture uncaught errors from background jobs triggered by startExecution', async () => {
      const maxConcurrentJobs = 17;
      const numberOfJobs = maxConcurrentJobs + 18;
      const jobErrors: CustomJobError[] = [];
      const semaphore = new ZeroBackpressureSemaphore<void>(maxConcurrentJobs);

      for (let ithJob = 0; ithJob < numberOfJobs; ++ithJob) {
        const error: CustomJobError = {
          name: 'CustomJobError',
          message: `Job no. ${ithJob} has failed`,
          jobID: ithJob,
        };
        jobErrors.push(error);

        await semaphore.startExecution(async () => {
          throw error;
        });
      }

      await semaphore.waitForAllExecutingJobsToComplete();

      expect(semaphore.amountOfUncaughtErrors).toBe(numberOfJobs);
      expect(semaphore.extractUncaughtErrors()).toEqual(jobErrors);
      // Following extraction, the semaphore no longer holds the error references.
      expect(semaphore.amountOfUncaughtErrors).toBe(0);
      expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(0);
    });
  });
});
