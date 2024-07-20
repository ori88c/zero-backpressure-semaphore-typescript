
export type SemaphoreJob<T> = () => Promise<T>;
type PromiseResolveType = (value: void | PromiseLike<void>) => void;

/**
 * ZeroBackpressureSemaphore
 * 
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
 * ### Graceful Termination
 * All the job execution promises are tracked by the semaphore instance, ensuring no dangling promises.
 * This enables graceful termination via the `waitForAllExecutingJobsToComplete` method, which is
 * particularly useful for the multiple jobs execution use-case. This can help perform necessary
 * post-processing logic, and ensure a clear state between unit-tests.
 * If your component has a termination method (`stop`, `terminate`, or similar), keep that in mind.
 * 
 * ### Error Handling for Background Jobs
 * Background jobs triggered by `startExecution` may throw errors. Unlike the `waitForCompletion` case,
 * the caller has no reference to the corresponding job promise which executes in the background.
 * Therefore, errors from background jobs are captured by the semaphore and can be extracted using 
 * the `extractUncaughtErrors` method. The number of accumulated uncaught errors can be obtained via 
 * the `amountOfUncaughtErrors` getter method. This can be useful, for example, if the user wants to 
 * handle uncaught errors only after a certain threshold is reached.
 * 
 * ### Complexity
 * - **Initialization**: O(maxConcurrentJobs) for both time and space.
 * - **startExecution, waitForCompletion**: O(1) for both time and space, excluding the job execution itself.
 * - **waitForAllExecutingJobsToComplete**: O(maxConcurrentJobs) for both time and space, excluding job executions.
 * - All the getter methods have O(1) complexity for both time and space.
 * 
 */
export class ZeroBackpressureSemaphore<T, UncaughtErrorType = Error> {
    private readonly _availableSlotsStack: Array<number>;
    private readonly _slots: Array<Promise<T> | null>;

    // Slot availability indicator:
    // A pending `_waitForAvailableSlot` promise indicates "all slots are taken". Its resolve
    // function is used to notify all awaiters of a state change. This approach has similarities
    // with a condition_variable in C++.
    private _waitForAvailableSlot?: Promise<void>;
    private _notifyAvailableSlotExists?: PromiseResolveType; // Resolving the above.

    // Stores uncaught errors from background jobs triggered by `startExecution`.
    private _uncaughtErrors: UncaughtErrorType[] = [];

    constructor(maxConcurrentJobs: number) {
        if (maxConcurrentJobs <= 0) {
            throw new Error(
                'ZeroBackpressureSemaphore expects a positive maxConcurrentJobs, received ' +
                `${maxConcurrentJobs}`
            );
        }

        if (maxConcurrentJobs !== Math.floor(maxConcurrentJobs)) {
            throw new Error(
                'ZeroBackpressureSemaphore expects a natural number of maxConcurrentJobs, received ' +
                `${maxConcurrentJobs}`
            );
        }

        this._availableSlotsStack = new Array<number>(maxConcurrentJobs).fill(0);
        for (let i = 1; i < maxConcurrentJobs; ++i) {
            this._availableSlotsStack[i] = i;
        }
        
        this._slots = new Array(maxConcurrentJobs).fill(null);
    }

    /**
     * maxConcurrentJobs
     * 
     * @returns The maximum number of concurrent jobs as specified in the constructor.
     */	
    public get maxConcurrentJobs(): number {
        return this._slots.length;
    }
    
    /**
     * isAvailable
     * 
     * @returns True if there is an available job slot, otherwise false.
     */	
    public get isAvailable(): boolean {
        return this._availableSlotsStack.length > 0;
    }
    
    /**
     * amountOfCurrentlyExecutingJobs
     * 
     * @returns The number of jobs currently being executed by the semaphore.
     */	
    public get amountOfCurrentlyExecutingJobs(): number {
        return this._slots.length - this._availableSlotsStack.length;
    }

    /**
     * amountOfUncaughtErrors
     * 
     * @returns The number of uncaught errors from background jobs, triggered by `startExecution`.
     */	
    public get amountOfUncaughtErrors(): number {
        return this._uncaughtErrors.length;
    }

    /**
     * startExecution
     * 
     * This method resolves once the given job has started its execution, indicating that the
     * semaphore has become available (i.e., allotted a slot for the job).
     * Users can leverage this to determine the start timestamp of a job. If the semaphore is too busy
     * to start a given job `X`, there is no reason to create another job `Y` until `X` has started.
     * 
     * This method is particularly useful for executing multiple or background jobs, where no return
     * value is expected.
     * 
     * If the job throws an error, it is captured by the semaphore and can be accessed via the
     * `extractUncaughtError` method. Users are encouraged to specify a custom `UncaughtErrorType`
     * generic parameter to the class if jobs may throw errors.
     * 
     * @param job - The job to be executed once the semaphore is available.
     * @returns A promise that resolves when the job starts execution.
     */	
    public async startExecution(backgroundJob: SemaphoreJob<T>): Promise<void> {
        const availableSlot = await this._getAvailableSlot();
        this._slots[availableSlot] = this._handleJobExecution(backgroundJob, availableSlot, true);
        return;
    }

    /**
     * waitForCompletion
     * 
     * This method executes the given job in a controlled manner, once the semaphore is available. 
     * It resolves or rejects when the job has finished its execution, providing the returned value
     * or thrown error from the job.
     * 
     * This method is useful when the flow depends on the job's execution, such as needing its return
     * value or handling any errors it may throw.
     * 
     * ### Example Use Case
     * Suppose you have a route handler that needs to perform a specific code block with limited
     * concurrency (e.g., database access) due to external constraints, such as throttling limits.
     * This method allows you to execute the job with controlled concurrency. Once the job resolves
     * or rejects, you can continue the route handler's flow based on the result.
     * 
     * @param job - The job to be executed once the semaphore is available.
     * @throws - Error thrown by the job itself.
     * @returns A promise that resolves with the job's return value or rejects with its error.
     */
    public async waitForCompletion(job: SemaphoreJob<T>): Promise<T> {
        const availableSlot = await this._getAvailableSlot();
        return this._slots[availableSlot] = this._handleJobExecution(job, availableSlot, false);
    }

    /**
     * waitForAllExecutingJobsToComplete
     * 
     * This method allows the caller to wait until all currently executing jobs have completed.
     * It is useful for ensuring that the application can terminate gracefully, without leaving 
     * any pending operations.
     * 
     * When this method is called, it returns a promise that resolves once all currently running 
     * promises have either resolved or rejected. This is particularly useful in scenarios where 
     * you need to ensure that all tasks are completed before proceeding, such as during shutdown 
     * processes or between unit tests.
     * 
     * @returns A promise that resolves when all currently executing jobs are completed.
     */
    public async waitForAllExecutingJobsToComplete(): Promise<void> {
        const pendingJobs = this._slots.filter(job => job !== null);
        if (pendingJobs.length > 0) {
            await Promise.allSettled(pendingJobs);
        }
    }

    /**
     * waitForAvailability
     * 
     * This method resolves once at least one slot (slot) is available for job execution.
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
     * @returns A promise that resolves once at least one slot is available.
     */
    public async waitForAvailability(): Promise<void> {
        while (this._waitForAvailableSlot) {
            await this._waitForAvailableSlot;
        }
    }

    /**
     * extractUncaughtErrors
     * 
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
    public extractUncaughtErrors(): UncaughtErrorType[] {
        const errors = this._uncaughtErrors;
        this._uncaughtErrors = [];
        return errors;
    }

    private async _getAvailableSlot(): Promise<number> {
        while (this._waitForAvailableSlot) {
            await this._waitForAvailableSlot;
        }
        
        const availableSlot = this._availableSlotsStack.pop();
        
        // Handle state change: from available to unavailable.
        if (this._availableSlotsStack.length === 0) {
            this._waitForAvailableSlot = new Promise<void>(
                resolve => this._notifyAvailableSlotExists = resolve
            );
        }

        return availableSlot;
    }

    /**
     * _handleJobExecution
     * 
     * This method manages the execution of a given job in a controlled manner. It ensures that
     * the job is executed within the constraints of the semaphore and handles updating the 
     * internal state once the job has completed.
     * 
     * ### Behavior
     * - Waits for the job to either return a value or throw an error.
     * - Updates the internal state to make the allotted slot available again once the job is finished.
     * 
     * @param job - The job to be executed in the given slot.
     * @param allottedSlot - The slot number in which the job should be executed.
     * @param isBackgroundJob - A flag indicating whether the caller expects a return value to proceed
     *                          with its work. If `true`, no return value is expected, and any error
     *                          thrown by the job should not be propagated.
     * @returns A promise that resolves with the job's return value or rejects with its error.
     *          Rejection occurs only if triggered by `waitForCompletion`.
     */
    public async _handleJobExecution(
        job: SemaphoreJob<T>,
        allottedSlot: number,
        isBackgroundJob: boolean
    ): Promise<T> {
        try {
            const jobResult = await job();
            return jobResult;
        } catch (err) {
            if (!isBackgroundJob) {
                // Triggered by `waitForCompletion`:
                // Caller is awaiting either fulfillment or rejection.
                throw err;
            }

            // Triggered by `startExecution`: A background job.
            this._uncaughtErrors.push(err);
        } finally {
            this._slots[allottedSlot] = null;
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
