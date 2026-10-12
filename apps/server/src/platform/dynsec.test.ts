import { describe, expect, it } from "vitest";
import { type Acl, diferenciarAcls, ROLES } from "./dynsec.ts";

const a = (acltype: Acl["acltype"], topic: string, allow = true): Acl => ({
  acltype,
  topic,
  allow,
});

describe("diferenciarAcls", () => {
  it("no hace nada si coinciden", () => {
    const acls = [a("publishClientSend", "x/%u")];
    expect(diferenciarAcls(acls, acls)).toEqual({ quitar: [], agregar: [] });
  });

  it("quita lo que sobra (p. ej. el acceso total del admin por defecto) y agrega lo que falta", () => {
    const actuales = [a("subscribePattern", "#"), a("publishClientSend", "$CONTROL/#")];
    const deseadas = [a("publishClientSend", "$CONTROL/#"), a("subscribePattern", "$CONTROL/#")];
    const { quitar, agregar } = diferenciarAcls(actuales, deseadas);
    expect(quitar).toEqual([a("subscribePattern", "#")]);
    expect(agregar).toEqual([a("subscribePattern", "$CONTROL/#")]);
  });

  it("trata un cambio de allow como quitar y volver a agregar", () => {
    const { quitar, agregar } = diferenciarAcls(
      [a("subscribePattern", "t", false)],
      [a("subscribePattern", "t", true)],
    );
    expect(quitar).toHaveLength(1);
    expect(agregar).toHaveLength(1);
  });
});

describe("ROLES", () => {
  it("el rol nodo usa %u en todos sus tópicos propios y ninguno comodín de flota", () => {
    const nodo = ROLES.find((r) => r.rolename === "nodo");
    expect(nodo).toBeDefined();
    for (const acl of nodo?.acls ?? []) {
      expect(acl.topic).toContain("%u");
      expect(acl.topic).not.toContain("+");
    }
  });

  it("revocado niega todo con la prioridad máxima", () => {
    const rev = ROLES.find((r) => r.rolename === "revocado");
    expect(rev?.acls.every((x) => !x.allow && x.topic === "#" && x.priority === 1000)).toBe(true);
  });
});
