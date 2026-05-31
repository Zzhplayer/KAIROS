import { describe, it, expect } from "bun:test";
import { parseCronExpression } from "./cron";

describe("parseCronExpression", () => {
  it("parses exact minute matching", () => {
    const result = parseCronExpression("30 9 * * 1-5");
    expect(result.minute).toEqual([30]);
    expect(result.hour).toEqual([9]);
    expect(result.dayOfWeek).toEqual([1, 2, 3, 4, 5]);
  });

  it("parses wildcard fields", () => {
    const result = parseCronExpression("* * * * *");
    expect(result.minute).toEqual(Array.from({ length: 60 }, (_, i) => i));
    expect(result.hour).toEqual(Array.from({ length: 24 }, (_, i) => i));
    expect(result.dayOfMonth).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
    expect(result.month).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(result.dayOfWeek).toEqual(Array.from({ length: 7 }, (_, i) => i));
  });

  it("parses step expressions", () => {
    const result = parseCronExpression("*/15 * * * *");
    expect(result.minute).toEqual([0, 15, 30, 45]);
  });

  it("parses range expressions", () => {
    const result = parseCronExpression("0 9-17 * * 1-5");
    expect(result.hour).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(result.dayOfWeek).toEqual([1, 2, 3, 4, 5]);
  });

  it("parses list expressions", () => {
    const result = parseCronExpression("0 8,12,18 * * *");
    expect(result.hour).toEqual([8, 12, 18]);
  });

  it("throws on invalid field count", () => {
    expect(() => parseCronExpression("30 9 * *")).toThrow(
      "Invalid cron expression: expected 5 fields, got 4",
    );
  });

  it("throws on empty expression", () => {
    expect(() => parseCronExpression("")).toThrow(
      "Invalid cron expression: expected 5 fields, got 1",
    );
  });
});
