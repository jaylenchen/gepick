// *****************************************************************************
// Copyright (C) 2019 Ericsson and others.
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

import { JSONValue } from '@lumino/coreutils';
import { IJSONSchema, isObject, isString } from '@gepick/core/common';
import { PreferenceScope } from './preference-scope';

export interface PreferenceSchemaProperties {
  [name: string]: PreferenceSchemaProperty;
}
export namespace PreferenceSchemaProperties {
  export function is(obj: unknown): obj is PreferenceSchemaProperties {
    return isObject(obj);
  }
}

export interface PreferenceSchema {
  [name: string]: any;
  scope?: 'application' | 'window' | 'resource' | PreferenceScope;
  overridable?: boolean;
  /**
   * The title of the preference schema.
   * It is used in the preference UI to associate a localized group of preferences.
   */
  title?: string;
  properties: PreferenceSchemaProperties;
}
export namespace PreferenceSchema {
  export function is(obj: unknown): obj is PreferenceSchema {
    return isObject<PreferenceSchema>(obj) && PreferenceSchemaProperties.is(obj.properties);
  }
  export function getDefaultScope(schema: PreferenceSchema): PreferenceScope {
    let defaultScope: PreferenceScope = PreferenceScope.Workspace;
    if (!PreferenceScope.is(schema.scope)) {
      defaultScope = PreferenceScope.fromString(<string>schema.scope) || PreferenceScope.Workspace;
    }
    else {
      defaultScope = schema.scope;
    }
    return defaultScope;
  }
}

export interface PreferenceDataSchema {
  [name: string]: any;
  scope?: PreferenceScope;
  properties: {
    [name: string]: PreferenceDataProperty;
  };
  patternProperties: {
    [name: string]: PreferenceDataProperty;
  };
}

export interface PreferenceItem extends IJSONSchema {
  /**
   * preference default value, if `undefined` then `default`
   */
  defaultValue?: JSONValue;
  overridable?: boolean;
  /** If false, the preference will not be included in the schema or the UI. */
  included?: boolean;
  /** If true, this item will registered as part of the preference schema, but hidden in the preference editor UI. */
  hidden?: boolean;
  [key: string]: any;
}
export interface PreferenceSchemaProperty extends PreferenceItem {
  description?: string;
  markdownDescription?: string;
  scope?: 'application' | 'machine' | 'window' | 'resource' | 'language-overridable' | 'machine-overridable' | PreferenceScope;
  tags?: string[];
}

export interface PreferenceDataProperty extends PreferenceItem {
  description?: string;
  markdownDescription?: string;
  scope?: PreferenceScope;
  typeDetails?: any;
}
export namespace PreferenceDataProperty {
  export function fromPreferenceSchemaProperty(schemaProps: PreferenceSchemaProperty, defaultScope: PreferenceScope = PreferenceScope.Workspace): PreferenceDataProperty {
    if (!schemaProps.scope) {
      schemaProps.scope = defaultScope;
    }
    else if (isString(schemaProps.scope)) {
      return Object.assign(schemaProps, { scope: PreferenceScope.fromString(schemaProps.scope) || defaultScope });
    }
    return <PreferenceDataProperty>schemaProps;
  }
}
