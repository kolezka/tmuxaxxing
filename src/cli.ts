import { agents } from "./cli/agents";
import { seen } from "./cli/seen";
import { sidebar } from "./cli/sidebar";
import { widths } from "./cli/widths";

type Command = (args: string[]) => Promise<void>;

const commands = new Map<string, Command>([
  ["agents", agents],
  ["seen", seen],
  ["sidebar", sidebar],
  ["widths", widths],
]);

export async function main(args: string[]): Promise<void> {
  const [name, ...commandArgs] = args;
  const command = name ? commands.get(name) : undefined;

  if (!command) {
    throw new Error(`unknown command: ${name ?? ""}`);
  }

  await command(commandArgs);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
