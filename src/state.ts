import { readFile, writeFile } from "node:fs/promises";
import type { Availability } from "./stock.js";

const STATE_PATH = ".state.json";

export type StateMap = Record<string, Availability>;

export async function loadState(): Promise<StateMap> {
  try {
    return JSON.parse(await readFile(STATE_PATH, "utf8")) as StateMap;
  } catch {
    return {};
  }
}

export async function saveState(state: StateMap): Promise<void> {
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}
