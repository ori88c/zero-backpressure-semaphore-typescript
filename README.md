<h2 align="middle">zero-backpressure-semaphore-typescript</h2>

The `ZeroBackpressureSemaphore` class implements a semaphore for Node.js projects, allowing users to limit the number of concurrently executing jobs.  
This implementation does not queue pending jobs, thereby eliminating backpressure. As a result, users have better control over memory footprint, which enhances performance by reducing garbage-collector overhead.

The design addresses the two primary semaphore use cases in Node.js:
* __Multiple Jobs Execution__: This use case involves a single caller dispatching multiple jobs, often serving as the sole owner of the semaphore instance.
* __Single Job Execution__: In scenarios where multiple callers, such as route handlers, concurrently access the same semaphore instance. Each caller initiates a single job and relies on its outcome to proceed.

Each use case necessitates distinct handling capabilities, which will be discussed separately with accompanying examples.

## Modern API Design

Traditional semaphore APIs require explicit *acquire* and *release* steps, adding overhead and responsibility for the user. Additionally, they introduce the risk of deadlocking the application if one forgets to *release*, for example, due to a thrown exception.

In contrast, `ZeroBackpressureSemaphore` manages job execution, abstracting away these details and reducing user responsibility. The *acquire* and *release* steps are handled implicitly by the execution methods, similarly to the RAII idiom in C++.

Method names are chosen to clearly convey their functionality.

## Installing

```bash
npm i zero-backpressure-semaphore-typescript
```

## Key Features

- __Backpressure Control__: Ideal for job workers and background services. Concurrency control alone isn't sufficient to ensure stability and performance if backpressure control is overlooked.
- __Graceful Termination__: Achieved via the `waitTillAllExecutingJobsAreSettled` method.
- __High Efficiency__: All state-altering operations have a constant time complexity, O(1).
- __Comprehensive documentation__: The class is thoroughly documented, enabling IDEs to provide helpful tooltips that enhance the coding experience.
- Fully covered by unit tests.
- Self-explanatory method names.
- No external runtime dependencies: Only development dependencies are used.
- ES2020 Compatibility.
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
const sensorAggregationSemaphore = new ZeroBackpressureSemaphore<void>(maxConcurrentAggregationJobs);

async function aggregateSensorsData(sensorUIDs: ReadonlyArray<string>) {
  for (const uid of sensorUIDs) {
    // Until the semaphore can start aggregating data from the current sensor, it won't make
    // sense to add more jobs, as such will induce unnecessary backpressure.
    await sensorAggregationSemaphore.startExecution(
      (): Promise<void> => handleDataAggregation(uid)
    );
  }
  // Note: at this stage, jobs might be still executing, as we did not wait for
  // their completion.

  // Graceful termination, if desired.
  await sensorAggregationSemaphore.waitTillAllExecutingJobsAreSettled();
  console.info(`Finished aggregating data from ${sensorUIDs.length} IoT sensors`);
}

async function handleDataAggregation(sensorUID): Promise<void> {
  // Business logic for aggregating data from a single sensor.
}
```
Please note that in a real-world scenario, sensor UIDs are more likely to be consumed from a message queue (e.g., RabbitMQ, Kafka, AWS SNS) rather than from an in-memory array. This setup **highlights the benefits** of avoiding backpressure:  
We should avoid consuming a message if we cannot start processing it immediately. Working with message queues typically involves acknowledgements, which have timeout mechanisms. Therefore, immediate processing is crucial to ensure efficient and reliable handling of messages.

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
