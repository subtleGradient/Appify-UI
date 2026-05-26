export function joinURLPath(...parts: string[]): string {
  const joined = parts
    .flatMap((part) => part.split("/"))
    .filter((part) => part.length > 0)
    .join("/");
  return `/${joined}`;
}

export function randomPath(prefix: string): string {
  return joinURLPath(`${prefix}-${crypto.randomUUID().replaceAll("-", "")}`);
}

export function pathIsAtOrUnder(pathname: string, basePath: string): boolean {
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

export function shellToken(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}
