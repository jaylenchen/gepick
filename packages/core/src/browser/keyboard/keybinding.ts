import { Command, DisposableCollection, Emitter, Event, ICommandRegistry, IContributionProvider, IDisposable, InjectableService, Key, KeyCode, KeySequence, Keybinding, createContribution, createServiceDecorator, isOSX, toDisposable } from "@gepick/core/common";
import { IContextKeyService } from "../menu";
import { IKeyBindingProvider, IKeybindingContext, IKeybindingContextProvider } from "./keybinding-contribution";
import { KeybindingContext, KeybindingContexts } from "./keybinding-context";
import { IKeyboardLayoutService } from "./keyboard-layout-service";

export enum KeybindingScope {
  DEFAULT,
  USER,
  WORKSPACE,
  END,
}
export namespace KeybindingScope {
  export const length = KeybindingScope.END - KeybindingScope.DEFAULT;
}

export interface ResolvedKeybinding extends Keybinding {
  /**
   * The KeyboardLayoutService may transform the `keybinding` depending on the
   * user's keyboard layout. This property holds the transformed keybinding that
   * should be used in the UI. The value is undefined if the KeyboardLayoutService
   * has not been called yet to resolve the keybinding.
   */
  resolved?: KeyCode[];
}

export interface ScopedKeybinding extends Keybinding {
  /** Current keybinding scope */
  scope: KeybindingScope;
}

export const KeybindingContribution = Symbol('KeybindingContribution');
/**
 * Allows extensions to contribute {@link Keybinding}s
 */
export interface KeybindingContribution {
  /**
   * Registers keybindings.
   * @param keybindings the keybinding registry.
   */
  registerKeybindings: (keybindings: KeybindingRegistry) => void;
}

export class KeybindingRegistry extends InjectableService {
  static readonly PASSTHROUGH_PSEUDO_COMMAND = 'passthrough';
  protected keySequence: KeySequence = [];

  protected readonly contexts: { [id: string]: IKeybindingContext } = {};
  protected readonly keymaps: ScopedKeybinding[][] = [...Array(KeybindingScope.length)].map(() => []);

  constructor(
    @ICommandRegistry protected readonly commandRegistry: ICommandRegistry,
    @IContextKeyService protected readonly whenContextService: IContextKeyService,
    @IKeyboardLayoutService protected readonly keyboardLayoutService: IKeyboardLayoutService,
    @IKeyBindingProvider protected readonly contributions: IKeyBindingProvider,
    @IKeybindingContextProvider protected readonly contextProvider: IKeybindingContextProvider,
  ) {
    super();
  }

  async onStart(): Promise<void> {
    await this.keyboardLayoutService.initialize();
    this.keyboardLayoutService.onKeyboardLayoutChanged(() => {
      this.clearResolvedKeybindings();
      this.keybindingsChanged.fire(undefined);
    });
    this.registerContext(KeybindingContexts.NOOP_CONTEXT);
    this.registerContext(KeybindingContexts.DEFAULT_CONTEXT);
    this.registerContext(...this.contextProvider.getContributions());
    for (const contribution of this.contributions.getContributions()) {
      contribution.registerKeybindings(this);
    }
  }

  protected keybindingsChanged = new Emitter<void>();

  /**
   * Event that is fired when the resolved keybindings change due to a different keyboard layout
   * or when a new keymap is being set
   */
  get onKeybindingsChanged(): Event<void> {
    return this.keybindingsChanged.event;
  }

  /**
   * Registers the keybinding context arguments into the application. Fails when an already registered
   * context is being registered.
   *
   * @param contexts the keybinding contexts to register into the application.
   */
  protected registerContext(...contexts: KeybindingContext[]): void {
    for (const context of contexts) {
      const { id } = context;
      if (this.contexts[id]) {
        console.error(`A keybinding context with ID ${id} is already registered.`);
      }
      else {
        this.contexts[id] = context;
      }
    }
  }

  /**
   * Register a default keybinding to the registry.
   *
   * Keybindings registered later have higher priority during evaluation.
   *
   * @param binding the keybinding to be registered
   */
  registerKeybinding(binding: Keybinding): IDisposable {
    return this.doRegisterKeybinding(binding);
  }

  /**
   * Register multiple default keybindings to the registry
   *
   * @param bindings An array of keybinding to be registered
   */
  registerKeybindings(...bindings: Keybinding[]): IDisposable {
    return this.doRegisterKeybindings(bindings, KeybindingScope.DEFAULT);
  }

  /**
   * Unregister all keybindings from the registry that are bound to the key of the given keybinding
   *
   * @param binding a keybinding specifying the key to be unregistered
   */
  unregisterKeybinding(binding: Keybinding): void;
  /**
   * Unregister all keybindings with the given key from the registry
   *
   * @param key a key to be unregistered
   */
  unregisterKeybinding(key: string): void;
  /**
   * Unregister all existing keybindings for the given command
   * @param command the command to unregister all keybindings for
   */
  unregisterKeybinding(command: Command): void;

  unregisterKeybinding(arg: Keybinding | string | Command): void {
    const keymap = this.keymaps[KeybindingScope.DEFAULT];
    const filter = Command.is(arg)
      ? ({ command }: Keybinding) => command === arg.id
      : ({ keybinding }: Keybinding) => Keybinding.is(arg)
          ? keybinding === arg.keybinding
          : keybinding === arg;
    for (const binding of keymap.filter(filter)) {
      const idx = keymap.indexOf(binding);
      if (idx !== -1) {
        keymap.splice(idx, 1);
      }
    }
  }

  protected doRegisterKeybindings(bindings: Keybinding[], scope: KeybindingScope = KeybindingScope.DEFAULT): IDisposable {
    const toDispose = new DisposableCollection();
    for (const binding of bindings) {
      toDispose.push(this.doRegisterKeybinding(binding, scope));
    }
    return toDispose;
  }

  protected doRegisterKeybinding(binding: Keybinding, scope: KeybindingScope = KeybindingScope.DEFAULT): IDisposable {
    try {
      this.resolveKeybinding(binding);
      const scoped = Object.assign(binding, { scope });
      this.insertBindingIntoScope(scoped, scope);
      return toDisposable(() => {
        const index = this.keymaps[scope].indexOf(scoped);
        if (index !== -1) {
          this.keymaps[scope].splice(index, 1);
        }
      });
    }
    catch (error) {
      console.warn(`Could not register keybinding:\n  ${Keybinding.stringify(binding)}\n${error}`);
      return toDisposable(() => {});
    }
  }

  /**
   * Ensures that keybindings are inserted in order of increasing length of binding to ensure that if a
   * user triggers a short keybinding (e.g. ctrl+k), the UI won't wait for a longer one (e.g. ctrl+k enter)
   */
  protected insertBindingIntoScope(item: Keybinding & { scope: KeybindingScope }, scope: KeybindingScope): void {
    const scopedKeymap = this.keymaps[scope];
    const getNumberOfKeystrokes = (binding: Keybinding): number => (binding.keybinding.trim().match(/\s/g)?.length ?? 0) + 1;
    const numberOfKeystrokesInBinding = getNumberOfKeystrokes(item);
    const indexOfFirstItemWithEqualStrokes = scopedKeymap.findIndex(existingBinding => getNumberOfKeystrokes(existingBinding) === numberOfKeystrokesInBinding);
    if (indexOfFirstItemWithEqualStrokes > -1) {
      scopedKeymap.splice(indexOfFirstItemWithEqualStrokes, 0, item);
    }
    else {
      scopedKeymap.push(item);
    }
  }

  /**
   * Ensure that the `resolved` property of the given binding is set by calling the KeyboardLayoutService.
   */
  resolveKeybinding(binding: ResolvedKeybinding): KeyCode[] {
    if (!binding.resolved) {
      const sequence = KeySequence.parse(binding.keybinding);
      binding.resolved = sequence.map(code => this.keyboardLayoutService.resolveKeyCode(code));
    }
    return binding.resolved;
  }

  /**
   * Clear all `resolved` properties of registered keybindings so the KeyboardLayoutService is called
   * again to resolve them. This is necessary when the user's keyboard layout has changed.
   */
  protected clearResolvedKeybindings(): void {
    for (let i = KeybindingScope.DEFAULT; i < KeybindingScope.END; i++) {
      const bindings = this.keymaps[i];
      for (let j = 0; j < bindings.length; j++) {
        const binding = bindings[j] as ResolvedKeybinding;
        binding.resolved = undefined;
      }
    }
  }

  /**
   * Checks whether a colliding {@link Keybinding} exists in a specific scope.
   * @param binding the keybinding to check
   * @param scope the keybinding scope to check
   * @returns true if there is a colliding keybinding
   */
  containsKeybindingInScope(binding: Keybinding, scope = KeybindingScope.USER): boolean {
    const bindingKeySequence = this.resolveKeybinding(binding);
    const collisions = this.getKeySequenceCollisions(this.getUsableBindings(this.keymaps[scope]), bindingKeySequence)
      .filter(b => b.context === binding.context && !b.when && !binding.when);
    if (collisions.full.length > 0) {
      return true;
    }
    if (collisions.partial.length > 0) {
      return true;
    }
    if (collisions.shadow.length > 0) {
      return true;
    }
    return false;
  }

  /**
   * Get a user visible representation of a {@link Keybinding}.
   * @returns an array of strings representing all elements of the {@link KeySequence} defined by the {@link Keybinding}
   * @param keybinding the keybinding
   * @param separator the separator to be used to stringify {@link KeyCode}s that are part of the {@link KeySequence}
   */
  acceleratorFor(keybinding: Keybinding, separator: string = ' ', asciiOnly = false): string[] {
    const bindingKeySequence = this.resolveKeybinding(keybinding);
    return this.acceleratorForSequence(bindingKeySequence, separator, asciiOnly);
  }

  /**
   * Get a user visible representation of a {@link KeySequence}.
   * @returns an array of strings representing all elements of the {@link KeySequence}
   * @param keySequence the keysequence
   * @param separator the separator to be used to stringify {@link KeyCode}s that are part of the {@link KeySequence}
   */
  acceleratorForSequence(keySequence: KeySequence, separator: string = ' ', asciiOnly = false): string[] {
    return keySequence.map(keyCode => this.acceleratorForKeyCode(keyCode, separator, asciiOnly));
  }

  /**
   * Get a user visible representation of a key code (a key with modifiers).
   * @returns a string representing the {@link KeyCode}
   * @param keyCode the keycode
   * @param separator the separator used to separate keys (key and modifiers) in the returning string
   * @param asciiOnly if `true`, no special characters will be substituted into the string returned. Ensures correct keyboard shortcuts in Electron menus.
   */
  acceleratorForKeyCode(keyCode: KeyCode, separator: string = ' ', asciiOnly = false): string {
    return this.componentsForKeyCode(keyCode, asciiOnly).join(separator);
  }

  componentsForKeyCode(keyCode: KeyCode, asciiOnly = false): string[] {
    const keyCodeResult = [];
    const useSymbols = isOSX && !asciiOnly;
    if (keyCode.meta && isOSX) {
      keyCodeResult.push(useSymbols ? '⌘' : 'Cmd');
    }
    if (keyCode.ctrl) {
      keyCodeResult.push(useSymbols ? '⌃' : 'Ctrl');
    }
    if (keyCode.alt) {
      keyCodeResult.push(useSymbols ? '⌥' : 'Alt');
    }
    if (keyCode.shift) {
      keyCodeResult.push(useSymbols ? '⇧' : 'Shift');
    }
    if (keyCode.key) {
      keyCodeResult.push(this.acceleratorForKey(keyCode.key, asciiOnly));
    }
    return keyCodeResult;
  }

  /**
   * @param asciiOnly if `true`, no special characters will be substituted into the string returned. Ensures correct keyboard shortcuts in Electron menus.
   *
   * Return a user visible representation of a single key.
   */
  acceleratorForKey(key: Key, asciiOnly = false): string {
    if (isOSX && !asciiOnly) {
      if (key === Key.ARROW_LEFT) {
        return '←';
      }
      if (key === Key.ARROW_RIGHT) {
        return '→';
      }
      if (key === Key.ARROW_UP) {
        return '↑';
      }
      if (key === Key.ARROW_DOWN) {
        return '↓';
      }
    }
    const keyString = this.keyboardLayoutService.getKeyboardCharacter(key);
    if (key.keyCode >= Key.KEY_A.keyCode && key.keyCode <= Key.KEY_Z.keyCode
      || key.keyCode >= Key.F1.keyCode && key.keyCode <= Key.F24.keyCode) {
      return keyString.toUpperCase();
    }
    else if (keyString.length > 1) {
      return keyString.charAt(0).toUpperCase() + keyString.slice(1);
    }
    else {
      return keyString;
    }
  }

  /**
   * Finds collisions for a key sequence inside a list of bindings (error-free)
   *
   * @param bindings the reference bindings
   * @param candidate the sequence to match
   */
  protected getKeySequenceCollisions(bindings: ScopedKeybinding[], candidate: KeySequence): KeybindingRegistry.KeybindingsResult {
    const result = new KeybindingRegistry.KeybindingsResult();
    for (const binding of bindings) {
      try {
        const bindingKeySequence = this.resolveKeybinding(binding);
        const compareResult = KeySequence.compare(candidate, bindingKeySequence);
        switch (compareResult) {
          case KeySequence.CompareResult.FULL: {
            result.full.push(binding);
            break;
          }
          case KeySequence.CompareResult.PARTIAL: {
            result.partial.push(binding);
            break;
          }
          case KeySequence.CompareResult.SHADOW: {
            result.shadow.push(binding);
            break;
          }
        }
      }
      catch (error) {
        console.warn(error);
      }
    }
    return result;
  }

  /**
   * Get all keybindings associated to a commandId.
   *
   * @param commandId The ID of the command for which we are looking for keybindings.
   * @returns an array of {@link ScopedKeybinding}
   */
  getKeybindingsForCommand(commandId: string): ScopedKeybinding[] {
    const result: ScopedKeybinding[] = [];
    const disabledBindings = new Set<string>();
    for (let scope = KeybindingScope.END - 1; scope >= KeybindingScope.DEFAULT; scope--) {
      this.keymaps[scope].forEach((binding) => {
        if (binding.command?.startsWith('-')) {
          disabledBindings.add(JSON.stringify({ command: binding.command.substring(1), binding: binding.keybinding, context: binding.context, when: binding.when }));
        }
        else {
          const command = this.commandRegistry.getCommand(binding.command);
          if (command
            && command.id === commandId
            && !disabledBindings.has(JSON.stringify({ command: binding.command, binding: binding.keybinding, context: binding.context, when: binding.when }))) {
            result.push({ ...binding, scope });
          }
        }
      });
    }
    return result;
  }

  protected isActive(binding: Keybinding): boolean {
    /* Pseudo commands like "passthrough" are always active (and not found
           in the command registry).  */
    if (this.isPseudoCommand(binding.command)) {
      return true;
    }

    const command = this.commandRegistry.getCommand(binding.command);
    return !!command && !!this.commandRegistry.getActiveHandler(command.id);
  }

  /**
   * Tries to execute a keybinding.
   *
   * @param binding to execute
   * @param event keyboard event.
   */
  protected executeKeyBinding(binding: Keybinding, event: KeyboardEvent): void {
    if (this.isPseudoCommand(binding.command)) {
      /* Don't do anything, let the event propagate.  */
    }
    else {
      const command = this.commandRegistry.getCommand(binding.command);
      if (command) {
        if (this.commandRegistry.isEnabled(binding.command, binding.args)) {
          this.commandRegistry.executeCommand(binding.command, binding.args)
            .catch(e => console.error('Failed to execute command:', e));
        }

        /* Note that if a keybinding is in context but the command is
                   not active we still stop the processing here.  */
        event.preventDefault();
        event.stopPropagation();
      }
    }
  }

  /**
   * Only execute if it has no context (global context) or if we're in that context.
   */
  protected isEnabled(binding: Keybinding, event: KeyboardEvent): boolean {
    return this.isEnabledInScope(binding, <HTMLElement>event.target);
  }

  isEnabledInScope(binding: Keybinding, target: HTMLElement | undefined): boolean {
    const context = binding.context && this.contexts[binding.context];
    if (binding.command && (!this.isPseudoCommand(binding.command) && !this.commandRegistry.isEnabled(binding.command, binding.args))) {
      return false;
    }
    if (context && !context.isEnabled(binding)) {
      return false;
    }
    if (binding.when && !this.whenContextService.match(binding.when, target)) {
      return false;
    }
    return true;
  }

  dispatchCommand(id: string, target?: EventTarget): void {
    const keybindings = this.getKeybindingsForCommand(id);
    if (keybindings.length) {
      for (const keyCode of this.resolveKeybinding(keybindings[0])) {
        this.dispatchKeyDown(keyCode, target);
      }
    }
  }

  dispatchKeyDown(input: KeyboardEventInit | KeyCode | string, target: EventTarget = document.activeElement || window): void {
    const eventInit = this.asKeyboardEventInit(input);
    const emulatedKeyboardEvent = new KeyboardEvent('keydown', eventInit);
    target.dispatchEvent(emulatedKeyboardEvent);
  }

  protected asKeyboardEventInit(input: KeyboardEventInit | KeyCode | string): KeyboardEventInit & Partial<{ keyCode: number }> {
    if (typeof input === 'string') {
      return this.asKeyboardEventInit(KeyCode.createKeyCode(input as any));
    }
    if (input instanceof KeyCode) {
      return {
        metaKey: input.meta,
        shiftKey: input.shift,
        altKey: input.alt,
        ctrlKey: input.ctrl,
        code: input.key && input.key.code,
        key: (input && input.character) || (input.key && input.key.code),
        keyCode: input.key && input.key.keyCode,
      };
    }
    return input;
  }

  registerEventListeners(win: Window): IDisposable {
    /* vvv HOTFIX begin vvv
        *
        * This is a hotfix against issues eclipse/theia#6459 and gitpod-io/gitpod#875 .
        * It should be reverted after Theia was updated to the newer Monaco.
        */
    let inComposition = false;
    const compositionStart = () => {
      inComposition = true;
    };
    win.document.addEventListener('compositionstart', compositionStart);

    const compositionEnd = () => {
      inComposition = false;
    };
    win.document.addEventListener('compositionend', compositionEnd);

    const keydown = (event: KeyboardEvent) => {
      if (inComposition !== true) {
        this.run(event);
      }
    };
    win.document.addEventListener('keydown', keydown, true);

    return toDisposable(() => {
      win.document.removeEventListener('compositionstart', compositionStart);
      win.document.removeEventListener('compositionend', compositionEnd);
      win.document.removeEventListener('keydown', keydown);
    });
  }

  /**
   * Run the command matching to the given keyboard event.
   */
  run(event: KeyboardEvent): void {
    if (event.defaultPrevented) {
      return;
    }

    const eventDispatch = 'code';
    // @ts-ignore
    const keyCode = KeyCode.createKeyCode(event, eventDispatch);
    /* Keycode is only a modifier, next keycode will be modifier + key.
           Ignore this one.  */
    if (keyCode.isModifierOnly()) {
      return;
    }

    this.keyboardLayoutService.validateKeyCode(keyCode);
    this.keySequence.push(keyCode);
    const match = this.matchKeybinding(this.keySequence, event);

    if (match && match.kind === 'partial') {
      /* Accumulate the keysequence */
      event.preventDefault();
      event.stopPropagation();
    }
    else {
      if (match && match.kind === 'full') {
        this.executeKeyBinding(match.binding, event);
      }
      this.keySequence = [];
    }
  }

  /**
   * Match first binding in the current context.
   * Keybindings ordered by a scope and by a registration order within the scope.
   *
   * FIXME:
   * This method should run very fast since it happens on each keystroke. We should reconsider how keybindings are stored.
   * It should be possible to look up full and partial keybinding for given key sequence for constant time using some kind of tree.
   * Such tree should not contain disabled keybindings and be invalidated whenever the registry is changed.
   */
  matchKeybinding(keySequence: KeySequence, event?: KeyboardEvent): KeybindingRegistry.Match {
    let disabled: Set<string> | undefined;
    const isEnabled = (binding: ScopedKeybinding) => {
      const { command, context, when, keybinding } = binding;
      if (!this.isUsable(binding)) {
        disabled = disabled || new Set<string>();
        disabled.add(JSON.stringify({ command: command.substring(1), context, when, keybinding }));
        return false;
      }
      if (event && !this.isEnabled(binding, event)) {
        return false;
      }
      return !disabled?.has(JSON.stringify({ command, context, when, keybinding }));
    };

    for (let scope = KeybindingScope.END; --scope >= KeybindingScope.DEFAULT;) {
      for (const binding of this.keymaps[scope]) {
        const resolved = this.resolveKeybinding(binding);
        const compareResult = KeySequence.compare(keySequence, resolved);
        if (compareResult === KeySequence.CompareResult.FULL && isEnabled(binding)) {
          return { kind: 'full', binding };
        }
        if (compareResult === KeySequence.CompareResult.PARTIAL && isEnabled(binding)) {
          return { kind: 'partial', binding };
        }
      }
    }
    return undefined;
  }

  /**
   * Returns true if the binding is usable
   * @param binding Binding to be checked
   */
  protected isUsable(binding: Keybinding): boolean {
    return binding.command.charAt(0) !== '-';
  }

  /**
   * Return a new filtered array containing only the usable bindings among the input bindings
   * @param bindings Bindings to filter
   */
  protected getUsableBindings<T extends Keybinding>(bindings: T[]): T[] {
    return bindings.filter(binding => this.isUsable(binding));
  }

  /**
   * Return true of string a pseudo-command id, in other words a command id
   * that has a special meaning and that we won't find in the command
   * registry.
   *
   * @param commandId commandId to test
   */
  isPseudoCommand(commandId: string): boolean {
    return commandId === KeybindingRegistry.PASSTHROUGH_PSEUDO_COMMAND;
  }

  /**
   * Sets a new keymap replacing all existing {@link Keybinding}s in the given scope.
   * @param scope the keybinding scope
   * @param bindings an array containing the new {@link Keybinding}s
   */
  setKeymap(scope: KeybindingScope, bindings: Keybinding[]): void {
    this.resetKeybindingsForScope(scope);
    this.toResetKeymap.set(scope, this.doRegisterKeybindings(bindings, scope));
    this.keybindingsChanged.fire(undefined);
  }

  protected readonly toResetKeymap = new Map<KeybindingScope, IDisposable>();

  /**
   * Reset keybindings for a specific scope
   * @param scope scope to reset the keybindings for
   */
  resetKeybindingsForScope(scope: KeybindingScope): void {
    const toReset = this.toResetKeymap.get(scope);
    if (toReset) {
      toReset.dispose();
    }
  }

  /**
   * Reset keybindings for all scopes(only leaves the default keybindings mapped)
   */
  resetKeybindings(): void {
    for (let i = KeybindingScope.DEFAULT + 1; i < KeybindingScope.END; i++) {
      this.keymaps[i] = [];
    }
  }

  /**
   * Get all {@link Keybinding}s for a {@link KeybindingScope}.
   * @returns an array of {@link common.ScopedKeybinding}
   * @param scope the keybinding scope to retrieve the {@link Keybinding}s for.
   */
  getKeybindingsByScope(scope: KeybindingScope): ScopedKeybinding[] {
    return this.keymaps[scope];
  }
}
export const IKeybindingRegistry = createServiceDecorator<IKeybindingRegistry>(KeybindingRegistry.name);
export type IKeybindingRegistry = KeybindingRegistry;

export namespace KeybindingRegistry {
  export type Match = {
    kind: 'full' | 'partial';
    binding: ScopedKeybinding;
  } | undefined;
  export class KeybindingsResult {
    full: ScopedKeybinding[] = [];
    partial: ScopedKeybinding[] = [];
    shadow: ScopedKeybinding[] = [];

    /**
     * Merge two results together inside `this`
     *
     * @param other the other KeybindingsResult to merge with
     * @return this
     */
    merge(other: KeybindingsResult): KeybindingsResult {
      this.full.push(...other.full);
      this.partial.push(...other.partial);
      this.shadow.push(...other.shadow);
      return this;
    }

    /**
     * Returns a new filtered KeybindingsResult
     *
     * @param fn callback filter on the results
     * @return filtered new result
     */
    filter(fn: (binding: Keybinding) => boolean): KeybindingsResult {
      const result = new KeybindingsResult();
      result.full = this.full.filter(fn);
      result.partial = this.partial.filter(fn);
      result.shadow = this.shadow.filter(fn);
      return result;
    }
  }
}
