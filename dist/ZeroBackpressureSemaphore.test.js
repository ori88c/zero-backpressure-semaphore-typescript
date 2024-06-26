"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ZeroBackpressureSemaphore_1 = require("./ZeroBackpressureSemaphore");
/**
 * resolveFast
 *
 * The one-and-only purpose of this function, is triggerring an event-loop iteration.
 * It is relevant whenever a test needs to simulate tasks from the Node.js' micro-tasks queue.
 */
const resolveFast = async () => {
    expect(14).toBeGreaterThan(3);
};
describe('ZeroBackpressureSemaphore tests', () => {
    describe('Happy path tests', () => {
        test('waitForCompletion: should process only one job at a time, when jobs happen to be scheduled sequentially (trivial case)', async () => {
            const maxConcurrentJobs = 7;
            const semaphore = new ZeroBackpressureSemaphore_1.ZeroBackpressureSemaphore(maxConcurrentJobs);
            let finishCurrentJob;
            const numberOfJobs = 10;
            for (let jobNo = 1; jobNo <= numberOfJobs; ++jobNo) {
                expect(semaphore.isAvailable).toBeTruthy();
                expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(0);
                expect(semaphore.maxConcurrentJobs).toBe(maxConcurrentJobs);
                const jobPromise = new Promise(res => finishCurrentJob = res);
                const job = () => jobPromise;
                const waitTillCompletionPromise = semaphore.waitForCompletion(job);
                await resolveFast();
                expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(1);
                finishCurrentJob();
                await waitTillCompletionPromise;
            }
        });
        test('waitForCompletion: should process only one job at a time, when max concurrency is 1 and jobs are scheduled concurrently', async () => {
            const maxConcurrentJobs = 1;
            const lock = new ZeroBackpressureSemaphore_1.ZeroBackpressureSemaphore(maxConcurrentJobs);
            const numberOfJobs = 10;
            const jobCompletionCallbacks = [];
            const waitTillCompletionPromises = [];
            for (let jobNo = 0; jobNo < numberOfJobs; ++jobNo) {
                const jobPromise = new Promise(res => jobCompletionCallbacks[jobNo] = res);
                const job = () => jobPromise;
                // Jobs will be executed in the order on which they were registered.
                const waitPromise = lock.waitForCompletion(job);
                waitTillCompletionPromises.push(waitPromise);
            }
            for (let jobNo = 0; jobNo < numberOfJobs; ++jobNo) {
                // Just trigger the event loop.
                await Promise.race([...waitTillCompletionPromises, resolveFast()]);
                // At this stage, all jobs are pending for execution, except one which has started its execution.
                // At this stage, jobNo has started its execution.
                expect(lock.isAvailable).toBeFalsy();
                expect(lock.amountOfCurrentlyExecutingJobs).toBe(maxConcurrentJobs);
                expect(lock.maxConcurrentJobs).toBe(maxConcurrentJobs);
                // Finish current job.
                // Note: the order on which jobs will be executed, is the order on which we
                // invoke lock.waitTillCompletion.
                const finishCurrentJob = jobCompletionCallbacks[0];
                expect(finishCurrentJob).toBeDefined();
                finishCurrentJob();
                await waitTillCompletionPromises[0];
                // Evict the just-completed job.
                waitTillCompletionPromises.shift();
                jobCompletionCallbacks.shift();
            }
            expect(lock.isAvailable).toBeTruthy();
            expect(lock.amountOfCurrentlyExecutingJobs).toBe(0);
            expect(lock.maxConcurrentJobs).toBe(maxConcurrentJobs);
        });
        test('waitForCompletion: should not exceed max concurrently executing jobs, when the amont of pending jobs is bigger than the amount of rooms', async () => {
            const maxConcurrentJobs = 5;
            const numberOfJobs = 17 * maxConcurrentJobs - 1;
            const jobCompletionCallbacks = [];
            const waitTillCompletionPromises = [];
            const semaphore = new ZeroBackpressureSemaphore_1.ZeroBackpressureSemaphore(maxConcurrentJobs);
            for (let jobNo = 0; jobNo < numberOfJobs; ++jobNo) {
                const jobPromise = new Promise(res => jobCompletionCallbacks[jobNo] = res);
                const job = () => jobPromise;
                // Jobs will be executed in the order on which they were registered.
                const waitPromise = semaphore.waitForCompletion(job);
                waitTillCompletionPromises.push(waitPromise);
            }
            for (let jobNo = 0; jobNo < numberOfJobs; ++jobNo) {
                // Triggering the event loop, allowing the Semaphore to decide which jobs can
                // start their execution.
                await Promise.race([...waitTillCompletionPromises, resolveFast()]);
                // At this stage, jobs [jobNo, min(maxConcurrentJobs, jobNo + maxConcurrentJobs - 1)] are executing.
                const remainedJobs = numberOfJobs - jobNo;
                const isAvailable = remainedJobs < maxConcurrentJobs;
                const amountOfCurrentlyExecutingJobs = isAvailable ? remainedJobs : maxConcurrentJobs;
                expect(semaphore.isAvailable).toBe(isAvailable);
                expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(amountOfCurrentlyExecutingJobs);
                expect(semaphore.maxConcurrentJobs).toBe(maxConcurrentJobs);
                // Finish current job.
                // Note: the order on which jobs will be executed, is the order on which we
                // invoke lock.waitTillCompletion.
                const finishCurrentJob = jobCompletionCallbacks[0];
                expect(finishCurrentJob).toBeDefined();
                finishCurrentJob();
                await waitTillCompletionPromises[0];
                waitTillCompletionPromises.shift();
                jobCompletionCallbacks.shift();
            }
            expect(semaphore.isAvailable).toBeTruthy();
            expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(0);
            expect(semaphore.maxConcurrentJobs).toBe(maxConcurrentJobs);
        });
        test('waitForCompletion: should return the expected value when succeeds', async () => {
            const maxConcurrentJobs = 18;
            const semaphore = new ZeroBackpressureSemaphore_1.ZeroBackpressureSemaphore(maxConcurrentJobs);
            const expectedReturnValue = -1723598;
            const job = () => Promise.resolve(expectedReturnValue);
            const actualReturnValue = await semaphore.waitForCompletion(job);
            expect(actualReturnValue).toBe(expectedReturnValue);
        });
        test('waitForCompletion: should return the expected error when throws', async () => {
            const maxConcurrentJobs = 3;
            const semaphore = new ZeroBackpressureSemaphore_1.ZeroBackpressureSemaphore(maxConcurrentJobs);
            const expectedThrownError = new Error("got one less, one less");
            const job = () => Promise.reject(expectedThrownError);
            try {
                await semaphore.waitForCompletion(job);
                expect(true).toBe(false); // Necessarily fails, as it shouldn't reach here.
            }
            catch (actualThrownError) {
                expect(actualThrownError).toBe(expectedThrownError);
            }
        });
        test('waitTillAllExecutingJobsAreSettled: should resolve once all executing jobs are settled', async () => {
            const maxConcurrentJobs = 12;
            const jobCompletionCallbacks = [];
            const waitTillCompletionPromises = [];
            const semaphore = new ZeroBackpressureSemaphore_1.ZeroBackpressureSemaphore(maxConcurrentJobs);
            for (let jobNo = 0; jobNo < maxConcurrentJobs; ++jobNo) {
                const jobPromise = new Promise(res => jobCompletionCallbacks[jobNo] = res);
                const job = () => jobPromise;
                // Jobs will be executed in the order on which they were registered.
                const waitPromise = semaphore.waitForCompletion(job);
                waitTillCompletionPromises.push(waitPromise);
            }
            const waitTillAllAreSettledPromise = semaphore.waitTillAllExecutingJobsAreSettled();
            await resolveFast(); // Trigger the event loop.
            // Resolve jobs one by one.
            for (let jobNo = 0; jobNo < maxConcurrentJobs; ++jobNo) {
                // Before resolving.
                expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(maxConcurrentJobs - jobNo);
                // Resolve one job.
                jobCompletionCallbacks[jobNo]();
                await Promise.race(waitTillCompletionPromises);
                // After resolving.
                expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(maxConcurrentJobs - jobNo - 1);
                expect(semaphore.isAvailable).toBe(true);
                waitTillCompletionPromises.shift();
            }
            expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(0);
            await waitTillAllAreSettledPromise;
        });
        test('startExecution: background jobs should not exceed the max given concurrency', async () => {
            const maxConcurrentJobs = 5;
            const numberOfJobs = 6 * maxConcurrentJobs - 1;
            const jobCompletionCallbacks = [];
            const semaphore = new ZeroBackpressureSemaphore_1.ZeroBackpressureSemaphore(maxConcurrentJobs);
            // Each main iteration starts execution of the current jobNo, and completing
            // the (jobNo - maxConcurrentJobs)th job if exist, to make an available room for it.
            for (let jobNo = 0; jobNo < numberOfJobs; ++jobNo) {
                const shouldJobSucceed = jobNo % 2 === 0; // Even attempts will succeed, odd attempts will throw.
                const jobPromise = new Promise((res, rej) => jobCompletionCallbacks[jobNo] = shouldJobSucceed ?
                    () => res() :
                    () => rej(new Error("Why bad things happen to good semaphores?")));
                const job = () => jobPromise;
                // Jobs will be executed in the order on which they were registered.
                const waitTillExecutionStartsPromise = semaphore.startExecution(job);
                if (jobNo < maxConcurrentJobs) {
                    // Should start immediately.
                    await waitTillExecutionStartsPromise;
                    expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(jobNo + 1);
                    expect(semaphore.maxConcurrentJobs).toBe(maxConcurrentJobs);
                    continue;
                }
                // At this stage, jobs [jobNo - maxConcurrentJobs, jobNo - 1] are executing, whilst jobNo
                // cannot start yet (none of the currently executing ones has resulted yet).
                expect(semaphore.isAvailable).toBeFalsy();
                expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(maxConcurrentJobs);
                expect(semaphore.maxConcurrentJobs).toBe(maxConcurrentJobs);
                // Finish oldest job (began executing first, among the currently executing ones).
                const finishOldestJob = jobCompletionCallbacks[jobNo - maxConcurrentJobs];
                expect(finishOldestJob).toBeDefined();
                finishOldestJob();
                // Wait till jobNo start its execution, after we prepared a room for it.
                await waitTillExecutionStartsPromise;
            }
            // Cleaning the tail of remained last (still executing) maxConcurrentJobs jobs:
            // Each main loop completes the current job.
            const remainedJobsSuffixStart = numberOfJobs - maxConcurrentJobs;
            for (let jobNo = remainedJobsSuffixStart; jobNo < numberOfJobs; ++jobNo) {
                const finishCurrentJob = jobCompletionCallbacks[jobNo];
                expect(finishCurrentJob).toBeDefined();
                finishCurrentJob();
                // Just trigger the event loop.
                await resolveFast();
                const amountOfCurrentlyExecutingJobs = numberOfJobs - jobNo - 1;
                expect(semaphore.isAvailable).toBe(true);
                expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(amountOfCurrentlyExecutingJobs);
                expect(semaphore.maxConcurrentJobs).toBe(maxConcurrentJobs);
            }
            expect(semaphore.isAvailable).toBe(true);
            expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(0);
        });
    });
    describe('Negative path tests', () => {
        test('should throw when maxConcurrentJobs is non-positive', () => {
            expect(() => new ZeroBackpressureSemaphore_1.ZeroBackpressureSemaphore(-5)).toThrow();
            expect(() => new ZeroBackpressureSemaphore_1.ZeroBackpressureSemaphore(0)).toThrow();
        });
        test('should throw when maxConcurrentJobs is non-natural', () => {
            expect(() => new ZeroBackpressureSemaphore_1.ZeroBackpressureSemaphore(0.01)).toThrow();
            expect(() => new ZeroBackpressureSemaphore_1.ZeroBackpressureSemaphore(1.99)).toThrow();
            expect(() => new ZeroBackpressureSemaphore_1.ZeroBackpressureSemaphore(17.41)).toThrow();
        });
    });
});
//# sourceMappingURL=ZeroBackpressureSemaphore.test.js.map