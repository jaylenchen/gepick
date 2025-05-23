/* eslint-disable no-console */
/*
 * Copyright (C) 2017 TypeFox and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { Logger } from "vscode-jsonrpc";

export class ConsoleLogger implements Logger {
  error(message: string): void {
    console.log(message);
  }

  warn(message: string): void {
    console.log(message);
  }

  info(message: string): void {
    console.log(message);
  }

  log(message: string): void {
    console.log(message);
  }
}
