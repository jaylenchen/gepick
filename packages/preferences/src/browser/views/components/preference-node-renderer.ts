// *****************************************************************************
// Copyright (C) 2020 Ericsson and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Container, IDisposable, IServiceContainer, InTransientScope, InjectableService, PostConstruct, URI, createServiceDecorator, lodashDebounce } from '@gepick/core/common';
import { DOMPurify, IContextMenuRenderer, IOpenerService, IPreferencesService, JSONValue, PreferencesService, WidgetUtilities, open } from "@gepick/core/browser";
import { IPreferenceNode, Preference, PreferenceInspection, PreferenceMenus } from '../../util/preference-types';
import { IPreferenceTreeLabelProvider } from '../../util/preference-tree-label-provider';
import { PreferenceScope } from '../../preference-scope';
import { IPreferencesSearchbarWidget } from '../preferences-searchbar-widget';
import { IPreferenceTreeModel } from '../../preferences-tree-model';
import { IPreferencesScopeTabBar } from '../preferences-scope-tabbar-widget';
import { PreferenceDataProperty } from '../../preference-schema';
import { IPreferenceMarkdownRenderer } from './preference-markdown-renderer';
import { DefaultPreferenceNodeRendererCreatorRegistry, IPreferenceNodeRendererCreatorRegistry } from './preference-node-renderer-creator';

export const HEADER_CLASS = 'settings-section-category-title';
export const SUBHEADER_CLASS = 'settings-section-subcategory-title';

export interface GeneralPreferenceNodeRenderer extends IDisposable {
  node: HTMLElement;
  id: string;
  schema?: PreferenceDataProperty;
  group: string;
  nodeId: string;
  visible: boolean;
  insertBefore: (nextSibling: HTMLElement) => void;
  insertAfter: (previousSibling: HTMLElement) => void;
  appendTo: (parent: HTMLElement) => void;
  prependTo: (parent: HTMLElement) => void;
  handleValueChange?: () => void;
  handleSearchChange?: (isFiltered?: boolean) => void;
  handleScopeChange?: (isFiltered?: boolean) => void;
  hide: () => void;
  show: () => void;
}

export abstract class PreferenceNodeRenderer extends InjectableService implements GeneralPreferenceNodeRenderer {
  @IPreferenceNode protected readonly preferenceNode: IPreferenceNode;
  @IPreferenceTreeLabelProvider protected readonly labelProvider: IPreferenceTreeLabelProvider;

  protected attached = false;

  _id: string;
  _group: string;
  _subgroup: string;
  protected domNode: HTMLElement;

  get node(): HTMLElement {
    return this.domNode;
  }

  get nodeId(): string {
    return this.preferenceNode.id;
  }

  get id(): string {
    return this._id;
  }

  get group(): string {
    return this._group;
  }

  get visible(): boolean {
    return !this.node.classList.contains('hidden');
  }

  @PostConstruct()
  protected init(): void {
    this.setId();
    this.domNode = this.createDomNode();
  }

  protected setId(): void {
    const { id, group } = Preference.TreeNode.getGroupAndIdFromNodeId(this.preferenceNode.id);
    const segments = id.split('.');
    this._id = id;
    this._group = group;
    this._subgroup = (group === segments[0] ? segments[1] : segments[0]) ?? '';
  }

  protected abstract createDomNode(): HTMLElement;

  protected getAdditionalNodeClassnames(): Iterable<string> {
    return [];
  }

  insertBefore(nextSibling: HTMLElement): void {
    nextSibling.insertAdjacentElement('beforebegin', this.domNode);
    this.attached = true;
  }

  insertAfter(previousSibling: HTMLElement): void {
    previousSibling.insertAdjacentElement('afterend', this.domNode);
  }

  appendTo(parent: HTMLElement): void {
    parent.appendChild(this.domNode);
  }

  prependTo(parent: HTMLElement): void {
    parent.prepend(this.domNode);
  }

  hide(): void {
    this.domNode.classList.add('hidden');
  }

  show(): void {
    this.domNode.classList.remove('hidden');
  }

  override dispose(): void {
    this.domNode.remove();
    super.dispose();
  }
}

@InTransientScope()
export class PreferenceHeaderRenderer extends PreferenceNodeRenderer {
  protected createDomNode(): HTMLElement {
    const wrapper = document.createElement('ul');
    wrapper.className = 'settings-section';
    wrapper.id = `${this.preferenceNode.id}-editor`;
    const isCategory = Preference.TreeNode.isTopLevel(this.preferenceNode);
    const hierarchyClassName = isCategory ? HEADER_CLASS : SUBHEADER_CLASS;
    const name = this.labelProvider.getName(this.preferenceNode);
    const label = document.createElement('li');
    label.classList.add('settings-section-title', hierarchyClassName);
    label.textContent = name;
    wrapper.appendChild(label);
    return wrapper;
  }
}

export abstract class PreferenceLeafNodeRenderer<ValueType extends JSONValue, InteractableType extends HTMLElement> extends PreferenceNodeRenderer implements Required<GeneralPreferenceNodeRenderer> {
  @IPreferenceNode protected declare readonly preferenceNode: IPreferenceNode;
  @IPreferencesService protected readonly preferenceService: IPreferencesService;
  @IContextMenuRenderer protected readonly menuRenderer: IContextMenuRenderer;
  @IPreferencesScopeTabBar protected readonly scopeTracker: IPreferencesScopeTabBar;
  @IPreferenceTreeModel protected readonly model: IPreferenceTreeModel;
  @IPreferencesSearchbarWidget protected readonly searchbar: IPreferencesSearchbarWidget;
  @IOpenerService protected readonly openerService: IOpenerService;
  @IPreferenceMarkdownRenderer protected readonly markdownRenderer: IPreferenceMarkdownRenderer;

  protected headlineWrapper: HTMLDivElement;
  protected gutter: HTMLDivElement;
  protected interactable: InteractableType;
  protected inspection: PreferenceInspection<ValueType> | undefined;
  protected isModifiedFromDefault = false;

  get schema(): PreferenceDataProperty {
    return (this.preferenceNode as any).preference.data;
  }

  @PostConstruct()
  protected override init(): void {
    this.setId();
    this.updateInspection();
    this.domNode = this.createDomNode();
    this.updateModificationStatus();
  }

  protected updateInspection(): void {
    this.inspection = this.preferenceService.inspect<ValueType>(this.id, this.scopeTracker.currentScope.uri) as any;
  }

  protected openLink(event: MouseEvent): void {
    if (event.target instanceof HTMLAnchorElement) {
      event.preventDefault();
      event.stopPropagation();
      // Exclude right click
      if (event.button < 2) {
        const uri = new URI(event.target.href);
        open(this.openerService, uri);
      }
    }
  }

  protected createDomNode(): HTMLLIElement {
    const wrapper = document.createElement('li');
    wrapper.classList.add('single-pref');
    wrapper.id = `${this.id}-editor`;
    wrapper.tabIndex = 0;
    wrapper.setAttribute('data-pref-id', this.id);
    wrapper.setAttribute('data-node-id', this.preferenceNode.id);

    const headlineWrapper = document.createElement('div');
    headlineWrapper.classList.add('pref-name');
    headlineWrapper.title = this.id;
    this.headlineWrapper = headlineWrapper;
    wrapper.appendChild(headlineWrapper);

    this.updateHeadline();

    const gutter = document.createElement('div');
    gutter.classList.add('pref-context-gutter');
    this.gutter = gutter;
    wrapper.appendChild(gutter);

    const cog = document.createElement('i');
    cog.className = `${WidgetUtilities.codicon('settings-gear', true)} settings-context-menu-btn`;
    cog.setAttribute('aria-label', 'Open Context Menu');
    cog.setAttribute('role', 'button');
    cog.onclick = this.handleCogAction.bind(this);
    cog.onkeydown = this.handleCogAction.bind(this);
    cog.title = 'More Actions...';
    gutter.appendChild(cog);

    const contentWrapper = document.createElement('div');
    contentWrapper.classList.add('pref-content-container', ...this.getAdditionalNodeClassnames());
    wrapper.appendChild(contentWrapper);

    const { description, markdownDescription } = this.preferenceNode.preference.data;
    if (markdownDescription || description) {
      const descriptionWrapper = document.createElement('div');
      descriptionWrapper.classList.add('pref-description');
      if (markdownDescription) {
        const renderedDescription = this.markdownRenderer.render(markdownDescription);
        descriptionWrapper.onauxclick = this.openLink.bind(this);
        descriptionWrapper.onclick = this.openLink.bind(this);
        descriptionWrapper.oncontextmenu = () => false;
        descriptionWrapper.innerHTML = DOMPurify.sanitize(renderedDescription, {
          ALLOW_UNKNOWN_PROTOCOLS: true,
        });
      }
      else if (description) {
        descriptionWrapper.textContent = description;
      }
      contentWrapper.appendChild(descriptionWrapper);
    }

    const interactableWrapper = document.createElement('div');
    interactableWrapper.classList.add('pref-input');
    contentWrapper.appendChild(interactableWrapper);
    this.createInteractable(interactableWrapper);

    return wrapper;
  }

  protected handleCogAction({ currentTarget }: KeyboardEvent | MouseEvent): void {
    const value = Preference.getValueInScope(this.inspection, this.scopeTracker.currentScope.scope) ?? this.inspection?.defaultValue;
    const target = currentTarget as HTMLElement | undefined;
    if (target && value !== undefined) {
      this.showCog();
      const domRect = target.getBoundingClientRect();
      this.menuRenderer.render({
        menuPath: PreferenceMenus.PREFERENCE_EDITOR_CONTEXT_MENU,
        anchor: { x: domRect.left, y: domRect.bottom },
        args: [{ id: this.id, value }],
        context: target,
        onHide: () => this.hideCog(),
      });
    }
  }

  protected addModifiedMarking(): void {
    this.gutter.classList.add('theia-mod-item-modified');
  }

  protected removeModifiedMarking(): void {
    this.gutter.classList.remove('theia-mod-item-modified');
  }

  protected showCog(): void {
    this.gutter.classList.add('show-cog');
  }

  protected hideCog(): void {
    this.gutter.classList.remove('show-cog');
  }

  protected updateModificationStatus(knownCurrentValue?: JSONValue): void {
    const wasModified = this.isModifiedFromDefault;
    const { inspection } = this;
    const valueInCurrentScope = knownCurrentValue ?? Preference.getValueInScope(inspection, this.scopeTracker.currentScope.scope);
    this.isModifiedFromDefault = valueInCurrentScope !== undefined && !PreferencesService.deepEqual(valueInCurrentScope, inspection?.defaultValue);
    if (wasModified !== this.isModifiedFromDefault) {
      this.gutter.classList.toggle('theia-mod-item-modified', this.isModifiedFromDefault);
    }
  }

  protected updateHeadline(filtered = this.model.isFiltered): void {
    const { headlineWrapper } = this;
    if (this.headlineWrapper.childElementCount === 0) {
      const name = this.labelProvider.getName(this.preferenceNode);
      const nameWrapper = document.createElement('span');
      nameWrapper.classList.add('preference-leaf-headline-name');
      nameWrapper.textContent = name;
      headlineWrapper.appendChild(nameWrapper);
    }
    const prefix = this.labelProvider.getPrefix(this.preferenceNode, filtered);
    const currentFirstChild = headlineWrapper.children[0];
    const currentFirstChildIsPrefix = currentFirstChild.classList.contains('preference-leaf-headline-prefix');
    if (prefix) {
      let prefixWrapper;
      if (currentFirstChildIsPrefix) {
        prefixWrapper = currentFirstChild;
      }
      else {
        prefixWrapper = document.createElement('span');
        prefixWrapper.classList.add('preference-leaf-headline-prefix');
        headlineWrapper.insertBefore(prefixWrapper, currentFirstChild);
      }
      prefixWrapper.textContent = prefix;
    }
    else if (currentFirstChildIsPrefix) {
      headlineWrapper.removeChild(currentFirstChild);
    }

    const currentLastChild = headlineWrapper.lastChild as HTMLElement;
    if (currentLastChild.classList.contains('preference-leaf-headline-suffix')) {
      this.compareOtherModifiedScopes(headlineWrapper, currentLastChild);
    }
    else {
      this.createOtherModifiedScopes(headlineWrapper);
    }
  }

  protected compareOtherModifiedScopes(headlineWrapper: HTMLDivElement, currentSuffix: HTMLElement): void {
    const modifiedScopes = this.getModifiedScopesAsStrings();
    if (modifiedScopes.length === 0) {
      headlineWrapper.removeChild(currentSuffix);
    }
    else {
      const modifiedMessagePrefix = currentSuffix.children[0] as HTMLElement;
      const newMessagePrefix = this.getModifiedMessagePrefix();
      if (modifiedMessagePrefix.textContent !== newMessagePrefix) {
        modifiedMessagePrefix.textContent = newMessagePrefix;
      }

      const [firstModifiedScope, secondModifiedScope] = modifiedScopes;

      const firstScopeMessage = currentSuffix.children[1] as HTMLElement;
      const secondScopeMessage = currentSuffix.children[2] as HTMLElement;
      firstScopeMessage.children[0].textContent = PreferenceScope[firstModifiedScope];
      this.addEventHandlerToModifiedScope(firstModifiedScope, firstScopeMessage.children[0] as HTMLElement);
      if (modifiedScopes.length === 1 && secondScopeMessage) {
        currentSuffix.removeChild(secondScopeMessage);
      }
      else if (modifiedScopes.length === 2 && !secondScopeMessage) {
        const newSecondMessage = this.createModifiedScopeMessage(secondModifiedScope);
        currentSuffix.appendChild(newSecondMessage);
      }
      // If both scopes are modified and both messages are present, do nothing.
    }
  }

  protected createOtherModifiedScopes(headlineWrapper: HTMLDivElement): void {
    const modifiedScopes = this.getModifiedScopesAsStrings();
    if (modifiedScopes.length !== 0) {
      const wrapper = document.createElement('i');
      wrapper.classList.add('preference-leaf-headline-suffix');
      headlineWrapper.appendChild(wrapper);

      const messagePrefix = this.getModifiedMessagePrefix();
      const messageWrapper = document.createElement('span');
      messageWrapper.classList.add('preference-other-modified-scope-alert');
      messageWrapper.textContent = messagePrefix;
      wrapper.appendChild(messageWrapper);
      modifiedScopes.forEach((scopeName) => {
        const scopeWrapper = this.createModifiedScopeMessage(scopeName);
        wrapper.appendChild(scopeWrapper);
      });
    }
  }

  protected createModifiedScopeMessage(scope: PreferenceScope): HTMLSpanElement {
    const scopeWrapper = document.createElement('span');
    scopeWrapper.classList.add('preference-modified-scope-wrapper');
    const scopeInteractable = document.createElement('span');
    scopeInteractable.classList.add('preference-scope-underlined');
    const scopeName = PreferenceScope[scope];
    this.addEventHandlerToModifiedScope(scope, scopeInteractable);
    scopeInteractable.textContent = scopeName;
    scopeWrapper.appendChild(scopeInteractable);
    return scopeWrapper;
  }

  protected getModifiedMessagePrefix(): string {
    return `${this.isModifiedFromDefault ? 'Also modified in' : 'Modified in'}: `;
  }

  protected addEventHandlerToModifiedScope(scope: PreferenceScope, scopeWrapper: HTMLElement): void {
    if (scope === PreferenceScope.User || scope === PreferenceScope.Workspace) {
      const eventHandler = () => {
        this.scopeTracker.setScope(scope);
        this.searchbar.updateSearchTerm(this.id);
      };
      scopeWrapper.onclick = eventHandler;
      scopeWrapper.onkeydown = eventHandler;
      scopeWrapper.tabIndex = 0;
    }
    else {
      scopeWrapper.onclick = null;
      scopeWrapper.onkeydown = null;
      scopeWrapper.tabIndex = -1;
    }
  }

  protected getModifiedScopesAsStrings(): PreferenceScope[] {
    const currentScopeInView = this.scopeTracker.currentScope.scope;
    const { inspection } = this;
    const modifiedScopes = [];
    if (inspection) {
      for (const otherScope of [PreferenceScope.User, PreferenceScope.Workspace]) {
        if (otherScope !== currentScopeInView) {
          const valueInOtherScope = Preference.getValueInScope(inspection, otherScope);
          if (valueInOtherScope !== undefined && !PreferencesService.deepEqual(valueInOtherScope, inspection.defaultValue)) {
            modifiedScopes.push(otherScope);
          }
        }
      }
    }
    return modifiedScopes;
  }

  // Many preferences allow `null` and even use it as a default regardless of the declared type.
  protected getValue(): ValueType | null {
    let currentValue = Preference.getValueInScope(this.inspection, this.scopeTracker.currentScope.scope);
    if (currentValue === undefined) {
      currentValue = this.inspection?.defaultValue;
    }
    return currentValue !== undefined ? currentValue : this.getFallbackValue();
  }

  protected setPreferenceWithDebounce = lodashDebounce(this.setPreferenceImmediately.bind(this), 500, { leading: false, trailing: true });

  protected setPreferenceImmediately(value: ValueType | undefined): Promise<void> {
    return this.preferenceService.set(this.id, value, this.scopeTracker.currentScope.scope, this.scopeTracker.currentScope.uri)
      .catch(() => this.handleValueChange());
  }

  handleSearchChange(isFiltered = this.model.isFiltered): void {
    this.updateHeadline(isFiltered);
  }

  handleScopeChange(isFiltered = this.model.isFiltered): void {
    this.handleValueChange();
    this.updateHeadline(isFiltered);
  }

  handleValueChange(): void {
    this.doHandleValueChange();
    this.updateHeadline();
  }

  /**
   * Should create an HTML element that the user can interact with to change the value of the preference.
   * @param container the parent element for the interactable. This method is responsible for adding the new element to its parent.
   */
  protected abstract createInteractable(container: HTMLElement): void;
  /**
   * @returns a fallback default value for a preference of the type implemented by a concrete leaf renderer
   * This function is only called if the default value for a given preference is not specified in its schema.
   */
  protected abstract getFallbackValue(): ValueType;
  /**
   * This function is responsible for reconciling the display of the preference value with the value reported by the PreferenceService.
   */
  protected abstract doHandleValueChange(): void;
}

export class PreferenceNodeRendererFactory extends InjectableService {
  constructor(
    @IServiceContainer protected readonly serviceContainer: Container,
  ) {
    super();
  }

  createNodeReaderer(node: Preference.TreeNode) {
    const registry = this.serviceContainer.get<IPreferenceNodeRendererCreatorRegistry>(DefaultPreferenceNodeRendererCreatorRegistry.getServiceId());
    const creator = registry.getPreferenceNodeRendererCreator(node);
    return creator.createRenderer(node, this.serviceContainer);
  }
}
export const IPreferenceNodeRendererFactory = createServiceDecorator<IPreferenceNodeRendererFactory>(PreferenceNodeRendererFactory.name);
export type IPreferenceNodeRendererFactory = PreferenceNodeRendererFactory;
