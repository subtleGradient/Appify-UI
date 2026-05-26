export function parseArgsText(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "single" | "double" | null = null;
  let active = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;

    if (quote === "single") {
      if (char === "'") {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (quote === "double") {
      if (char === "\"") {
        quote = null;
      } else if (char === "\\") {
        index += 1;
        if (index >= input.length) {
          throw new Error("Arguments end with an unfinished escape.");
        }
        current += input[index]!;
      } else {
        current += char;
      }
      continue;
    }

    if (/\s/.test(char)) {
      if (active) {
        args.push(current);
        current = "";
        active = false;
      }
      continue;
    }

    active = true;
    if (char === "'") {
      quote = "single";
    } else if (char === "\"") {
      quote = "double";
    } else if (char === "\\") {
      index += 1;
      if (index >= input.length) {
        throw new Error("Arguments end with an unfinished escape.");
      }
      current += input[index]!;
    } else {
      current += char;
    }
  }

  if (quote !== null) {
    throw new Error(`Arguments contain an unclosed ${quote} quote.`);
  }
  if (active) {
    args.push(current);
  }

  return args;
}
