import { describe, expect, it } from "vitest";
import {
  EXPRESSION_GLOBALS,
  ExpressionError,
  type ExprValue,
  type ExpressionScope,
  evaluateExpression,
  expressionError,
  expressionValue,
  parseExpression,
} from "./expressions.ts";

const scope = (over: Partial<ExpressionScope> = {}): ExpressionScope => ({
  time: 0,
  value: 0,
  fps: 30,
  valueAtTime: () => 0,
  keyTimes: [],
  prop: () => undefined,
  seed: 1,
  ...over,
});

const run = (source: string, over?: Partial<ExpressionScope>): ExprValue =>
  evaluateExpression(parseExpression(source), scope(over));

/** The error an expression ends in (parsing or running). */
const errorOf = (source: string, over?: Partial<ExpressionScope>): ExpressionError => {
  try {
    run(source, over);
  } catch (error) {
    if (error instanceof ExpressionError) return error;
    throw error;
  }
  throw new Error(`${source} didn't fail`);
};

const close = (actual: ExprValue, expected: number | number[]) => {
  if (typeof expected === "number") return expect(actual).toBeCloseTo(expected, 9);
  expect(Array.isArray(actual)).toBe(true);
  const values = actual as number[];
  expect(values).toHaveLength(expected.length);
  expected.forEach((v, i) => expect(values[i]).toBeCloseTo(v, 9));
};

describe("operators", () => {
  it.each<[string, ExprValue]>([
    ["1 + 2 * 3", 7],
    ["(1 + 2) * 3", 9],
    ["10 - 4 - 3", 3],
    ["8 / 4 / 2", 1],
    ["7 % 4 * 2", 6],
    ["2 ** 3 ** 2", 512],
    ["2 * 3 ** 2", 18],
    ["2 ** -1", 0.5],
    ["(-2) ** 2", 4],
    ["-(2 ** 2)", -4],
    ["-2 * 3", -6],
    ["2 + -3", -1],
    ["- -3", 3],
    ["+4", 4],
    ["!0", true],
    ["!!'a'", true],
    ["![]", false],
    ["1 + 2 < 4", true],
    ["2 * 2 >= 4", true],
    ["3 <= 2", false],
    ["3 > 2", true],
    ["1 < 2 == true", true],
    ["1 == 1 && 2 == 3", false],
    ["true || false && false", true],
    ["false && true || true", true],
    ["!true || true", true],
    ["0 || 5", 5],
    ["3 && 5", 5],
    ["0 && 5", 0],
    ["1 ? 2 : 3 ? 4 : 5", 2],
    ["0 ? 2 : 0 ? 4 : 5", 5],
    ["1 < 2 ? 10 + 1 : 20", 11],
    ["undefined ?? 3", 3],
    ["null ?? 3", 3],
    ["0 ?? 3", 0],
    ["[1][5] ?? 7", 7],
    ["1 == '1'", true],
    ["1 === '1'", false],
    ["1 != '1'", false],
    ["1 !== '1'", true],
    ["'a' < 'b'", true],
    ["[1, 2] == [1, 2]", true],
    ["[1, 2] != [1, 3]", true],
    ["1 + 2 + 'a'", "3a"],
    ["'a' + 1 + 2", "a12"],
    ["'a' + [1, 2]", "a1,2"],
    ["true + 1", 2],
    ["1e3 + .5 + 1.5e-1", 1000.65],
  ])("%s", (source, expected) => {
    expect(run(source)).toEqual(expected);
  });

  it("refuses a unary operator straight before ** (as JavaScript does)", () => {
    expect(errorOf("-2 ** 2").message).toMatch(/brackets/);
  });

  it("doesn't evaluate the side a logical operator or ternary skips", () => {
    expect(run("true || nope")).toBe(true);
    expect(run("false && nope")).toBe(false);
    expect(run("1 ?? nope")).toBe(1);
    expect(run("true ? 1 : nope")).toBe(1);
  });

  it("refuses arithmetic on text and nothing", () => {
    expect(errorOf("'a' * 2").message).toMatch(/needs numbers or arrays, not text/);
    expect(errorOf("undefined + 1").message).toMatch(/nothing/);
    expect(errorOf("[1] < 2").message).toMatch(/compares numbers/);
  });
});

describe("literals and comments", () => {
  it("reads strings with escapes", () => {
    expect(run(`'it\\'s' + "\\n" + "a\\\\b"`)).toBe("it's\na\\b");
  });

  it("skips comments", () => {
    expect(run("// a note\n1 + /* inline */ 2 // and the end")).toBe(3);
    expect(run("/* two\nlines */ 4")).toBe(4);
  });

  it("reads arrays of numbers, with a trailing comma", () => {
    expect(run("[1, 2 + 3, true,]")).toEqual([1, 5, 1]);
    expect(run("[]")).toEqual([]);
    expect(errorOf("[1, 'a']").message).toMatch(/Arrays hold numbers only/);
    expect(errorOf("[[1], 2]").message).toMatch(/Arrays hold numbers only/);
  });
});

describe("vector maths", () => {
  it("adds and subtracts element by element, padding the shorter with 0", () => {
    expect(run("[1, 2] + [10, 20]")).toEqual([11, 22]);
    expect(run("[1, 2, 3] - [1, 1]")).toEqual([0, 1, 3]);
    expect(run("[1, 2] + 5")).toEqual([6, 2]);
    expect(run("-[1, -2]")).toEqual([-1, 2]);
  });

  it("scales by a number on either side, and divides by one", () => {
    expect(run("[1, 2] * 3")).toEqual([3, 6]);
    expect(run("3 * [1, 2]")).toEqual([3, 6]);
    expect(run("[3, 6] / 3")).toEqual([1, 2]);
  });

  it("refuses array * array, and dividing by an array", () => {
    expect(errorOf("[1, 2] * [3, 4]").message).toMatch(/multiply two arrays/);
    expect(errorOf("2 / [1, 2]").message).toMatch(/divide by an array/);
    expect(errorOf("[1, 2] % 2").message).toMatch(/only works on numbers/);
  });

  it("indexes, and reads .length, .x and .y", () => {
    expect(run("[4, 5][1]")).toBe(5);
    expect(run("[4, 5].x + [4, 5].y")).toBe(9);
    expect(run("[4, 5, 6].length")).toBe(3);
    expect(run("'abc'.length")).toBe(3);
    expect(run("'abc'[1]")).toBe("b");
    expect(run("value[0] + value.y", { value: [3, 4] })).toBe(7);
    expect(errorOf("5[0]").message).toMatch(/Can't index a number/);
    expect(errorOf("(5).length").message).toMatch(/\.length/);
    expect(errorOf("(5).x").message).toMatch(/only arrays/);
    expect(errorOf("[1]['0']").message).toMatch(/index must be a number/);
  });
});

describe("statements", () => {
  it("declares and assigns variables", () => {
    expect(run("const a = 1; a * 2")).toBe(2);
    expect(run("let x = 1; x = x + 1; x += 2; x *= 3; x -= 2; x /= 2; x")).toBe(5);
    expect(run("var a = 1, b = 2; a + b")).toBe(3);
    expect(run("let v = [1, 2]; v += [1, 1]; v")).toEqual([2, 3]);
    expect(run("let a; a ?? 4")).toBe(4);
  });

  it("separates statements with line breaks too", () => {
    expect(run("const a = 2\nconst b = 3\na * b")).toBe(6);
    expect(run("x = wiggle(0, 0)\n[x, 5]", { value: 2 })).toEqual([2, 5]);
    expect(run("1 +\n2")).toBe(3);
  });

  it("declares on a plain assignment, as After Effects' expressions do", () => {
    expect(run("amp = 30; amp / 2")).toBe(15);
    expect(errorOf("amp += 1").message).toBe('Unknown name "amp" at 0');
  });

  it("gives the last statement's value", () => {
    expect(run("1; 2; 3")).toBe(3);
    expect(run("1; 2;")).toBe(2);
    expect(run("x = 7")).toBe(7);
    expect(run("5; const a = 1")).toBe(5);
  });

  it("has no value without one", () => {
    expect(errorOf("const a = 1").message).toMatch(/no value/);
    expect(errorOf("undefined").message).toMatch(/no value/);
    expect(errorOf("").message).toMatch(/empty/);
    expect(errorOf("  // nothing\n").message).toMatch(/empty/);
  });

  it("takes an if's branch, whose last value is the statement's", () => {
    const source = "if (time > 1) { const a = 10; a * 2 } else { 5 }";
    expect(run(source, { time: 2 })).toBe(20);
    expect(run(source, { time: 0 })).toBe(5);
    expect(run("1; if (false) { 2 }")).toBe(1);
    expect(run("if (time < 1) 1; else if (time < 2) 2; else 3", { time: 1.5 })).toBe(2);
    expect(run("if (time < 1) 1\nelse 3", { time: 5 })).toBe(3);
    expect(run("let x = 0; if (true) { x = 4 } x + 1")).toBe(5);
  });

  it("scopes let and const to their block, var to the expression", () => {
    expect(errorOf("if (true) { let a = 1 } a").message).toMatch(/Unknown name "a"/);
    expect(run("if (true) { var a = 1 } a")).toBe(1);
    expect(run("let a = 1; if (true) { let a = 2 } a")).toBe(1);
  });

  it("protects constants and refuses redeclaring", () => {
    expect(errorOf("const a = 1; a = 2").message).toMatch(/"a" is a const/);
    expect(errorOf("let a = 1; let a = 2").message).toMatch(/already declared/);
    expect(run("var a = 1; var a = 2; a")).toBe(2);
    expect(expressionError("const a")).toMatch(/needs a value/);
    expect(expressionError("let if = 1")).toMatch(/can't be a variable's name/);
    expect(expressionError("Math = 1")).toMatch(/can't be a variable's name/);
  });

  it("lets a variable shadow a global", () => {
    expect(run("const time = 5; time * 2", { time: 1 })).toBe(10);
  });
});

describe("parse errors", () => {
  it("carry a position and a readable message", () => {
    const error = errorOf("linear(1, 2))");
    expect(error.message).toBe('Unexpected ")" at 12');
    expect(error.position).toBe(12);
    expect(expressionError("linear(1, 2))")).toBe('Unexpected ")" at 12');
    expect(expressionError("1 + 2")).toBeNull();
  });

  it.each<[string, RegExp, number]>([
    ["1 +", /Unexpected end of the expression at 3/, 3],
    ["(1 + 2", /Unexpected end of the expression \(expected "\)"\)/, 6],
    ["1 2", /Unexpected "2"/, 2],
    ["1 # 2", /Unexpected "#"/, 2],
    ["a & b", /Unexpected "&"/, 2],
    ["'abc", /never closed/, 0],
    ["/* abc", /never closed/, 0],
    ["12abc", /Unexpected "a" after the number 12/, 2],
    ["for (;;) {}", /Loops/, 0],
    ["1; while (true) 1", /Loops/, 3],
    ["function f() {}", /Functions can't be defined/, 0],
    ["(a) => a", /Arrow functions/, 4],
    ["x => x", /Arrow functions/, 2],
    ["({ a: 1 })", /objects and blocks aren't supported/, 1],
    ["new Date()", /"new" isn't supported/, 0],
    ["this", /"this" isn't supported/, 0],
    ["typeof 1", /"typeof" isn't supported/, 0],
    ["x++", /"\+\+" isn't supported/, 1],
    ["foo(1)", /Unknown function "foo"/, 0],
    ["(wiggle)(1, 2)", /Only the built-in functions/, 8],
    ["value(1)", /Unknown function "value"/, 0],
    ["a = b = 1", /Unexpected "="/, 6],
    ["if (1) { 2", /expected "}"/, 10],
    ["else 1", /Unexpected "else"/, 0],
    ["Math.nope(1)", /Math\.nope isn't a function/, 5],
    ["Math.TAU", /Math\.TAU isn't available/, 5],
    ["Math.sin", /Math\.sin is a function/, 5],
    ["Math", /Math can only be used as Math\.name/, 0],
  ])("%s", (source, message, position) => {
    const error = errorOf(source);
    expect(error.message).toMatch(message);
    expect(error.position).toBe(position);
    expect(expressionError(source)).toBe(error.message);
  });

  it("caps the source's length and nesting", () => {
    expect(expressionError(`1 + ${" ".repeat(5000)}1`)).toMatch(/too long/);
    expect(expressionError(`${"(".repeat(300)}1${")".repeat(300)}`)).toMatch(/nested too deeply/);
    expect(expressionError(`${"!".repeat(300)}1`)).toMatch(/nested too deeply/);
    expect(expressionError(`${"if (1) ".repeat(300)}1`)).toMatch(/nested too deeply/);
    expect(expressionError(`${"(".repeat(50)}1${")".repeat(50)}`)).toBeNull();
  });
});

describe("runtime errors", () => {
  it("name the unknown identifier", () => {
    const error = errorOf("1 + nope");
    expect(error.message).toBe('Unknown name "nope" at 4');
    expect(error.position).toBe(4);
  });

  it("say a function must be called", () => {
    expect(errorOf("wiggle + 1").message).toMatch(/"wiggle" is a function: call it/);
  });

  it("say what's wrong with an argument", () => {
    expect(errorOf("wiggle('a', 1)").message).toMatch(/wiggle\(\): freq must be a number, not text/);
    expect(errorOf("wiggle(1)").message).toMatch(/Wrong number of arguments: wiggle\(freq, amp/);
    expect(errorOf("Math.sin('a')").message).toMatch(/Math\.sin\(\): argument 1 must be a number/);
    expect(errorOf("clamp(1, 2)").message).toMatch(/clamp\(value, min, max\)/);
  });

  it("stop an expression that does too much work", () => {
    expect(errorOf("wiggle(1, 1, 1e9)").message).toMatch(/too much work \(over 10000 steps\)/);
    expect(errorOf("wiggle(1, 1, 1 / 0)").message).toMatch(/too much work/);
    const busy = Array.from({ length: 300 }, () => "wiggle(1,1,40)").join(";");
    expect(errorOf(busy).message).toMatch(/too much work/);
  });

  it("stop a chain too deep to walk, as an ExpressionError", () => {
    expect(expressionError(`${"1+".repeat(1000)}1`)).toBeNull();
    expect(errorOf(`${"1+".repeat(1000)}1`).message).toMatch(/too complex/);
    expect(run(`${"1+".repeat(100)}1`)).toBe(101);
  });

  it("stop text growing without end", () => {
    const doubling = `let s = "aaaaaaaaaa"; ${"s = s + s; ".repeat(20)} s`;
    expect(errorOf(doubling).message).toMatch(/text is too long/);
  });
});

describe("the sandbox", () => {
  it.each([
    "[].constructor",
    '"a".constructor',
    "Math.constructor",
    "Math.constructor('return 1')()",
    "value.__proto__",
    "value.constructor",
    "[].constructor.constructor('return this')()",
    "[]['constructor']",
    "'a'['constructor']",
    "value['__proto__']",
    "[].map",
    "'a'.toString()",
    "Math.sin.call(1)",
    "Math['sin'](1)",
    "Math.__proto__",
    "Math.toString()",
    "constructor",
    "__proto__",
    "prototype",
    "toString",
    "hasOwnProperty('a')",
    "valueOf()",
    "window",
    "globalThis",
    "self",
    "process",
    "require('fs')",
    "eval('1')",
    "Function('return 1')()",
    "this",
    "new Function('return 1')",
    "import('fs')",
    "value.x.constructor",
    "wiggle.constructor",
    "time.constructor",
    "`${1}`",
    "(() => 1)()",
    "(function () { return 1 })()",
    "a = {}; a",
    "while (true) {}",
    "for (;;) {}",
  ])("refuses %s", (source) => {
    expect(() => run(source, { value: [1, 2] })).toThrow(ExpressionError);
    expect(expressionValue(source, scope({ value: [1, 2] }), 0)).toBeUndefined();
  });

  it("keeps variables named like Object's members apart from them", () => {
    expect(run("let constructor = 3; let __proto__ = 4; let toString = 5; constructor + __proto__ + toString")).toBe(12);
    expect(errorOf("hasOwnProperty").message).toBe('Unknown name "hasOwnProperty" at 0');
  });

  it("never hands back the scope's own arrays", () => {
    const value = [1, 2];
    const result = run("value", { value });
    expect(result).toEqual([1, 2]);
    expect(result).not.toBe(value);
  });
});

describe("Math", () => {
  it("has the usual functions and constants", () => {
    close(run("Math.sin(Math.PI / 2)"), 1);
    expect(run("Math.max(1, 5, 3) + Math.min(2, -1)")).toBe(4);
    expect(run("Math.floor(2.7) + Math.ceil(2.1) + Math.round(2.5) + Math.abs(-1) + Math.trunc(-1.5)")).toBe(8);
    expect(run("Math.pow(2, 10) + Math.sqrt(16) + Math.hypot(3, 4) + Math.sign(-3)")).toBe(1032);
    close(run("Math.atan2(1, 1) * 4"), Math.PI);
    close(run("Math.exp(1) - Math.E + Math.log(Math.E) + Math.SQRT2 * Math.SQRT2"), 3);
  });

  it("routes Math.random to the seeded random", () => {
    expect(run("Math.random()")).toBe(run("random()"));
    expect(run("Math.random()")).toBe(run("Math.random()"));
  });
});

describe("the property's globals", () => {
  it("time, value, fps", () => {
    expect(run("time * 2", { time: 1.5 })).toBe(3);
    expect(run("value + 1", { value: 4 })).toBe(5);
    expect(run("value + [1, 1]", { value: [4, 5] })).toEqual([5, 6]);
    expect(run("fps", { fps: 24 })).toBe(24);
  });

  it("numKeys and key(i), counted from 1", () => {
    const keyTimes = [0.5, 2, 4];
    expect(run("numKeys", { keyTimes })).toBe(3);
    expect(run("key(1) + key(numKeys)", { keyTimes })).toBe(4.5);
    expect(errorOf("key(0)", { keyTimes }).message).toMatch(/keyframes 1 to 3/);
    expect(errorOf("key(4)", { keyTimes }).message).toMatch(/keyframes 1 to 3/);
    expect(errorOf("key(1)").message).toMatch(/no keyframes/);
  });

  it("valueAtTime", () => {
    expect(run("valueAtTime(time - 1)", { time: 3, valueAtTime: (t) => t * 10 })).toBe(20);
    expect(run("valueAtTime(2)[1]", { valueAtTime: (t) => [t, t * 2] })).toBe(4);
  });

  it("prop reads the clip's other properties", () => {
    const prop: ExpressionScope["prop"] = (path, t) =>
      path === "motion.position" ? [100 + (t ?? -1), 200] : path === "opacity.opacity" ? 50 : path === "text.text" ? "hi" : undefined;
    expect(run("prop('motion.position')", { prop, time: 2 })).toEqual([102, 200]);
    expect(run("prop('motion.position', 7)[0]", { prop })).toBe(107);
    expect(run("prop('opacity.opacity') / 100", { prop })).toBe(0.5);
    expect(run("prop('text.text') + '!'", { prop })).toBe("hi!");
    expect(errorOf("prop('motion.nope')", { prop }).message).toBe('prop(): this clip has no property "motion.nope" at 0');
    expect(errorOf("prop(1)", { prop }).message).toMatch(/path must be text/);
  });

  it("posterizeTime steps time, value and what follows them", () => {
    const over = { time: 1.26, valueAtTime: (t: number) => t * 100, value: 126 };
    expect(run("posterizeTime(10); time", over)).toBeCloseTo(1.2, 9);
    expect(run("posterizeTime(10); value", over)).toBeCloseTo(120, 9);
    expect(run("posterizeTime(10)", over)).toBeCloseTo(120, 9);
    expect(run("posterizeTime(2); time", { time: 0.99 })).toBe(0.5);
    // A frame that lands on a step stays on it.
    expect(run("posterizeTime(10); time", { time: 3 / 30 })).toBeCloseTo(0.1, 9);
    // Held, so are wiggle and random.
    const held = (time: number) => run("posterizeTime(1); [wiggle(3, 10), random()]", { time, value: 0 });
    expect(held(2.1)).toEqual(held(2.9));
    expect(held(2.1)).not.toEqual(held(3.1));
    expect(errorOf("posterizeTime(0)").message).toMatch(/above 0/);
  });
});

describe("wiggle", () => {
  const at = (time: number, over: Partial<ExpressionScope> = {}, source = "wiggle(2, 30)") =>
    run(source, { time, value: 100, ...over }) as number;

  it("is deterministic", () => {
    expect(at(1.234)).toBe(at(1.234));
  });

  it("stays within the amplitude with one octave, and does move", () => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 2000; i++) {
      const v = at(i * 0.013);
      expect(Math.abs(v - 100)).toBeLessThanOrEqual(30);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(max - min).toBeGreaterThan(30);
  });

  it("is continuous", () => {
    for (let i = 0; i < 500; i++) {
      const t = i * 0.0371;
      expect(Math.abs(at(t + 1e-6) - at(t))).toBeLessThan(1e-3);
    }
  });

  it("differs between seeds", () => {
    const a = [0.3, 1.7, 2.9].map((t) => at(t, { seed: 1 }));
    const b = [0.3, 1.7, 2.9].map((t) => at(t, { seed: 2 }));
    const c = [0.3, 1.7, 2.9].map((t) => at(t, { seed: 1.5 }));
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("wiggles each component of a point on its own", () => {
    const [x, y] = run("wiggle(2, 30)", { time: 0.7, value: [100, 100] }) as number[];
    expect(x).not.toBe(y);
    expect(Math.abs(x - 100)).toBeLessThanOrEqual(30);
    expect(Math.abs(y - 100)).toBeLessThanOrEqual(30);
    // The first component is the number's own wiggle.
    expect(x).toBe(at(0.7));
  });

  it("adds finer, smaller layers with octaves", () => {
    expect(at(0.7, {}, "wiggle(2, 30, 3)")).not.toBe(at(0.7));
    // An octave with no amplitude adds nothing.
    expect(at(0.7, {}, "wiggle(2, 30, 3, 0)")).toBe(at(0.7));
    for (let i = 0; i < 500; i++) {
      expect(Math.abs(at(i * 0.013, {}, "wiggle(2, 30, 3, 0.5)") - 100)).toBeLessThanOrEqual(30 * 1.75);
    }
  });

  it("takes its time from t", () => {
    expect(at(5, {}, "wiggle(2, 30, 1, 0.5, 1.25)")).toBe(at(1.25));
    expect(at(0.4, {}, "wiggle(0, 30)")).toBe(at(3, {}, "wiggle(0, 30)"));
  });
});

describe("random and noise", () => {
  it("random is the same for the same frame, and changes with the frame, the seed and each call", () => {
    expect(run("random()", { time: 1 })).toBe(run("random()", { time: 1 }));
    expect(run("random()", { time: 1 })).toBe(run("random()", { time: 1.01 }));
    expect(run("random()", { time: 1 })).not.toBe(run("random()", { time: 1 + 1 / 30 }));
    expect(run("random()", { seed: 1 })).not.toBe(run("random()", { seed: 2 }));
    const [a, b] = run("[random(), random()]") as number[];
    expect(a).not.toBe(b);
  });

  it("random stays in its range", () => {
    for (let frame = 0; frame < 300; frame++) {
      const time = frame / 30;
      const [unit, upTo, between] = run("[random(), random(5), random(-2, -1)]", { time }) as number[];
      expect(unit).toBeGreaterThanOrEqual(0);
      expect(unit).toBeLessThan(1);
      expect(upTo).toBeGreaterThanOrEqual(0);
      expect(upTo).toBeLessThan(5);
      expect(between).toBeGreaterThanOrEqual(-2);
      expect(between).toBeLessThan(-1);
    }
  });

  it("random spreads over its range", () => {
    const values = Array.from({ length: 600 }, (_, frame) => run("random()", { time: frame / 30 }) as number);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    expect(mean).toBeGreaterThan(0.4);
    expect(mean).toBeLessThan(0.6);
    expect(new Set(values).size).toBe(600);
  });

  it("random takes arrays", () => {
    const [x, y] = run("random([10, 20], [11, 21])") as number[];
    expect(x).toBeGreaterThanOrEqual(10);
    expect(x).toBeLessThan(11);
    expect(y).toBeGreaterThanOrEqual(20);
    expect(y).toBeLessThan(21);
  });

  it("seedRandom picks another sequence, and can hold it over time", () => {
    expect(run("seedRandom(3); random()")).not.toBe(run("seedRandom(4); random()"));
    expect(run("seedRandom(3); random()")).not.toBe(run("random()"));
    expect(run("seedRandom(3); random()", { time: 1 })).not.toBe(run("seedRandom(3); random()", { time: 2 }));
    expect(run("seedRandom(3, true); random()", { time: 1 })).toBe(run("seedRandom(3, true); random()", { time: 2 }));
    expect(run("seedRandom(3, true); random()", { seed: 1 })).not.toBe(run("seedRandom(3, true); random()", { seed: 2 }));
    expect(errorOf("seedRandom(3)").message).toMatch(/no value/);
  });

  it("noise is smooth, within -1..1 and the same every time", () => {
    expect(run("noise(1.37)")).toBe(run("noise(1.37)", { seed: 9, time: 4 }));
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 1000; i++) {
      const x = i * 0.173 - 40;
      const v = run(`noise(${x})`) as number;
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      expect(Math.abs((run(`noise(${x + 1e-6})`) as number) - v)).toBeLessThan(1e-4);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(max - min).toBeGreaterThan(1);
  });

  it("noise takes a point", () => {
    const v = run("noise([0.3, 1.7])") as number;
    expect(Math.abs(v)).toBeLessThanOrEqual(1);
    expect(v).not.toBe(run("noise([0.3, 2.7])"));
    expect(Math.abs((run("noise([0.3, 1.700001])") as number) - v)).toBeLessThan(1e-4);
    expect(Math.abs(run("noise([0.3, 1.7, 2.2, 9])") as number)).toBeLessThanOrEqual(1);
  });
});

describe("loopOut and loopIn", () => {
  // Keyframes at 1 s and 3 s; the property's value is 10 × time, so it runs 10 → 30 between them.
  const linear = (time: number, over: Partial<ExpressionScope> = {}): Partial<ExpressionScope> => ({
    time,
    fps: 10,
    keyTimes: [1, 3],
    valueAtTime: (t) => t * 10,
    value: 99,
    ...over,
  });

  it("loopOut cycles", () => {
    close(run("loopOut()", linear(3.5)), 15);
    close(run("loopOut('cycle')", linear(5.5)), 15);
    close(run("loopOut()", linear(4.75)), 27.5);
  });

  it("loopOut ping-pongs", () => {
    close(run("loopOut('pingpong')", linear(3.5)), 25);
    close(run("loopOut('pingpong')", linear(5.5)), 15);
    close(run("loopOut('pingpong')", linear(7.5)), 25);
  });

  it("loopOut offsets each round by the animation's change", () => {
    close(run("loopOut('offset')", linear(3.5)), 35);
    close(run("loopOut('offset')", linear(5.5)), 55);
  });

  it("loopOut continues at the final speed", () => {
    close(run("loopOut('continue')", linear(4)), 40);
    // Only the last frame's speed counts: 5 a frame at 10 fps is 50 a second.
    const bend = (t: number) => (t < 2.9 ? 0 : (t - 2.9) * 50);
    close(run("loopOut('continue')", linear(4, { valueAtTime: bend })), 5 + 50);
  });

  it("loopOut leaves the keyframed part alone", () => {
    expect(run("loopOut()", linear(2))).toBe(99);
    expect(run("loopOut()", linear(3))).toBe(99);
    expect(run("loopOut('continue')", linear(0.5))).toBe(99);
  });

  it("loops only the last numKeyframes segments", () => {
    const keyTimes = [0, 1, 3];
    close(run("loopOut('cycle')", linear(3.5, { keyTimes })), 5);
    close(run("loopOut('cycle', 1)", linear(3.5, { keyTimes })), 15);
    close(run("loopOut('cycle', 9)", linear(3.5, { keyTimes })), 5);
    close(run("loopIn('cycle', 1)", linear(-0.25, { keyTimes })), 7.5);
    close(run("loopIn('cycle')", linear(-0.25, { keyTimes })), 27.5);
  });

  it("loopIn cycles, ping-pongs, offsets and continues before the first keyframe", () => {
    close(run("loopIn()", linear(0.5)), 25);
    close(run("loopIn('cycle')", linear(-1.5)), 25);
    close(run("loopIn('pingpong')", linear(0.5)), 15);
    close(run("loopIn('pingpong')", linear(-1.5)), 25);
    close(run("loopIn('offset')", linear(0.5)), 5);
    close(run("loopIn('offset')", linear(-1.5)), -15);
    close(run("loopIn('continue')", linear(0.5)), 5);
    expect(run("loopIn()", linear(1))).toBe(99);
    expect(run("loopIn()", linear(2))).toBe(99);
  });

  it("loops points", () => {
    const point = { valueAtTime: (t: number) => [t, t * 2], value: [9, 9] };
    close(run("loopOut()", linear(3.5, point)), [1.5, 3]);
    close(run("loopOut('offset')", linear(3.5, point)), [3.5, 7]);
    close(run("loopOut('continue')", linear(4, point)), [4, 8]);
    expect(run("loopOut()", linear(2, point))).toEqual([9, 9]);
  });

  it("returns the value with fewer than two keyframes", () => {
    expect(run("loopOut()", linear(5, { keyTimes: [] }))).toBe(99);
    expect(run("loopOut('pingpong')", linear(5, { keyTimes: [1] }))).toBe(99);
    expect(run("loopIn('offset')", linear(-5, { keyTimes: [1] }))).toBe(99);
  });

  it("follows posterizeTime", () => {
    close(run("posterizeTime(1); loopOut()", linear(3.9)), 99 * 0 + 30);
    close(run("posterizeTime(1); loopOut()", linear(4.9)), 20);
  });

  it("names the types it knows", () => {
    expect(errorOf("loopOut('bounce')", linear(5)).message).toMatch(/"cycle", "pingpong", "offset", "continue"/);
    expect(errorOf("loopIn(2)", linear(5)).message).toMatch(/loopIn\(\): the type must be one of/);
  });
});

describe("interpolation helpers", () => {
  it("linear maps and clamps", () => {
    expect(run("linear(5, 0, 10, 100, 200)")).toBe(150);
    expect(run("linear(-5, 0, 10, 100, 200)")).toBe(100);
    expect(run("linear(50, 0, 10, 100, 200)")).toBe(200);
    expect(run("linear(0.25, 10, 20)")).toBe(12.5);
    expect(run("linear(2, 10, 20)")).toBe(20);
    expect(run("linear(5, 0, 10, [0, 100], [10, 0])")).toEqual([5, 50]);
    expect(run("linear(1, 3, 3, 0, 1)")).toBe(0);
    expect(run("linear(3, 3, 3, 0, 1)")).toBe(1);
    expect(errorOf("linear(1, 2)").message).toMatch(/linear\(t, tMin, tMax, value1, value2\)/);
  });

  it("ease is slow at both ends", () => {
    expect(run("ease(0, 0, 1, 10, 20)")).toBe(10);
    expect(run("ease(0.5, 0, 1, 10, 20)")).toBe(15);
    expect(run("ease(1, 0, 1, 10, 20)")).toBe(20);
    expect(run("ease(9, 0, 1, 10, 20)")).toBe(20);
    expect(run("ease(0.25, 0, 1, 0, 1)")).toBeLessThan(0.25);
    expect(run("ease(0.75, 0, 1, 0, 1)")).toBeGreaterThan(0.75);
    expect(run("ease(0.5, [0, 0], [2, 4])")).toEqual([1, 2]);
  });

  it("easeIn leaves slowly, easeOut arrives slowly", () => {
    expect(run("easeIn(0.5, 0, 1, 0, 100)")).toBe(25);
    expect(run("easeOut(0.5, 0, 1, 0, 100)")).toBe(75);
    expect(run("easeIn(0.5, 0, 100)")).toBe(25);
    expect(run("[easeIn(-1, 0, 1, 5, 9), easeIn(2, 0, 1, 5, 9), easeOut(-1, 0, 1, 5, 9), easeOut(2, 0, 1, 5, 9)]")).toEqual([
      5, 9, 5, 9,
    ]);
  });

  it("clamp", () => {
    expect(run("[clamp(5, 0, 3), clamp(-5, 0, 3), clamp(2, 0, 3)]")).toEqual([3, 0, 2]);
    expect(run("clamp([-5, 50], 0, 10)")).toEqual([0, 10]);
    expect(run("clamp([-5, 50], [0, 0], [10, 100])")).toEqual([0, 50]);
  });
});

describe("vector helpers", () => {
  it("angles", () => {
    close(run("degreesToRadians(180)"), Math.PI);
    close(run("radiansToDegrees(Math.PI / 2)"), 90);
  });

  it("length", () => {
    expect(run("length([3, 4])")).toBe(5);
    expect(run("length([1, 1], [4, 5])")).toBe(5);
    expect(run("length(-7)")).toBe(7);
  });

  it("add, sub, mul, div", () => {
    expect(run("add([1, 2], [3, 4])")).toEqual([4, 6]);
    expect(run("sub([1, 2], [3, 5])")).toEqual([-2, -3]);
    expect(run("mul([1, 2], 3)")).toEqual([3, 6]);
    expect(run("div([3, 6], 3)")).toEqual([1, 2]);
    expect(errorOf("mul([1, 2], [3, 4])").message).toMatch(/multiply two arrays/);
    expect(errorOf("add('a', 1)").message).toMatch(/add\(\): a must be a number or an array/);
  });

  it("normalize and dot", () => {
    close(run("normalize([3, 4])"), [0.6, 0.8]);
    expect(run("normalize([0, 0])")).toEqual([0, 0]);
    expect(run("dot([1, 2], [3, 4])")).toBe(11);
  });

  it("lookAt gives the direction's angle in degrees", () => {
    close(run("lookAt([0, 0], [1, 0])"), 0);
    close(run("lookAt([0, 0], [0, 5])"), 90);
    close(run("lookAt([2, 2], [1, 1])"), -135);
  });
});

describe("EXPRESSION_GLOBALS", () => {
  it("lists every name once, with a signature and a description", () => {
    const names = EXPRESSION_GLOBALS.map((g) => g.name);
    expect(new Set(names).size).toBe(names.length);
    for (const g of EXPRESSION_GLOBALS) {
      expect(g.signature.startsWith(g.name)).toBe(true);
      expect(g.description.length).toBeGreaterThan(10);
    }
    expect(names).toEqual(
      expect.arrayContaining([
        "time", "value", "fps", "numKeys", "key", "valueAtTime", "wiggle", "loopOut", "loopIn", "linear", "ease", "easeIn",
        "easeOut", "clamp", "random", "seedRandom", "noise", "degreesToRadians", "radiansToDegrees", "length", "add", "sub",
        "mul", "div", "normalize", "dot", "lookAt", "prop", "posterizeTime", "Math",
      ]),
    );
  });

  it("lists only names the interpreter knows", () => {
    for (const { name } of EXPRESSION_GLOBALS) {
      if (name === "Math") continue;
      // A variable evaluates; a function says it must be called. Neither is unknown.
      let message = "";
      try {
        run(name);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toMatch(/Unknown/);
      if (message) expect(message).toMatch(/is a function/);
    }
  });
});

describe("parseExpression's cache", () => {
  it("returns the same Expression for the same source", () => {
    const a = parseExpression("time * 2 + 1");
    expect(parseExpression("time * 2 + 1")).toBe(a);
    expect(a.source).toBe("time * 2 + 1");
    expect(parseExpression("time * 2 + 2")).not.toBe(a);
  });

  it("is bounded: the least recently used goes first", () => {
    const old = parseExpression("1 + 1000");
    const kept = parseExpression("1 + 1001");
    for (let i = 0; i < 498; i++) parseExpression(`2 + ${i}`);
    // Used again, so the 500 that follow push out `old` but not `kept`... until they too fill the cache.
    expect(parseExpression("1 + 1001")).toBe(kept);
    parseExpression("3 + 1");
    expect(parseExpression("1 + 1001")).toBe(kept);
    expect(parseExpression("1 + 1000")).not.toBe(old);
    for (let i = 0; i < 600; i++) parseExpression(`4 + ${i}`);
    expect(parseExpression("1 + 1001")).not.toBe(kept);
  });

  it("remembers errors too", () => {
    const first = errorOf("1 +* 2");
    expect(errorOf("1 +* 2")).toBe(first);
  });

  it("keeps evaluations apart", () => {
    const expression = parseExpression("x = time; x += 1; x");
    expect(evaluateExpression(expression, scope({ time: 1 }))).toBe(2);
    expect(evaluateExpression(expression, scope({ time: 5 }))).toBe(6);
  });
});

describe("expressionValue", () => {
  it("coerces to a number", () => {
    expect(expressionValue("time * 2", scope({ time: 2 }), 0)).toBe(4);
    expect(expressionValue("[7, 8]", scope(), 0)).toBe(7);
    expect(expressionValue("[7]", scope(), 0)).toBe(7);
    expect(expressionValue("true", scope(), 0)).toBe(1);
    expect(expressionValue("1 > 2", scope(), 0)).toBe(0);
  });

  it("coerces to a point", () => {
    expect(expressionValue("[7, 8]", scope(), [0, 0])).toEqual([7, 8]);
    expect(expressionValue("[7, 8, 9]", scope(), [0, 0])).toEqual([7, 8]);
    expect(expressionValue("5", scope(), [0, 0])).toEqual([5, 5]);
    expect(expressionValue("value + [10, 0]", scope({ value: [1, 2] }), [0, 0])).toEqual([11, 2]);
  });

  it("gives undefined for what a property can't hold", () => {
    expect(expressionValue("'a'", scope(), 0)).toBeUndefined();
    expect(expressionValue("'a'", scope(), [0, 0])).toBeUndefined();
    expect(expressionValue("1 / 0", scope(), 0)).toBeUndefined();
    expect(expressionValue("0 / 0", scope(), 0)).toBeUndefined();
    expect(expressionValue("[]", scope(), 0)).toBeUndefined();
    expect(expressionValue("[0 / 0, 1]", scope(), 0)).toBeUndefined();
    expect(expressionValue("[1]", scope(), [0, 0])).toBeUndefined();
    expect(expressionValue("[1, 1 / 0]", scope(), [0, 0])).toBeUndefined();
    expect(expressionValue("true", scope(), [0, 0])).toBeUndefined();
    expect(expressionValue("1 / 0", scope(), [0, 0])).toBeUndefined();
  });

  it("never throws", () => {
    const broken = scope({
      valueAtTime: () => {
        throw new Error("boom");
      },
      prop: () => {
        throw new TypeError("boom");
      },
    });
    for (const source of ["1 +", "nope", "", "wiggle(1, 1, 1e9)", "valueAtTime(1)", "prop('a.b')", "x".repeat(6000), "[].constructor"]) {
      expect(() => expressionValue(source, broken, 0)).not.toThrow();
      expect(expressionValue(source, broken, 0)).toBeUndefined();
      expect(expressionValue(source, broken, [0, 0])).toBeUndefined();
    }
    const odd = scope({ value: "a" as unknown as number, valueAtTime: () => "a" as unknown as number });
    expect(expressionValue("value", odd, 0)).toBeUndefined();
    expect(expressionValue("1", scope({ valueAtTime: () => "a" as unknown as number }), 0)).toBe(1);
    expect(expressionValue("valueAtTime(0)", scope({ valueAtTime: () => "a" as unknown as number }), 0)).toBeUndefined();
    expect(expressionValue(5 as unknown as string, scope(), 0)).toBeUndefined();
  });

  it("runs the everyday expressions", () => {
    const s = scope({ time: 1.5, value: [540, 960], seed: 42, keyTimes: [0, 1], valueAtTime: (t) => [540 + t * 100, 960] });
    const wiggled = expressionValue("wiggle(3, 25)", s, [0, 0]) as [number, number];
    expect(Math.abs(wiggled[0] - 540)).toBeLessThanOrEqual(25);
    expect(expressionValue("loopOut('pingpong')", s, [0, 0])).toEqual([590, 960]);
    expect(
      expressionValue("freq = 2; amp = 40;\ny = Math.sin(time * freq * Math.PI * 2) * amp;\nvalue + [0, y]", s, [0, 0]),
    ).toEqual([540, 960 + Math.sin(1.5 * 2 * Math.PI * 2) * 40]);
    expect(expressionValue("time * 90", s, 0)).toBe(135);
  });
});
