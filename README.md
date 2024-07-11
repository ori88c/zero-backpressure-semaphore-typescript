<h2 align="middle">zero-backpressure-semaphore-typescript</h2>

The `ZeroBackpressureSemaphore` class implements a semaphore for Node.js projects, allowing users to limit the number of concurrently executing jobs.  
This implementation does not queue pending jobs, thereby eliminating backpressure. As a result, users have better control over memory footprint, which enhances performance by reducing garbage-collector overhead.

The design addresses the two primary semaphore use cases in Node.js:
* __Multiple Jobs Execution__: This use case involves a single caller dispatching multiple jobs, often serving as the sole owner of the semaphore instance.
* __Single Job Execution__: In scenarios where multiple callers, such as route handlers, concurrently access the same semaphore instance. Each caller initiates a single job and relies on its outcome to proceed.

Each use case necessitates distinct handling capabilities, which will be discussed separately with accompanying examples.

## Modern API Design

Traditional semaphore APIs require explicit *acquire* and *release* steps, adding overhead and responsibility for the user. Additionally, they introduce the risk of deadlocking the application if one forgets to *release*, for example, due to a thrown exception.

In contrast, `ZeroBackpressureSemaphore` manages job execution, abstracting away these details and reducing user responsibility. The *acquire* and *release* steps are handled implicitly by the execution methods, reminiscent of the RAII idiom in C++.

Method names are chosen to clearly convey their functionality.

## Installing

```bash
npm i zero-backpressure-semaphore-typescript
```

## Key Features

- __Backpressure Control__: Ideal for job workers and background services. Concurrency control alone isn't sufficient to ensure stability and performance if backpressure control is overlooked. Without backpressure control, the heap can become overloaded, resulting in space complexity of O(*semaphore-rooms* + *pending-jobs*) instead of O(*semaphore-rooms*).
- __Graceful Termination__: Await the completion of all currently executing jobs via the `waitTillAllExecutingJobsAreSettled` method.
- __High Efficiency__: All state-altering operations have a constant time complexity, O(1).
- __Comprehensive documentation__: The class is thoroughly documented, enabling IDEs to provide helpful tooltips that enhance the coding experience.
- __Robust Error Handling__: Uncaught errors from background jobs triggered by `startExecution` are captured and can be accessed using the `extractUncaughtErrors` method.
- Fully covered by unit tests.
- Self-explanatory method names.
- No external runtime dependencies: Only development dependencies are used.
- ES6 Compatibility.
- TypeScript support.

## 1st use-case: Multiple Jobs Execution

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
Rather than pre-creating 1M jobs (one for each sensor), which could potentially overwhelm the Node.js task queue and induce backpressure, the system should adopt a **just-in-time** approach. This means creating a sensor aggregation job only when the semaphore indicates availability, thereby optimizing resource utilization and maintaining system stability.

Note: method `waitTillAllExecutingJobsAreSettled` can be used to perform post-processing, after all jobs have completed. It complements the typical use-cases of `startExecution`.

```ts
import { ZeroBackpressureSemaphore } from 'zero-backpressure-semaphore-typescript';

const maxConcurrentAggregationJobs = 24;
const sensorAggregationSemaphore = new ZeroBackpressureSemaphore<void>(
  maxConcurrentAggregationJobs
);

async function aggregateSensorsData(sensorUIDs: ReadonlyArray<string>) {
  for (const uid of sensorUIDs) {
    // Until the semaphore can start aggregating data from the current sensor,
    // it won't make sense to add more jobs, as such will induce unnecessary
    // backpressure.
    await sensorAggregationSemaphore.startExecution(
      (): Promise<void> => handleDataAggregation(uid)
    );
  }
  // Note: at this stage, jobs might be still executing, as we did not wait for
  // their completion.

  // Graceful termination: await the completion of all currently executing jobs.
  await sensorAggregationSemaphore.waitTillAllExecutingJobsAreSettled();
  console.info(`Finished aggregating data from ${sensorUIDs.length} IoT sensors`);
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

If the jobs might throw errors, you don't need to worry about these errors propagating up to the event loop and potentially crashing the application. Uncaught errors from jobs triggered by `startExecution` are captured by the semaphore and can be safely accessed for post-processing purposes (e.g., metrics).  
Refer to the following adaptation of the above example, now utilizing the semaphore's error handling capabilities:

```ts
import { ZeroBackpressureSemaphore } from 'zero-backpressure-semaphore-typescript';

const maxConcurrentAggregationJobs = 24;
const sensorAggregationSemaphore =
  // Notice the 2nd generic parameter (Error by default).
  new ZeroBackpressureSemaphore<void, SensorAggregationError>(
    maxConcurrentAggregationJobs
  );

async function aggregateSensorsData(sensorUIDs: ReadonlyArray<string>) {
  for (const uid of sensorUIDs) {
    // Until the semaphore can start aggregating data from the current sensor,
    // it won't make sense to add more jobs, as such will induce unnecessary
    // backpressure.
    await sensorAggregationSemaphore.startExecution(
      (): Promise<void> => handleDataAggregation(uid)
    );
  }
  // Note: at this stage, jobs might be still executing, as we did not wait for
  // their completion.

  // Graceful termination: await the completion of all currently executing jobs.
  await sensorAggregationSemaphore.waitTillAllExecutingJobsAreSettled();

  // Post processing.
  const errors = sensorAggregationSemaphore.extractUncaughtErrors();
  if (errors.length > 0) {
    await updateFailedAggregationMetrics(errors);
  }

  // Summary.
  const successfulJobsCount = sensorUIDs.length - errors.length;
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

Please note that in a real-world scenario, sensor UIDs may be consumed from a message queue (e.g., RabbitMQ, Kafka, AWS SNS) rather than from an in-memory array. This setup **highlights the benefits** of avoiding backpressure:  
We should avoid consuming a message if we cannot start processing it immediately. Working with message queues typically involves acknowledgements, which have **timeout** mechanisms. Therefore, immediate processing is crucial to ensure efficient and reliable handling of messages. The `waitForAvailability` method addresses this need by checking availability as a preliminary action before consuming a message.  
Refer to the following adaptation of the previous example, where sensor UIDs are consumed from a message queue. This example overlooks error handling and message validation, for simplicity.

```ts
import { ZeroBackpressureSemaphore } from 'zero-backpressure-semaphore-typescript';

const maxConcurrentAggregationJobs = 24;
const sensorAggregationSemaphore =
  new ZeroBackpressureSemaphore<void, SensorAggregationError>(
    maxConcurrentAggregationJobs
  );

const SENSOR_UIDS_TOPIC = "IOT_SENSOR_UIDS";
const mqClient = new MessageQueueClient(SENSOR_UIDS_TOPIC);

async function processConsumedMessages(): Promise<void> {
  let numberOfProcessedMessages = 0;

  do {
    await sensorAggregationSemaphore.waitForAvailability();
    const message = await mqClient.receiveOneMessage();
    if (!message) {
      // Consider the queue as empty.
      break;
    }

    ++numberOfProcessedMessages;
    const { uid } = message.data;

    // At this point, `startExecution` will begin immediately, due to the
    // preliminary `waitForAvailability` action.
    await sensorAggregationSemaphore.startExecution(
      (): Promise<void> => handleDataAggregation(uid);
    );
    
    await mqClient.removeMessageFromQueue(message);
  } while (true);
  // Note: at this stage, jobs might be still executing, as we did not wait for
  // their completion.

  // Graceful termination: await the completion of all currently executing jobs.
  await sensorAggregationSemaphore.waitTillAllExecutingJobsAreSettled();

  // Post processing.
  const errors = sensorAggregationSemaphore.extractUncaughtErrors();
  if (errors.length > 0) {
    await updateFailedAggregationMetrics(errors);
  }

  // Summary.
  const successfulJobsCount = numberOfProcessedMessages - errors.length;
  logger.info(
    `Successfully aggregated data from ${successfulJobsCount} IoT sensors, ` +
    `with failures in aggregating data from ${errors.length} IoT sensors`
  );
}
```

In reference to the above example, please note that `waitForAvailability` may be considered overkill or redundant if the job's duration is significantly shorter than the message timeout.  
For example, if the message queue's timeout for acknowledging a message is 1 minute and a typical job duration is 1 second, the 59 second gap provides a substantial safety margin. In such cases, the preliminary `waitForAvailability` action can be omitted.

## 2nd use-case: Single Job Execution

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

## Graceful Termination

The `waitTillAllExecutingJobsAreSettled` method is essential for scenarios where it is necessary to wait for all ongoing jobs to finish, such as logging a success message or executing subsequent logic.

A key use case for this method is ensuring stable unit tests. Each test should start with a clean state, independent of others, to avoid interference. This prevents scenarios where a job from Test A inadvertently continues to execute during Test B.

If your component has a termination method (`stop`, `terminate`, or similar), keep that in mind.

## Error Handling for Background Jobs

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

## Unavoidable / Implicit Backpressure

Mitigating backpressure is primarily associated with the `startExecution` method, particularly in scenarios involving multiple jobs. However, the single-job use case may certainly inflict backpressure on the Node.js micro-tasks queue.

For instance, consider a situation where 1000 concurrently executing route handlers are each awaiting the completion of their own `waitForCompletion` execution, while the semaphore is unavailable. In such cases, all handlers will internally wait on the semaphore's `_availableRoomExists` private property, competing to acquire the semaphore once it becomes available.

## Naming Convention

To improve readability and maintainability, it is highly recommended to assign a use-case-specific name to your semaphore instances. This practice helps in clearly identifying the purpose of each semaphore in the codebase. Examples include:
- dbAccessSemaphore
- tokenGenerationSemaphore
- azureStorageSemaphore

## License

[MIT](LICENSE)
