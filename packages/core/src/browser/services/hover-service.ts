import { DisposableCollection, IDisposable, InjectableService, MarkdownString, createServiceDecorator, disposableTimeout } from '@gepick/core/common';
import { IMarkdownRendererFactory, MarkdownRenderer } from '../markdown';

import '../style/hover-service.css';
import { animationFrame } from './browser-service';

export type HoverPosition = 'left' | 'right' | 'top' | 'bottom';

// Threshold, in milliseconds, over which a mouse movement is not considered
// quick enough as to be ignored
const quickMouseThresholdMillis = 200;

export namespace HoverPosition {
  export function invertIfNecessary(position: HoverPosition, target: DOMRect, host: DOMRect, totalWidth: number, totalHeight: number): HoverPosition {
    if (position === 'left') {
      if (target.left - host.width - 5 < 0) {
        return 'right';
      }
    }
    else if (position === 'right') {
      if (target.right + host.width + 5 > totalWidth) {
        return 'left';
      }
    }
    else if (position === 'top') {
      if (target.top - host.height - 5 < 0) {
        return 'bottom';
      }
    }
    else if (position === 'bottom') {
      if (target.bottom + host.height + 5 > totalHeight) {
        return 'top';
      }
    }
    return position;
  }
}

export interface HoverRequest {
  content: string | MarkdownString | HTMLElement;
  target: HTMLElement;
  /**
   * The position where the hover should appear.
   * Note that the hover service will try to invert the position (i.e. right -> left)
   * if the specified content does not fit in the window next to the target element
   */
  position: HoverPosition;
  /**
   * Additional css classes that should be added to the hover box.
   * Used to style certain boxes different e.g. for the extended tab preview.
   */
  cssClasses?: string[];
  /**
   * A function to render a visual preview on the hover.
   * Function that takes the desired width and returns a HTMLElement to be rendered.
   */
  visualPreview?: (width: number) => HTMLElement | undefined;
}

export class HoverService extends InjectableService {
  protected static hostClassName = 'theia-hover';
  protected static styleSheetId = 'theia-hover-style';
  protected _markdownRenderer: MarkdownRenderer | undefined;
  protected get markdownRenderer(): MarkdownRenderer {
    this._markdownRenderer ||= this.markdownRendererFactory.createMarkdownRenderer();
    return this._markdownRenderer;
  }

  protected _hoverHost: HTMLElement | undefined;
  protected get hoverHost(): HTMLElement {
    if (!this._hoverHost) {
      this._hoverHost = document.createElement('div');
      this._hoverHost.classList.add(HoverService.hostClassName);
      this._hoverHost.style.position = 'absolute';
    }
    return this._hoverHost;
  }

  protected pendingTimeout: IDisposable | undefined;
  protected hoverTarget: HTMLElement | undefined;
  protected lastHidHover = Date.now();
  protected readonly disposeOnHide = new DisposableCollection();

  constructor(
    @IMarkdownRendererFactory protected readonly markdownRendererFactory: IMarkdownRendererFactory,
  ) {
    super();
  }

  requestHover(request: HoverRequest): void {
    if (request.target !== this.hoverTarget) {
      this.cancelHover();
      this.pendingTimeout = disposableTimeout(() => this.renderHover(request), this.getHoverDelay());
      this.hoverTarget = request.target;
      this.listenForMouseOut();
    }
  }

  protected getHoverDelay(): number {
    return Date.now() - this.lastHidHover < quickMouseThresholdMillis
      ? 0
      : 1500;
  }

  protected async renderHover(request: HoverRequest): Promise<void> {
    const host = this.hoverHost;
    let firstChild: HTMLElement | undefined;
    const { target, content, position, cssClasses } = request;
    if (cssClasses) {
      host.classList.add(...cssClasses);
    }
    if (content instanceof HTMLElement) {
      host.appendChild(content);
      firstChild = content;
    }
    else if (typeof content === 'string') {
      host.textContent = content;
    }
    else {
      const renderedContent = this.markdownRenderer.render(content);
      this.disposeOnHide.push(renderedContent);
      host.appendChild(renderedContent.element);
      firstChild = renderedContent.element;
    }
    // browsers might insert linebreaks when the hover appears at the edge of the window
    // resetting the position prevents that
    host.style.left = '0px';
    host.style.top = '0px';
    document.body.append(host);

    if (request.visualPreview) {
      // If just a string is being rendered use the size of the outer box
      const width = firstChild ? firstChild.offsetWidth : this.hoverHost.offsetWidth;
      const visualPreview = request.visualPreview(width);
      if (visualPreview) {
        host.appendChild(visualPreview);
      }
    }

    await animationFrame(); // Allow the browser to size the host
    const updatedPosition = this.setHostPosition(target, host, position);

    this.disposeOnHide.push({
      dispose: () => {
        this.lastHidHover = Date.now();
        host.classList.remove(updatedPosition);
        if (cssClasses) {
          host.classList.remove(...cssClasses);
        }
      },
    });
  }

  protected setHostPosition(target: HTMLElement, host: HTMLElement, position: HoverPosition): HoverPosition {
    const targetDimensions = target.getBoundingClientRect();
    const hostDimensions = host.getBoundingClientRect();
    const documentWidth = document.body.getBoundingClientRect().width;
    // document.body.getBoundingClientRect().height doesn't work as expected
    // scrollHeight will always be accurate here: https://stackoverflow.com/a/44077777
    const documentHeight = document.documentElement.scrollHeight;
    position = HoverPosition.invertIfNecessary(position, targetDimensions, hostDimensions, documentWidth, documentHeight);
    if (position === 'top' || position === 'bottom') {
      const targetMiddleWidth = targetDimensions.left + (targetDimensions.width / 2);
      const middleAlignment = targetMiddleWidth - (hostDimensions.width / 2);
      const furthestRight = Math.min(documentWidth - hostDimensions.width, middleAlignment);
      const left = Math.max(0, furthestRight);
      const top = position === 'top'
        ? targetDimensions.top - hostDimensions.height - 5
        : targetDimensions.bottom + 5;
      host.style.setProperty('--theia-hover-before-position', `${targetMiddleWidth - left - 5}px`);
      host.style.top = `${top}px`;
      host.style.left = `${left}px`;
    }
    else {
      const targetMiddleHeight = targetDimensions.top + (targetDimensions.height / 2);
      const middleAlignment = targetMiddleHeight - (hostDimensions.height / 2);
      const furthestTop = Math.min(documentHeight - hostDimensions.height, middleAlignment);
      const top = Math.max(0, furthestTop);
      const left = position === 'left'
        ? targetDimensions.left - hostDimensions.width - 5
        : targetDimensions.right + 5;
      host.style.setProperty('--theia-hover-before-position', `${targetMiddleHeight - top - 5}px`);
      host.style.left = `${left}px`;
      host.style.top = `${top}px`;
    }
    host.classList.add(position);
    return position;
  }

  protected listenForMouseOut(): void {
    const handleMouseMove = (e: MouseEvent) => {
      if (e.target instanceof Node && !this.hoverHost.contains(e.target) && !this.hoverTarget?.contains(e.target)) {
        this.disposeOnHide.push(disposableTimeout(() => {
          if (!this.hoverHost.matches(':hover') && !this.hoverTarget?.matches(':hover')) {
            this.cancelHover();
          }
        }, quickMouseThresholdMillis));
      }
    };
    document.addEventListener('mousemove', handleMouseMove);
    this.disposeOnHide.push({ dispose: () => document.removeEventListener('mousemove', handleMouseMove) });
  }

  cancelHover(): void {
    this.pendingTimeout?.dispose();
    this.unRenderHover();
    this.disposeOnHide.dispose();
    this.hoverTarget = undefined;
  }

  protected unRenderHover(): void {
    this.hoverHost.remove();
    this.hoverHost.replaceChildren();
  }
}

export const IHoverService = createServiceDecorator<IHoverService>(HoverService.name);
export type IHoverService = HoverService;
