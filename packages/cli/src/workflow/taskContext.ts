// What the runner reads from a run's task and plan into its context, which
// node prompts expand and edge conditions route on (split from runner.ts).
import { FOREIGN_TEXT_CAPS, capForeignText, escapeForeignControlChars, inlineForeignText } from "@codecast/shared/contracts";
import { planReadiness } from "../planReadiness.js";
import type { WorkflowGraph } from "./types";

// One routable value for "how did the hand end": the execution status of a
// handoff that placed the task in review, else none. The edges read it, and so
// does the runner's wait on a builder that ended a turn before handing off.
export function handoffOf(task: any): string {
  return String(task?.status || "") === "in_review" ? String(task.execution_status || "none") : "none";
}

// The task fields node prompts and edge conditions read. A verdict older than
// `freshSince` reads as "none": a review round that ended without a verdict
// must not re-route on the last round's answer.
export function readTaskFields(task: any, context: Record<string, string>, freshSince = 0): void {
  // Why: every value here is expanded into node prompts through $vars
  // and the `# Context` list, so it is escaped and capped as it enters
  // the context rather than at each of those sites (ct-49593).
  context["task_title"] = inlineForeignText(task.title);
  context["task_description"] = capForeignText(
    escapeForeignControlChars(task.description || ""),
    FOREIGN_TEXT_CAPS.descriptionChars,
  );
  const criteria: string[] = (task.acceptance_criteria?.length ? task.acceptance_criteria : (task.steps || []).map((s: any) => s.title))
    .map((c: string) => inlineForeignText(c));
  context["acceptance_criteria"] = criteria.join("\n- ");
  context["task_status"] = String(task.status || "");
  context["execution_status"] = String(task.execution_status || "");
  const verdict = task.review_verdict;
  context["review_verdict"] = verdict && (verdict.at ?? 0) >= freshSince ? String(verdict.verdict) : "none";
  context["review_note"] = verdict?.note ? capForeignText(escapeForeignControlChars(String(verdict.note)), FOREIGN_TEXT_CAPS.descriptionChars) : "";
  // One routable value for "how did the hand end": the execution status of a
  // handoff that placed the task in review, else none. A `changes` verdict
  // moves the task to in_progress without clearing execution_status, so
  // status = in_review is the freshness signal; a hand that ended without a
  // handoff (an inline question, a decision, a crash) reads as none and no
  // edge fires, which is the failure path.
  context["handoff"] = handoffOf(task);
  // What a hand that stopped (blocked, needs_context) said in its handoff: the
  // question the line's ask gate puts to a person, whole. Only a gate's doc
  // names it (no hand's prompt does), and a person answers what they can read
  // to its end, so it carries no prompt cap.
  context["handoff_note"] = context["handoff"] === "blocked" || context["handoff"] === "needs_context"
    ? escapeForeignControlChars(String(task.verification_evidence || ""))
    : "";
  // The ground node's fields (the-line-end-to-end.md LE5), which the line's
  // edges route on; empty until ground writes them.
  context["goal_ref"] = inlineForeignText(task.goal_ref || "");
  context["category"] = String(task.category || "");
  context["risk"] = String(task.risk || "");
  context["readiness"] = String(task.readiness || "");
  context["readiness_note"] = inlineForeignText(task.readiness_note || "");
  // Whose line this is, for the line's decision stack (LE11).
  context["assignee"] = inlineForeignText(task.assignee_info?.name || task.assignee || "unassigned");
}

// A station whose every edge routes on its handoff (the line's builders) has
// answered when its handoff lands, not when its hand first ends a turn.
export function routesOnlyOnHandoff(graph: WorkflowGraph, nodeId: string): boolean {
  const out = graph.edges.filter((e) => e.from === nodeId);
  return out.length > 0 && out.every((e) => /\bhandoff\b/.test(e.condition ?? ""));
}

// The plan fields node prompts and edge conditions read, refreshed after
// every node like the task's: `ready_tasks` counts the plan's tasks that can
// start now, so plan-autopilot's loop routes on the plan as it is.
export function readPlanFields(plan: any, context: Record<string, string>): void {
  context["plan_title"] = inlineForeignText(plan.title);
  context["plan_goal"] = capForeignText(
    escapeForeignControlChars(plan.goal || ""),
    FOREIGN_TEXT_CAPS.descriptionChars,
  );
  context["plan_acceptance_criteria"] = (plan.acceptance_criteria || [])
    .map((c: string) => inlineForeignText(c)).join("\n- ");
  const { open, ready } = planReadiness<any>(plan.tasks || [], plan.graph_outside);
  context["ready_tasks"] = String(ready.length);
  context["open_tasks"] = String(open.length);
}
