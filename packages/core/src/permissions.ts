import type { PermissionsConfig } from "./config.ts";

/**
 * Permission system: allow once / always / deny.
 * - "ask" mode prompts for anything not read-only (plus everything in alwaysAsk).
 * - "allow-read-only" auto-approves read-only tools, prompts for the rest.
 * - "yolo" auto-approves everything (user opted in; still logged).
 */

export type PermissionDecision = "allow-once" | "allow-always" | "deny";

export type PermissionPrompt = (
  tool: string,
  detail: string,
) => Promise<PermissionDecision>;

export class PermissionGate {
  private readonly alwaysAllowed = new Set<string>();
  private readonly alwaysDenied = new Set<string>();

  constructor(
    private readonly config: PermissionsConfig,
    private readonly alwaysAsk: string[] = [],
  ) {}

  /** Does this tool need an interactive prompt? */
  needsApproval(tool: string, readOnly: boolean): boolean {
    if (this.config.mode === "yolo") return false;
    if (this.alwaysAllowed.has(tool)) return false;
    if (this.alwaysDenied.has(tool)) return true;
    if (this.alwaysAsk.includes(tool)) return true;
    if (this.config.mode === "allow-read-only" && readOnly) return false;
    if (this.config.mode === "ask" && readOnly) return false;
    return true;
  }

  async check(tool: string, readOnly: boolean, detail: string, prompt: PermissionPrompt): Promise<boolean> {
    if (this.alwaysDenied.has(tool)) return false;
    if (!this.needsApproval(tool, readOnly)) return true;

    const decision = await prompt(tool, detail);
    switch (decision) {
      case "allow-once":
        return true;
      case "allow-always":
        this.alwaysAllowed.add(tool);
        return true;
      case "deny":
        return false;
    }
  }

  grantAlways(tool: string): void {
    this.alwaysAllowed.add(tool);
  }

  reset(): void {
    this.alwaysAllowed.clear();
    this.alwaysDenied.clear();
  }
}
