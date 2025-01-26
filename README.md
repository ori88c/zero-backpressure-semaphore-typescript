<h2 align="middle"><span style="color:#4f979f">Zer</span><span style="color:#547e87">o Ba</span><span style="color:#677b8b">kpr</span><span style="color:#7f91a0">ess</span><span style="color:#94a6a2">ure </span><span style="color:#779a92">Sem</span><span style="color:#64958a">aph</span><span style="color:#539b8c">ore </span><span style="color:#57a7a8">Typ</span><span style="color:#5fabbf">esc</span><span style="color:#6dafd0">rip</span><span style="color:#5e92ab">t</span></h2>

The `ZeroBackpressureSemaphore` class implements a semaphore for Node.js projects, allowing users to limit the number of concurrently executing jobs.  
This implementation does not queue pending jobs. Conversly, it promote a **just-in-time** approach, thereby eliminating backpressure. As a result, users have better control over memory footprint, which enhances performance by reducing garbage-collector overhead.

To illustrate the benefits of backpressure prevention, consider a scenario where messages from a message broker, such as RabbitMQ or Kafka, are translated into jobs. For example, in a stock-exchange broker system, each message might contain a username, and each job processes all pending buy/sell requests for that user. If consumers using a semaphore pull messages too quickly, messages may accumulate for extended periods, potentially triggering the broker's TTL (Time to Live).

The design addresses the two primary semaphore use cases in Node.js:
* __Multiple Jobs Execution__: This use case involves a single caller dispatching multiple jobs, often serving as the sole owner of the semaphore instance.
* __Single Job Execution__: In scenarios where multiple callers, such as route handlers, concurrently access the same semaphore instance. Each caller initiates a single job and relies on its outcome to proceed.

Each use case necessitates distinct handling capabilities, which will be discussed separately with accompanying examples.

If your use case involves weighted jobs - where instead of limiting the maximum concurrency, you need to enforce a maximum total weight for concurrently executing jobs - consider using the weighted variant of this package: [zero-backpressure-weighted-promise-semaphore](https://www.npmjs.com/package/zero-backpressure-weighted-promise-semaphore).

If your use case requires a concurrency of 1, consider using the lock variant of this package: [zero-overhead-promise-lock](https://www.npmjs.com/package/zero-overhead-promise-lock). While semaphores can simulate locks by setting their concurrency to 1, a dedicated lock implementation offers greater efficiency with minimal overhead.

## Table of Contents

* [Key Features](#key-features)
* [Modern API Design](#modern-api-design)
* [API](#api)
* [Getter Methods](#getter-methods)
* [1st use-case: Multiple Jobs Execution](#first-use-case)
* [2nd use-case: Single Job Execution](#second-use-case)
* [Graceful Termination](#graceful-termination)
* [Error Handling for Background Jobs](#error-handling)
* [Unavoidable / Implicit Backpressure](#unavoidable-backpressure)
* [Promise Semaphores Are Not Promise Pools](#not-promise-pool)
* [Breaking Change in Version 3.0.0](#breaking-change-3)
* [Breaking Change in Version 2.0.0](#breaking-change-2)
* [Naming Convention](#naming-convention)
* [License](#license)

## Key Features :sparkles:<a id="key-features"></a>

- __Backpressure Control__: Ideal for job workers and background services. Concurrency control alone isn't sufficient to ensure stability and performance if backpressure control is overlooked. Without backpressure control, the heap can become overloaded, resulting in space complexity of O(*semaphore-slots* + *pending-jobs*) instead of O(*semaphore-slots*).
- __Graceful Termination__: Await the completion of all currently executing jobs via the `waitForAllExecutingJobsToComplete` method.
- __High Efficiency :gear:__: All state-altering operations have a constant time complexity, O(1).
- __Comprehensive documentation :books:__: The class is thoroughly documented, enabling IDEs to provide helpful tooltips that enhance the coding experience.
- __Robust Error Handling__: Uncaught errors from background jobs triggered by `startExecution` are captured and can be accessed using the `extractUncaughtErrors` method.
- __Metrics :bar_chart:__: The class offers various metrics through getter methods, such as `amountOfCurrentlyExecutingJobs`, providing insights into the semaphore's current state. These metrics can be used for periodic logging or to collect statistics from real-world usage.
- __Tests :test_tube:__: Fully covered by rigorous unit tests.
- Self-explanatory method names.
- No external runtime dependencies: Only development dependencies are used.
- ES2020 Compatibility: The `tsconfig` target is set to ES2020, ensuring compatibility with ES2020 environments.
- TypeScript support.

## Modern API Design :rocket:<a id="modern-api-design"></a>

Traditional semaphore APIs require explicit *acquire* and *release* steps, adding overhead and responsibility for the user. Additionally, they introduce the risk of deadlocking the application if one forgets to *release*, for example, due to a thrown exception.

In contrast, `ZeroBackpressureSemaphore` manages job execution, abstracting away these details and reducing user responsibility. The *acquire* and *release* steps are handled implicitly by the execution methods, reminiscent of the RAII idiom in C++.

Method names are chosen to clearly convey their functionality.

## API :globe_with_meridians:<a id="api"></a>

The `ZeroBackpressureSemaphore` class provides the following methods:

* __startExecution__: Resolves once the given job has **started** its execution. Users can leverage this to prevent backpressure of pending jobs; If the semaphore is too busy to start a given job `X`, there is no reason to create another job `Y` until `X` has started. This method is particularly useful for background job workers that frequently retrieve job metadata from external sources, such as pulling messages from a message broker.
* __waitForCompletion__: Executes the given job in a controlled manner, once there is an available slot. It resolves or rejects when the job **completes** execution, returning the job's value or propagating any error it may throw.
* __waitForAllExecutingJobsToComplete__: Resolves when all **currently** executing jobs have finished, meaning once all running promises have either resolved or rejected. This is particularly useful in scenarios where you need to ensure that all jobs are completed before proceeding, such as during shutdown processes or between unit tests. By using the optional `considerPendingJobsBackpressure` parameter, the waiting behavior can be extended to include potentially pending jobs that induce backpressure.
* __waitForAvailability__: This method resolves once at least one slot is available for job execution. In other words, it resolves when the semaphore is available to trigger a new job immediately. Note that the same effect can be achieved with `startExecution` alone, if the async logic (intended to be delayed until availability) is handled **within the job itself** rather than as a preliminary step. Therefore, `waitForAvailability` serves as a design choice rather than a strict necessity.
* __extractUncaughtErrors__: Returns an array of uncaught errors, captured by the semaphore while executing background jobs added by `startExecution`. The instance will no longer hold these error references once extracted. In other words, ownership of these uncaught errors shifts to the caller, while the semaphore clears its list of uncaught errors.

If needed, refer to the code documentation for a more comprehensive description of each method.

## Getter Methods :mag:<a id="getter-methods"></a>

The `ZeroBackpressureSemaphore` class provides the following getter methods to reflect the current semaphore's state:

* __maxConcurrentJobs__: The maximum number of concurrent jobs as specified in the constructor. This value is set in the constructor and remains constant throughout the instance's lifespan.
* __isAvailable__: Indicates whether there is an available job slot, meaning the semaphore can begin executing a new job immediately.
* __amountOfCurrentlyExecutingJobs__: The number of jobs currently being executed by the semaphore.
* __amountOfUncaughtErrors__: The number of uncaught errors from background jobs triggered by `startExecution`, that are currently stored by the instance. These errors have not yet been extracted using `extractUncaughtErrors`.

To eliminate any ambiguity, all getter methods have **O(1)** time and space complexity, meaning they do **not** iterate through all currently executing jobs with each call. The metrics are maintained by the jobs themselves.

## 1st use-case: Multiple Jobs Execution :man_technologist:<a id="first-use-case"></a>

This semaphore variant excels in eliminating backpressure when dispatching multiple concurrent jobs from the same caller. This pattern is typically observed in **background job services**, such as:
- Log File analysis.
- Network Traffic analyzers.
- Vulnerability scanning.
- Malware Signature updates.
- Sensor Data aggregation.
- Remote Configuration changes.
- Batch Data processing.

Here, the start time of each job is crucial. Since a pending job cannot start its execution until the semaphore allows, there is no benefit to adding additional jobs that cannot start immediately. The `startExecution` method communicates the job's start time to the caller (resolves as soon as the job starts), which enables to create a new job as-soon-as it makes sense.

For example, consider an application managing 1M IoT sensors that require hourly data aggregation. To mitigate server load, a semaphore can be employed to limit the number of concurrent data aggregation tasks.  
Instead of loading all sensor UIDs into memory and pre-creating 1M jobs (one for each sensor), which could potentially overwhelm the Node.js task queue and induce backpressure, the system should adopt a **just-in-time** approach. This means creating a sensor aggregation job only when the semaphore indicates availability, thereby optimizing resource utilization and maintaining system stability.

The following example demonstrates fetching sensor UIDs using an `AsyncGenerator`. Async generators and iterators are widely adopted in modern APIs, providing efficient handling of potentially large data sets. For instance, the [AWS-SDK](https://aws.amazon.com/blogs/developer/pagination-using-async-iterators-in-modular-aws-sdk-for-javascript/) utilizes them for pagination, abstracting away complexities like managing offsets. Similarly, [MongoDB's cursor](https://www.mongodb.com/docs/manual/reference/method/db.collection.find/) enables iteration over a large number of documents in a paginated and asynchronous manner. These abstractions elegantly handle pagination internally, sparing users the complexities of managing offsets and other low-level details. By awaiting the semaphore's availability, the **space complexity** is implicitly constrained to *O(max(page-size, semaphore-capacity))*, as the `AsyncGenerator` fetches a new page only after all sensors from the current page have initiated aggregation.

Note: method `waitForAllExecutingJobsToComplete` can be used to perform post-processing, after all jobs have completed. It complements the typical use-cases of `startExecution`.

```ts
import { ZeroBackpressureSemaphore } from 'zero-backpressure-semaphore-typescript';

const maxConcurrentAggregationJobs = 24;
const sensorAggregationSemaphore = new ZeroBackpressureSemaphore<void>(
  maxConcurrentAggregationJobs
);

async function aggregateSensorsData(sensorUIDs: AsyncGenerator<string>) {
  let fetchedSensorsCounter = 0;

  for await (const uid of sensorUIDs) {
    ++fetchedSensorsCounter;

    // Until the semaphore can start aggregating data from the current sensor,
    // adding more jobs won't make sense as this would induce unnecessary backpressure.
    await sensorAggregationSemaphore.startExecution(
      (): Promise<void> => handleDataAggregation(uid)
    );
  }
  // Note: at this stage, jobs might be still executing, as we did not wait for
  // their completion.

  // Graceful termination: await the completion of all currently executing jobs.
  await sensorAggregationSemaphore.waitForAllExecutingJobsToComplete();
  console.info(`Finished aggregating data from ${fetchedSensorsCounter} IoT sensors`);
}

/**
 * Handles the data aggregation process for a specified IoT sensor.
 *
 * @param sensorUID - The unique identifier of the IoT sensor whose data is to
 *                    be aggregated.
 */
async function handleDataAggregation(sensorUID): Promise<void> {
  // Implementation goes here. 
}
```

If jobs might throw errors, you don't need to worry about these errors propagating to the event loop and potentially crashing the application. Uncaught errors from jobs triggered by `startExecution` are captured by the semaphore and can be safely accessed for post-processing purposes (e.g., metrics).  
Refer to the following adaptation of the above example, now utilizing the semaphore's error handling capabilities:

```ts
import { ZeroBackpressureSemaphore } from 'zero-backpressure-semaphore-typescript';

const maxConcurrentAggregationJobs = 24;
const sensorAggregationSemaphore =
  // Notice the 2nd generic parameter (Error by default).
  new ZeroBackpressureSemaphore<void, SensorAggregationError>(
    maxConcurrentAggregationJobs
  );

async function aggregateSensorsData(sensorUIDs: AsyncGenerator<string>) {
  let fetchedSensorsCounter = 0;

  for await (const uid of sensorUIDs) {
    ++fetchedSensorsCounter;

    // Until the semaphore can start aggregating data from the current sensor,
    // adding more jobs won't make sense as this would induce unnecessary backpressure.
    await sensorAggregationSemaphore.startExecution(
      (): Promise<void> => handleDataAggregation(uid)
    );
  }
  // Note: at this stage, jobs might be still executing, as we did not wait for
  // their completion.

  // Graceful termination: await the completion of all currently executing jobs.
  await sensorAggregationSemaphore.waitForAllExecutingJobsToComplete();

  // Post processing.
  const errors = sensorAggregationSemaphore.extractUncaughtErrors();
  if (errors.length > 0) {
    await updateFailedAggregationMetrics(errors);
  }

  // Summary.
  const successfulJobsCount = fetchedSensorsCounter - errors.length;
  logger.info(
    `Successfully aggregated data from ${successfulJobsCount} IoT sensors, ` +
    `with failures in aggregating data from ${errors.length} IoT sensors`
  );
}

/**
 * Handles the data aggregation process for a specified IoT sensor.
 *
 * @param sensorUID - The unique identifier of the IoT sensor whose data is to
 *                    be aggregated.
 * @throws SensorAggregationError - Throws an error if the data aggregation
 *                                  process fails.
 */
async function handleDataAggregation(sensorUID): Promise<void> {
  // Implementation goes here. 
}
```

## 2nd use-case: Single Job Execution :man_technologist:<a id="second-use-case"></a>

The `waitForCompletion` method is useful for executing a sub-procedure, for which the caller must wait before proceeding with its work.

For example, consider fetching data from an external resource within a route handler. The route handler must respond (e.g., with an HTTP status 200 on success) based on the result of the fetching sub-procedure. Note that a sub-procedure may return a value or throw an error. If an error is thrown, `waitForCompletion` will propagate the error back to the caller.

The concurrency limit for such operations is typically set based on external constraints (e.g., reducing the chances of being throttled) or the desire to limit network resource usage.

```ts
import { SemaphoreJob, ZeroBackpressureSemaphore } from 'zero-backpressure-semaphore-typescript';

type UserInfo = Record<string, string>;

const maxConcurrentDbRequests = 32;
const dbAccessSemaphore = new ZeroBackpressureSemaphore<UserInfo>(maxConcurrentDbRequests);

app.get('/user/', async (req, res) => {
  // Define the sub-prodecure.
  const fetchUserInfo: SemaphoreJob<UserInfo> = async (): Promise<UserInfo> => {
    const userInfo: UserInfo = await usersDbClient.get(req.userID);
    return userInfo;
  }

  // Execute the sub-procedure in a controlled manner.
  try {
    const userInfo: UserInfo = await dbAccessSemaphore.waitForCompletion(fetchUserInfo);
    res.status(HTTP_OK_CODE).send(userInfo);
  } catch (err) {
    // err was thrown by the fetchUserInfo job.
    logger.error(`Failed fetching user info for userID ${req.userID} with error: ${err.message}`);
    res.status(HTTP_ERROR_CODE);
  }
});
```

## Graceful Termination :hourglass:<a id="graceful-termination"></a>

The `waitForAllExecutingJobsToComplete` method is essential for scenarios where it is necessary to wait for all ongoing jobs to finish, such as logging a success message or executing subsequent logic.

A key use case for this method is ensuring stable unit tests. Each test should start with a clean state, independent of others, to avoid interference. This prevents scenarios where a job from Test A inadvertently continues to execute during Test B.

If your component has a termination method (`stop`, `terminate`, or similar), keep that in mind.

## Error Handling for Background Jobs :warning:<a id="error-handling"></a>

Background jobs triggered by `startExecution` may throw errors. Unlike the `waitForCompletion` case, the caller has no reference to the corresponding job promise which executes in the background.

Therefore, errors from background jobs are captured by the semaphore and can be extracted using the `extractUncaughtErrors` method. Optionally, you can specify a custom `UncaughtErrorType` as the second generic parameter of the `ZeroBackpressureSemaphore` class. By default, the error type is `Error`.
```ts
const trafficAnalyzerSemaphore = new ZeroBackpressureSemaphore<void, TrafficAnalyzerError>(
  maxConcurrentAnalyzers
);
```
The number of accumulated uncaught errors can be obtained via the `amountOfUncaughtErrors` getter method. This can be useful, for example, if the user wants to handle uncaught errors only after a certain threshold is reached.

Even if the user does not intend to perform error-handling with these uncaught errors, it is **important** to periodically call this method when using `startExecution` to prevent the accumulation of errors in memory.
However, there are a few exceptional cases where the user can safely avoid extracting uncaught errors:
- The number of jobs is relatively small and the process is short-lived.
- The jobs never throw errors, thus no uncaught errors are possible.

## Unavoidable / Implicit Backpressure<a id="unavoidable-backpressure"></a>

Mitigating backpressure is primarily associated with the `startExecution` method, particularly in scenarios involving multiple jobs. However, the single-job use case may certainly inflict backpressure on the Node.js micro-tasks queue.

For instance, consider a situation where 1K concurrently executing route handlers are each awaiting the completion of their own `waitForCompletion` execution, while the semaphore is unavailable. In such cases, all handlers will internally wait on the semaphore's `_availableSlotExists` private property, competing to acquire the semaphore once it becomes available.

## Promise Semaphores Are Not Promise Pools<a id="not-promise-pool"></a>

The term "promise pool" is commonly used in the JavaScript community to describe promise semaphores.  
However, this terminology can be misleading. The term "pool" typically implies the **reuse of resources**, as in "thread pools" or "connection pools," where a fixed set of resources is used and **recycled**. In contrast, a promise semaphore’s primary goal is to **control concurrency** by limiting the number of jobs executing concurrently, with each job represented by a **distinct promise instance**.

Using the term "promise pool" may cause confusion, as it suggests resource reuse rather than concurrency management.

## Breaking Change in Version 3.0.0 :boom:<a id="breaking-change-3"></a>

In version 3.0.0, the target compatibility has been upgraded from ES6 to ES2020. This change was made to leverage the widespread adoption of ES2020, its native support for async/await, and the use of `Promise.allSettled` within the semaphore.

## Breaking Change in Version 2.0.0 :boom:<a id="breaking-change-2"></a>

The only breaking change in this release is the renaming of the method `waitTillAllExecutingJobsAreSettled` to `waitForAllExecutingJobsToComplete` for improved readability. No other changes have been introduced.

## Naming Convention :memo:<a id="naming-convention"></a>

To improve readability and maintainability, it is highly recommended to assign a use-case-specific name to your semaphore instances. This practice helps in clearly identifying the purpose of each semaphore in the codebase. Examples include:
- dbAccessSemaphore
- tokenGenerationSemaphore
- azureStorageSemaphore

## License :scroll:<a id="license"></a>

[MIT](LICENSE)
