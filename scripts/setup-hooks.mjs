// Configura core.hooksPath para usar .githooks (sin husky/lefthook). No falla fuera de git (p. ej. en Docker).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

if (existsSync(".git")) {
  try {
    execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "ignore" });
  } catch {
    // git no disponible: se ignora
  }
}
