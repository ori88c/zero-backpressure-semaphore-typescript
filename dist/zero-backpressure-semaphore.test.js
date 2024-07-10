"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const zero_backpressure_semaphore_1 = require("./zero-backpressure-semaphore");
/**
 * resolveFast
 *
 * The one-and-only purpose of this function, is triggerring an event-loop iteration.
 * It is relevant whenever a test needs to simulate tasks from the Node.js' micro-tasks queue.
 */
const resolveFast = () => __awaiter(void 0, void 0, void 0, function* () {
    expect(14).toBeGreaterThan(3);
});
describe('ZeroBackpressureSemaphore tests', () => {
    describe('Happy path tests', () => {
        test('waitForCompletion: should process only one job at a time, when jobs happen to be scheduled sequentially (trivial case)', () => __awaiter(void 0, void 0, void 0, function* () {
            const maxConcurrentJobs = 7;
            const semaphore = new zero_backpressure_semaphore_1.ZeroBackpressureSemaphore(maxConcurrentJobs);
            let finishCurrentJob;
            const numberOfJobs = 10;
            for (let jobNo = 1; jobNo <= numberOfJobs; ++jobNo) {
                expect(semaphore.isAvailable).toBeTruthy();
                expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(0);
                expect(semaphore.maxConcurrentJobs).toBe(maxConcurrentJobs);
                const jobPromise = new Promise(res => finishCurrentJob = res);
                const job = () => jobPromise;
                const waitTillCompletionPromise = semaphore.waitForCompletion(job);
                yield resolveFast();
                expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(1);
                finishCurrentJob();
                yield waitTillCompletionPromise;
            }
            expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(0);
            expect(semaphore.amountOfUncaughtErrors).toBe(0);
        }));
        test('waitForCompletion: should process only one job at a time, when max concurrency is 1 and jobs are scheduled concurrently', () => __awaiter(void 0, void 0, void 0, function* () {
            const maxConcurrentJobs = 1;
            const lock = new zero_backpressure_semaphore_1.ZeroBackpressureSemaphore(maxConcurrentJobs);
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
                yield Promise.race([...waitTillCompletionPromises, resolveFast()]);
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
                yield waitTillCompletionPromises[0];
                // Evict the just-completed job.
                waitTillCompletionPromises.shift();
                jobCompletionCallbacks.shift();
            }
            expect(lock.isAvailable).toBeTruthy();
            expect(lock.amountOfCurrentlyExecutingJobs).toBe(0);
            expect(lock.maxConcurrentJobs).toBe(maxConcurrentJobs);
            expect(lock.amountOfUncaughtErrors).toBe(0);
        }));
        test('waitForCompletion: should not exceed max concurrently executing jobs, when the amont of pending jobs is bigger than the amount of rooms', () => __awaiter(void 0, void 0, void 0, function* () {
            const maxConcurrentJobs = 5;
            const numberOfJobs = 17 * maxConcurrentJobs - 1;
            const jobCompletionCallbacks = [];
            const waitTillCompletionPromises = [];
            const semaphore = new zero_backpressure_semaphore_1.ZeroBackpressureSemaphore(maxConcurrentJobs);
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
                yield Promise.race([...waitTillCompletionPromises, resolveFast()]);
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
                yield waitTillCompletionPromises[0];
                waitTillCompletionPromises.shift();
                jobCompletionCallbacks.shift();
            }
            expect(semaphore.isAvailable).toBeTruthy();
            expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(0);
            expect(semaphore.maxConcurrentJobs).toBe(maxConcurrentJobs);
            expect(semaphore.amountOfUncaughtErrors).toBe(0);
        }));
        test('waitForCompletion: should return the expected value when succeeds', () => __awaiter(void 0, void 0, void 0, function* () {
            const maxConcurrentJobs = 18;
            const semaphore = new zero_backpressure_semaphore_1.ZeroBackpressureSemaphore(maxConcurrentJobs);
            const expectedReturnValue = -1723598;
            const job = () => Promise.resolve(expectedReturnValue);
            const actualReturnValue = yield semaphore.waitForCompletion(job);
            expect(actualReturnValue).toBe(expectedReturnValue);
            expect(semaphore.amountOfUncaughtErrors).toBe(0);
        }));
        test('waitForCompletion: should return the expected error when throws', () => __awaiter(void 0, void 0, void 0, function* () {
            const maxConcurrentJobs = 3;
            const semaphore = new zero_backpressure_semaphore_1.ZeroBackpressureSemaphore(maxConcurrentJobs);
            const expectedThrownError = new Error("got one less, one less");
            const job = () => Promise.reject(expectedThrownError);
            try {
                yield semaphore.waitForCompletion(job);
                expect(true).toBe(false); // Necessarily fails, as it shouldn't reach here.
            }
            catch (actualThrownError) {
                expect(actualThrownError).toBe(expectedThrownError);
            }
            // The semaphore stores uncaught errors only for background jobs triggered by
            // `startExecution`.
            expect(semaphore.amountOfUncaughtErrors).toBe(0);
        }));
        test('waitTillAllExecutingJobsAreSettled: should resolve once all executing jobs are settled', () => __awaiter(void 0, void 0, void 0, function* () {
            const maxConcurrentJobs = 12;
            const jobCompletionCallbacks = [];
            const waitTillCompletionPromises = [];
            const semaphore = new zero_backpressure_semaphore_1.ZeroBackpressureSemaphore(maxConcurrentJobs);
            for (let jobNo = 0; jobNo < maxConcurrentJobs; ++jobNo) {
                const jobPromise = new Promise(res => jobCompletionCallbacks[jobNo] = res);
                const job = () => jobPromise;
                // Jobs will be executed in the order on which they were registered.
                const waitPromise = semaphore.waitForCompletion(job);
                waitTillCompletionPromises.push(waitPromise);
            }
            const waitTillAllAreSettledPromise = semaphore.waitTillAllExecutingJobsAreSettled();
            yield resolveFast(); // Trigger the event loop.
            // Resolve jobs one by one.
            for (let jobNo = 0; jobNo < maxConcurrentJobs; ++jobNo) {
                // Before resolving.
                expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(maxConcurrentJobs - jobNo);
                // Resolve one job.
                jobCompletionCallbacks[jobNo]();
                yield Promise.race(waitTillCompletionPromises);
                // After resolving.
                expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(maxConcurrentJobs - jobNo - 1);
                expect(semaphore.isAvailable).toBe(true);
                waitTillCompletionPromises.shift();
            }
            expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(0);
            yield waitTillAllAreSettledPromise;
            expect(semaphore.amountOfUncaughtErrors).toBe(0);
        }));
        test('startExecution: background jobs should not exceed the max given concurrency', () => __awaiter(void 0, void 0, void 0, function* () {
            const maxConcurrentJobs = 5;
            const numberOfJobs = 6 * maxConcurrentJobs - 1;
            const jobCompletionCallbacks = [];
            const semaphore = new zero_backpressure_semaphore_1.ZeroBackpressureSemaphore(maxConcurrentJobs);
            // Each main iteration starts execution of the current jobNo, and completing the
            // (jobNo - maxConcurrentJobs)th job if exist, to make an available room for it.
            let numberOfFailedJobs = 0;
            for (let jobNo = 0; jobNo < numberOfJobs; ++jobNo) {
                const shouldJobSucceed = jobNo % 2 === 0; // Even attempts will succeed, odd attempts will throw.
                if (!shouldJobSucceed) {
                    ++numberOfFailedJobs;
                }
                const jobPromise = new Promise((res, rej) => jobCompletionCallbacks[jobNo] = shouldJobSucceed ?
                    () => res() :
                    () => rej(new Error("Why bad things happen to good semaphores?")));
                const job = () => jobPromise;
                // Jobs will be executed in the order on which they were registered.
                const waitTillExecutionStartsPromise = semaphore.startExecution(job);
                if (jobNo < maxConcurrentJobs) {
                    // Should start immediately.
                    yield waitTillExecutionStartsPromise;
                    expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(jobNo + 1);
                    expect(semaphore.maxConcurrentJobs).toBe(maxConcurrentJobs);
                    continue;
                }
                // At this stage, jobs [jobNo - maxConcurrentJobs, jobNo - 1] are executing, whilst jobNo
                // cannot start yet (none of the currently executing ones has resulted yet).
                expect(semaphore.isAvailable).toBe(false);
                expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(maxConcurrentJobs);
                expect(semaphore.maxConcurrentJobs).toBe(maxConcurrentJobs);
                // Finish oldest job (began executing first, among the currently executing ones).
                const finishOldestJob = jobCompletionCallbacks[jobNo - maxConcurrentJobs];
                expect(finishOldestJob).toBeDefined();
                finishOldestJob();
                // Wait till jobNo start its execution, after we prepared a room for it.
                yield waitTillExecutionStartsPromise;
            }
            // Cleaning the tail of remained last (still executing) maxConcurrentJobs jobs:
            // Each main loop completes the current job.
            const remainedJobsSuffixStart = numberOfJobs - maxConcurrentJobs;
            for (let jobNo = remainedJobsSuffixStart; jobNo < numberOfJobs; ++jobNo) {
                const finishCurrentJob = jobCompletionCallbacks[jobNo];
                expect(finishCurrentJob).toBeDefined();
                finishCurrentJob();
                // Just trigger the event loop.
                yield resolveFast();
                const amountOfCurrentlyExecutingJobs = numberOfJobs - jobNo - 1;
                expect(semaphore.isAvailable).toBe(true);
                expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(amountOfCurrentlyExecutingJobs);
                expect(semaphore.maxConcurrentJobs).toBe(maxConcurrentJobs);
            }
            expect(semaphore.isAvailable).toBe(true);
            expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(0);
            expect(semaphore.amountOfUncaughtErrors).toBe(numberOfFailedJobs);
        }));
        test('when _waitForAvailableRoom resolves, its awaiters should be executed according to their order in the microtasks queue', () => __awaiter(void 0, void 0, void 0, function* () {
            // This test does not directly assess the semaphore component. Instead, it verifies the
            // correctness of the room-acquire mechanism, ensuring it honors the FIFO order of callers
            // requesting an available room.
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
            const actualExecutionOrderOfAwaiters = [];
            // This specific usage of one promise instance being awaited by multiple other promises
            // may remind those with a C++ background of a condition_variable.
            let notifyAvailableRoomExists;
            const waitForAvailableRoom = new Promise(res => notifyAvailableRoomExists = res);
            const awaiterAskingForRoom = (awaiterID) => __awaiter(void 0, void 0, void 0, function* () {
                yield waitForAvailableRoom;
                actualExecutionOrderOfAwaiters.push(awaiterID);
                // Other awaiters in the microtasks queue will now be notified about the
                // fulfillment of 'waitForAvailableRoom'.
            });
            const expectedExecutionOrder = [];
            const awaiterPromises = [];
            for (let i = 0; i < numberOfAwaiters; ++i) {
                expectedExecutionOrder.push(i);
                awaiterPromises.push(awaiterAskingForRoom(i));
            }
            // Initially, no awaiter should be able to make progress.
            yield Promise.race([...awaiterPromises, resolveFast()]);
            expect(actualExecutionOrderOfAwaiters.length).toBe(0);
            // Notify that a room is available, triggering the awaiters in order.
            notifyAvailableRoomExists();
            yield Promise.all(awaiterPromises);
            // The execution order should match the expected order.
            expect(actualExecutionOrderOfAwaiters).toEqual(expectedExecutionOrder);
            ;
        }));
    });
    describe('Negative path tests', () => {
        test('should throw when maxConcurrentJobs is non-positive', () => {
            expect(() => new zero_backpressure_semaphore_1.ZeroBackpressureSemaphore(-5)).toThrow();
            expect(() => new zero_backpressure_semaphore_1.ZeroBackpressureSemaphore(0)).toThrow();
        });
        test('should throw when maxConcurrentJobs is non-natural', () => {
            expect(() => new zero_backpressure_semaphore_1.ZeroBackpressureSemaphore(0.01)).toThrow();
            expect(() => new zero_backpressure_semaphore_1.ZeroBackpressureSemaphore(1.99)).toThrow();
            expect(() => new zero_backpressure_semaphore_1.ZeroBackpressureSemaphore(17.41)).toThrow();
        });
        test('should capture uncaught errors from background jobs triggered by startExecution', () => __awaiter(void 0, void 0, void 0, function* () {
            const maxConcurrentJobs = 17;
            const numberOfJobs = maxConcurrentJobs + 18;
            const jobErrors = [];
            const semaphore = new zero_backpressure_semaphore_1.ZeroBackpressureSemaphore(maxConcurrentJobs);
            for (let jobNo = 0; jobNo < numberOfJobs; ++jobNo) {
                const error = {
                    name: "CustomJobError",
                    message: `Job no. ${jobNo} has failed`,
                    jobID: jobNo
                };
                jobErrors.push(error);
                yield semaphore.startExecution(() => __awaiter(void 0, void 0, void 0, function* () { throw error; }));
            }
            yield semaphore.waitTillAllExecutingJobsAreSettled();
            expect(semaphore.amountOfUncaughtErrors).toBe(numberOfJobs);
            expect(semaphore.extractUncaughtErrors()).toEqual(jobErrors);
            // Following extraction, the semaphore no longer holds the error references.
            expect(semaphore.amountOfUncaughtErrors).toBe(0);
            expect(semaphore.amountOfCurrentlyExecutingJobs).toBe(0);
        }));
    });
});
//# sourceMappingURL=zero-backpressure-semaphore.test.js.map