import { Emitter, Event, IServiceContainer, InjectableService, Key, KeyCode, createServiceDecorator } from '@gepick/core/common';
import { AbstractWidget, Message } from '../../widget';
import { SearchBoxDebounce, SearchBoxDebounceOptions } from './search-box-debounce';

/**
 * Initializer properties for the search box widget.
 */
export interface SearchBoxProps extends SearchBoxDebounceOptions {

  /**
   * If `true`, the `Previous`, `Next`, and `Close` buttons will be visible. Otherwise, `false`. Defaults to `false`.
   */
  readonly showButtons?: boolean;

  /**
   * If `true`, `Filter` and `Close` buttons will be visible, and clicking the `Filter` button will triggers filter on the search term. Defaults to `false`.
   */
  readonly showFilter?: boolean;

}

export namespace SearchBoxProps {

  /**
   * The default search box widget option.
   */
  export const DEFAULT: SearchBoxProps = SearchBoxDebounceOptions.DEFAULT;

}

export namespace SearchBox1 {

  /**
   * CSS classes for the search box widget.
   */
  export namespace Styles {

    export const SEARCH_BOX = 'theia-search-box';
    export const SEARCH_INPUT = 'theia-search-input';
    export const SEARCH_BUTTONS_WRAPPER = 'theia-search-buttons-wrapper';
    export const BUTTON = 'theia-search-button';
    export const FILTER = ['codicon', 'codicon-filter'];
    export const FILTER_ON = 'filter-active';
    export const BUTTON_PREVIOUS = 'theia-search-button-previous';
    export const BUTTON_NEXT = 'theia-search-button-next';
    export const BUTTON_CLOSE = 'theia-search-button-close';
    export const NON_SELECTABLE = 'theia-non-selectable';
    export const NO_MATCH = 'no-match';
  }

  export interface HighlightInfo {
    filterText: string | undefined;
    matched: number;
    total: number;
  }

}

/**
 * The search box widget.
 */
export class SearchBox extends AbstractWidget {
  protected static SPECIAL_KEYS = [
    Key.ESCAPE,
    Key.BACKSPACE,
  ];

  protected static MAX_CONTENT_LENGTH = 15;

  protected readonly nextEmitter = new Emitter<void>();
  protected readonly previousEmitter = new Emitter<void>();
  protected readonly closeEmitter = new Emitter<void>();
  protected readonly textChangeEmitter = new Emitter<string | undefined>();
  protected readonly filterToggleEmitter = new Emitter<boolean>();
  protected readonly input: HTMLSpanElement;
  protected readonly filter: HTMLElement | undefined;
  protected _isFiltering: boolean = false;

  constructor(protected readonly props: SearchBoxProps, protected readonly debounce: SearchBoxDebounce) {
    super();
    [
      this.nextEmitter,
      this.previousEmitter,
      this.closeEmitter,
      this.textChangeEmitter,
      this.filterToggleEmitter,
      this.debounce,
      this.debounce.onChanged(data => this.fireTextChange(data)),
    ].forEach(d => this.toDispose.push(d));
    this.hide();
    this.update();
    const { input, filter } = this.createContent();
    this.input = input;
    this.filter = filter;
  }

  get onPrevious(): Event<void> {
    return this.previousEmitter.event;
  }

  get onNext(): Event<void> {
    return this.nextEmitter.event;
  }

  get onClose(): Event<void> {
    return this.closeEmitter.event;
  }

  get onTextChange(): Event<string | undefined> {
    return this.textChangeEmitter.event;
  }

  get onFilterToggled(): Event<boolean> {
    return this.filterToggleEmitter.event;
  }

  get isFiltering(): boolean {
    return this._isFiltering;
  }

  get keyCodePredicate(): KeyCode.Predicate {
    return this.canHandle.bind(this);
  }

  protected firePrevious(): void {
    this.previousEmitter.fire(undefined);
  }

  protected fireNext(): void {
    this.nextEmitter.fire(undefined);
  }

  protected fireClose(): void {
    this.closeEmitter.fire(undefined);
  }

  protected fireTextChange(input: string | undefined): void {
    this.textChangeEmitter.fire(input);
  }

  protected fireFilterToggle(): void {
    this.doFireFilterToggle();
  }

  protected doFireFilterToggle(toggleTo: boolean = !this._isFiltering): void {
    if (this.filter) {
      if (toggleTo) {
        this.filter.classList.add(SearchBox1.Styles.FILTER_ON);
      }
      else {
        this.filter.classList.remove(SearchBox1.Styles.FILTER_ON);
      }
      this._isFiltering = toggleTo;
      this.filterToggleEmitter.fire(toggleTo);
      this.update();
    }
  }

  handle(event: KeyboardEvent): void {
    event.preventDefault();
    const keyCode = KeyCode.createKeyCode(event);
    if (this.canHandle(keyCode)) {
      if (Key.equals(Key.ESCAPE, keyCode) || this.isCtrlBackspace(keyCode)) {
        this.hide();
      }
      else {
        this.show();
        this.handleKey(keyCode);
      }
    }
  }

  protected handleArrowUp(): void {
    this.firePrevious();
  }

  protected handleArrowDown(): void {
    this.fireNext();
  }

  override onBeforeHide(): void {
    this.removeClass(SearchBox1.Styles.NO_MATCH);
    this.doFireFilterToggle(false);
    this.debounce.append(undefined);
    this.fireClose();
  }

  protected handleKey(keyCode: KeyCode): void {
    const character = Key.equals(Key.BACKSPACE, keyCode) ? '\b' : keyCode.character;
    const data = this.debounce.append(character);
    if (data) {
      this.input.textContent = this.getTrimmedContent(data);
      this.update();
    }
    else {
      this.hide();
    }
  }

  protected getTrimmedContent(data: string): string {
    if (data.length > SearchBox.MAX_CONTENT_LENGTH) {
      return `...${data.substring(data.length - SearchBox.MAX_CONTENT_LENGTH)}`;
    }
    return data;
  }

  protected canHandle(keyCode: KeyCode | undefined): boolean {
    if (keyCode === undefined) {
      return false;
    }
    const { ctrl, alt, meta } = keyCode;
    if (this.isCtrlBackspace(keyCode)) {
      return true;
    }
    if (ctrl || alt || meta || keyCode.key === Key.SPACE) {
      return false;
    }
    if (keyCode.character || (this.isVisible && SearchBox.SPECIAL_KEYS.some(key => Key.equals(key, keyCode)))) {
      return true;
    }
    return false;
  }

  protected isCtrlBackspace(keyCode: KeyCode): boolean {
    if (keyCode.ctrl && Key.equals(Key.BACKSPACE, keyCode)) {
      return true;
    }
    return false;
  }

  updateHighlightInfo(info: SearchBox1.HighlightInfo): void {
    if (info.filterText && info.filterText.length > 0) {
      if (info.matched === 0) {
        this.addClass(SearchBox1.Styles.NO_MATCH);
      }
      else {
        this.removeClass(SearchBox1.Styles.NO_MATCH);
      }
    }
  }

  protected createContent(): {
    container: HTMLElement;
    input: HTMLSpanElement;
    filter: HTMLElement | undefined;
    previous: HTMLElement | undefined;
    next: HTMLElement | undefined;
    close: HTMLElement | undefined;
  } {
    this.node.setAttribute('tabIndex', '0');
    this.addClass(SearchBox1.Styles.SEARCH_BOX);

    const input = document.createElement('span');
    input.classList.add(SearchBox1.Styles.SEARCH_INPUT);
    this.node.appendChild(input);

    const buttons = document.createElement('div');
    buttons.classList.add(SearchBox1.Styles.SEARCH_BUTTONS_WRAPPER);
    this.node.appendChild(buttons);

    let filter: HTMLElement | undefined;
    if (this.props.showFilter) {
      filter = document.createElement('div');
      filter.classList.add(
        SearchBox1.Styles.BUTTON,
        ...SearchBox1.Styles.FILTER,
      );
      filter.title = 'Filter on Type';
      buttons.appendChild(filter);
      filter.onclick = this.fireFilterToggle.bind(this);
    }

    let previous: HTMLElement | undefined;
    let next: HTMLElement | undefined;
    let close: HTMLElement | undefined;

    if (this.props.showButtons) {
      previous = document.createElement('div');
      previous.classList.add(
        SearchBox1.Styles.BUTTON,
        SearchBox1.Styles.BUTTON_PREVIOUS,
      );
      previous.title = 'Previous (Up)';
      buttons.appendChild(previous);
      previous.onclick = () => this.firePrevious.bind(this)();

      next = document.createElement('div');
      next.classList.add(
        SearchBox1.Styles.BUTTON,
        SearchBox1.Styles.BUTTON_NEXT,
      );
      next.title = 'Next (Down)';
      buttons.appendChild(next);
      next.onclick = () => this.fireNext.bind(this)();
    }

    if (this.props.showButtons || this.props.showFilter) {
      close = document.createElement('div');
      close.classList.add(
        SearchBox1.Styles.BUTTON,
        SearchBox1.Styles.BUTTON_CLOSE,
      );
      close.title = 'Close (Escape)';
      buttons.appendChild(close);
      close.onclick = () => this.hide.bind(this)();
    }

    return {
      container: this.node,
      input,
      filter,
      previous,
      next,
      close,
    };
  }

  protected override onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg);
    this.addEventListener(this.input, 'selectstart' as any, () => false);
  }
}

/**
 * Search box factory.
 */
export const SearchBoxFactory = Symbol('SearchBoxFactory');
export interface SearchBoxFactory {

  /**
   * Creates a new search box with the given initializer properties.
   */
  (props: SearchBoxProps): SearchBox;

}

export class SearchBoxFactoryImpl extends InjectableService {
  createSearchBox(props: SearchBoxProps): SearchBox {
    const debounce = new SearchBoxDebounce(props);
    return new SearchBox(props, debounce);
  }
}
export const ISearchBoxFactory = createServiceDecorator<ISearchBoxFactory>(SearchBoxFactoryImpl.name);
export type ISearchBoxFactory = SearchBoxFactoryImpl;
