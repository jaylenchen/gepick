/* eslint-disable ts/no-unsafe-function-type */
import "reflect-metadata";
import { Container, ContainerModule, decorate, injectable, interfaces } from "inversify";
import { ServiceConstructor, ServiceIdUtil } from './instantiation';
import { ContributionProvider } from './contribution-provider';
import { BindingScope, getActivationHandler, getBindingScope, getConstantValue, getDeactivationHandler } from "./binding-syntax";

export type ServiceModuleConstructor = (new (container: Container) => ServiceModule);

export const MODULE_METADATA = {
  SERVICES: 'services',
  FACTORIES: 'factories',
};

const metadataKeys = [
  MODULE_METADATA.SERVICES,
  MODULE_METADATA.FACTORIES,
];
export const INVALID_MODULE_CONFIG_MESSAGE = (
  _text: TemplateStringsArray,
  property: string,
) => `Invalid property '${property}' passed into the @Module() decorator.`;

export function validateModuleKeys(keys: string[]) {
  const validateKey = (key: string) => {
    if (metadataKeys.includes(key)) {
      return;
    }
    throw new Error(INVALID_MODULE_CONFIG_MESSAGE`${key}`);
  };
  keys.forEach(validateKey);
}

export function Module(metadata: IModuleMetadata) {
  const propsKeys = Object.keys(metadata);
  validateModuleKeys(propsKeys);

  return (target: Function) => {
    for (const property in metadata) {
      if (Object.hasOwnProperty.call(metadata, property)) {
        Reflect.defineMetadata(property, (metadata as any)[property], target.prototype);
      }
    }
  };
}

interface ServiceFactory { id: symbol; handler: ((context: interfaces.Context) => InstanceType<ServiceConstructor>) }
export interface IModuleMetadata {
  services: ServiceConstructor[];
  factories?: ServiceFactory[];
}

export abstract class ServiceModule extends ContainerModule {
  static getServices() {
    const services = this.prototype.getServices();
    return services.map(service => service.getServiceId());
  }

  constructor(container: Container) {
    super((bind) => {
      this.bindServices(container);
      this.bindFactories(bind, container);
    });
  }

  private bindServices(container: Container) {
    const services = this.getServices();

    services.forEach((service) => {
      if (!ServiceIdUtil.isInjectable(service)) {
        decorate(injectable(), service);
      }
      this.resolveBinding(container, service);
    });
  }

  private bindFactories(bind: interfaces.Bind, container: Container) {
    const factories = this.getFactories();

    factories?.forEach(factory => this.registerFactory(bind, container, factory));
  }

  protected getServices(): IModuleMetadata['services'] {
    return Reflect.getMetadata(MODULE_METADATA.SERVICES, this.constructor.prototype);
  }

  protected getFactories(): IModuleMetadata['factories'] {
    return Reflect.getMetadata(MODULE_METADATA.FACTORIES, this.constructor.prototype);
  }

  protected registerFactory<T extends ServiceFactory>(bind: interfaces.Bind, _container: Container, factory: T): void {
    bind(factory.id).toFactory(context => () => factory.handler(context));
  }

  /**
   * - `bindingToSyntax.toConstantValue`: 可以设计一个ConstantValue装饰器来绑定constant value
   * - `bindingToSyntax.to`: 默认的服务绑定
   * - `bindingToSyntax.toFactory`: 我们不需要factory，设计service得时候本身就可以拿到service container，我们可以设计一个create方法，直接绑定service factory class，然后获得的实例来调用create方法也能够获得跟toFactory一样的效果
   * - `bindingToSyntax.toDynamicValue`: 我们不需要DynamicValue，理由跟toFactory一样
   * - `bindingToSyntax.toService`: 我们已经设计了contribution这个概念，它就是toService
   */
  private resolveBinding<T extends ServiceConstructor>(container: Container, target: T) {
    const serviceId = target.getServiceId();
    const bindingToSyntax = container.bind<T>(serviceId);

    if (!this.resolveBindingToConstantValue(bindingToSyntax, target)) {
      const bindingWhenOnSyntax = this.resolveBindingInScope<T>(bindingToSyntax, target);
      this.resolveBindingOnEvent(bindingWhenOnSyntax, target);
    }

    this.resolveBindingToContribution(container, target);
  }

  private resolveBindingToConstantValue<T extends ServiceConstructor>(bindingToSyntax: interfaces.BindingToSyntax<T>, target: T): boolean {
    const constantValue = getConstantValue(target);

    if (constantValue) {
      const bindingWhenOnSyntax = bindingToSyntax.toConstantValue(constantValue);

      this.resolveBindingOnEvent(bindingWhenOnSyntax, target);

      return true;
    }

    return false;
  };

  private resolveBindingInScope<T extends ServiceConstructor>(bindingToSyntax: interfaces.BindingToSyntax<T>, target: T): interfaces.BindingWhenOnSyntax<T> {
    const scope = getBindingScope(target);
    const bindingInWhenOnSyntax = bindingToSyntax.to(target);

    switch (scope) {
      case BindingScope.Singleton: {
        return bindingInWhenOnSyntax.inSingletonScope();
      }
      case BindingScope.Request: {
        return bindingInWhenOnSyntax.inRequestScope();
      }
      case BindingScope.Transient: {
        return bindingInWhenOnSyntax.inTransientScope();
      }
      default: {
        return bindingInWhenOnSyntax.inSingletonScope();
      }
    }
  }

  private resolveBindingToContribution<T extends ServiceConstructor>(container: Container, target: T) {
    const serviceId = target.getServiceId();
    const contributionId = target.getContributionId();

    if (contributionId) {
      if (typeof contributionId !== 'symbol') {
        throw new TypeError(`Service ${target.name} must have a static symbol type contribution property.`);
      }

      if (!container.isBound(contributionId)) {
        container.bind(ContributionProvider.getProviderId(contributionId)).toDynamicValue(ctx => new ContributionProvider(contributionId, ctx.container))
          .inSingletonScope();
      }

      container.bind(contributionId).toService(serviceId);
    }
  }

  private resolveBindingOnEvent<T extends ServiceConstructor>(bindingOnSyntax: interfaces.BindingOnSyntax<T>, target: T) {
    const activationHandler = getActivationHandler(target);
    const deactivationHandler = getDeactivationHandler(target);

    if (activationHandler) {
      bindingOnSyntax.onActivation(activationHandler);
    }

    if (deactivationHandler) {
      bindingOnSyntax.onDeactivation(deactivationHandler);
    }
  }
}
