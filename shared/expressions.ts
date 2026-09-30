/**
 * Expressions (After Effects'): a short script on an animatable property, run
 * once per frame, whose result replaces the property's value. `wiggle(2, 30)`,
 * `loopOut()`, `value + [0, Math.sin(time) * 50]`...
 *
 * The source is untrusted (it comes from saved projects and from AI agents) and
 * runs in the tab and in the export, so it never reaches the JavaScript engine:
 * this module tokenises, parses and walks a small JavaScript-like language of
 * its own. There are no loops, no functions to define and no objects, so an
 * expression can only reach the names in `EXPRESSION_GLOBALS` and what its
 * `ExpressionScope` hands it, and its work is bounded (source length, nesting,
 * evaluation steps, string length).
 *
 * Everything random (wiggle, random, noise) is a hash of the scope's seed and
 * the time, so the preview and the export draw the same frame.
 */
import type { Vec2 } from "./types.ts";

export type ExprValue = number | boolean | string | number[];

/** What an expression can see. Everything is supplied by the caller; the interpreter itself knows nothing about clips. */
export interface ExpressionScope {
  /** Seconds since the clip's start. */
  time: number;
  /** The property's own value at `time` without the expression (keyframed or static): a number or a point. */
  value: number | number[];
  /** Frames per second of the sequence. */
  fps: number;
  /** The property's own value (without the expression) at another time: what `valueAtTime(t)` returns. */
  valueAtTime(t: number): number | number[];
  /** The property's keyframe times (same clock as `time`), sorted; empty when it has none. Used by loopIn/loopOut and `numKeys`/`key(i)`. */
  keyTimes: readonly number[];
  /** Another property of the same clip by path "effectId.paramKey" (e.g. "motion.position"), at a time (default: now); undefined when there's no such property. */
  prop(path: string, t?: number): ExprValue | undefined;
  /** A stable seed for this property's random functions (wiggle, random, noise), so every property wiggles differently but deterministically. */
  seed: number;
}

/** A parsed expression: parse once, evaluate every frame. */
export interface Expression {
  readonly source: string;
  /** The parsed statements (opaque to callers). */
  readonly program: readonly Stmt[];
}

/** A parse or runtime error in an expression, worded for the person (or model) who wrote it. */
export class ExpressionError extends Error {
  /** 0-based character offset into the source, when known. */
  readonly position?: number;

  constructor(message: string, position?: number) {
    super(position === undefined ? message : `${message} at ${position}`);
    this.name = "ExpressionError";
    this.position = position;
  }
}

// Limits: an expression runs for every animated property of every frame.
const MAX_SOURCE = 5000;
const MAX_STEPS = 10_000;
const MAX_NESTING = 200;
const MAX_DEPTH = 300;
const MAX_STRING = 10_000;
const CACHE_SIZE = 500;

const fail = (message: string, position?: number): never => {
  throw new ExpressionError(message, position);
};

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

interface Token {
  type: "num" | "str" | "id" | "op" | "end";
  /** The operator or identifier, or a string's decoded text. */
  text: string;
  /** As written, for error messages. */
  raw: string;
  value: number;
  pos: number;
  /** A line break came before it (statements end at line breaks). */
  nl: boolean;
}

// Longest first, so `===` isn't read as `==` then `=`.
const OPERATORS = [
  "===", "!==",
  "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "**", "+=", "-=", "*=", "/=", "++", "--",
  "+", "-", "*", "/", "%", "<", ">", "=", "!", "?", ":", ";", ",", ".", "(", ")", "[", "]", "{", "}",
];
const NUMBER = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const IDENTIFIER = /[A-Za-z_$][\w$]*/y;
const ESCAPES = new Map([["n", "\n"], ["t", "\t"], ["r", "\r"], ["0", "\0"], ["b", "\b"]]);

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let nl = false;
  const push = (type: Token["type"], text: string, start: number, value = 0) => {
    tokens.push({ type, text, raw: src.slice(start, i), value, pos: start, nl });
    nl = false;
  };
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") {
      nl = true;
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end < 0) fail("This comment is never closed (add */)", i);
      if (src.slice(i, end).includes("\n")) nl = true;
      i = end + 2;
      continue;
    }
    const start = i;
    NUMBER.lastIndex = i;
    const number = NUMBER.exec(src);
    if (number) {
      i += number[0].length;
      if (i < src.length && /[\w$]/.test(src[i])) fail(`Unexpected "${src[i]}" after the number ${number[0]}`, i);
      push("num", number[0], start, Number(number[0]));
      continue;
    }
    IDENTIFIER.lastIndex = i;
    const identifier = IDENTIFIER.exec(src);
    if (identifier) {
      i += identifier[0].length;
      push("id", identifier[0], start);
      continue;
    }
    if (c === '"' || c === "'") {
      let text = "";
      i++;
      for (;;) {
        if (i >= src.length || src[i] === "\n") fail(`This text is never closed (add ${c})`, start);
        const ch = src[i++];
        if (ch === c) break;
        if (ch !== "\\") {
          text += ch;
          continue;
        }
        if (i >= src.length) fail(`This text is never closed (add ${c})`, start);
        const escaped = src[i++];
        text += ESCAPES.get(escaped) ?? escaped;
      }
      push("str", text, start);
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (!op) fail(`Unexpected "${c}"`, i);
    else {
      i += op.length;
      push("op", op, start);
    }
  }
  tokens.push({ type: "end", text: "", raw: "", value: 0, pos: src.length, nl: true });
  return tokens;
}

// ---------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------

type Node =
  | { kind: "num"; pos: number; value: number }
  | { kind: "str"; pos: number; value: string }
  | { kind: "bool"; pos: number; value: boolean }
  | { kind: "nothing"; pos: number }
  | { kind: "array"; pos: number; items: Node[] }
  | { kind: "name"; pos: number; name: string }
  | { kind: "unary"; pos: number; op: string; arg: Node }
  | { kind: "binary"; pos: number; op: string; left: Node; right: Node }
  | { kind: "logical"; pos: number; op: string; left: Node; right: Node }
  | { kind: "cond"; pos: number; test: Node; then: Node; otherwise: Node }
  | { kind: "index"; pos: number; target: Node; index: Node }
  | { kind: "member"; pos: number; target: Node; name: string }
  | { kind: "call"; pos: number; name: string; args: Node[] }
  | { kind: "mathCall"; pos: number; name: string; args: Node[] }
  | { kind: "mathConst"; pos: number; name: string };

type Stmt =
  | { kind: "expr"; pos: number; expr: Node }
  | { kind: "declare"; pos: number; how: string; name: string; init: Node | null }
  | { kind: "assign"; pos: number; op: string; name: string; expr: Node }
  | { kind: "if"; pos: number; test: Node; then: Stmt[]; otherwise: Stmt[] | null };

/** JavaScript the language leaves out, and what to say about each. */
const UNSUPPORTED = new Map<string, string>([
  ...["for", "while", "do", "break", "continue"].map((k): [string, string] => [k, `Loops ("${k}") aren't supported in expressions`]),
  ...["function", "return", "class", "async", "await", "yield"].map(
    (k): [string, string] => [k, `Functions can't be defined in expressions ("${k}")`],
  ),
  ...["new", "this", "typeof", "instanceof", "in", "of", "delete", "void", "switch", "case", "default", "throw", "try", "catch", "finally", "import", "export", "with", "super"].map(
    (k): [string, string] => [k, `"${k}" isn't supported in expressions`],
  ),
]);
const STATEMENT_WORDS = new Set(["if", "else", "const", "let", "var"]);
const LITERAL_WORDS = new Set(["true", "false", "null", "undefined", "Math"]);
const MEMBERS = new Set(["length", "x", "y"]);
const ASSIGNMENTS = new Set(["=", "+=", "-=", "*=", "/="]);
const UNARY = new Set(["-", "+", "!"]);
// Loosest first; `??` and the ternary sit above these, `**` and the unary operators below.
const BINARY_LEVELS = [["||"], ["&&"], ["==", "!=", "===", "!=="], ["<", "<=", ">", ">="], ["+", "-"], ["*", "/", "%"]];

const MATH_FUNCTIONS = new Map<string, (...n: number[]) => number>();
for (const name of [
  "abs", "acos", "acosh", "asin", "asinh", "atan", "atan2", "atanh", "cbrt", "ceil", "cos", "cosh", "exp", "expm1", "floor",
  "fround", "hypot", "log", "log10", "log1p", "log2", "max", "min", "pow", "round", "sign", "sin", "sinh", "sqrt", "tan",
  "tanh", "trunc",
]) {
  MATH_FUNCTIONS.set(name, (Math as unknown as Record<string, (...n: number[]) => number>)[name]);
}
const MATH_CONSTANTS = new Map<string, number>([
  ["PI", Math.PI],
  ["E", Math.E],
  ["LN2", Math.LN2],
  ["LN10", Math.LN10],
  ["LOG2E", Math.LOG2E],
  ["LOG10E", Math.LOG10E],
  ["SQRT2", Math.SQRT2],
  ["SQRT1_2", Math.SQRT1_2],
]);

function parseProgram(source: string): Stmt[] {
  const tokens = tokenize(source);
  let p = 0;
  let nesting = 0;

  const isOp = (text: string, t: Token = tokens[p]) => t.type === "op" && t.text === text;
  const unexpected = (expected?: string): never => {
    const t = tokens[p];
    const wanted = expected ? ` (expected ${expected})` : "";
    if (t.type === "end") return fail(`Unexpected end of the expression${wanted}`, t.pos);
    if (isOp("=>")) return fail("Arrow functions aren't supported in expressions", t.pos);
    if (isOp("{")) return fail('Unexpected "{": objects and blocks aren\'t supported in expressions', t.pos);
    if (isOp("++") || isOp("--")) return fail(`"${t.text}" isn't supported: write x ${t.text[0]}= 1`, t.pos);
    if (t.type === "id" && UNSUPPORTED.has(t.text)) return fail(UNSUPPORTED.get(t.text)!, t.pos);
    return fail(`Unexpected "${t.raw}"${wanted}`, t.pos);
  };
  const expect = (text: string) => {
    if (!isOp(text)) unexpected(`"${text}"`);
    return tokens[p++];
  };
  const deeper = (pos: number) => {
    if (++nesting > MAX_NESTING) fail("The expression is nested too deeply", pos);
  };
  /** A name the user may give a variable. */
  const variableName = (): string => {
    const t = tokens[p];
    if (t.type !== "id") return unexpected("a name");
    if (UNSUPPORTED.has(t.text) || STATEMENT_WORDS.has(t.text) || LITERAL_WORDS.has(t.text)) {
      return fail(`"${t.text}" can't be a variable's name`, t.pos);
    }
    p++;
    return t.text;
  };

  const list = (close: string): Node[] => {
    const items: Node[] = [];
    while (!isOp(close)) {
      items.push(ternary());
      if (!isOp(",")) break;
      p++;
    }
    expect(close);
    return items;
  };

  const primary = (): Node => {
    const t = tokens[p];
    const pos = t.pos;
    if (t.type === "num") {
      p++;
      return { kind: "num", pos, value: t.value };
    }
    if (t.type === "str") {
      p++;
      return { kind: "str", pos, value: t.text };
    }
    if (isOp("(")) {
      p++;
      const inner = ternary();
      expect(")");
      return inner;
    }
    if (isOp("[")) {
      p++;
      return { kind: "array", pos, items: list("]") };
    }
    if (t.type !== "id" || UNSUPPORTED.has(t.text) || STATEMENT_WORDS.has(t.text)) return unexpected();
    p++;
    const name = t.text;
    if (name === "true" || name === "false") return { kind: "bool", pos, value: name === "true" };
    if (name === "null" || name === "undefined") return { kind: "nothing", pos };
    if (name === "Math") {
      if (!isOp(".")) fail("Math can only be used as Math.name, e.g. Math.sin(time) or Math.PI", pos);
      p++;
      const member = tokens[p];
      if (member.type !== "id") return unexpected("a Math function or constant");
      p++;
      const known = member.text === "random" || MATH_FUNCTIONS.has(member.text);
      if (isOp("(") && !tokens[p].nl) {
        if (!known) fail(`Math.${member.text} isn't a function expressions can use`, member.pos);
        p++;
        return { kind: "mathCall", pos, name: member.text, args: list(")") };
      }
      if (known) fail(`Math.${member.text} is a function: call it, e.g. Math.${member.text}(…)`, member.pos);
      if (!MATH_CONSTANTS.has(member.text)) fail(`Math.${member.text} isn't available in expressions`, member.pos);
      return { kind: "mathConst", pos, name: member.text };
    }
    if (isOp("(") && !tokens[p].nl) {
      if (!FUNCTIONS.has(name)) fail(`Unknown function "${name}"`, pos);
      p++;
      return { kind: "call", pos, name, args: list(")") };
    }
    return { kind: "name", pos, name };
  };

  const postfix = (): Node => {
    let node = primary();
    for (;;) {
      const t = tokens[p];
      if (isOp(".")) {
        p++;
        const member = tokens[p];
        if (member.type !== "id") return unexpected("length, x or y");
        if (!MEMBERS.has(member.text)) {
          fail(`Can't read ".${member.text}": values only have .length, .x and .y`, member.pos);
        }
        p++;
        node = { kind: "member", pos: member.pos, target: node, name: member.text };
      } else if (isOp("[") && !t.nl) {
        // A `[` on a new line starts a new statement (an array), unlike JavaScript: the usual last line of an expression.
        p++;
        const index = ternary();
        expect("]");
        node = { kind: "index", pos: t.pos, target: node, index };
      } else if (isOp("(") && !t.nl) {
        return fail("Only the built-in functions can be called, by name", t.pos);
      } else {
        return node;
      }
    }
  };

  const unary = (): Node => {
    const t = tokens[p];
    deeper(t.pos);
    let node: Node;
    if (t.type === "op" && UNARY.has(t.text)) {
      p++;
      const next = tokens[p];
      const arg = next.type === "op" && UNARY.has(next.text) ? unary() : postfix();
      if (isOp("**")) {
        fail(`Put brackets around one side of "**": (${t.text}a) ** b or ${t.text}(a ** b)`, tokens[p].pos);
      }
      node = { kind: "unary", pos: t.pos, op: t.text, arg };
    } else {
      node = postfix();
      if (isOp("**")) {
        const op = tokens[p++];
        // Right-associative: 2 ** 3 ** 2 is 2 ** 9.
        node = { kind: "binary", pos: op.pos, op: "**", left: node, right: unary() };
      }
    }
    nesting--;
    return node;
  };

  const binary = (level: number): Node => {
    if (level === BINARY_LEVELS.length) return unary();
    const ops = BINARY_LEVELS[level];
    let left = binary(level + 1);
    for (;;) {
      const t = tokens[p];
      if (t.type !== "op" || !ops.includes(t.text)) return left;
      p++;
      const right = binary(level + 1);
      left = { kind: level < 2 ? "logical" : "binary", pos: t.pos, op: t.text, left, right };
    }
  };

  const nullish = (): Node => {
    let left = binary(0);
    while (isOp("??")) {
      const t = tokens[p++];
      left = { kind: "logical", pos: t.pos, op: "??", left, right: binary(0) };
    }
    return left;
  };

  function ternary(): Node {
    deeper(tokens[p].pos);
    let node = nullish();
    if (isOp("?")) {
      const t = tokens[p++];
      const then = ternary();
      expect(":");
      node = { kind: "cond", pos: t.pos, test: node, then, otherwise: ternary() };
    }
    nesting--;
    return node;
  }

  /** A statement ends at a `;`, a line break, a `}` or the end. */
  const endStatement = () => {
    const t = tokens[p];
    if (isOp(";")) p++;
    else if (t.type !== "end" && !isOp("}") && !t.nl) unexpected();
  };

  const body = (): Stmt[] => {
    const out: Stmt[] = [];
    if (!isOp("{")) {
      statement(out);
      return out;
    }
    p++;
    while (!isOp("}")) {
      if (tokens[p].type === "end") unexpected('"}"');
      statement(out);
    }
    p++;
    return out;
  };

  function statement(out: Stmt[]): void {
    const t = tokens[p];
    const pos = t.pos;
    if (isOp(";")) {
      p++;
      return;
    }
    deeper(pos);
    if (t.type === "id" && (t.text === "const" || t.text === "let" || t.text === "var")) {
      p++;
      for (;;) {
        const at = tokens[p].pos;
        const name = variableName();
        let init: Node | null = null;
        if (isOp("=")) {
          p++;
          init = ternary();
        } else if (t.text === "const") {
          fail(`const ${name} needs a value: const ${name} = …`, at);
        }
        out.push({ kind: "declare", pos: at, how: t.text, name, init });
        if (!isOp(",")) break;
        p++;
      }
      endStatement();
    } else if (t.type === "id" && t.text === "if") {
      p++;
      expect("(");
      const test = ternary();
      expect(")");
      const then = body();
      let otherwise: Stmt[] | null = null;
      if (tokens[p].type === "id" && tokens[p].text === "else") {
        p++;
        otherwise = body();
      }
      out.push({ kind: "if", pos, test, then, otherwise });
    } else if (t.type === "id" && tokens[p + 1].type === "op" && ASSIGNMENTS.has(tokens[p + 1].text)) {
      const name = variableName();
      const op = tokens[p++].text;
      out.push({ kind: "assign", pos, op, name, expr: ternary() });
      endStatement();
    } else {
      out.push({ kind: "expr", pos, expr: ternary() });
      endStatement();
    }
    nesting--;
  }

  const program: Stmt[] = [];
  while (tokens[p].type !== "end") statement(program);
  if (!program.length) fail("The expression is empty", 0);
  return program;
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** A value inside the interpreter: `undefined` is JavaScript's null/undefined (an unset variable, an index past the end). */
type Val = ExprValue | undefined;
type Num = number | number[];

const describe = (v: Val): string =>
  v === undefined
    ? "nothing (undefined)"
    : Array.isArray(v)
      ? "an array"
      : typeof v === "string"
        ? "text"
        : typeof v === "boolean"
          ? String(v)
          : "a number";

const text = (v: Val): string => (Array.isArray(v) ? v.join(",") : String(v));
const truthy = (v: Val): boolean => Array.isArray(v) || Boolean(v);
const toVec = (v: Num): number[] => (typeof v === "number" ? [v] : v);

/** Element-wise on two numbers or arrays (After Effects: the shorter array counts as padded with 0). */
function zip(a: Num, b: Num, f: (x: number, y: number) => number): Num {
  if (typeof a === "number" && typeof b === "number") return f(a, b);
  const x = toVec(a);
  const y = toVec(b);
  const out: number[] = [];
  for (let i = 0; i < Math.max(x.length, y.length); i++) out.push(f(x[i] ?? 0, y[i] ?? 0));
  return out;
}

const each = (a: Num, f: (x: number) => number): Num => (typeof a === "number" ? f(a) : a.map(f));

/** A number or array for arithmetic (booleans count as 0/1, as in JavaScript). */
function operand(v: Val, what: string, pos: number): Num {
  if (typeof v === "number" || Array.isArray(v)) return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return fail(`${what} needs numbers or arrays, not ${describe(v)}`, pos);
}

function arithmetic(op: string, a: Val, b: Val, pos: number): Val {
  if (op === "+" && (typeof a === "string" || typeof b === "string")) {
    const joined = text(a) + text(b);
    if (joined.length > MAX_STRING) fail("The text is too long", pos);
    return joined;
  }
  const what = `"${op}"`;
  const x = operand(a, what, pos);
  const y = operand(b, what, pos);
  switch (op) {
    case "+":
      return zip(x, y, (m, n) => m + n);
    case "-":
      return zip(x, y, (m, n) => m - n);
    case "*":
      if (typeof y === "number") return each(x, (m) => m * y);
      if (typeof x === "number") return each(y, (n) => x * n);
      return fail("Can't multiply two arrays: multiply an array by a number, or use dot(a, b)", pos);
    case "/":
      if (typeof y === "number") return each(x, (m) => m / y);
      return fail("Can't divide by an array: divide by a number", pos);
    default:
      if (typeof x !== "number" || typeof y !== "number") return fail(`${what} only works on numbers, not arrays`, pos);
      return op === "%" ? x % y : x ** y;
  }
}

function equal(a: Val, b: Val, strict: boolean): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    // By value (JavaScript compares arrays by identity, which is never what an expression means).
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
  }
  if (typeof a === typeof b || strict) return a === b;
  if (a === undefined || b === undefined) return false;
  return Number(a) === Number(b);
}

function compare(op: string, a: Val, b: Val, pos: number): boolean {
  let x: number | string;
  let y: number | string;
  if (typeof a === "string" && typeof b === "string") {
    x = a;
    y = b;
  } else {
    const m = operand(a, `"${op}"`, pos);
    const n = operand(b, `"${op}"`, pos);
    if (typeof m !== "number" || typeof n !== "number") return fail(`"${op}" compares numbers, not arrays`, pos);
    x = m;
    y = n;
  }
  return op === "<" ? x < y : op === "<=" ? x <= y : op === ">" ? x > y : x >= y;
}

// ---------------------------------------------------------------------------
// Deterministic noise
// ---------------------------------------------------------------------------

/** Two integers hashed into 32 bits (murmur's finaliser). */
function mix(a: number, b: number): number {
  let h = (a | 0) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Any number as a hash (seeds needn't be integers). */
function hashOf(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const whole = Math.floor(x);
  return mix(whole % 0x100000000, Math.floor((x - whole) * 0x7fffffff));
}

/** A hash as a number in [0, 1). */
const unit = (h: number) => h / 0x100000000;
const smooth = (f: number) => f * f * (3 - 2 * f);

/** Smooth value noise in [-1, 1]: a random value at every integer, eased between them. */
function noise1(x: number, seed: number): number {
  const i = Math.floor(x);
  const a = unit(mix(seed, i)) * 2 - 1;
  const b = unit(mix(seed, i + 1)) * 2 - 1;
  return a + (b - a) * smooth(x - i);
}

/** The same in up to three dimensions. */
function noiseN(point: number[], seed: number): number {
  const cells = point.map(Math.floor);
  const weights = point.map((x, d) => smooth(x - cells[d]));
  let sum = 0;
  for (let corner = 0; corner < 1 << point.length; corner++) {
    let h = seed;
    let weight = 1;
    for (let d = 0; d < point.length; d++) {
      const far = (corner >> d) & 1;
      h = mix(h, cells[d] + far);
      weight *= far ? weights[d] : 1 - weights[d];
    }
    sum += weight * (unit(h) * 2 - 1);
  }
  return sum;
}

const WIGGLE_SALT = 0x77696767;
const RANDOM_SALT = 0x72616e64;
const NOISE_SALT = 0x6e6f6973;

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

interface Variable {
  value: Val;
  constant: boolean;
}

/** One evaluation's state. */
interface Run {
  scope: ExpressionScope;
  steps: number;
  depth: number;
  /** `time`, which posterizeTime holds. */
  time: number;
  value: Num;
  /** Innermost block last; `var` and undeclared assignments go in the first. */
  blocks: Map<string, Variable>[];
  last: Val;
  randomSeed: number;
  randomCalls: number;
  timeless: boolean;
}

function charge(r: Run, steps: number, pos?: number): void {
  r.steps += steps;
  if (!(r.steps <= MAX_STEPS)) fail(`The expression does too much work (over ${MAX_STEPS} steps)`, pos);
}

/** A property value handed over by the scope, checked and copied. */
function numeric(v: unknown, what: string, pos?: number): Num {
  if (typeof v === "number") return v;
  if (Array.isArray(v) && v.every((n) => typeof n === "number")) return v.slice();
  return fail(`${what} isn't a number or an array of numbers`, pos);
}

function valueAt(r: Run, t: number, pos?: number): Num {
  charge(r, 1, pos);
  return numeric(r.scope.valueAtTime(t), "The property's value", pos);
}

// Arguments. `fn` is the function's name for the message.
function numArg(args: Val[], i: number, fn: string, name: string, pos: number, fallback?: number): number {
  const v = args[i];
  if (v === undefined && fallback !== undefined) return fallback;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return fail(`${fn}(): ${name} must be a number, not ${describe(v)}`, pos);
}

function numOrVecArg(args: Val[], i: number, fn: string, name: string, pos: number): Num {
  const v = args[i];
  if (typeof v === "number" || Array.isArray(v)) return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return fail(`${fn}(): ${name} must be a number or an array, not ${describe(v)}`, pos);
}

const vecArg = (args: Val[], i: number, fn: string, name: string, pos: number): number[] =>
  toVec(numOrVecArg(args, i, fn, name, pos));

function arity(args: Val[], min: number, max: number, signature: string, pos: number): void {
  if (args.length < min || args.length > max) fail(`Wrong number of arguments: ${signature}`, pos);
}

const LOOP_TYPES = ["cycle", "pingpong", "offset", "continue"];

/** loopOut (`out`) repeats the keyframed stretch after its last keyframe; loopIn before its first. */
function loop(r: Run, args: Val[], pos: number, out: boolean): Val {
  const fn = out ? "loopOut" : "loopIn";
  arity(args, 0, 2, `${fn}(type = "cycle", numKeyframes = 0)`, pos);
  const type = args[0] ?? "cycle";
  if (typeof type !== "string" || !LOOP_TYPES.includes(type)) {
    fail(`${fn}(): the type must be one of ${LOOP_TYPES.map((t) => `"${t}"`).join(", ")}`, pos);
  }
  const segments = Math.max(0, Math.floor(numArg(args, 1, fn, "numKeyframes", pos, 0)));
  const keys = r.scope.keyTimes;
  const n = keys.length;
  if (n < 2) return r.value;
  const first = out && segments > 0 ? keys[Math.max(0, n - 1 - segments)] : keys[0];
  const last = !out && segments > 0 ? keys[Math.min(n - 1, segments)] : keys[n - 1];
  const span = last - first;
  // How far outside the keyframes, from the edge being looped from.
  const elapsed = out ? r.time - last : first - r.time;
  if (!(elapsed > 0) || !(span > 0)) return r.value;
  const edge = out ? last : first;
  const at = (t: number) => valueAt(r, t, pos);
  if (type === "continue") {
    const frame = 1 / (r.scope.fps > 0 ? r.scope.fps : 30);
    // The speed over the last (first) frame of the animation, carried on in a straight line.
    const velocity = out ? zip(at(edge), at(edge - frame), (a, b) => (a - b) / frame) : zip(at(edge + frame), at(edge), (a, b) => (a - b) / frame);
    const dt = r.time - edge;
    return zip(at(edge), velocity, (v, speed) => v + speed * dt);
  }
  const cycles = Math.floor(elapsed / span);
  const rest = elapsed - cycles * span;
  // Forwards from the first keyframe, or backwards from the last.
  const forwards = out ? first + rest : last - rest;
  const backwards = out ? last - rest : first + rest;
  if (type === "pingpong") return at(cycles % 2 === 0 ? backwards : forwards);
  if (type === "cycle") return at(forwards);
  const step = zip(at(last), at(first), (a, b) => a - b);
  const times = (cycles + 1) * (out ? 1 : -1);
  return zip(at(forwards), step, (v, d) => v + d * times);
}

/** linear/ease/easeIn/easeOut: `t` mapped from [tMin, tMax] onto [value1, value2] along `curve`, held outside. */
const ramp = (fn: string, curve: (p: number) => number) => (_r: Run, args: Val[], pos: number): Val => {
  if (args.length !== 3 && args.length !== 5) {
    fail(`Wrong number of arguments: ${fn}(t, tMin, tMax, value1, value2) or ${fn}(t, value1, value2)`, pos);
  }
  const five = args.length === 5;
  const t = numArg(args, 0, fn, "t", pos);
  const tMin = five ? numArg(args, 1, fn, "tMin", pos) : 0;
  const tMax = five ? numArg(args, 2, fn, "tMax", pos) : 1;
  const from = numOrVecArg(args, five ? 3 : 1, fn, "value1", pos);
  const to = numOrVecArg(args, five ? 4 : 2, fn, "value2", pos);
  const p = tMax === tMin ? (t < tMin ? 0 : 1) : Math.min(1, Math.max(0, (t - tMin) / (tMax - tMin)));
  const eased = curve(p);
  return zip(from, to, (a, b) => a + (b - a) * eased);
};

function random(r: Run, args: Val[], pos: number): Val {
  arity(args, 0, 2, "random(), random(max) or random(min, max)", pos);
  const frame = r.timeless ? 0 : Math.floor(r.time * r.scope.fps + 1e-6);
  const seed = mix(r.randomSeed, Number.isFinite(frame) ? frame % 0x100000000 : 0);
  const draw = () => unit(mix(seed, r.randomCalls++));
  if (!args.length) return draw();
  const min = args.length === 2 ? numOrVecArg(args, 0, "random", "min", pos) : 0;
  const max = numOrVecArg(args, args.length - 1, "random", "max", pos);
  charge(r, Math.max(toVec(min).length, toVec(max).length), pos);
  return zip(min, max, (a, b) => a + (b - a) * draw());
}

interface Global {
  name: string;
  signature: string;
  description: string;
  get?: (r: Run) => Val;
  call?: (r: Run, args: Val[], pos: number) => Val;
}

const vectorMaths = (fn: string, op: string) => (_r: Run, args: Val[], pos: number): Val => {
  arity(args, 2, 2, `${fn}(a, b)`, pos);
  return arithmetic(op, numOrVecArg(args, 0, fn, "a", pos), numOrVecArg(args, 1, fn, "b", pos), pos);
};

const GLOBALS: Global[] = [
  { name: "time", signature: "time", description: "Seconds since the clip's start.", get: (r) => r.time },
  {
    name: "value",
    signature: "value",
    description: "The property's own value now (its keyframes or static value), without the expression.",
    get: (r) => (typeof r.value === "number" ? r.value : r.value.slice()),
  },
  { name: "fps", signature: "fps", description: "The sequence's frames per second.", get: (r) => r.scope.fps },
  { name: "numKeys", signature: "numKeys", description: "How many keyframes the property has.", get: (r) => r.scope.keyTimes.length },
  {
    name: "key",
    signature: "key(index)",
    description: "The time of the property's keyframe number `index` (the first is 1).",
    call: (r, args, pos) => {
      arity(args, 1, 1, "key(index)", pos);
      const i = numArg(args, 0, "key", "index", pos);
      const n = r.scope.keyTimes.length;
      if (!Number.isInteger(i) || i < 1 || i > n) {
        fail(n ? `key(${i}): the property has keyframes 1 to ${n}` : `key(${i}): the property has no keyframes`, pos);
      }
      return r.scope.keyTimes[i - 1];
    },
  },
  {
    name: "valueAtTime",
    signature: "valueAtTime(t)",
    description: "The property's own value at another time (seconds since the clip's start).",
    call: (r, args, pos) => {
      arity(args, 1, 1, "valueAtTime(t)", pos);
      return valueAt(r, numArg(args, 0, "valueAtTime", "t", pos), pos);
    },
  },
  {
    name: "wiggle",
    signature: "wiggle(freq, amp, octaves = 1, ampMult = 0.5, t = time)",
    description: "The value shaken smoothly: `freq` wiggles a second, up to `amp` either way. Octaves add finer detail.",
    call: (r, args, pos) => {
      arity(args, 2, 5, "wiggle(freq, amp, octaves = 1, ampMult = 0.5, t = time)", pos);
      const freq = numArg(args, 0, "wiggle", "freq", pos);
      const amp = numArg(args, 1, "wiggle", "amp", pos);
      const octaves = Math.max(1, Math.floor(numArg(args, 2, "wiggle", "octaves", pos, 1)));
      const ampMult = numArg(args, 3, "wiggle", "ampMult", pos, 0.5);
      const t = numArg(args, 4, "wiggle", "t", pos, r.time);
      charge(r, octaves * toVec(r.value).length, pos);
      const seed = mix(hashOf(r.scope.seed), WIGGLE_SALT);
      const offset = (component: number) => {
        let sum = 0;
        for (let o = 0; o < octaves; o++) sum += ampMult ** o * noise1(t * freq * 2 ** o, mix(seed, component * 1009 + o));
        return amp * sum;
      };
      return typeof r.value === "number" ? r.value + offset(0) : r.value.map((v, i) => v + offset(i));
    },
  },
  {
    name: "loopOut",
    signature: 'loopOut(type = "cycle", numKeyframes = 0)',
    description:
      'Repeats the keyframed animation after its last keyframe: "cycle", "pingpong" (back and forth), "offset" (each round carries on from the last) or "continue" (keeps its final speed). numKeyframes = how many segments to loop (0 = all).',
    call: (r, args, pos) => loop(r, args, pos, true),
  },
  {
    name: "loopIn",
    signature: 'loopIn(type = "cycle", numKeyframes = 0)',
    description: "Like loopOut, but before the first keyframe.",
    call: (r, args, pos) => loop(r, args, pos, false),
  },
  {
    name: "linear",
    signature: "linear(t, tMin, tMax, value1, value2)",
    description: "value1 when t <= tMin, value2 when t >= tMax, a straight line between. linear(t, value1, value2) uses 0..1.",
    call: ramp("linear", (p) => p),
  },
  {
    name: "ease",
    signature: "ease(t, tMin, tMax, value1, value2)",
    description: "Like linear, but slow at both ends.",
    call: ramp("ease", smooth),
  },
  {
    name: "easeIn",
    signature: "easeIn(t, tMin, tMax, value1, value2)",
    description: "Like linear, but leaving value1 slowly.",
    call: ramp("easeIn", (p) => p * p),
  },
  {
    name: "easeOut",
    signature: "easeOut(t, tMin, tMax, value1, value2)",
    description: "Like linear, but reaching value2 slowly.",
    call: ramp("easeOut", (p) => 1 - (1 - p) * (1 - p)),
  },
  {
    name: "clamp",
    signature: "clamp(value, min, max)",
    description: "The value kept between min and max (each component of an array).",
    call: (_r, args, pos) => {
      arity(args, 3, 3, "clamp(value, min, max)", pos);
      const v = numOrVecArg(args, 0, "clamp", "value", pos);
      const min = numOrVecArg(args, 1, "clamp", "min", pos);
      const max = numOrVecArg(args, 2, "clamp", "max", pos);
      // A single limit applies to every component (zip would pad it with 0).
      const limit = (l: Num, i: number) => (typeof l === "number" ? l : (l[i] ?? 0));
      const one = (x: number, i: number) => Math.min(Math.max(x, limit(min, i)), limit(max, i));
      return typeof v === "number" ? one(v, 0) : v.map(one);
    },
  },
  {
    name: "random",
    signature: "random(min = 0, max = 1)",
    description: "A random number (or array, given arrays) that changes every frame but is the same every time that frame is drawn. random(max) is 0..max.",
    call: random,
  },
  {
    name: "seedRandom",
    signature: "seedRandom(seed, timeless = false)",
    description: "Picks another sequence for random(); timeless = true keeps its numbers the same on every frame.",
    call: (r, args, pos) => {
      arity(args, 1, 2, "seedRandom(seed, timeless = false)", pos);
      r.randomSeed = mix(mix(hashOf(r.scope.seed), RANDOM_SALT), hashOf(numArg(args, 0, "seedRandom", "seed", pos)));
      r.timeless = truthy(args[1]);
      r.randomCalls = 0;
      return undefined;
    },
  },
  {
    name: "noise",
    signature: "noise(x)",
    description: "Smooth noise between -1 and 1 for a number or a point (up to 3 numbers): nearby inputs give nearby results.",
    call: (r, args, pos) => {
      arity(args, 1, 1, "noise(x)", pos);
      const point = vecArg(args, 0, "noise", "x", pos).slice(0, 3);
      if (!point.length) fail("noise(): x is an empty array", pos);
      charge(r, 1 << point.length, pos);
      return noiseN(point, NOISE_SALT);
    },
  },
  {
    name: "degreesToRadians",
    signature: "degreesToRadians(degrees)",
    description: "Degrees as radians (for Math.sin and friends).",
    call: (_r, args, pos) => {
      arity(args, 1, 1, "degreesToRadians(degrees)", pos);
      return (numArg(args, 0, "degreesToRadians", "degrees", pos) * Math.PI) / 180;
    },
  },
  {
    name: "radiansToDegrees",
    signature: "radiansToDegrees(radians)",
    description: "Radians as degrees.",
    call: (_r, args, pos) => {
      arity(args, 1, 1, "radiansToDegrees(radians)", pos);
      return (numArg(args, 0, "radiansToDegrees", "radians", pos) * 180) / Math.PI;
    },
  },
  {
    name: "length",
    signature: "length(a, b?)",
    description: "The length of a vector, or the distance between two points.",
    call: (_r, args, pos) => {
      arity(args, 1, 2, "length(a) or length(a, b)", pos);
      const a = numOrVecArg(args, 0, "length", "a", pos);
      const d = args.length === 2 ? zip(a, numOrVecArg(args, 1, "length", "b", pos), (x, y) => x - y) : a;
      return Math.hypot(...toVec(d));
    },
  },
  { name: "add", signature: "add(a, b)", description: "a + b, component by component.", call: vectorMaths("add", "+") },
  { name: "sub", signature: "sub(a, b)", description: "a - b, component by component.", call: vectorMaths("sub", "-") },
  { name: "mul", signature: "mul(a, amount)", description: "An array with every component multiplied by a number.", call: vectorMaths("mul", "*") },
  { name: "div", signature: "div(a, amount)", description: "An array with every component divided by a number.", call: vectorMaths("div", "/") },
  {
    name: "normalize",
    signature: "normalize(a)",
    description: "The vector scaled to length 1 (a zero vector stays zero).",
    call: (_r, args, pos) => {
      arity(args, 1, 1, "normalize(a)", pos);
      const a = vecArg(args, 0, "normalize", "a", pos);
      const size = Math.hypot(...a);
      return a.map((v) => (size > 0 ? v / size : 0));
    },
  },
  {
    name: "dot",
    signature: "dot(a, b)",
    description: "The dot product of two vectors.",
    call: (_r, args, pos) => {
      arity(args, 2, 2, "dot(a, b)", pos);
      const products = zip(vecArg(args, 0, "dot", "a", pos), vecArg(args, 1, "dot", "b", pos), (x, y) => x * y);
      return toVec(products).reduce((sum, v) => sum + v, 0);
    },
  },
  {
    name: "lookAt",
    signature: "lookAt(from, to)",
    description: "The angle in degrees of the direction from one point to another (0 = to the right, 90 = down the canvas).",
    call: (_r, args, pos) => {
      arity(args, 2, 2, "lookAt(from, to)", pos);
      const from = vecArg(args, 0, "lookAt", "from", pos);
      const to = vecArg(args, 1, "lookAt", "to", pos);
      return (Math.atan2((to[1] ?? 0) - (from[1] ?? 0), (to[0] ?? 0) - (from[0] ?? 0)) * 180) / Math.PI;
    },
  },
  {
    name: "prop",
    signature: 'prop("effect.param", t = time)',
    description: 'Another property of the same clip, e.g. prop("motion.position"), now or at a time.',
    call: (r, args, pos) => {
      arity(args, 1, 2, 'prop("effect.param", t = time)', pos);
      const path = args[0];
      if (typeof path !== "string") return fail(`prop(): the path must be text like "motion.position", not ${describe(path)}`, pos);
      charge(r, 1, pos);
      const v = r.scope.prop(path, numArg(args, 1, "prop", "t", pos, r.time));
      if (v === undefined || v === null) return fail(`prop(): this clip has no property "${path}"`, pos);
      if (typeof v === "string" || typeof v === "boolean") return v;
      return numeric(v, `The property "${path}"`, pos);
    },
  },
  {
    name: "posterizeTime",
    signature: "posterizeTime(framesPerSecond)",
    description: "Makes the rest of the expression (time, value, wiggle, random...) change only that many times a second. Returns the held value.",
    call: (r, args, pos) => {
      arity(args, 1, 1, "posterizeTime(framesPerSecond)", pos);
      const rate = numArg(args, 0, "posterizeTime", "framesPerSecond", pos);
      if (!(rate > 0) || !Number.isFinite(rate)) fail("posterizeTime(): framesPerSecond must be above 0", pos);
      // The epsilon keeps a frame that lands exactly on a step (3/30 * 10) on it despite rounding.
      r.time = Math.floor(r.scope.time * rate + 1e-9) / rate;
      r.value = valueAt(r, r.time, pos);
      return typeof r.value === "number" ? r.value : r.value.slice();
    },
  },
];

const VARIABLES = new Map<string, (r: Run) => Val>();
const FUNCTIONS = new Map<string, (r: Run, args: Val[], pos: number) => Val>();
for (const g of GLOBALS) {
  if (g.get) VARIABLES.set(g.name, g.get);
  if (g.call) FUNCTIONS.set(g.name, g.call);
}

/** Names the editor can offer/auto-complete: every global function and variable, with a one-line signature + description. */
export const EXPRESSION_GLOBALS: readonly { name: string; signature: string; description: string }[] = [
  ...GLOBALS.map(({ name, signature, description }) => ({ name, signature, description })),
  {
    name: "Math",
    signature: "Math.sin(x), Math.PI, …",
    description: "JavaScript's Math functions and constants. Math.random() is random(): the same on every draw of a frame.",
  },
];

function lookup(r: Run, name: string): Variable | undefined {
  for (let i = r.blocks.length - 1; i >= 0; i--) {
    const found = r.blocks[i].get(name);
    if (found) return found;
  }
  return undefined;
}

function evaluate(r: Run, node: Node): Val {
  charge(r, 1, node.pos);
  if (++r.depth > MAX_DEPTH) fail("The expression is too complex (nested too deeply)", node.pos);
  const v = evaluateNode(r, node);
  r.depth--;
  return v;
}

function evaluateNode(r: Run, node: Node): Val {
  const pos = node.pos;
  switch (node.kind) {
    case "num":
    case "str":
    case "bool":
      return node.value;
    case "nothing":
      return undefined;
    case "array":
      return node.items.map((item) => {
        const v = evaluate(r, item);
        if (typeof v === "boolean") return v ? 1 : 0;
        return typeof v === "number" ? v : fail(`Arrays hold numbers only, not ${describe(v)}`, item.pos);
      });
    case "name": {
      const variable = lookup(r, node.name);
      if (variable) return variable.value;
      const global = VARIABLES.get(node.name);
      if (global) return global(r);
      if (FUNCTIONS.has(node.name)) return fail(`"${node.name}" is a function: call it, e.g. ${node.name}(…)`, pos);
      return fail(`Unknown name "${node.name}"`, pos);
    }
    case "unary": {
      const v = evaluate(r, node.arg);
      if (node.op === "!") return !truthy(v);
      const n = operand(v, `"${node.op}"`, pos);
      return node.op === "-" ? each(n, (x) => -x) : n;
    }
    case "logical": {
      const left = evaluate(r, node.left);
      if (node.op === "??") return left === undefined ? evaluate(r, node.right) : left;
      return truthy(left) === (node.op === "||") ? left : evaluate(r, node.right);
    }
    case "binary": {
      const left = evaluate(r, node.left);
      const right = evaluate(r, node.right);
      switch (node.op) {
        case "==":
        case "===":
          return equal(left, right, node.op === "===");
        case "!=":
        case "!==":
          return !equal(left, right, node.op === "!==");
        case "<":
        case "<=":
        case ">":
        case ">=":
          return compare(node.op, left, right, pos);
        default:
          return arithmetic(node.op, left, right, pos);
      }
    }
    case "cond":
      return evaluate(r, truthy(evaluate(r, node.test)) ? node.then : node.otherwise);
    case "index": {
      const target = evaluate(r, node.target);
      const index = evaluate(r, node.index);
      if (!Array.isArray(target) && typeof target !== "string") return fail(`Can't index ${describe(target)}: only arrays and text`, pos);
      if (typeof index !== "number") return fail(`An index must be a number, not ${describe(index)}`, pos);
      return Number.isInteger(index) && index >= 0 && index < target.length ? target[index] : undefined;
    }
    case "member": {
      const target = evaluate(r, node.target);
      if (node.name === "length") {
        if (Array.isArray(target) || typeof target === "string") return target.length;
        return fail(`Can't read ".length" of ${describe(target)}: only arrays and text have one`, pos);
      }
      if (!Array.isArray(target)) return fail(`Can't read ".${node.name}" of ${describe(target)}: only arrays have one`, pos);
      return target[node.name === "x" ? 0 : 1];
    }
    case "call": {
      const args = node.args.map((a) => evaluate(r, a));
      return FUNCTIONS.get(node.name)!(r, args, pos);
    }
    case "mathCall": {
      const args = node.args.map((a) => evaluate(r, a));
      if (node.name === "random") return random(r, args, pos);
      const numbers = args.map((_, i) => numArg(args, i, `Math.${node.name}`, `argument ${i + 1}`, pos));
      return MATH_FUNCTIONS.get(node.name)!(...numbers);
    }
    case "mathConst":
      return MATH_CONSTANTS.get(node.name)!;
  }
}

function runBlock(r: Run, statements: readonly Stmt[]): void {
  r.blocks.push(new Map());
  for (const s of statements) execute(r, s);
  r.blocks.pop();
}

function execute(r: Run, s: Stmt): void {
  charge(r, 1, s.pos);
  switch (s.kind) {
    case "expr":
      r.last = evaluate(r, s.expr);
      return;
    case "declare": {
      const block = s.how === "var" ? r.blocks[0] : r.blocks[r.blocks.length - 1];
      const existing = block.get(s.name);
      if (existing && (s.how !== "var" || existing.constant)) fail(`"${s.name}" is already declared`, s.pos);
      // `var x;` again keeps x, as in JavaScript.
      if (existing && !s.init) return;
      block.set(s.name, { value: s.init ? evaluate(r, s.init) : undefined, constant: s.how === "const" });
      return;
    }
    case "assign": {
      const variable = lookup(r, s.name);
      if (variable?.constant) fail(`"${s.name}" is a const: declare it with let to change it`, s.pos);
      const right = evaluate(r, s.expr);
      if (!variable) {
        // After Effects' habit: `amp = 30` declares amp.
        if (s.op !== "=") fail(`Unknown name "${s.name}"`, s.pos);
        r.blocks[0].set(s.name, { value: right, constant: false });
        r.last = right;
        return;
      }
      variable.value = s.op === "=" ? right : arithmetic(s.op[0], variable.value, right, s.pos);
      r.last = variable.value;
      return;
    }
    case "if":
      if (truthy(evaluate(r, s.test))) runBlock(r, s.then);
      else if (s.otherwise) runBlock(r, s.otherwise);
  }
}

// ---------------------------------------------------------------------------
// The API
// ---------------------------------------------------------------------------

// Most recently used last. Errors are kept too: a broken expression is asked for on every frame.
const cache = new Map<string, Expression | ExpressionError>();

/** Parse (and cache by source string) an expression. Throws ExpressionError with a message a user can act on, e.g. `Unexpected ")" at 12`. */
export function parseExpression(source: string): Expression {
  if (typeof source !== "string") throw new ExpressionError("An expression must be text");
  if (source.length > MAX_SOURCE) throw new ExpressionError(`The expression is too long (over ${MAX_SOURCE} characters)`);
  let entry = cache.get(source);
  if (entry) {
    cache.delete(source);
  } else {
    try {
      entry = { source, program: parseProgram(source) };
    } catch (error) {
      if (error instanceof ExpressionError) entry = error;
      else if (error instanceof RangeError) entry = new ExpressionError("The expression is nested too deeply");
      else throw error;
    }
    if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  }
  cache.set(source, entry);
  if (entry instanceof ExpressionError) throw entry;
  return entry;
}

/** Evaluate it. Throws ExpressionError on a runtime error (unknown name, wrong argument, too many steps). The result is whatever the last statement evaluates to. */
export function evaluateExpression(expression: Expression, scope: ExpressionScope): ExprValue {
  const run: Run = {
    scope,
    steps: 0,
    depth: 0,
    time: scope.time,
    value: numeric(scope.value, "The property's value"),
    blocks: [new Map()],
    last: undefined,
    randomSeed: mix(hashOf(scope.seed), RANDOM_SALT),
    randomCalls: 0,
    timeless: false,
  };
  try {
    for (const s of expression.program) execute(run, s);
  } catch (error) {
    if (error instanceof RangeError) throw new ExpressionError("The expression is too complex (nested too deeply)");
    throw error;
  }
  const result = run.last;
  if (result === undefined) throw new ExpressionError("The expression has no value: end it with the value to use");
  return Array.isArray(result) ? result.slice() : result;
}

/**
 * The expression's result coerced to what the property holds: `like` a number → a finite number (a 1+-element array gives its first
 * element; booleans 0/1), `like` a point → a 2-element array of finite numbers (a number n gives [n, n]). Returns undefined when it can't
 * be coerced (strings, NaN/Infinity...). Never throws: on an ExpressionError it returns undefined too. This is what the renderer calls per frame.
 */
export function expressionValue(source: string, scope: ExpressionScope, like: number | number[]): number | Vec2 | undefined {
  let result: ExprValue;
  try {
    result = evaluateExpression(parseExpression(source), scope);
  } catch {
    // Whatever went wrong (the scope's own callbacks included), the renderer falls back to the plain value.
    return undefined;
  }
  if (typeof result === "string") return undefined;
  if (Array.isArray(like)) {
    if (typeof result === "boolean") return undefined;
    const point: Vec2 = typeof result === "number" ? [result, result] : [result[0], result[1]];
    return Number.isFinite(point[0]) && Number.isFinite(point[1]) ? point : undefined;
  }
  const n = typeof result === "boolean" ? (result ? 1 : 0) : typeof result === "number" ? result : result[0];
  return Number.isFinite(n) ? n : undefined;
}

/** null when `source` parses, else the error message (for showing under the expression editor). */
export function expressionError(source: string): string | null {
  try {
    parseExpression(source);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
