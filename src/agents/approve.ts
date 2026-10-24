import type { AgentEntry } from "./state";

export type ApprovalAction = "yes" | "no";

export type ApprovalConfig = { dialogPattern: RegExp; noLinePattern: RegExp; yesKey: "1" };

// Both regexes are copied verbatim from spike/FINDINGS.md section 1.
export const APPROVAL_CONFIG: ApprovalConfig = {
  dialogPattern: /^ Do you want to [^\n]*\?\n ❯ 1\. Yes\n(?:   \d\. [^\n]*\n)+\n Esc to cancel/m,
  noLinePattern: /^ {1,3}(?:❯ )?(\d)\. No$/m,
  yesKey: "1",
};

export type GuardResult =
  | { send: true; keys: string[] }
  | {
      send: false;
      reason: "gone" | "unreadable" | "not-asking" | "changed" | "dialog-not-visible" | "no-option-not-found";
    };

export function checkApproval(
  input: { expectedRequestId: string; current: AgentEntry | undefined; paneText: string },
  action: ApprovalAction,
  config: ApprovalConfig,
): GuardResult {
  const { current } = input;
  if (!current) return { send: false, reason: "gone" };
  if (!current.ok) return { send: false, reason: "unreadable" };
  if (current.record.state !== "ask") return { send: false, reason: "not-asking" };
  if (current.record.question?.requestId !== input.expectedRequestId) return { send: false, reason: "changed" };

  const dialog = config.dialogPattern.exec(input.paneText);
  if (!dialog) return { send: false, reason: "dialog-not-visible" };
  if (action === "yes") return { send: true, keys: [config.yesKey] };

  // The No digit varies per tool, so read it only from inside the matched dialog.
  const noLine = config.noLinePattern.exec(dialog[0]);
  if (!noLine) return { send: false, reason: "no-option-not-found" };
  return { send: true, keys: [noLine[1]!] };
}
