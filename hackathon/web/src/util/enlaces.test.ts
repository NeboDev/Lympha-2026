import { describe, expect, it } from "vitest";
import { esEnlaceTelegram } from "./enlaces.ts";

const TOKEN = "A".repeat(43);

describe("esEnlaceTelegram", () => {
  it("acepta el enlace de vinculación del bot", () => {
    expect(esEnlaceTelegram(`https://t.me/lympha26_bot?start=${TOKEN}`)).toBe(true);
    expect(esEnlaceTelegram(`https://t.me/lympha26_bot?startgroup=${TOKEN}`)).toBe(true);
  });

  it("rechaza todo lo demás: otros hosts, http, javascript: y colas extra", () => {
    for (const malo of [
      `http://t.me/lympha26_bot?start=${TOKEN}`,
      `https://t.me.malo.example/lympha26_bot?start=${TOKEN}`,
      `https://malo.example/t.me/lympha26_bot?start=${TOKEN}`,
      `javascript:alert(1)//t.me/lympha26_bot?start=${TOKEN}`,
      `https://t.me/lympha26_bot?start=${TOKEN}&x=1`,
      `https://t.me/lympha26_bot?start=corto`,
      `https://t.me/lympha26_bot`,
      "",
    ]) {
      expect(esEnlaceTelegram(malo), malo).toBe(false);
    }
  });
});
