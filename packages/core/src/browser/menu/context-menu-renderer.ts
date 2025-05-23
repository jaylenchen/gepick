import { DisposableCollection, IDisposable, InjectableService, MenuPath } from '@gepick/core/common';
import { ContextMatcher } from './context-key-service';

export interface Coordinate { x: number; y: number }
export const Coordinate = Symbol('Coordinate');

export type Anchor = MouseEvent | Coordinate;

export function coordinateFromAnchor(anchor: Anchor): Coordinate {
  const { x, y } = anchor instanceof MouseEvent ? { x: anchor.clientX, y: anchor.clientY } : anchor;
  return { x, y };
}

export abstract class ContextMenuAccess implements IDisposable {
  protected readonly toDispose = new DisposableCollection();
  readonly onDispose = this.toDispose.onDispose;

  constructor(toClose: IDisposable) {
    this.toDispose.push(toClose);
  }

  get disposed(): boolean {
    return this.toDispose.disposed;
  }

  dispose(): void {
    this.toDispose.dispose();
  }
}

export abstract class ContextMenuRenderer extends InjectableService {
  protected _current: ContextMenuAccess | undefined;
  protected readonly toDisposeOnSetCurrent = new DisposableCollection();
  /**
   * Currently opened context menu.
   * Rendering a new context menu will close the current.
   */
  get current(): ContextMenuAccess | undefined {
    return this._current;
  }

  protected setCurrent(current: ContextMenuAccess | undefined): void {
    if (this._current === current) {
      return;
    }
    this.toDisposeOnSetCurrent.dispose();
    this._current = current;
    if (current) {
      this.toDisposeOnSetCurrent.push(current.onDispose(() => {
        this._current = undefined;
      }));
      this.toDisposeOnSetCurrent.push(current);
    }
  }

  render(options: RenderContextMenuOptions): ContextMenuAccess {
    const resolvedOptions = this.resolve(options);
    const access = this.doRender(resolvedOptions);
    this.setCurrent(access);
    return access;
  }

  protected abstract doRender(options: RenderContextMenuOptions): ContextMenuAccess;

  protected resolve(options: RenderContextMenuOptions): RenderContextMenuOptions {
    const args: any[] = options.args ? options.args.slice() : [];
    if (options.includeAnchorArg !== false) {
      args.push(options.anchor);
    }
    return {
      ...options,
      args,
    };
  }
}

export interface RenderContextMenuOptions {
  menuPath: MenuPath;
  anchor: Anchor;
  args?: any[];
  /**
   * Whether the anchor should be passed as an argument to the handlers of commands for this context menu.
   * If true, the anchor will be appended to the list of arguments or passed as the only argument if no other
   * arguments are supplied.
   * Default is `true`.
   */
  includeAnchorArg?: boolean;
  /**
   * A DOM context for the menu to be shown
   * Will be used to attach the menu to a window and to evaluate enablement ("when"-clauses)
   */
  context: HTMLElement;
  contextKeyService?: ContextMatcher;
  onHide?: () => void;
  /**
   * If true a single submenu in the context menu is not rendered but its children are rendered on the top level.
   * Default is `false`.
   */
  skipSingleRootNode?: boolean;
}
