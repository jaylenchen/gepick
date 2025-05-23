/* eslint-disable ts/method-signature-style */
import { once } from 'lodash-es';
import { isIterable } from './iterator';
import { Emitter, Event } from './event';

export interface IDisposable {
  dispose: () => void;
}

export class MultiDisposeError extends Error {
  constructor(readonly errors: any[]) {
    super(
      `Encountered errors while disposing of store. Errors: [${errors.join(', ')}]`,
    );
  }
}

export function dispose<T extends IDisposable>(disposable: T): T;
export function dispose<T extends IDisposable>(
  disposable: T | undefined
): T | undefined;
export function dispose<
  T extends IDisposable,
  A extends Iterable<T> = Iterable<T>,
>(disposables: A): A;
export function dispose<T extends IDisposable>(disposables: T[]): T[];
export function dispose<T extends IDisposable>(
  disposables: readonly T[]
): readonly T[];
export function dispose<T extends IDisposable>(
  arg: T | Iterable<T> | undefined,
): any {
  if (isIterable(arg)) {
    const errors: any[] = [];

    for (const d of arg) {
      if (d) {
        try {
          d.dispose();
        }
        catch (e) {
          errors.push(e);
        }
      }
    }

    if (errors.length === 1) {
      throw errors[0];
    }
    else if (errors.length > 1) {
      throw new MultiDisposeError(errors);
    }

    return Array.isArray(arg) ? [] : arg;
  }
  else if (arg) {
    arg.dispose();
    return arg;
  }
}

export function toDisposable(fn: () => void): IDisposable {
  const self = {
    dispose: once(() => {
      fn();
    }),
  };
  return self;
}

export class DisposableStore implements IDisposable {
  // 是否禁用销毁后的警告 （默认是开启销毁警告）
  static DISABLE_DISPOSED_WARNING = false;

  // 待销毁的对象集合
  private readonly _toDispose = new Set<IDisposable>();
  private _isDisposed = false;

  get isDisposed() {
    return this._isDisposed;
  }

  // 添加disposable对象到待销毁的对象集合中
  add<T extends IDisposable>(disposable: T): T {
    if (!disposable) {
      return disposable;
    }

    // 不允许添加当前的DisposableStore对象
    if ((disposable as unknown as DisposableStore) === this) {
      throw new Error('Cannot register a disposable on itself!');
    }

    // 如果DisposableStore对象已经被销毁了，那么在销毁后尝试添加disposable对象时，如果开启了销毁警告提示会打印警告信息
    if (this._isDisposed) {
      if (!DisposableStore.DISABLE_DISPOSED_WARNING) {
        console.warn(
          new Error(
            'Trying to add a disposable to a DisposableStore that has already been disposed of. The added object will be leaked!',
          ).stack,
        );
      }
    }
    else {
      // DisposableStore对象未被销毁，将disposable对象添加到待销毁的对象集合中
      this._toDispose.add(disposable);
    }

    return disposable;
  }

  clear(): void {
    // 如果待销毁的对象集合为空，不做任何处理直接返回
    if (this._toDispose.size === 0) {
      return;
    }

    try {
      // 将待销毁的对象集合中的IDisposable对象一一销毁
      dispose(this._toDispose);
    }
    finally {
      // 清空待销毁的对象集合
      this._toDispose.clear();
    }
  }

  dispose(): void {
    // 如果已经销毁过了，不做任何处理直接返回
    if (this._isDisposed) {
      return;
    }

    this._isDisposed = true;
    this.clear();
  }
}

/**
 * Disposable是一个抽象类，它实现了IDisposable接口，实现了注册资源、清理资源方法，提供资源管理的能力。
 * 因此，一个类如果希望具有资源管理的能力，那么这个类可以继承Disposable类。
 *
 * 一个配合事件机制使用的例子：
 * ```typescript
 * // 1. 注册事件发射器
export class Button extends Disposable {
    private _onDidClick = this._register(new Emitter<Event>());
    get onDidClick(): BaseEvent<Event> {
        return this._onDidClick.event;
    }
}

// 2. 订阅某个事件
export class QuickInputController extends Disposable {
    private getUI() {
        const ok = new Button(okContainer);
        ok.label = localize('ok', 'OK');
        this._register(
            ok.onDidClick((e) => {
                this.onDidAcceptEmitter.fire();
            })
        );
    }
}
 * ```
 * 上述例子，
 * 1. 注册事件阶段：通过const ok = this._register(new Emitter<Event>())，将一个emitter对象注册到disposableStore中
 * 2. 订阅事件阶段：通过 this._register(ok.onDidClick((e) => { this.onDidAcceptEmitter.fire()}))，将onDidClick调用后返回的disposable对象注册到了disposableStore中
 * 当程序执行调用了Disposable类的dispose方法，此时就会销毁disposableStore中的所有disposable对象。
 */
export abstract class Disposable implements IDisposable {
  /**
   * 一个Disposable对象都有一个配套的_disposableStore
   * 1. 当子类调用_register方法的时候，实际上是将disposable对象添加到了_disposableStore中
   * 2. 当调用Disposable对象的dispose方法的时候，实际上是调用了_disposableStore的dispose方法，
   *    该方法的作用是将所有通过_register方法添加到_disposableStore中的disposable对象都销毁了
   */
  protected readonly _disposableStore = new DisposableStore();

  /**
   * 清理存放到store中的disposable对象
   */
  dispose(): void {
    this._disposableStore.dispose();
  }

  /**
   * 将一个disposable对象注册到store中，注册完毕之后将其返回
   * @param disposable 一个具有dispose方法的对象
   * @returns 返回传递进来的disposable对象
   */
  protected _register<T extends IDisposable>(disposable: T): T {
    // 不允许当前的Disposable对象自己注册自己
    if ((disposable as unknown as Disposable) === this) {
      throw new Error('Cannot register a disposable on itself!');
    }
    // 添加disposable对象到待销毁的对象集合中
    return this._disposableStore.add(disposable);
  }
}

/**
 * Utility for tracking a collection of Disposable objects.
 *
 * This utility provides a number of benefits over just using an array of
 * Disposables:
 *
 * - the collection is auto-pruned when an element it contains is disposed by
 * any code that has a reference to it
 * - you can register to be notified when all elements in the collection have
 * been disposed [1]
 * - you can conveniently dispose all elements by calling dispose()
 * on the collection
 *
 * Unlike an array, however, this utility does not give you direct access to
 * its elements.
 *
 * Being notified when all elements are disposed is simple:
 * ```
 * const dc = new DisposableCollection(myDisposables);
 * dc.onDispose(() => {
 *    console.log('All elements in the collection have been disposed');
 * });
 * ```
 *
 * [1] The collection will notify only once. It will continue to function in so
 * far as accepting new Disposables and pruning them when they are disposed, but
 * such activity will never result in another notification.
 */
export class DisposableCollection implements IDisposable {
  protected readonly disposables: IDisposable[] = [];
  protected readonly onDisposeEmitter = new Emitter<void>();

  constructor(...toDispose: IDisposable[]) {
    toDispose.forEach(d => this.push(d));
  }

  /**
     * This event is fired only once
     * on first dispose of not empty collection.
     */
  get onDispose(): Event<void> {
    return this.onDisposeEmitter.event;
  }

  protected checkDisposed(): void {
    if (this.disposed && !this.disposingElements) {
      this.onDisposeEmitter.fire(undefined);
      this.onDisposeEmitter.dispose();
    }
  }

  get disposed(): boolean {
    return this.disposables.length === 0;
  }

  private disposingElements = false;
  dispose(): void {
    if (this.disposed || this.disposingElements) {
      return;
    }
    this.disposingElements = true;
    while (!this.disposed) {
      try {
        this.disposables.pop()!.dispose();
      }
      catch (e) {
        console.error(e);
      }
    }
    this.disposingElements = false;
    this.checkDisposed();
  }

  push(disposable: IDisposable): IDisposable {
    const disposables = this.disposables;
    disposables.push(disposable);
    const originalDispose = disposable.dispose.bind(disposable);
    const toRemove = toDisposable(() => {
      const index = disposables.indexOf(disposable);
      if (index !== -1) {
        disposables.splice(index, 1);
      }
      this.checkDisposed();
    });
    disposable.dispose = () => {
      toRemove.dispose();
      disposable.dispose = originalDispose;
      originalDispose();
    };
    return toRemove;
  }

  pushAll(disposables: IDisposable[]): IDisposable[] {
    return disposables.map(disposable =>
      this.push(disposable),
    );
  }
}

export type DisposableGroup = { push: (disposable: IDisposable) => void } | { add: (disposable: IDisposable) => void };
export namespace DisposableGroup {
  export function canPush(candidate?: DisposableGroup): candidate is { push(disposable: IDisposable): void } {
    return Boolean(candidate && (candidate as { push(): void }).push);
  }
  export function canAdd(candidate?: DisposableGroup): candidate is { add(disposable: IDisposable): void } {
    return Boolean(candidate && (candidate as { add(): void }).add);
  }
}

export function disposableTimeout(...args: Parameters<typeof setTimeout>): IDisposable {
  const handle = setTimeout(...args);
  return { dispose: () => clearTimeout(handle) };
}

/**
 * Wrapper for a {@link IDisposable} that is not available immediately.
 */
export class DisposableWrapper implements IDisposable {
  private disposed = false;
  private disposable: IDisposable | undefined = undefined;

  set(disposable: IDisposable): void {
    if (this.disposed) {
      disposable.dispose();
    }
    else {
      this.disposable = disposable;
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.disposable) {
      this.disposable.dispose();
      this.disposable = undefined;
    }
  }
}
