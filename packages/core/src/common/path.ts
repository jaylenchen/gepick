/**
 * On POSIX:
 * ┌──────────────────────┬────────────┐
 * │          dir         │    base    │
 * ├──────┬               ├──────┬─────┤
 * │ root │               │ name │ ext │
 * "  /     home/user/dir / file  .txt "
 * └──────┴───────────────┴──────┴─────┘
 *
 * On Windows:
 * ┌──────────────────────┬────────────┐
 * │           dir        │    base    │
 * ├──────┬               ├──────┬─────┤
 * │ root │               │ name │ ext │
 * "  /c: / home/user/dir / file  .txt "
 * └──────┴───────────────┴──────┴─────┘
 */

import { OS } from './os';

export class Path {
  static separator = '/' as const;

  static isDrive(segment: string): boolean {
    return segment.endsWith(':');
  }

  /**
   * vscode-uri always normalizes drive letters to lower case:
   * https://github.com/Microsoft/vscode-uri/blob/b1d3221579f97f28a839b6f996d76fc45e9964d8/src/index.ts#L1025
   * Theia path should be adjusted to this.
   */
  static normalizeDrive(path: string): string {
    // lower-case windows drive letters in /C:/fff or C:/fff
    if (path.length >= 3 && path.charCodeAt(0) === 47 /* '/' */ && path.charCodeAt(2) === 58 /* ':' */) {
      const code = path.charCodeAt(1);
      if (code >= 65 /* A */ && code <= 90 /* Z */) {
        path = `/${String.fromCharCode(code + 32)}:${path.substring(3)}`; // "/c:".length === 3
      }
    }
    else if (path.length >= 2 && path.charCodeAt(1) === 58 /* ':' */) {
      const code = path.charCodeAt(0);
      if (code >= 65 /* A */ && code <= 90 /* Z */) {
        path = `${String.fromCharCode(code + 32)}:${path.substring(2)}`; // "c:".length === 2
      }
      if (path.charCodeAt(0) !== 47 /* '/' */) {
        path = `${String.fromCharCode(47)}${path}`;
      }
    }
    return path;
  }

  /**
   * Normalize path separator to use Path.separator
   * @param Path candidate to normalize
   * @returns Normalized string path
   */
  static normalizePathSeparator(path: string): string {
    return path.split(/\\/).join(Path.separator);
  }

  /**
   * Creates a windows path from the given path string.
   * A windows path uses an upper case drive letter and backwards slashes.
   * @param path The input path
   * @returns Windows style path
   */
  static windowsPath(path: string): string {
    const offset = path.charAt(0) === '/' ? 1 : 0;
    if (path.charAt(offset + 1) === ':') {
      const driveLetter = path.charAt(offset).toUpperCase();
      const substring = path.substring(offset + 2).replace(/\//g, '\\');
      return `${driveLetter}:${substring || '\\'}`;
    }
    return path.replace(/\//g, '\\');
  }

  /**
   * Tildify path, replacing `home` with `~` if user's `home` is present at the beginning of the path.
   * This is a non-operation for Windows.
   *
   * @param resourcePath
   * @param home
   */
  static tildify(resourcePath: string, home: string): string {
    const path = new Path(resourcePath);
    const isWindows = path.root && Path.isDrive(path.root.base);

    if (!isWindows && home && resourcePath.indexOf(`${home}/`) === 0) {
      return resourcePath.replace(`${home}/`, '~/');
    }

    return resourcePath;
  }

  /**
   * Untildify path, replacing `~` with `home` if `~` present at the beginning of the path.
   * This is a non-operation for Windows.
   *
   * @param resourcePath
   * @param home
   */
  static untildify(resourcePath: string, home: string): string {
    if (resourcePath.startsWith('~')) {
      const untildifiedResource = resourcePath.replace(/^~/, home);
      const untildifiedPath = new Path(untildifiedResource);
      const isWindows = untildifiedPath.root && Path.isDrive(untildifiedPath.root.base);
      if (!isWindows && home && untildifiedResource.startsWith(`${home}`)) {
        return untildifiedResource;
      }
    }
    return resourcePath;
  }

  readonly isAbsolute: boolean;
  readonly isRoot: boolean;
  readonly root: Path | undefined;
  readonly base: string;
  readonly name: string;
  readonly ext: string;

  private _dir: Path;
  private readonly raw: string;

  /**
   * The raw should be normalized, meaning that only '/' is allowed as a path separator.
   */
  constructor(
    raw: string,
  ) {
    raw = Path.normalizePathSeparator(raw);
    this.raw = Path.normalizeDrive(raw);
    const firstIndex = this.raw.indexOf(Path.separator);
    const lastIndex = this.raw.lastIndexOf(Path.separator);
    this.isAbsolute = firstIndex === 0;
    this.base = lastIndex === -1 ? this.raw : this.raw.substring(lastIndex + 1);
    this.isRoot = this.isAbsolute && firstIndex === lastIndex && (!this.base || Path.isDrive(this.base));
    this.root = this.computeRoot();

    const extIndex = this.base.lastIndexOf('.');
    this.name = extIndex === -1 ? this.base : this.base.substring(0, extIndex);
    this.ext = extIndex === -1 ? '' : this.base.substring(extIndex);
  }

  protected computeRoot(): Path | undefined {
    // '/' -> '/'
    // '/c:' -> '/c:'
    if (this.isRoot) {
      return this;
    }
    // 'foo/bar' -> `undefined`
    if (!this.isAbsolute) {
      return undefined;
    }
    const index = this.raw.indexOf(Path.separator, Path.separator.length);
    if (index === -1) {
      // '/foo/bar' -> '/'
      return new Path(Path.separator);
    }
    // '/c:/foo/bar' -> '/c:'
    // '/foo/bar' -> '/'
    return new Path(this.raw.substring(0, index)).root;
  }

  /**
   * Returns the parent directory if it exists (`hasDir === true`) or `this` otherwise.
   */
  get dir(): Path {
    if (this._dir === undefined) {
      this._dir = this.computeDir();
    }
    return this._dir;
  }

  /**
   * Returns `true` if this has a parent directory, `false` otherwise.
   *
   * _This implementation returns `true` if and only if this is not the root dir and
   * there is a path separator in the raw path._
   */
  get hasDir(): boolean {
    return !this.isRoot && this.raw.includes(Path.separator);
  }

  protected computeDir(): Path {
    if (!this.hasDir) {
      return this;
    }
    const lastIndex = this.raw.lastIndexOf(Path.separator);
    if (this.isAbsolute) {
      const firstIndex = this.raw.indexOf(Path.separator);
      if (firstIndex === lastIndex) {
        return new Path(this.raw.substring(0, firstIndex + 1));
      }
    }
    return new Path(this.raw.substring(0, lastIndex));
  }

  join(...paths: string[]): Path {
    const relativePath = paths.filter(s => !!s).join(Path.separator);
    if (!relativePath) {
      return this;
    }
    if (this.raw.endsWith(Path.separator)) {
      return new Path(this.raw + relativePath);
    }
    return new Path(this.raw + Path.separator + relativePath);
  }

  /**
   *
   * @param paths portions of a path
   * @returns a new Path if an absolute path can be computed from the segments passed in + this.raw
   * If no absolute path can be computed, returns undefined.
   *
   * Processes the path segments passed in from right to left (reverse order) concatenating until an
   * absolute path is found.
   */
  resolve(...paths: string[]): Path | undefined {
    const segments = paths.slice().reverse(); // Don't mutate the caller's array.
    segments.push(this.raw);
    let result = new Path('');
    for (const segment of segments) {
      if (segment) {
        const next = new Path(segment).join(result.raw);
        if (next.isAbsolute) {
          return next.normalize();
        }
        result = next;
      }
    }

    return undefined;
  }

  toString(): string {
    return this.raw;
  }

  /**
   * Converts the current path into a file system path.
   * @param format Determines the format of the path.
   * If `undefined`, the format will be determined by the `OS.backend.type` value.
   * @returns A file system path.
   */
  fsPath(format?: Path.Format): string {
    if (format === Path.Format.Windows || (format === undefined && OS.backend.isWindows)) {
      return Path.windowsPath(this.raw);
    }
    else {
      return this.raw;
    }
  }

  relative(path: Path): Path | undefined {
    if (this.raw === path.raw) {
      return new Path('');
    }
    if (!this.raw || !path.raw) {
      return undefined;
    }
    const raw = this.base ? this.raw + Path.separator : this.raw;
    if (!path.raw.startsWith(raw)) {
      return undefined;
    }
    const relativePath = path.raw.substring(raw.length);
    return new Path(relativePath);
  }

  isEqualOrParent(path: Path): boolean {
    return !!this.relative(path);
  }

  relativity(path: Path): number {
    const relative = this.relative(path);
    if (relative) {
      const relativeStr = relative.toString();
      if (relativeStr === '') {
        return 0;
      }
      return relativeStr.split(Path.separator).length;
    }
    return -1;
  }

  /*
     * return a normalized Path, resolving '..' and '.' segments
     */
  normalize(): Path {
    const trailingSlash = this.raw.endsWith('/');
    const pathArray = this.toString().split('/');
    const resultArray: string[] = [];
    pathArray.forEach((value, _index) => {
      if (!value || value === '.') {
        return;
      }
      if (value === '..') {
        if (resultArray.length && resultArray[resultArray.length - 1] !== '..') {
          resultArray.pop();
        }
        else if (!this.isAbsolute) {
          resultArray.push('..');
        }
      }
      else {
        resultArray.push(value);
      }
    });
    if (resultArray.length === 0) {
      if (this.isRoot) {
        return new Path('/');
      }
      else {
        return new Path('.');
      }
    }
    return new Path((this.isAbsolute ? '/' : '') + resultArray.join('/') + (trailingSlash ? '/' : ''));
  }
}

export namespace Path {
  export enum Format {
    Posix,
    Windows,
  }
}
