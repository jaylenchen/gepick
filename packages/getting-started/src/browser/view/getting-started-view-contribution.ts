import { AbstractView } from "@gepick/core/browser";
import { GettingStartedWidget } from "../getting-started-widget";

export class GettingStartedView extends AbstractView<GettingStartedWidget> {
  constructor() {
    super({
      widgetId: GettingStartedWidget.ID,
      widgetName: GettingStartedWidget.LABEL,
      defaultWidgetOptions: {
        area: "right",
      },
    });
  }

  async onShellLayoutInit(): Promise<void> {
    await this.setupView({ activate: true });
  }
}
