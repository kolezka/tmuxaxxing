import { join } from "node:path";

import { loadLayout } from "../config/layout";
import { configDir } from "../paths";

export async function widths(_args: string[]): Promise<void> {
  const layout = await loadLayout(join(configDir(), "layout.toml"));
  console.log(`${layout.left.width} ${layout.right.width}`);
}
