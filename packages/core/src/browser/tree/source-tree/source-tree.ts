import { MaybePromise } from '@gepick/core/common';
import { CompositeTreeNode, ExpandableTreeNode, SelectableTreeNode, TreeImpl, TreeNode } from '../base-tree';
import { CompositeTreeElement, TreeElement, TreeSource } from './tree-source';

export interface TreeElementNode extends TreeNode, SelectableTreeNode {
  element: TreeElement;
  parent: TreeElementNodeParent;
}
export namespace TreeElementNode {
  export function is(node: TreeNode | undefined): node is TreeElementNode {
    return SelectableTreeNode.is(node) && 'element' in node;
  }
}

export interface TreeSourceNode extends CompositeTreeNode, SelectableTreeNode {
  visible: false;
  children: TreeElementNode[];
  parent: undefined;
  source: TreeSource;
}
export namespace TreeSourceNode {
  export function is(node: TreeNode | undefined): node is TreeSourceNode {
    return CompositeTreeNode.is(node) && !node.visible && 'source' in node;
  }
  export function to(source: undefined): undefined;
  export function to(source: TreeSource): TreeSourceNode;
  export function to(source: TreeSource | undefined): TreeSourceNode | undefined;
  export function to(source: TreeSource | undefined): TreeSourceNode | undefined {
    if (!source) {
      return source;
    }
    const id = source.id || '__source__';
    return {
      id,
      name: id,
      visible: false,
      children: [],
      source,
      parent: undefined,
      selected: false,
    };
  }
}

export type TreeElementNodeParent = CompositeTreeElementNode | TreeSourceNode;

export interface CompositeTreeElementNode extends TreeElementNode, CompositeTreeNode, ExpandableTreeNode {
  element: CompositeTreeElement;
  children: TreeElementNode[];
  parent: TreeElementNodeParent;
}
export namespace CompositeTreeElementNode {
  export function is(node: TreeNode | undefined): node is CompositeTreeElementNode {
    return TreeElementNode.is(node) && CompositeTreeNode.is(node) && ExpandableTreeNode.is(node) && !!node.visible;
  }
}

export class SourceTree extends TreeImpl {
  static override name = TreeImpl.name;

  override async resolveChildren(parent: TreeElementNodeParent): Promise<TreeNode[]> {
    const elements = await this.resolveElements(parent);

    const nodes: TreeNode[] = [];
    let index = 0;
    for (const element of elements) {
      if (element.visible !== false) {
        nodes.push(this.toNode(element, index++, parent));
      }
    }

    return nodes;
  }

  protected resolveElements(parent: TreeElementNodeParent): MaybePromise<IterableIterator<TreeElement>> {
    if (TreeSourceNode.is(parent)) {
      return parent.source.getElements();
    }
    return parent.element.getElements();
  }

  protected toNode(element: TreeElement, index: number, parent: TreeElementNodeParent): TreeElementNode {
    const id = element.id ? String(element.id) : (`${parent.id}:${index}`);
    const name = id;
    const existing = this.getNode(id);
    const updated = existing && <TreeElementNode>Object.assign(existing, { element, parent });
    if (CompositeTreeElement.hasElements(element)) {
      const expand = element.expandByDefault ? element.expandByDefault() : false;
      if (updated) {
        if (!ExpandableTreeNode.is(updated)) {
          Object.assign(updated, { expanded: expand });
        }
        if (!CompositeTreeNode.is(updated)) {
          Object.assign(updated, { children: [] });
        }
        return updated;
      }
      return {
        element,
        parent,
        id,
        name,
        selected: false,
        expanded: expand,
        children: [],
      } as TreeElementNode;
    }
    if (CompositeTreeElementNode.is(updated)) {
      delete (updated as any).expanded;
      delete (updated as any).children;
    }
    if (updated) {
      if (ExpandableTreeNode.is(updated)) {
        delete (updated as any).expanded;
      }
      if (CompositeTreeNode.is(updated)) {
        delete (updated as any).children;
      }
      return updated;
    }
    return {
      element,
      parent,
      id,
      name,
      selected: false,
    };
  }
}
