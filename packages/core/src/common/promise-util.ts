import { Event } from './event';
import { CancellationError, CancellationToken, cancelled } from './cancellation';
import { isFunction, isObject } from './types';
import { IDisposable } from './lifecycle';

/**
 * Simple implementation of the deferred pattern.
 * An object that exposes a promise and functions to resolve and reject it.
 */
export class Deferred<T = void> {
  state: 'resolved' | 'rejected' | 'unresolved' = 'unresolved';
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (err?: unknown) => void;

  promise = new Promise<T>((resolve, reject) => {
    this.resolve = resolve;
    this.reject = reject;
  }).then(
    // eslint-disable-next-line no-sequences
    res => (this.setState('resolved'), res),
    // eslint-disable-next-line no-sequences
    err => (this.setState('rejected'), Promise.reject(err)),
  );

  protected setState(state: 'resolved' | 'rejected'): void {
    if (this.state === 'unresolved') {
      this.state = state;
    }
  }
}

/**
 * @returns resolves after a specified number of milliseconds
 * @throws cancelled if a given token is cancelled before a specified number of milliseconds
 */
export function timeout(ms: number, token = CancellationToken.None): Promise<void> {
  const deferred = new Deferred<void>();
  const handle = setTimeout(() => deferred.resolve(), ms);
  token.onCancellationRequested(() => {
    clearTimeout(handle);
    deferred.reject(cancelled());
  });
  return deferred.promise;
}

/**
 * Creates a promise that is rejected after the given amount of time. A typical use case is to wait for another promise until a specified timeout using:
 * ```
 * Promise.race([ promiseToPerform, timeoutReject(timeout, 'Timeout error message') ]);
 * ```
 *
 * @param ms timeout in milliseconds
 * @param message error message on promise rejection
 * @returns rejection promise
 */
export function timeoutReject<T>(ms: number, message?: string): Promise<T> {
  const deferred = new Deferred<T>();
  setTimeout(() => deferred.reject(new Error(message)), ms);
  return deferred.promise;
}

export async function retry<T>(task: () => Promise<T>, retryDelay: number, retries: number): Promise<T> {
  let lastError: Error | undefined;

  for (let i = 0; i < retries; i++) {
    try {
      return await task();
    }
    catch (error) {
      lastError = error as Error | undefined;

      await timeout(retryDelay);
    }
  }

  throw lastError;
}

/**
 * A function to allow a promise resolution to be delayed by a number of milliseconds. Usage is as follows:
 *
 * `const stringValue = await myPromise.then(delay(600)).then(value => value.toString());`
 *
 * @param ms the number of millisecond to delay
 * @returns a function that returns a promise that returns the given value, but delayed
 */
export function delay<T>(ms: number): (value: T) => Promise<T> {
  return value => new Promise((resolve, _reject) => { setTimeout(() => resolve(value), ms); });
}

/**
 * Constructs a promise that will resolve after a given delay.
 * @param ms the number of milliseconds to wait
 */
export async function wait(ms: number): Promise<void> {
  await delay(ms)(undefined);
}

export function waitForEvent<T>(event: Event<T>, ms: number, thisArg?: any, disposables?: IDisposable[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const registration = setTimeout(() => {
      // eslint-disable-next-line ts/no-use-before-define
      listener.dispose();
      reject(new CancellationError());
    }, ms);

    const listener = event((evt: T) => {
      clearTimeout(registration);
      listener.dispose();
      resolve(evt);
    }, thisArg, disposables);
  });
}

export function isThenable<T>(obj: unknown): obj is Promise<T> {
  return isObject<Promise<unknown>>(obj) && isFunction(obj.then);
}

/**
 * Returns with a promise that waits until the first promise resolves to `true`.
 */
// Based on https://stackoverflow.com/a/51160727/5529090
export function firstTrue(...promises: readonly Promise<boolean>[]): Promise<boolean> {
  const newPromises = promises.map(promise => new Promise<boolean>(
    (resolve, reject) => promise.then(result => result && resolve(true), reject),
  ));
  newPromises.push(Promise.all(promises).then(() => false));
  return Promise.race(newPromises);
}
