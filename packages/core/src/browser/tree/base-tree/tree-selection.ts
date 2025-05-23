import { Event, IDisposable, SelectionProvider, isObject } from '@gepick/core/common';
import { TreeNode } from './tree';

/**
 * The tree selection service.
 */
export const TreeSelectionService = Symbol('TreeSelectionService');
export interface TreeSelectionService extends IDisposable, SelectionProvider<ReadonlyArray<Readonly<SelectableTreeNode>>> {

  /**
   * The tree selection, representing the selected nodes from the tree. If nothing is selected, the
   * result will be empty.
   */
  readonly selectedNodes: ReadonlyArray<Readonly<SelectableTreeNode>>;

  /**
   * Emitted when the selection has changed in the tree.
   */
  readonly onSelectionChanged: Event<ReadonlyArray<Readonly<SelectableTreeNode>>>;

  /**
   * Registers the given selection into the tree selection service. If the selection state changes after adding the
   * `selectionOrTreeNode` argument, a selection changed event will be fired. If the argument is a tree node,
   * a it will be treated as a tree selection with the default selection type.
   */
  addSelection: (selectionOrTreeNode: TreeSelection | Readonly<SelectableTreeNode>) => void;

  /**
   * Clears all selected nodes
   */
  clearSelection: () => void;

  /**
   * Store selection state.
   */
  storeState: () => object;

  /**
   * Restore selection state.
   */
  restoreState: (state: object) => void;

}

/**
 * Representation of a tree selection.
 */
export interface TreeSelection {

  /**
   * The actual item that has been selected.
   */
  readonly node: Readonly<SelectableTreeNode>;

  /**
   * The optional tree selection type. Defaults to `SelectionType.DEFAULT`;
   */
  readonly type?: TreeSelection.SelectionType;

}

export namespace TreeSelection {

  /**
   * Enumeration of selection types.
   */
  export enum SelectionType {
    DEFAULT,
    TOGGLE,
    RANGE,
  }

  export function is(arg: unknown): arg is TreeSelection {
    return isObject(arg) && 'node' in arg;
  }

  export function isRange(arg: TreeSelection | SelectionType | undefined): boolean {
    return isSelectionTypeOf(arg, SelectionType.RANGE);
  }

  export function isToggle(arg: TreeSelection | SelectionType | undefined): boolean {
    return isSelectionTypeOf(arg, SelectionType.TOGGLE);
  }

  function isSelectionTypeOf(arg: TreeSelection | SelectionType | undefined, expected: SelectionType): boolean {
    if (arg === undefined) {
      return false;
    }
    const type = typeof arg === 'number' ? arg : arg.type;
    return type === expected;
  }

}

/**
 * A selectable tree node.
 */
export interface SelectableTreeNode extends TreeNode {

  /**
   * `true` if the tree node is selected. Otherwise, `false`.
   */
  selected: boolean;

  /**
   * @deprecated @since 1.27.0. Use TreeFocusService to track the focused node.
   *
   * `true` if the tree node has the focus. Otherwise, `false`. Defaults to `false`.
   */
  focus?: boolean;

}

export namespace SelectableTreeNode {

  export function is(node: unknown): node is SelectableTreeNode {
    return TreeNode.is(node) && 'selected' in node;
  }

  export function isSelected(node: unknown): node is SelectableTreeNode {
    return is(node) && node.selected;
  }

  /**
   * @deprecated @since 1.27.0. Use TreeFocusService to track the focused node.
   */
  export function hasFocus(node: TreeNode | undefined): boolean {
    return is(node) && node.focus === true;
  }

  export function isVisible(node: TreeNode | undefined): node is SelectableTreeNode {
    return is(node) && TreeNode.isVisible(node);
  }

  export function getVisibleParent(node: TreeNode | undefined): SelectableTreeNode | undefined {
    if (node) {
      if (isVisible(node.parent)) {
        return node.parent;
      }
      return getVisibleParent(node.parent);
    }

    return undefined;
  }
}
