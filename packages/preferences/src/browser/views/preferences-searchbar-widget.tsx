import { AbstractReactWidget, React, StatefulWidget, WidgetUtilities } from "@gepick/core/browser";
import { Emitter, PostConstruct, createServiceDecorator, pDebounce } from "@gepick/core/common";

export interface PreferencesSearchbarState {
  searchTerm: string;
}

export class PreferencesSearchbarWidget extends AbstractReactWidget implements StatefulWidget {
  static readonly ID = 'settings.header';
  static readonly LABEL = 'Settings Header';
  static readonly SEARCHBAR_ID = 'preference-searchbar';

  protected readonly onFilterStringChangedEmitter = new Emitter<string>();
  readonly onFilterChanged = this.onFilterStringChangedEmitter.event;

  protected searchbarRef: React.RefObject<HTMLInputElement> = React.createRef<HTMLInputElement>();
  protected resultsCount: number = 0;

  @PostConstruct()
  protected init(): void {
    this.id = PreferencesSearchbarWidget.ID;
    this.title.label = PreferencesSearchbarWidget.LABEL;
    this.update();
  }

  protected handleSearch = (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => this.search(e.target.value);

  protected search = pDebounce(async (value: string) => {
    this.onFilterStringChangedEmitter.fire(value);
    this.update();
  }, 200);

  focus = (): void => {
    if (this.searchbarRef.current) {
      this.searchbarRef.current.focus();
    }
  };

  /**
   * Clears the search input and all search results.
   * @param e on-click mouse event.
   */
  protected clearSearchResults = async (_e: React.MouseEvent): Promise<void> => {
    const search = document.getElementById(PreferencesSearchbarWidget.SEARCHBAR_ID) as HTMLInputElement;
    if (search) {
      search.value = '';
      await this.search(search.value);
      this.update();
    }
  };

  /**
   * Renders all search bar options.
   */
  protected renderOptionContainer(): React.ReactNode {
    const resultsCount = this.renderResultsCountOption();
    const clearAllOption = this.renderClearAllOption();
    return (
      <div className="option-buttons">
        {' '}
        {resultsCount}
        {' '}
        {clearAllOption}
        {' '}
      </div>
    );
  }

  /**
   * Renders a badge displaying search results count.
   */
  protected renderResultsCountOption(): React.ReactNode {
    let resultsFound: string;
    if (this.resultsCount === 0) {
      resultsFound = 'No Settings Found';
    }
    else if (this.resultsCount === 1) {
      resultsFound = '1 Setting Found';
    }
    else {
      resultsFound = `${this.resultsCount.toFixed(0)} Settings Found`;
    }
    return this.searchTermExists()
      ? (
          <span
            className="results-found"
            title={resultsFound}
          >
            {resultsFound}
          </span>
        )
      : '';
  }

  /**
   * Renders a clear all button.
   */
  protected renderClearAllOption(): React.ReactNode {
    return (
      <span
        className={`${WidgetUtilities.codicon('clear-all')} option ${(this.searchTermExists() ? 'enabled' : '')}`}
        title="Clear Search Results"
        onClick={this.clearSearchResults}
      />
    );
  }

  /**
   * Determines whether the search input currently has a value.
   * @returns true, if the search input currently has a value; false, otherwise.
   */
  protected searchTermExists(): boolean {
    return !!this.searchbarRef.current?.value;
  }

  protected getSearchTerm(): string {
    const search = document.getElementById(PreferencesSearchbarWidget.SEARCHBAR_ID) as HTMLInputElement;
    return search?.value;
  }

  async updateSearchTerm(searchTerm: string): Promise<void> {
    const search = document.getElementById(PreferencesSearchbarWidget.SEARCHBAR_ID) as HTMLInputElement;
    if (!search || search.value === searchTerm) {
      return;
    }
    search.value = searchTerm;
    await this.search(search.value);
    this.update();
  }

  render(): React.ReactNode {
    const optionContainer = this.renderOptionContainer();
    return (
      <div className="settings-header">
        <div className="settings-search-container" ref={this.focus}>
          <input
            type="text"
            id={PreferencesSearchbarWidget.SEARCHBAR_ID}
            spellCheck={false}
            placeholder="Search settings"
            className="settings-search-input theia-input"
            onChange={this.handleSearch}
            ref={this.searchbarRef}
          />
          {optionContainer}
        </div>
      </div>
    );
  }

  /**
   * Updates the search result count.
   * @param count the result count.
   */
  updateResultsCount(count: number): void {
    this.resultsCount = count;
    this.update();
  }

  storeState(): PreferencesSearchbarState {
    return {
      searchTerm: this.getSearchTerm(),
    };
  }

  restoreState(oldState: any): void {
    const searchInputExists = this.onDidChangeVisibility(() => {
      this.updateSearchTerm(oldState.searchTerm || '');
      searchInputExists.dispose();
    });
  }
}

export const IPreferencesSearchbarWidget = createServiceDecorator<IPreferencesSearchbarWidget>(PreferencesSearchbarWidget.name);
export type IPreferencesSearchbarWidget = PreferencesSearchbarWidget;
