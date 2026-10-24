import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { APPROVAL_CONFIG, checkApproval, type ApprovalAction } from "../../src/agents/approve";
import type { AgentEntry, AgentRecord } from "../../src/agents/state";

// FINDINGS section 1: option 2 is "Yes, and don't ask again" in every dialog seen.
const DONT_ASK_AGAIN_KEY = "2";
const REQUEST_ID = "call_xiXjTeDtC0sE3IuiVTifIVAk";

function fixture(name: string): string {
  return readFileSync(join(import.meta.dir, "..", "fixtures", "panes", name), "utf8");
}

const bashDialog = fixture("bash-dialog.txt");
const writeDialog = fixture("write-dialog.txt");
const idle = fixture("idle-startup.txt");
const bashDialogNoLineRemoved = bashDialog.replace("   4. No\n", "");

const askRecord: AgentRecord = {
  paneId: "%1",
  session: "s",
  window: "1",
  cwd: "/tmp",
  pid: 100,
  state: "ask",
  question: { requestId: REQUEST_ID, tool: "Bash", summary: "touch yes-marker.txt" },
  updatedAt: 1,
};

const asking: AgentEntry = { ok: true, file: "/x/%1.json", record: askRecord };

function check(current: AgentEntry | undefined, paneText: string, action: ApprovalAction) {
  return checkApproval({ expectedRequestId: REQUEST_ID, current, paneText }, action, APPROVAL_CONFIG);
}

describe("APPROVAL_CONFIG", () => {
  test("uses the FINDINGS regexes verbatim and yes is 1", () => {
    expect(APPROVAL_CONFIG.dialogPattern.source).toBe(
      String.raw`^ Do you want to [^\n]*\?\n ❯ 1\. Yes\n(?:   \d\. [^\n]*\n)+\n Esc to cancel`,
    );
    expect(APPROVAL_CONFIG.dialogPattern.flags).toBe("m");
    expect(APPROVAL_CONFIG.noLinePattern.source).toBe(String.raw`^ {1,3}(?:❯ )?(\d)\. No$`);
    expect(APPROVAL_CONFIG.noLinePattern.flags).toBe("m");
    expect(APPROVAL_CONFIG.yesKey).toBe("1");
  });

  test("dialog pattern matches both dialog captures and not the idle one", () => {
    expect(APPROVAL_CONFIG.dialogPattern.test(bashDialog)).toBe(true);
    expect(APPROVAL_CONFIG.dialogPattern.test(writeDialog)).toBe(true);
    expect(APPROVAL_CONFIG.dialogPattern.test(idle)).toBe(false);
  });
});

describe("checkApproval", () => {
  test("Bash dialog: yes sends 1, no sends the parsed 4", () => {
    expect(check(asking, bashDialog, "yes")).toEqual({ send: true, keys: ["1"] });
    expect(check(asking, bashDialog, "no")).toEqual({ send: true, keys: ["4"] });
  });

  test("Write dialog: yes sends 1, no sends the parsed 3", () => {
    expect(check(asking, writeDialog, "yes")).toEqual({ send: true, keys: ["1"] });
    expect(check(asking, writeDialog, "no")).toEqual({ send: true, keys: ["3"] });
  });

  test("agent gone", () => {
    expect(check(undefined, bashDialog, "yes")).toEqual({ send: false, reason: "gone" });
  });

  test("state file unreadable", () => {
    const bad: AgentEntry = { ok: false, file: "/x/%1.json", error: "invalid JSON" };
    expect(check(bad, bashDialog, "yes")).toEqual({ send: false, reason: "unreadable" });
  });

  test("agent not asking", () => {
    const { question: _q, ...rest } = askRecord;
    const working: AgentEntry = { ok: true, file: "/x/%1.json", record: { ...rest, state: "working" } };
    expect(check(working, bashDialog, "yes")).toEqual({ send: false, reason: "not-asking" });
  });

  test("different requestId means the question changed", () => {
    const other: AgentEntry = {
      ok: true,
      file: "/x/%1.json",
      record: { ...askRecord, question: { ...askRecord.question!, requestId: "call_Eky2bnU41nvrrcGSZHAU4YCC" } },
    };
    expect(check(other, bashDialog, "yes")).toEqual({ send: false, reason: "changed" });
    expect(check(other, bashDialog, "no")).toEqual({ send: false, reason: "changed" });
  });

  test("idle capture means the dialog is not visible", () => {
    expect(check(asking, idle, "yes")).toEqual({ send: false, reason: "dialog-not-visible" });
    expect(check(asking, idle, "no")).toEqual({ send: false, reason: "dialog-not-visible" });
  });

  test("dialog without a No line refuses no but still allows yes", () => {
    expect(APPROVAL_CONFIG.dialogPattern.test(bashDialogNoLineRemoved)).toBe(true);
    expect(check(asking, bashDialogNoLineRemoved, "no")).toEqual({ send: false, reason: "no-option-not-found" });
    expect(check(asking, bashDialogNoLineRemoved, "yes")).toEqual({ send: true, keys: ["1"] });
  });

  test("a No line in scrollback above the dialog is not used", () => {
    const pane = `  2. No\n${bashDialog}`;
    expect(check(asking, pane, "no")).toEqual({ send: true, keys: ["4"] });
  });

  test("never sends the don't-ask-again key for any fixture or action", () => {
    const panes = [bashDialog, writeDialog, idle, bashDialogNoLineRemoved, `  2. No\n${bashDialog}`];
    for (const pane of panes) {
      for (const action of ["yes", "no"] as const) {
        const result = check(asking, pane, action);
        if (result.send) expect(result.keys).not.toContain(DONT_ASK_AGAIN_KEY);
      }
    }
  });
});
