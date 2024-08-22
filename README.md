<h2 align="middle">Zero Backpressure Semaphore Typescript</h2>

The `ZeroBackpressureSemaphore` class implements a semaphore for Node.js projects, allowing users to limit the number of concurrently executing jobs.  
This implementation does not queue pending jobs. Conversly, it promote a **just-in-time** approach, thereby eliminating backpressure. As a result, users have better control over memory footprint, which enhances performance by reducing garbage-collector overhead.

To illustrate the benefits of backpressure prevention, consider a scenario where messages from a message broker, such as RabbitMQ or Kafka, are translated into jobs. For example, in a stock-exchange broker system, each message might contain a username, and each job processes all pending buy/sell requests for that user. If consumers using a semaphore pull messages too quickly, messages may accumulate for extended periods, potentially triggering the broker's TTL (Time to Live).

The design addresses the two primary semaphore use cases in Node.js:
* __Multiple Jobs Execution__: This use case involves a single caller dispatching multiple jobs, often serving as the sole owner of the semaphore instance.
* __Single Job Execution__: In scenarios where multiple callers, such as route handlers, concurrently access the same semaphore instance. Each caller initiates a single job and relies on its outcome to proceed.

Each use case necessitates distinct handling capabilities, which will be discussed separately with accompanying examples.

## Key Features :sparkles:

- __Backpressure Control__: Ideal for job workers and background services. Concurrency control alone isn't sufficient to ensure stability and performance if backpressure control is overlooked. Without backpressure control, the heap can become overloaded, resulting in space complexity of O(*semaphore-slots* + *pending-jobs*) instead of O(*semaphore-slots*).
- __Graceful Termination__: Await the completion of all currently executing jobs via the `waitForAllExecutingJobsToComplete` method.
- __High Efficiency :gear:__: All state-altering operations have a constant time complexity, O(1).
- __Comprehensive documentation :books:__: The class is thoroughly documented, enabling IDEs to provide helpful tooltips that enhance the coding experience.
- __Robust Error Handling__: Uncaught errors from background jobs triggered by `startExecution` are captured and can be accessed using the `extractUncaughtErrors` method.
- **Fully covered** by rigorous unit tests.
- Self-explanatory method names.
- No external runtime dependencies: Only development dependencies are used.
- ES2020 Compatibility: The `tsconfig` target is set to ES2020, ensuring compatibility with ES2020 environments.
- TypeScript support.

## Modern API Design :rocket:

Traditional semaphore APIs require explicit *acquire* and *release* steps, adding overhead and responsibility for the user. Additionally, they introduce the risk of deadlocking the application if one forgets to *release*, for example, due to a thrown exception.

In contrast, `ZeroBackpressureSemaphore` manages job execution, abstracting away these details and reducing user responsibility. The *acquire* and *release* steps are handled implicitly by the execution methods, reminiscent of the RAII idiom in C++.

Method names are chosen to clearly convey their functionality.

## 1st use-case: Multiple Jobs Execution :man_technologist:

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

Note: method `waitForAllExecutingJobsToComplete` can be used to perform post-processing, after all jobs have completed. It complements the typical use-cases of `startExecution`.

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
  await sensorAggregationSemaphore.waitForAllExecutingJobsToComplete();
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
  await sensorAggregationSemaphore.waitForAllExecutingJobsToComplete();

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
Working with message queues typically involves acknowledgements, which have **timeout** mechanisms. Therefore, immediate processing is crucial to ensure efficient and reliable handling of messages. Backpressure on the semaphore means that messages experience longer delays before their corresponding jobs start execution.  
Refer to the following adaptation of the previous example, where sensor UIDs are consumed from a message queue. This example overlooks error handling and message validation, for simplicity.

```ts
import { 
  ZeroBackpressureSemaphore,
  SemaphoreJob
} from 'zero-backpressure-semaphore-typescript';

const maxConcurrentAggregationJobs = 24;
const sensorAggregationSemaphore =
  new ZeroBackpressureSemaphore<void, SensorAggregationError>(
    maxConcurrentAggregationJobs
  );

const SENSOR_UIDS_TOPIC = "IOT_SENSOR_UIDS";
const mqClient = new MessageQueueClient(SENSOR_UIDS_TOPIC);

async function processConsumedMessages(): Promise<void> {
  let numberOfProcessedMessages = 0;
  let isQueueEmpty = false;

  const processOneMessage: SemaphoreJob<void> = async (): Promise<void> => {
    if (isQueueEmpty) {
      return;
    }

    const message = await mqClient.receiveOneMessage();
    if (!message) {
      // Consider the queue as empty.
      isQueueEmpty = true;
      return;
    }

    ++numberOfProcessedMessages;
    const { uid } = message.data;
    await handleDataAggregation(uid);
    await mqClient.removeMessageFromQueue(message);
  };

  do {
    await sensorAggregationSemaphore.startExecution(processOneMessage);
  } while (!isQueueEmpty);
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
  const successfulJobsCount = numberOfProcessedMessages - errors.length;
  logger.info(
    `Successfully aggregated data from ${successfulJobsCount} IoT sensors, ` +
    `with failures in aggregating data from ${errors.length} IoT sensors`
  );
}
```

Alternatively, the `waitForAvailability` method can address this need by checking availability as a preliminary action, **before** consuming a message.

```ts
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
}
```

In reference to the above example, please note that `waitForAvailability` may be considered overkill or redundant if the job's duration is significantly shorter than the message timeout.  
For example, if the message queue's timeout for acknowledging a message is 1 minute and a typical job duration is 1 second, the 59 second gap provides a substantial safety margin. In such cases, the preliminary `waitForAvailability` action can be omitted.  
On the other hand, given that the timeout is 30 seconds and a typical job duration is 20 seconds, using `waitForAvailability` is sensible. This is because `startExecution` might have to wait 20 seconds before the job can begin, resulting in a total of 40 seconds from the invocation of `startExecution` until the job completes.

As a general rule, `waitForAvailability` is advisable whenever a timeout mechanism is involved, and the timeout period begins **before** the job starts execution. Note that the same effect can be achieved with `startExecution` alone, if the timeout-triggering logic is included in the job itself (such as, consuming a message). Both approaches are valid.

## 2nd use-case: Single Job Execution :man_technologist:

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

## Graceful Termination :hourglass:

The `waitForAllExecutingJobsToComplete` method is essential for scenarios where it is necessary to wait for all ongoing jobs to finish, such as logging a success message or executing subsequent logic.

A key use case for this method is ensuring stable unit tests. Each test should start with a clean state, independent of others, to avoid interference. This prevents scenarios where a job from Test A inadvertently continues to execute during Test B.

If your component has a termination method (`stop`, `terminate`, or similar), keep that in mind.

## Error Handling for Background Jobs :warning:

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

For instance, consider a situation where 1K concurrently executing route handlers are each awaiting the completion of their own `waitForCompletion` execution, while the semaphore is unavailable. In such cases, all handlers will internally wait on the semaphore's `_availableSlotExists` private property, competing to acquire the semaphore once it becomes available.

## Naming Convention :memo:

To improve readability and maintainability, it is highly recommended to assign a use-case-specific name to your semaphore instances. This practice helps in clearly identifying the purpose of each semaphore in the codebase. Examples include:
- dbAccessSemaphore
- tokenGenerationSemaphore
- azureStorageSemaphore

## Breaking Change in Version 3.0.0 :boom:

In version 3.0.0, the target compatibility has been upgraded from ES6 to ES2020. This change was made to leverage the widespread adoption of ES2020, its native support for async/await, and the use of `Promise.allSettled` within the semaphore.

## Breaking Change in Version 2.0.0 :boom:

The only breaking change in this release is the renaming of the method `waitTillAllExecutingJobsAreSettled` to `waitForAllExecutingJobsToComplete` for improved readability. No other changes have been introduced.

## License :scroll:

[MIT](LICENSE)
