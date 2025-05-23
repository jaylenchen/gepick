import { Emitter, Event, IContributionProvider, IDisposable, InjectableService, MaybePromise, Optional, Prioritizeable, URI, createContribution, createServiceDecorator, match, toDisposable } from '@gepick/core/common';

export interface OpenerOptions {
}

export const OpenHandler = Symbol('OpenHandler');
/**
 * `OpenHandler` should be implemented to provide a new opener.
 */
export interface OpenHandler {
  /**
   * A unique id of this handler.
   */
  readonly id: string;
  /**
   * A human-readable name of this handler.
   */
  readonly label?: string;
  /**
   * A css icon class of this handler.
   */
  readonly iconClass?: string;
  /**
   * Test whether this handler can open the given URI for given options.
   * Return a nonzero number if this handler can open; otherwise it cannot.
   * Never reject.
   *
   * A returned value indicating a priority of this handler.
   */
  canHandle: (uri: URI, options?: OpenerOptions) => MaybePromise<number>;
  /**
   * Open a widget for the given URI and options.
   * Resolve to an opened widget or undefined, e.g. if a page is opened.
   * Never reject if `canHandle` return a positive number; otherwise should reject.
   */
  open: (uri: URI, options?: OpenerOptions) => MaybePromise<object | undefined>;
}

export const OpenerService = Symbol('OpenerService');
/**
 * `OpenerService` provide an access to existing openers.
 */
export interface OpenerService {
  /**
   * Return all registered openers.
   * Never reject.
   */
  getOpeners: (() => Promise<OpenHandler[]>) & ((uri: URI, options?: OpenerOptions) => Promise<OpenHandler[]>);
  /**
   * Return an opener with the higher priority for the given URI.
   * Reject if such does not exist.
   */
  getOpener: (uri: URI, options?: OpenerOptions) => Promise<OpenHandler>;
  /**
   * Add open handler i.e. for custom editors
   */
  addHandler?: (openHandler: OpenHandler) => IDisposable;

  /**
   * Remove open handler
   */
  removeHandler?: (openHandler: OpenHandler) => void;

  /**
   * Event that fires when a new opener is added or removed.
   */
  onDidChangeOpeners?: Event<void>;
}

export async function open(openerService: OpenerService, uri: URI, options?: OpenerOptions): Promise<object | undefined> {
  const opener = await openerService.getOpener(uri, options);
  return opener.open(uri, options);
}

export function getDefaultHandler(uri: URI, _preferenceService: any): string | undefined {
  const associations = {};
  const defaultHandler = Object.entries(associations).find(([key]) => match(key, uri.path.base))?.[1];
  if (typeof defaultHandler === 'string') {
    return defaultHandler;
  }
  return undefined;
}

export const defaultHandlerPriority = 100_000;

export const [IOpenHandler, IOpenHandlerProvider] = createContribution("OpenHandler");
export type IOpenHandler = OpenHandler;

export class DefaultOpenerService extends InjectableService implements OpenerService {
  // Collection of open-handlers for custom-editor contributions.
  protected readonly customEditorOpenHandlers: OpenHandler[] = [];

  protected readonly onDidChangeOpenersEmitter = new Emitter<void>();
  readonly onDidChangeOpeners = this.onDidChangeOpenersEmitter.event;

  constructor(
      @Optional() @IOpenHandlerProvider protected readonly handlersProvider: IContributionProvider<IOpenHandler>,
  ) {
    super();
  }

  addHandler(openHandler: OpenHandler): IDisposable {
    this.customEditorOpenHandlers.push(openHandler);
    this.onDidChangeOpenersEmitter.fire();

    return toDisposable(() => {
      this.removeHandler(openHandler);
    });
  }

  removeHandler(openHandler: OpenHandler): void {
    this.customEditorOpenHandlers.splice(this.customEditorOpenHandlers.indexOf(openHandler), 1);
    this.onDidChangeOpenersEmitter.fire();
  }

  async getOpener(uri: URI, options?: OpenerOptions): Promise<OpenHandler> {
    const handlers = await this.prioritize(uri, options);
    if (handlers.length >= 1) {
      return handlers[0];
    }
    return Promise.reject(new Error(`There is no opener for ${uri}.`));
  }

  async getOpeners(uri?: URI, options?: OpenerOptions): Promise<OpenHandler[]> {
    return uri ? this.prioritize(uri, options) : this.getHandlers();
  }

  protected async prioritize(uri: URI, options?: OpenerOptions): Promise<OpenHandler[]> {
    const prioritized = await Prioritizeable.prioritizeAll(this.getHandlers(), async (handler) => {
      try {
        return await handler.canHandle(uri, options);
      }
      catch {
        return 0;
      }
    });
    return prioritized.map(p => p.value);
  }

  protected getHandlers(): OpenHandler[] {
    const handlers = this.handlersProvider.getContributions();

    return [
      ...handlers,
      ...this.customEditorOpenHandlers,
    ];
  }
}
export const IOpenerService = createServiceDecorator<IOpenerService>(DefaultOpenerService.name);
export type IOpenerService = DefaultOpenerService;
