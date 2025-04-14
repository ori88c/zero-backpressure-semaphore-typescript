"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZeroBackpressureSemaphore = void 0;
/**
 * The `ZeroBackpressureSemaphore` class implements a semaphore for Node.js projects, allowing users
 * to limit the number of concurrently executing jobs. This implementation does not queue pending
 * jobs, thereby eliminating backpressure. As a result, users have better control over memory
 * footprint, which enhances performance by reducing garbage-collector overhead.
 *
 * The design addresses the two primary semaphore use cases in Node.js:
 * 1. **Single Job Execution**: A sub-procedure for which the caller must wait before proceeding with
 *    its work. In this case, the job's completion time is crucial to know.
 * 2. **Multiple Jobs Execution**: In this case, the start time of a given job is crucial. Since a
 *    pending job cannot start its execution until the semaphore allows, there is no reason to add
 *    additional jobs that cannot start either.
 *    Once all the jobs are completed, some post-processing logic may be required. The API provides a
 *    designated method to wait until there are no currently-executing jobs.
 *
 * ### Modern API Design
 * Traditional semaphore APIs require explicit acquire and release steps, adding overhead and
 * responsibility on the user.
 * In contrast, `ZeroBackpressureSemaphore` manages job execution, abstracting away these details and
 * reducing user responsibility. The acquire and release steps are handled implicitly by the execution
 * methods, reminiscent of the RAII idiom in C++.
 * Method names are chosen to clearly convey their functionality.
 *
 * ### Graceful Teardown
 * All the job execution promises are tracked by the semaphore instance, ensuring no dangling promises.
 * This enables graceful termination via the `waitForAllExecutingJobsToComplete` method, in scenarios
 * where it is essential to ensure that all the currently executing or pending jobs are fully processed
 * before proceeding.
 * Examples include application shutdowns (e.g., `onModuleDestroy` in Nest.js applications) or
 * maintaining a clear state between unit-tests.
 * Should graceful teardown be a concern for your component, consider how its termination method (e.g.,
 * `stop`, `terminate`, `onModuleDestroy`, etc) aligns with this capability.
 *
 * ### Error Handling for Background Jobs
 * Background jobs triggered by `startExecution` may throw errors. Unlike the `waitForCompletion` case,
 * the caller has no reference to the corresponding job promise which executes in the background.
 * Therefore, errors from background jobs are captured by the semaphore and can be extracted using
 * the `extractUncaughtErrors` method. The number of accumulated uncaught errors can be obtained via
 * the `amountOfUncaughtErrors` getter method. This can be useful, for example, if the user wants to
 * handle uncaught errors only after a certain threshold is reached.
 */
class ZeroBackpressureSemaphore {
    /**
     * Initializes the semaphore with the specified maximum number of concurrently
     * executing jobs. This sets up the internal structures to enforce the concurrency
     * limit for job execution.
     *
     * @param maxConcurrentJobs The maximum number of jobs that can execute concurrently.
     * @throws Error if `maxConcurrentJobs` is not a natural number (i.e., a positive integer).
     */
    constructor(maxConcurrentJobs) {
        // Stores uncaught errors from background jobs triggered by `startExecution`.
        this._uncaughtErrors = [];
        if (!isNaturalNumber(maxConcurrentJobs)) {
            // prettier-ignore
            throw new Error(`Failed to instantiate ZeroBackpressureSemaphore: ` +
                `maxConcurrentJobs must be a natural number, but received ${maxConcurrentJobs}`);
        }
        this._availableSlotsStack = new Array(maxConcurrentJobs).fill(0);
        for (let i = 1; i < maxConcurrentJobs; ++i) {
            this._availableSlotsStack[i] = i;
        }
        this._slots = new Array(maxConcurrentJobs).fill(undefined);
    }
    /**
     * @returns The maximum number of concurrent jobs as specified in the constructor.
     */
    get maxConcurrentJobs() {
        return this._slots.length;
    }
    /**
     * @returns True if there is an available job slot, otherwise false.
     */
    get isAvailable() {
        return this._availableSlotsStack.length > 0;
    }
    /**
     * @returns The number of jobs currently being executed by the semaphore.
     */
    get amountOfCurrentlyExecutingJobs() {
        return this._slots.length - this._availableSlotsStack.length;
    }
    /**
     * Indicates the number of uncaught errors from background jobs triggered by `startExecution`,
     * that are currently stored by the instance.
     * These errors have not yet been extracted using `extractUncaughtErrors`.
     *
     * Knowing the number of uncaught errors allows users to decide whether to process them immediately
     * or wait for further accumulation.
     *
     * @returns The number of uncaught errors from background jobs.
     */
    get amountOfUncaughtErrors() {
        return this._uncaughtErrors.length;
    }
    /**
     * Resolves once the given job has *started* its execution, indicating that the semaphore has
     * become available (i.e., allotted a slot for the job).
     * Users can leverage this to prevent backpressure of pending jobs:
     * If the semaphore is too busy to start a given job `X`, there is no reason to create another
     * job `Y` until `X` has started.
     *
     * This method is particularly useful for executing multiple or background jobs, where no return
     * value is expected. It promotes a just-in-time approach, on which each job is pending execution
     * only when no other job is, thereby eliminating backpressure and reducing memory footprint.
     *
     * ### Graceful Teardown
     * Method `waitForAllExecutingJobsToComplete` complements the typical use-cases of `startExecution`.
     * It can be used to perform post-processing, after all the currently-executing jobs have completed.
     *
     * ### Error Handling
     * If the job throws an error, it is captured by the semaphore and can be accessed via the
     * `extractUncaughtError` method. Users are encouraged to specify a custom `UncaughtErrorType`
     * generic parameter to the class if jobs may throw errors.
     *
     * @param backgroundJob The job to be executed once the semaphore is available.
     * @returns A promise that resolves when the job starts execution.
     */
    async startExecution(backgroundJob) {
        const availableSlot = await this._getAvailableSlot();
        this._slots[availableSlot] = this._handleJobExecution(backgroundJob, availableSlot, true);
        return;
    }
    /**
     * Executes the given job in a controlled manner, once the semaphore is available.
     * It resolves or rejects when the job finishes execution, returning the job's value or
     * propagating any error it may throw.
     *
     * This method is useful when the flow depends on a job's execution to proceed, such as
     * needing its return value or handling any errors it may throw.
     *
     * ### Example Use Case
     * Suppose you have a route handler that needs to perform a specific code block with limited
     * concurrency (e.g., database access) due to external constraints, such as throttling limits.
     * This method allows you to execute the job with controlled concurrency. Once the job resolves
     * or rejects, you can continue the route handler's flow based on the result.
     *
     * @param job The job to be executed once the semaphore is available.
     * @throws Error thrown by the job itself.
     * @returns A promise that resolves with the job's return value or rejects with its error.
     */
    async waitForCompletion(job) {
        const availableSlot = await this._getAvailableSlot();
        return (this._slots[availableSlot] = this._handleJobExecution(job, availableSlot, false));
    }
    /**
     * Waits for all **currently executing jobs** to finish, ensuring that all active promises
     * have either resolved or rejected before proceeding. This enables graceful termination in
     * scenarios such as:
     * - Application shutdowns (e.g., `onModuleDestroy` in Nest.js applications).
     * - Ensuring a clean state between unit tests.
     *
     * ### Considering Backpressure from Pending Jobs
     * By default, this method only waits for jobs that are already **executing** at the time of
     * invocation. In other words, the default behavior does **not** consider potential jobs that
     * are still queued (pending execution).
     * A backpressure of pending jobs may happen when multiple different callers share the same
     * semaphore instance, each being unaware of the others.
     * To extend the waiting behavior to include **potentially pending jobs** which account for
     * backpressure, use the optional `considerPendingJobsBackpressure` parameter set to `true`.
     * When this flag is enabled, the method will account for both existing and future backpressure,
     * even if the backpressure arises after the method is invoked.
     *
     * @param considerPendingJobsBackpressure A boolean indicating whether this method should also wait
     *                                        for the resolution of all potentially queued jobs (i.e.,
     *                                        those not yet executed when the method was invoked).
     *                                        This is especially relevant when multiple different callers
     *                                        share the same semaphore instance, each being unaware of
     *                                        the others.
     * @returns A promise that resolves once all currently executing jobs have completed.
     *          If `considerPendingJobsBackpressure` is `true`, the promise will additionally
     *          wait until all queued jobs have been executed, ensuring no pending job backpressure remains.
     */
    async waitForAllExecutingJobsToComplete(considerPendingJobsBackpressure = false) {
        while (this._availableSlotsStack.length < this._slots.length) {
            const busySlots = this._slots.filter((job) => job !== undefined);
            await Promise.allSettled(busySlots);
            if (!considerPendingJobsBackpressure) {
                break;
            }
        }
    }
    /**
     * This method resolves once at least one slot is available for job execution.
     * In other words, it resolves when the semaphore is available to trigger a new job immediately.
     *
     * ### Example Use Case
     * Consider a scenario where we read messages from a message queue (e.g., RabbitMQ, Kafka).
     * Each message contains job-specific metadata, meaning for each message, we want to create a
     * corresponding semaphore job. We aim to start processing a message immediately once it is
     * consumed, as message queues typically involve *acknowledgements*, which have *timeout*
     * mechanisms. Therefore, immediate processing is crucial to ensure efficient and reliable
     * handling of messages. Backpressure on the semaphore may cause messages to wait too long
     * before their corresponding job starts, increasing the chances of their timeout being exceeded.
     * To prevent such potential backpressure, users can utilize the `waitForAvailability` method
     * before consuming the next message.
     *
     * ### Design Choice
     * This method can be useful when the system is experiencing high load (as indicated by CPU
     * and/or memory usage metrics), and you want to pause further async operations until an available
     * job slot opens up.
     * However, the same effect can be achieved with `startExecution` alone if the async logic
     * (intended to be delayed until availability) is handled within the job itself rather than as
     * a preliminary step. Therefore, `waitForAvailability` serves as a design choice rather than a
     * strict necessity.
     *
     * @returns A promise that resolves once at least one slot is available.
     */
    async waitForAvailability() {
        while (this._waitForAvailableSlot) {
            await this._waitForAvailableSlot;
        }
    }
    /**
     * This method returns an array of uncaught errors, captured by the semaphore while executing
     * background jobs added by `startExecution`. The term `extract` implies that the semaphore
     * instance will no longer hold these error references once extracted, unlike `get`. In other
     * words, ownership of these uncaught errors shifts to the caller, while the semaphore clears
     * its list of uncaught errors.
     *
     * Even if the user does not intend to perform error-handling with these uncaught errors, it is
     * important to periodically call this method when using `startExecution` to prevent the
     * accumulation of errors in memory.
     * However, there are a few exceptional cases where the user can safely avoid extracting
     * uncaught errors:
     * - The number of jobs is relatively small and the process is short-lived.
     * - The jobs never throw errors, thus no uncaught errors are possible.
     *
     * @returns An array of uncaught errors from background jobs triggered by `startExecution`.
     */
    extractUncaughtErrors() {
        const errors = this._uncaughtErrors;
        this._uncaughtErrors = [];
        return errors;
    }
    async _getAvailableSlot() {
        while (this._waitForAvailableSlot) {
            await this._waitForAvailableSlot;
        }
        const availableSlot = this._availableSlotsStack.pop();
        // Handle state change: from available to unavailable.
        if (this._availableSlotsStack.length === 0) {
            this._waitForAvailableSlot = new Promise((resolve) => (this._notifyAvailableSlotExists = resolve));
        }
        return availableSlot;
    }
    /**
     * This method manages the execution of a given job in a controlled manner. It ensures that
     * the job is executed within the constraints of the semaphore and handles updating the
     * internal state once the job has completed.
     *
     * ### Behavior
     * - Waits for the job to either return a value or throw an error.
     * - Updates the internal state to make the allotted slot available again once the job is finished.
     *
     * @param job The job to be executed in the given slot.
     * @param allottedSlot The slot number in which the job should be executed.
     * @param isBackgroundJob A flag indicating whether the caller expects a return value to proceed
     *                        with its work. If `true`, no return value is expected, and any error
     *                        thrown by the job should not be propagated.
     * @returns A promise that resolves with the job's return value or rejects with its error.
     *          Rejection occurs only if triggered by `waitForCompletion`.
     */
    async _handleJobExecution(job, allottedSlot, isBackgroundJob) {
        try {
            const jobResult = await job();
            return jobResult;
        }
        catch (err) {
            if (!isBackgroundJob) {
                // Triggered by `waitForCompletion`:
                // Caller is awaiting either fulfillment or rejection.
                throw err;
            }
            // Triggered by `startExecution`:
            // A background job, the caller does not await for its return value to proceed.
            this._uncaughtErrors.push(err);
        }
        finally {
            this._slots[allottedSlot] = undefined;
            this._availableSlotsStack.push(allottedSlot);
            // Handle state change: from unavailable to available.
            if (this._availableSlotsStack.length === 1) {
                this._notifyAvailableSlotExists();
                this._waitForAvailableSlot = undefined;
                this._notifyAvailableSlotExists = undefined;
            }
        }
    }
}
exports.ZeroBackpressureSemaphore = ZeroBackpressureSemaphore;
function isNaturalNumber(num) {
    const floored = Math.floor(num);
    return floored >= 1 && floored === num;
}
//# sourceMappingURL=zero-backpressure-semaphore.js.map