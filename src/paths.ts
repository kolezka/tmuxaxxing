import { homedir } from "node:os";
import { join } from "node:path";

export function stateDir(): string {
  return process.env.TMUXAXXING_STATE_DIR ?? join(homedir(), ".cache", "tmuxaxxing");
}

export function configDir(): string {
  return process.env.TMUXAXXING_CONFIG_DIR ?? join(homedir(), ".config", "tmuxaxxing");
}
