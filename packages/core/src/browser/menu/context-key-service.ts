import { Emitter, Event, IDisposable, InjectableService, createServiceDecorator } from '../../common';

export type ContextKeyValue = null | undefined | boolean | number | string
  | Array<null | undefined | boolean | number | string>
  | Record<string, null | undefined | boolean | number | string>;

export interface ContextKey<T extends ContextKeyValue = ContextKeyValue> {
  set: (value: T | undefined) => void;
  reset: () => void;
  get: () => T | undefined;
}

export namespace ContextKey {
  export const None: ContextKey<any> = Object.freeze({
    set: () => { },
    reset: () => { },
    get: () => undefined,
  });
}

export interface ContextKeyChangeEvent {
  affects: (keys: { has: (key: string) => boolean }) => boolean;
}

export const ContextKeyService = Symbol('ContextKeyService');

export interface ContextMatcher {
  /**
   * Whether the expression is satisfied. If `context` provided, the service will attempt to retrieve a context object associated with that element.
   */
  match: (expression: string, context?: HTMLElement) => boolean;
}

export interface ContextKeyService extends ContextMatcher {
  readonly onDidChange: Event<ContextKeyChangeEvent>;

  createKey: <T extends ContextKeyValue>(key: string, defaultValue: T | undefined) => ContextKey<T>;

  /**
   * @returns a Set of the keys used by the given `expression` or `undefined` if none are used or the expression cannot be parsed.
   */
  parseKeys: (expression: string) => Set<string> | undefined;

  /**
   * Creates a temporary context that will use the `values` passed in when evaluating {@link callback}.
   * {@link callback | The callback} must be synchronous.
   */
  with: <T>(values: Record<string, unknown>, callback: () => T) => T;

  /**
   * Creates a child service with a separate context scoped to the HTML element passed in.
   * Useful for e.g. setting the {view} context value for particular widgets.
   */
  createScoped: (target: HTMLElement) => ScopedValueStore;

  /**
   * @param overlay values to be used in the new {@link ContextKeyService}. These values will be static.
   * Creates a child service with a separate context and a set of fixed values to override parent values.
   */
  createOverlay: (overlay: Iterable<[string, unknown]>) => ContextMatcher;

  /**
   * Set or modify a value in the service's context.
   */
  setContext: (key: string, value: unknown) => void;
}

export type ScopedValueStore = Omit<ContextKeyService, 'onDidChange' | 'match' | 'parseKeys' | 'with' | 'createOverlay'> & IDisposable;

export class ContextKeyServiceDummyImpl extends InjectableService implements ContextKeyService {
  protected readonly onDidChangeEmitter = new Emitter<ContextKeyChangeEvent>();
  readonly onDidChange = this.onDidChangeEmitter.event;
  protected fireDidChange(event: ContextKeyChangeEvent): void {
    this.onDidChangeEmitter.fire(event);
  }

  createKey<T extends ContextKeyValue>(_key: string, _defaultValue: T | undefined): ContextKey<T> {
    return ContextKey.None;
  }

  /**
   * It should be implemented by an extension, e.g. by the monaco extension.
   */
  match(_expression: string, _context?: HTMLElement): boolean {
    return true;
  }

  /**
   * It should be implemented by an extension, e.g. by the monaco extension.
   */
  parseKeys(_expression: string): Set<string> | undefined {
    return new Set<string>();
  }

  /**
   * Details should be implemented by an extension, e.g. by the monaco extension.
   * Callback must be synchronous.
   */
  with<T>(_values: Record<string, unknown>, callback: () => T): T {
    return callback();
  }

  /**
   * Details should implemented by an extension, e.g. by the monaco extension.
   */
  createScoped(_target: HTMLElement): ScopedValueStore {
    return this as any;
  }

  /**
   * Details should be implemented by an extension, e.g. the monaco extension.
   */
  createOverlay(_overlay: Iterable<[string, unknown]>): ContextMatcher {
    return this;
  }

  /**
   * Details should be implemented by an extension, e.g. by the monaco extension.
   */
  setContext(_key: string, _value: unknown): void { }
}
export const IContextKeyService = createServiceDecorator(ContextKeyServiceDummyImpl.name);
export type IContextKeyService = ContextKeyServiceDummyImpl;
