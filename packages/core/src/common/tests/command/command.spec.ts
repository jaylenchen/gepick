import {
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { Command, CommandHandler, CommandRegistry, ICommandRegistry } from '../../command';
import { Module, ServiceContainer, ServiceModule } from "../../framework";

@Module({
  services: [
    CommandRegistry,
  ],
})
class CommandModule extends ServiceModule {}

let container: ServiceContainer;
let commandRegistry: CommandRegistry;

describe('commands', () => {
  beforeEach(() => {
    container = new ServiceContainer([
      CommandModule,
    ]);
    commandRegistry = container.get<ICommandRegistry>(ICommandRegistry);
  });

  it('should register and execute a given command', async () => {
    const concatId = 'concat';
    const command: Command = { id: concatId };
    commandRegistry.registerCommand(command, new ConcatCommandHandler());
    const result = await commandRegistry.executeCommand(concatId, 'a', 'b', 'c');
    expect('abc').equals(result);
  });

  it('should add command to recently used', async () => {
    const commandId = 'stub';
    const command: Command = { id: commandId };
    commandRegistry.registerCommand(command, new StubCommandHandler());
    commandRegistry.addRecentCommand(command);
    expect(commandRegistry.recent.length).equal(1);
  });

  it('should add multiple commands to recently used in the order they were used', async () => {
    const commandIds = ['a', 'b', 'c'];
    const commands: Command[] = [
      { id: commandIds[0] },
      { id: commandIds[1] },
      { id: commandIds[2] },
    ];

    // Register each command.
    commands.forEach((c: Command) => {
      commandRegistry.registerCommand(c, new StubCommandHandler());
    });

    // Execute order c, b, a.
    commandRegistry.addRecentCommand(commands[2]);
    commandRegistry.addRecentCommand(commands[1]);
    commandRegistry.addRecentCommand(commands[0]);

    // Expect recently used to be a, b, c.
    const result: Command[] = commandRegistry.recent;

    expect(result.length).equal(3);
    expect(result[0].id).equal(commandIds[0]);
    expect(result[1].id).equal(commandIds[1]);
    expect(result[2].id).equal(commandIds[2]);
  });

  it('should add a previously used command to the top of the most recently used', async () => {
    const commandIds = ['a', 'b', 'c'];
    const commands: Command[] = [
      { id: commandIds[0] },
      { id: commandIds[1] },
      { id: commandIds[2] },
    ];

    // Register each command.
    commands.forEach((c: Command) => {
      commandRegistry.registerCommand(c, new StubCommandHandler());
    });

    // Execute order a, b, c, a.
    commandRegistry.addRecentCommand(commands[0]);
    commandRegistry.addRecentCommand(commands[1]);
    commandRegistry.addRecentCommand(commands[2]);
    commandRegistry.addRecentCommand(commands[0]);

    // Expect recently used to be a, b, c.
    const result: Command[] = commandRegistry.recent;

    expect(result.length).equal(3);
    expect(result[0].id).equal(commandIds[0]);
    expect(result[1].id).equal(commandIds[2]);
    expect(result[2].id).equal(commandIds[1]);
  });

  it('should clear the recently used command history', async () => {
    const commandIds = ['a', 'b', 'c'];
    const commands: Command[] = [
      { id: commandIds[0] },
      { id: commandIds[1] },
      { id: commandIds[2] },
    ];

    // Register each command.
    commands.forEach((c: Command) => {
      commandRegistry.registerCommand(c, new StubCommandHandler());
    });

    // Execute each command.
    commandRegistry.addRecentCommand(commands[0]);
    commandRegistry.addRecentCommand(commands[1]);
    commandRegistry.addRecentCommand(commands[2]);

    // Clear the list of recently used commands.
    commandRegistry.clearCommandHistory();
    expect(commandRegistry.recent.length).equal(0);
  });

  it('should return with an empty array of handlers if the command is not registered', () => {
    expect(commandRegistry.getCommand('missing')).to.be.undefined;
    expect(commandRegistry.getAllHandlers('missing')).to.be.empty;
  });

  it('should return with an empty array of handlers if the command has no registered handlers', () => {
    commandRegistry.registerCommand({ id: 'id' });
    expect(commandRegistry.getCommand('id')).to.be.not.undefined;
    expect(commandRegistry.getAllHandlers('id')).to.be.empty;
  });

  it('should return all handlers including the non active ones', () => {
    commandRegistry.registerCommand({ id: 'id' });
    commandRegistry.registerHandler('id', new StubCommandHandler());
    commandRegistry.registerHandler('id', new NeverActiveStubCommandHandler());
    expect(commandRegistry.getAllHandlers('id').length).to.be.equal(2);
  });

  describe('compareCommands', () => {
    it('should sort command \'a\' before command \'b\' with categories', () => {
      const a: Command = { id: 'a', category: 'a', label: 'a' };
      const b: Command = { id: 'b', category: 'b', label: 'b' };
      expect(Command.compareCommands(a, b)).to.equal(-1);
      expect(Command.compareCommands(b, a)).to.equal(1);
    });

    it('should sort command \'a\' before command \'b\' without categories', () => {
      const a: Command = { id: 'a', label: 'a' };
      const b: Command = { id: 'b', label: 'b' };
      expect(Command.compareCommands(a, b)).to.equal(-1);
      expect(Command.compareCommands(b, a)).to.equal(1);
    });

    it('should sort command \'a\' before command \'b\' with mix-match categories', () => {
      const a: Command = { id: 'a', category: 'a', label: 'a' };
      const b: Command = { id: 'b', label: 'a' };
      expect(Command.compareCommands(a, b)).to.equal(1);
      expect(Command.compareCommands(b, a)).to.equal(-1);
    });

    it('should sort irregardless of casing', () => {
      const lowercase: Command = { id: 'a', label: 'a' };
      const uppercase: Command = { id: 'a', label: 'A' };
      expect(Command.compareCommands(lowercase, uppercase)).to.equal(0);
    });

    it('should not sort if commands are equal', () => {
      const a: Command = { id: 'a', label: 'a' };
      expect(Command.compareCommands(a, a)).to.equal(0);
    });

    it('should not sort commands without labels', () => {
      const a: Command = { id: 'a' };
      const b: Command = { id: 'b' };
      expect(Command.compareCommands(a, b)).to.equal(0);
    });
  });
});

class ConcatCommandHandler implements CommandHandler {
  execute(...args: string[]): string {
    let concat = '';
    args.forEach((element) => {
      concat += element;
    });
    return concat;
  }
}

class StubCommandHandler implements CommandHandler {
  execute(...args: string[]): undefined { return undefined; }
}

class NeverActiveStubCommandHandler extends StubCommandHandler {
  isEnabled(): boolean { return false; }
}
