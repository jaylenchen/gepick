import { CompositeTreeNode, IPreferenceConfigurations, IPreferenceSchemaProvider, IPreferencesService } from "@gepick/core/browser";
import { Emitter, InjectableService, PostConstruct, createServiceDecorator, lodashDebounce } from "@gepick/core/common";
import { PreferenceDataProperty } from "../preference-schema";
import { COMMONLY_USED_SECTION_PREFIX, IPreferenceLayoutProvider } from "./preference-layout";
import { IPreferenceTreeLabelProvider } from "./preference-tree-label-provider";
import { Preference } from "./preference-types";

export interface CreatePreferencesGroupOptions {
  id: string;
  group: string;
  root: CompositeTreeNode;
  expanded?: boolean;
  depth?: number;
  label?: string;
}

export class PreferenceTreeGenerator extends InjectableService {
  protected _root: CompositeTreeNode;
  protected _idCache = new Map<string, string>();

  protected readonly onSchemaChangedEmitter = new Emitter<CompositeTreeNode>();
  readonly onSchemaChanged = this.onSchemaChangedEmitter.event;
  protected readonly defaultTopLevelCategory = 'extensions';

  constructor(
    @IPreferencesService protected readonly preferencesManager: IPreferencesService,
    @IPreferenceSchemaProvider protected readonly schemaProvider: IPreferenceSchemaProvider,
    @IPreferenceConfigurations protected readonly preferencesConfiguration: IPreferenceConfigurations,
    @IPreferenceLayoutProvider protected readonly layoutProvider: IPreferenceLayoutProvider,
    @IPreferenceTreeLabelProvider protected readonly labelProvider: IPreferenceTreeLabelProvider,
  ) {
    super();
  }

  get root(): CompositeTreeNode {
    return this._root ?? this.generateTree();
  }

  @PostConstruct()
  protected init(): void {
    this.doInit();
  }

  protected async doInit(): Promise<void> {
    await this.schemaProvider.ready;
    this.schemaProvider.onDidPreferenceSchemaChanged(() => this.handleChangedSchema());
    this.handleChangedSchema();
  }

  generateTree(): CompositeTreeNode {
    this._idCache.clear();
    const preferencesSchema = this.schemaProvider.getCombinedSchema();
    const propertyNames = Object.keys(preferencesSchema.properties);
    const groups = new Map<string, Preference.CompositeTreeNode>();
    const root = this.createRootNode();

    // const commonlyUsedLayout = this.layoutProvider.getCommonlyUsedLayout();
    // const commonlyUsed = this.getOrCreatePreferencesGroup({
    //   id: commonlyUsedLayout.id,
    //   group: commonlyUsedLayout.id,
    //   root,
    //   groups,
    //   label: commonlyUsedLayout.label,
    // });

    for (const layout of this.layoutProvider.getLayout()) {
      this.getOrCreatePreferencesGroup({
        id: layout.id,
        group: layout.id,
        root,
        groups,
        label: layout.label,
      });
    }
    // for (const preference of commonlyUsedLayout.settings ?? []) {
    //   if (preference in preferencesSchema.properties) {
    //     this.createLeafNode(preference, commonlyUsed, preferencesSchema.properties[preference]);
    //   }
    // }
    for (const propertyName of propertyNames) {
      const property = preferencesSchema.properties[propertyName];
      this.createBuiltinLeafNode(propertyName, property, root, groups);
      // if (!property.hidden && !property.deprecationMessage && !this.preferencesConfiguration.isSectionName(propertyName) && !OVERRIDE_PROPERTY_PATTERN.test(propertyName)) {
      //   if (property.owner) {
      //     this.createPluginLeafNode(propertyName, property, root, groups);
      //   }
      //   else {
      //     this.createBuiltinLeafNode(propertyName, property, root, groups);
      //   }
      // }
    }

    for (const group of groups.values()) {
      if (group.id !== `${COMMONLY_USED_SECTION_PREFIX}@${COMMONLY_USED_SECTION_PREFIX}`) {
        (group.children as Preference.TreeNode[]).sort((a, b) => {
          const aIsComposite = CompositeTreeNode.is(a);
          const bIsComposite = CompositeTreeNode.is(b);
          if (aIsComposite && !bIsComposite) {
            return 1;
          }
          if (bIsComposite && !aIsComposite) {
            return -1;
          }
          return a.id.localeCompare(b.id);
        });
      }
    }

    this._root = root;
    return root;
  };

  protected createBuiltinLeafNode(name: string, property: PreferenceDataProperty, root: CompositeTreeNode, groups: Map<string, Preference.CompositeTreeNode>): void {
    const { immediateParent, topLevelParent } = this.getParents(name, root, groups);
    this.createLeafNode(name, immediateParent || topLevelParent, property);
  }

  protected createPluginLeafNode(name: string, property: PreferenceDataProperty, root: CompositeTreeNode, groups: Map<string, Preference.CompositeTreeNode>): void {
    if (!property.owner) {
      return;
    }
    const groupID = this.defaultTopLevelCategory;
    const subgroupName = property.owner;
    const subsubgroupName = property.group;
    const hasGroup = Boolean(subsubgroupName);
    const toplevelParent = this.getOrCreatePreferencesGroup({
      id: groupID,
      group: groupID,
      root,
      groups,
    });
    const subgroupID = [groupID, subgroupName].join('.');
    const subgroupParent = this.getOrCreatePreferencesGroup({
      id: subgroupID,
      group: groupID,
      root: toplevelParent,
      groups,
      expanded: hasGroup,
      label: subgroupName,
    });
    const subsubgroupID = [groupID, subgroupName, subsubgroupName].join('.');
    const subsubgroupParent = hasGroup
      ? this.getOrCreatePreferencesGroup({
          id: subsubgroupID,
          group: subgroupID,
          root: subgroupParent,
          groups,
          depth: 2,
          label: subsubgroupName,
        })
      : undefined;
    this.createLeafNode(name, subsubgroupParent || subgroupParent, property);
  }

  getNodeId(preferenceId: string): string {
    return this._idCache.get(preferenceId) ?? '';
  }

  protected getParents(
    name: string,
    root: CompositeTreeNode,
    groups: Map<string, Preference.CompositeTreeNode>,
  ): {
      topLevelParent: Preference.CompositeTreeNode;
      immediateParent: Preference.CompositeTreeNode | undefined;
    } {
    const layoutItem = this.layoutProvider.getLayoutForPreference(name);
    const labels = (layoutItem?.id ?? name).split('.');
    const groupID = this.getGroupName(labels);
    const subgroupName = groupID !== labels[0]
      ? labels[0]
    // If a layout item is present, any additional segments are sections
    // If not, then the name describes a leaf node and only non-final segments are sections.
      : layoutItem || labels.length > 2
        ? labels.at(1)
        : undefined;
    const topLevelParent = this.getOrCreatePreferencesGroup({
      id: groupID,
      group: groupID,
      root,
      groups,
      label: this.generateName(groupID),
    });
    const immediateParent = subgroupName
      ? this.getOrCreatePreferencesGroup({
          id: [groupID, subgroupName].join('.'),
          group: groupID,
          root: topLevelParent,
          groups,
          label: layoutItem?.label ?? this.generateName(subgroupName),
        })
      : undefined;
    return { immediateParent, topLevelParent };
  }

  protected getGroupName(labels: string[]): string {
    const defaultGroup = labels[0];
    if (this.layoutProvider.hasCategory(defaultGroup)) {
      return defaultGroup;
    }
    return this.defaultTopLevelCategory;
  }

  protected getSubgroupName(labels: string[], computedGroupName: string): string | undefined {
    if (computedGroupName !== labels[0]) {
      return labels[0];
    }
    else if (labels.length > 1) {
      return labels[1];
    }
    else {
      return undefined;
    }
  }

  protected generateName(id: string): string {
    return this.labelProvider.formatString(id);
  }

  doHandleChangedSchema(): void {
    const newTree = this.generateTree();
    this.onSchemaChangedEmitter.fire(newTree);
  }

  handleChangedSchema = lodashDebounce(this.doHandleChangedSchema, 200);

  protected createRootNode(): CompositeTreeNode {
    return {
      id: 'root-node-id',
      name: '',
      parent: undefined,
      visible: true,
      children: [],
    };
  }

  protected createLeafNode(property: string, preferencesGroup: Preference.CompositeTreeNode, data: PreferenceDataProperty): Preference.LeafNode {
    const { group } = Preference.TreeNode.getGroupAndIdFromNodeId(preferencesGroup.id);
    const newNode: Preference.LeafNode = {
      id: `${group}@${property}`,
      preferenceId: property,
      parent: preferencesGroup,
      preference: { data },
      depth: Preference.TreeNode.isTopLevel(preferencesGroup) ? 1 : 2,
    };
    this._idCache.set(property, newNode.id);
    CompositeTreeNode.addChild(preferencesGroup, newNode);
    return newNode;
  }

  protected createPreferencesGroup(options: CreatePreferencesGroupOptions): Preference.CompositeTreeNode {
    const newNode: Preference.CompositeTreeNode = {
      id: `${options.group}@${options.id}`,
      visible: true,
      parent: options.root,
      children: [],
      expanded: false,
      selected: false,
      depth: 0,
      label: options.label,
    };
    const isTopLevel = Preference.TreeNode.isTopLevel(newNode);
    if (!(options.expanded ?? isTopLevel)) {
      delete newNode.expanded;
    }
    newNode.depth = options.depth ?? (isTopLevel ? 0 : 1);
    CompositeTreeNode.addChild(options.root, newNode);
    return newNode;
  }

  protected getOrCreatePreferencesGroup(options: CreatePreferencesGroupOptions & { groups: Map<string, Preference.CompositeTreeNode> }): Preference.CompositeTreeNode {
    const existingGroup = options.groups.get(options.id);
    if (existingGroup) { return existingGroup; }
    const newNode = this.createPreferencesGroup(options);
    options.groups.set(options.id, newNode);
    return newNode;
  };
}
export const IPreferenceTreeGenerator = createServiceDecorator<IPreferenceTreeGenerator>(PreferenceTreeGenerator.name);
export type IPreferenceTreeGenerator = PreferenceTreeGenerator;
