import { CancellationToken, DisposableStore, Emitter, Event, InjectableService, PostConstruct, SelectionProvider, WaitUntilEvent, createServiceDecorator } from '@gepick/core/common';
import { CompositeTreeNode, ITree, Tree, TreeNode } from './tree';
import { SelectableTreeNode, TreeSelection, TreeSelectionService } from './tree-selection';
import { ExpandableTreeNode, ITreeExpansionService, TreeExpansionService } from './tree-expansion';
import { ITreeNavigationService } from './tree-navigation';
import { BottomUpTreeIterator, Iterators, TopDownTreeIterator, TreeIterator } from './tree-iterator';
import { ITreeSearch, TreeSearch } from './tree-search';
import { ITreeFocusService, TreeFocusService } from './tree-focus-service';
import { ITreeSelectionService } from './tree-selection-impl';

/**
 * The tree model.
 */
export const TreeModel = Symbol('TreeModel');
export interface TreeModel extends Tree, TreeSelectionService, TreeExpansionService {

  /**
   * Expands the given node. If the `node` argument is `undefined`, then expands the currently selected tree node.
   * If multiple tree nodes are selected, expands the most recently selected tree node.
   */
  expandNode: (node?: Readonly<ExpandableTreeNode>) => Promise<Readonly<ExpandableTreeNode> | undefined>;

  /**
   * Collapses the given node. If the `node` argument is `undefined`, then collapses the currently selected tree node.
   * If multiple tree nodes are selected, collapses the most recently selected tree node.
   */
  collapseNode: (node?: Readonly<ExpandableTreeNode>) => Promise<boolean>;

  /**
   * Collapses recursively. If the `node` argument is `undefined`, then collapses the currently selected tree node.
   * If multiple tree nodes are selected, collapses the most recently selected tree node.
   */
  collapseAll: (node?: Readonly<CompositeTreeNode>) => Promise<boolean>;

  /**
   * Toggles the expansion state of the given node. If not give, then it toggles the expansion state of the currently selected node.
   * If multiple nodes are selected, then the most recently selected tree node's expansion state will be toggled.
   */
  toggleNodeExpansion: (node?: Readonly<ExpandableTreeNode>) => Promise<void>;

  /**
   * Opens the given node or the currently selected on if the argument is `undefined`.
   * If multiple nodes are selected, open the most recently selected node.
   */
  openNode: (node?: Readonly<TreeNode> | undefined) => void;

  /**
   * Event when a node should be opened.
   */
  readonly onOpenNode: Event<Readonly<TreeNode>>;

  /**
   * Selects the parent node relatively to the selected taking into account node expansion.
   */
  selectParent: () => void;

  /**
   * Navigates to the given node if it is defined. This method accepts both the tree node and its ID as an argument.
   * Navigation sets a node as a root node and expand it. Resolves to the node if the navigation was successful. Otherwise,
   * resolves to `undefined`.
   */
  navigateTo: (nodeOrId: Readonly<TreeNode> | string | undefined) => Promise<TreeNode | undefined>;
  /**
   * Tests whether it is possible to navigate forward.
   */
  canNavigateForward: () => boolean;

  /**
   * Tests whether it is possible to navigate backward.
   */
  canNavigateBackward: () => boolean;

  /**
   * Navigates forward.
   */
  navigateForward: () => Promise<void>;
  /**
   * Navigates backward.
   */
  navigateBackward: () => Promise<void>;

  /**
   * Selects the previous tree node, regardless of its selection or visibility state.
   */
  selectPrev: () => void;

  /**
   * Selects the previous node relatively to the currently selected one. This method takes the expansion state of the tree into consideration.
   */
  selectPrevNode: (type?: TreeSelection.SelectionType) => void;

  /**
   * Returns the previous tree node, regardless of its selection or visibility state.
   */
  getPrevNode: (node?: TreeNode) => TreeNode | undefined;

  /**
   * Returns the previous selectable tree node.
   */
  getPrevSelectableNode: (node?: TreeNode) => SelectableTreeNode | undefined;

  /**
   * Selects the next tree node, regardless of its selection or visibility state.
   */
  selectNext: () => void;

  /**
   * Selects the next node relatively to the currently selected one. This method takes the expansion state of the tree into consideration.
   */
  selectNextNode: (type?: TreeSelection.SelectionType) => void;

  /**
   * Returns the next tree node, regardless of its selection or visibility state.
   */
  getNextNode: (node?: TreeNode) => TreeNode | undefined;

  /**
   * Returns the next selectable tree node.
   */
  getNextSelectableNode: (node?: TreeNode) => SelectableTreeNode | undefined;

  /**
   * Selects the given tree node. Has no effect when the node does not exist in the tree. Discards any previous selection state.
   */
  selectNode: (node: Readonly<SelectableTreeNode>) => void;

  /**
   * Selects the given node if it was not yet selected, or unselects it if it was. Keeps the previous selection state and updates it
   * with the current toggle selection.
   */
  toggleNode: (node: Readonly<SelectableTreeNode>) => void;

  /**
   * Selects a range of tree nodes. The target of the selection range is the argument, the from tree node is the previous selected node.
   * If no node was selected previously, invoking this method does nothing.
   */
  selectRange: (node: Readonly<SelectableTreeNode>) => void;

  /**
   * Returns the node currently in focus in this tree, or undefined if no node is focused.
   */
  getFocusedNode: () => SelectableTreeNode | undefined;
}

export class TreeModelImpl extends InjectableService implements TreeModel, SelectionProvider<ReadonlyArray<Readonly<SelectableTreeNode>>> {
  protected readonly onChangedEmitter = new Emitter<void>();
  protected readonly onOpenNodeEmitter = new Emitter<TreeNode>();
  protected readonly toDispose = new DisposableStore();

  constructor(
    @ITree protected readonly tree: ITree,
    @ITreeExpansionService protected readonly expansionService: ITreeExpansionService,
    @ITreeNavigationService protected readonly navigationService: ITreeNavigationService,
    @ITreeFocusService protected readonly focusService: TreeFocusService,
    @ITreeSearch protected readonly treeSearch: TreeSearch,
    @ITreeSelectionService protected readonly selectionService: ITreeSelectionService,
  ) {
    super();
  }

  @PostConstruct()
  protected init(): void {
    this.toDispose.add(this.tree);
    this.toDispose.add(this.tree.onChanged(() => this.fireChanged()));

    this.toDispose.add(this.selectionService);

    this.toDispose.add(this.expansionService);
    this.toDispose.add(this.expansionService.onExpansionChanged((node) => {
      this.fireChanged();
      this.handleExpansion(node);
    }));

    this.toDispose.add(this.onOpenNodeEmitter);
    this.toDispose.add(this.onChangedEmitter);
    this.toDispose.add(this.treeSearch);
  }

  override dispose(): void {
    this.toDispose.dispose();
    super.dispose();
  }

  protected handleExpansion(node: Readonly<ExpandableTreeNode>): void {
    this.selectIfAncestorOfSelected(node);
  }

  /**
   * Select the given node if it is the ancestor of a selected node.
   */
  protected selectIfAncestorOfSelected(node: Readonly<ExpandableTreeNode>): void {
    if (!node.expanded && this.selectedNodes.some(selectedNode => CompositeTreeNode.isAncestor(node, selectedNode))) {
      if (SelectableTreeNode.isVisible(node)) {
        this.selectNode(node);
      }
    }
  }

  get root(): TreeNode | undefined {
    return this.tree.root;
  }

  set root(root: TreeNode | undefined) {
    this.tree.root = root;
  }

  get onChanged(): Event<void> {
    return this.onChangedEmitter.event;
  }

  get onOpenNode(): Event<TreeNode> {
    return this.onOpenNodeEmitter.event;
  }

  protected fireChanged(): void {
    this.onChangedEmitter.fire(undefined);
  }

  get onNodeRefreshed(): Event<Readonly<CompositeTreeNode> & WaitUntilEvent> {
    return this.tree.onNodeRefreshed;
  }

  getNode(id: string | undefined): TreeNode | undefined {
    return this.tree.getNode(id);
  }

  getFocusedNode(): SelectableTreeNode | undefined {
    return this.focusService.focusedNode;
  }

  validateNode(node: TreeNode | undefined): TreeNode | undefined {
    return this.tree.validateNode(node);
  }

  async refresh(parent?: Readonly<CompositeTreeNode>): Promise<CompositeTreeNode | undefined> {
    if (parent) {
      return this.tree.refresh(parent);
    }
    return this.tree.refresh();
  }

  // tslint:disable-next-line:typedef
  get selectedNodes() {
    return this.selectionService.selectedNodes;
  }

  // tslint:disable-next-line:typedef
  get onSelectionChanged() {
    return this.selectionService.onSelectionChanged;
  }

  get onExpansionChanged(): Event<Readonly<ExpandableTreeNode>> {
    return this.expansionService.onExpansionChanged;
  }

  async expandNode(raw?: Readonly<ExpandableTreeNode>): Promise<ExpandableTreeNode | undefined> {
    for (const node of this.getExpansionCandidates(raw)) {
      if (ExpandableTreeNode.is(node)) {
        return this.expansionService.expandNode(node);
      }
    }
    return undefined;
  }

  protected *getExpansionCandidates(raw?: Readonly<TreeNode>): IterableIterator<TreeNode | undefined> {
    yield raw;
    yield this.getFocusedNode();
    yield * this.selectedNodes;
  }

  async collapseNode(raw?: Readonly<ExpandableTreeNode>): Promise<boolean> {
    for (const node of this.getExpansionCandidates(raw)) {
      if (ExpandableTreeNode.is(node)) {
        return this.expansionService.collapseNode(node);
      }
    }
    return false;
  }

  async collapseAll(raw?: Readonly<CompositeTreeNode>): Promise<boolean> {
    const node = raw || this.getFocusedNode();
    if (SelectableTreeNode.is(node)) {
      this.selectNode(node);
    }
    if (CompositeTreeNode.is(node)) {
      return this.expansionService.collapseAll(node);
    }
    return false;
  }

  async toggleNodeExpansion(raw?: Readonly<ExpandableTreeNode>): Promise<void> {
    for (const node of raw ? [raw] : this.selectedNodes) {
      if (ExpandableTreeNode.is(node)) {
        await this.expansionService.toggleNodeExpansion(node);
      }
    }
  }

  selectPrev(): void {
    const node = this.getPrevNode();
    this.selectNodeIfSelectable(node);
  }

  selectPrevNode(type: TreeSelection.SelectionType = TreeSelection.SelectionType.DEFAULT): void {
    const node = this.getPrevSelectableNode();
    if (node) {
      this.addSelection({ node, type });
    }
  }

  getPrevNode(node: TreeNode | undefined = this.getFocusedNode()): TreeNode | undefined {
    const iterator = this.createBackwardTreeIterator(node);
    return iterator && this.doGetNode(iterator);
  }

  getPrevSelectableNode(node: TreeNode | undefined = this.getFocusedNode()): SelectableTreeNode | undefined {
    if (!node) {
      return this.getNextSelectableNode(this.root);
    }
    const iterator = this.createBackwardIterator(node);
    return iterator && this.doGetNextNode(iterator, this.isVisibleSelectableNode.bind(this));
  }

  selectNext(): void {
    const node = this.getNextNode();
    this.selectNodeIfSelectable(node);
  }

  selectNextNode(type: TreeSelection.SelectionType = TreeSelection.SelectionType.DEFAULT): void {
    const node = this.getNextSelectableNode();
    if (node) {
      this.addSelection({ node, type });
    }
  }

  getNextNode(node: TreeNode | undefined = this.getFocusedNode()): TreeNode | undefined {
    const iterator = this.createTreeIterator(node);
    return iterator && this.doGetNode(iterator);
  }

  getNextSelectableNode(node: TreeNode | undefined = this.getFocusedNode() ?? this.root): SelectableTreeNode | undefined {
    const iterator = this.createIterator(node);
    return iterator && this.doGetNextNode(iterator, this.isVisibleSelectableNode.bind(this));
  }

  protected selectNodeIfSelectable(node: TreeNode | undefined): void {
    if (SelectableTreeNode.is(node)) {
      this.addSelection(node);
    }
  }

  protected doGetNode(iterator: TreeIterator): TreeNode | undefined {
    iterator.next();
    const result = iterator.next();
    return result.done ? undefined : result.value;
  }

  protected doGetNextNode<T extends TreeNode>(iterator: TreeIterator, criterion: (node: TreeNode) => node is T): T | undefined {
    // Skip the first item. // TODO: clean this up, and skip the first item in a different way without loading everything.
    iterator.next();
    let result = iterator.next();
    while (!result.done) {
      if (criterion(result.value)) {
        return result.value;
      }
      result = iterator.next();
    }
    return undefined;
  }

  protected isVisibleSelectableNode(node: TreeNode): node is SelectableTreeNode {
    return SelectableTreeNode.isVisible(node);
  }

  protected createBackwardTreeIterator(node: TreeNode | undefined): TreeIterator | undefined {
    const { filteredNodes } = this.treeSearch;
    if (filteredNodes.length === 0) {
      return node ? new BottomUpTreeIterator(node!, { pruneCollapsed: false }) : undefined;
    }
    if (node && !filteredNodes.includes(node)) {
      return undefined;
    }
    return Iterators.cycle(filteredNodes.slice().reverse(), node);
  }

  protected createBackwardIterator(node: TreeNode | undefined): TreeIterator | undefined {
    const { filteredNodes } = this.treeSearch;
    if (filteredNodes.length === 0) {
      return node ? new BottomUpTreeIterator(node!, { pruneCollapsed: true }) : undefined;
    }
    if (node && !filteredNodes.includes(node)) {
      return undefined;
    }
    return Iterators.cycle(filteredNodes.slice().reverse(), node);
  }

  protected createTreeIterator(node: TreeNode | undefined): TreeIterator | undefined {
    const { filteredNodes } = this.treeSearch;
    if (filteredNodes.length === 0) {
      return node && new TopDownTreeIterator(node, { pruneCollapsed: false });
    }
    if (node && !filteredNodes.includes(node)) {
      return undefined;
    }
    return Iterators.cycle(filteredNodes, node);
  }

  protected createIterator(node: TreeNode | undefined): TreeIterator | undefined {
    const { filteredNodes } = this.treeSearch;
    if (filteredNodes.length === 0) {
      return node && this.createForwardIteratorForNode(node);
    }
    if (node && !filteredNodes.includes(node)) {
      return undefined;
    }
    return Iterators.cycle(filteredNodes, node);
  }

  protected createForwardIteratorForNode(node: TreeNode): TreeIterator {
    return new TopDownTreeIterator(node, { pruneCollapsed: true });
  }

  openNode(raw?: TreeNode | undefined): void {
    const node = raw ?? this.focusService.focusedNode;
    if (node) {
      this.doOpenNode(node);
      this.onOpenNodeEmitter.fire(node);
    }
  }

  protected doOpenNode(node: TreeNode): void {
    if (ExpandableTreeNode.is(node)) {
      this.toggleNodeExpansion(node);
    }
  }

  selectParent(): void {
    const node = this.getFocusedNode();
    if (node) {
      const parent = SelectableTreeNode.getVisibleParent(node);
      if (parent) {
        this.selectNode(parent);
      }
    }
  }

  async navigateTo(nodeOrId: TreeNode | string | undefined): Promise<TreeNode | undefined> {
    if (nodeOrId) {
      const node = typeof nodeOrId === 'string' ? this.getNode(nodeOrId) : nodeOrId;
      if (node) {
        this.navigationService.push(node);
        await this.doNavigate(node);
        return node;
      }
    }
    return undefined;
  }

  canNavigateForward(): boolean {
    return !!this.navigationService.next;
  }

  canNavigateBackward(): boolean {
    return !!this.navigationService.prev;
  }

  async navigateForward(): Promise<void> {
    const node = this.navigationService.advance();
    if (node) {
      await this.doNavigate(node);
    }
  }

  async navigateBackward(): Promise<void> {
    const node = this.navigationService.retreat();
    if (node) {
      await this.doNavigate(node);
    }
  }

  protected async doNavigate(node: TreeNode): Promise<void> {
    this.tree.root = node;
    if (ExpandableTreeNode.is(node)) {
      await this.expandNode(node);
    }
    if (SelectableTreeNode.is(node)) {
      this.selectNode(node);
    }
  }

  addSelection(selectionOrTreeNode: TreeSelection | Readonly<SelectableTreeNode>): void {
    this.selectionService.addSelection(selectionOrTreeNode);
  }

  clearSelection(): void {
    this.selectionService.clearSelection();
  }

  selectNode(node: Readonly<SelectableTreeNode>): void {
    this.addSelection(node);
  }

  toggleNode(node: Readonly<SelectableTreeNode>): void {
    this.addSelection({ node, type: TreeSelection.SelectionType.TOGGLE });
  }

  selectRange(node: Readonly<SelectableTreeNode>): void {
    this.addSelection({ node, type: TreeSelection.SelectionType.RANGE });
  }

  storeState(): TreeModelImpl.State {
    return {
      selection: this.selectionService.storeState(),
    };
  }

  restoreState(state: any): void {
    if (state.selection) {
      this.selectionService.restoreState(state.selection);
    }
  }

  get onDidChangeBusy(): Event<TreeNode> {
    return this.tree.onDidChangeBusy;
  }

  markAsBusy(node: Readonly<TreeNode>, ms: number, token: CancellationToken): Promise<void> {
    return this.tree.markAsBusy(node, ms, token);
  }

  get onDidUpdate(): Event<TreeNode[]> {
    return this.tree.onDidUpdate;
  }

  markAsChecked(node: TreeNode, checked: boolean): void {
    this.tree.markAsChecked(node, checked);
  }
}

export const ITreeModel = createServiceDecorator<ITreeModel>(TreeModelImpl.name);
export type ITreeModel = TreeModelImpl;

export namespace TreeModelImpl {
  export interface State {
    selection: any;
  }
}
