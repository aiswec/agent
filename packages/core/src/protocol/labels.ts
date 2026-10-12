/**
 * Labels are the entire state machine.
 *
 * The lesson from the source system is that ad-hoc add/remove calls rot: a
 * success path forgets to clear a failure label and the issue sits in two states
 * at once. So transitions are computed from a declared state set with one
 * invariant (at most one state label at a time) and every transition clears
 * the others by construction rather than by remembering to.
 *
 * `hold` is deliberately not a state. It is an operator brake that coexists with
 * whatever state the issue is in, and it survives every transition.
 */
import { DEFAULT_NAMESPACE } from "./markers.js";

export const HUB_STATES = ["awaiting-input", "awaiting-approval", "routed", "needs-human"] as const;
export const REPO_STATES = ["refined", "ready-to-build", "pr-open", "needs-human"] as const;

export type HubState = (typeof HUB_STATES)[number];
export type RepoState = (typeof REPO_STATES)[number];

export const HOLD = "hold";

/**
 * The assignment. aiswec works only on issues a maintainer has handed to it,
 * and GitHub does not let an App be an assignee, so the bare namespace is the
 * label that means "assigned to aiswec": apply it to assign, remove it to
 * withdraw. Like `hold` it is not a state: it coexists with every state and
 * every stage checks it before acting.
 */
export function assignmentLabel(namespace: string = DEFAULT_NAMESPACE): string {
  return namespace;
}

export function isAssigned(labels: readonly string[], namespace: string = DEFAULT_NAMESPACE): boolean {
  return labels.includes(assignmentLabel(namespace));
}

export function labelName(state: string, namespace: string = DEFAULT_NAMESPACE): string {
  return `${namespace}:${state}`;
}

export interface LabelPlanOptions {
  states: readonly string[];
  namespace?: string;
}

export interface LabelPlan {
  add: string[];
  remove: string[];
  /** The label set after applying the plan, in stable order. */
  final: string[];
}

/**
 * @param to the state to enter, or null to leave the machine entirely (a merged PR).
 */
export function planTransition(
  current: readonly string[],
  to: string | null,
  options: LabelPlanOptions,
): LabelPlan {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  if (to !== null && !options.states.includes(to)) {
    throw new Error(
      `unknown state "${to}"; declared states are ${options.states.join(", ")}`,
    );
  }

  const stateLabels = new Set(options.states.map((state) => labelName(state, namespace)));
  const target = to === null ? null : labelName(to, namespace);

  const remove = current.filter((label) => stateLabels.has(label) && label !== target);
  const add = target !== null && !current.includes(target) ? [target] : [];
  const removed = new Set(remove);
  const final = [...current.filter((label) => !removed.has(label)), ...add];

  return { add, remove, final };
}

/** Guard for the invariant. Returns the single active state, or null if none. */
export function activeState(
  labels: readonly string[],
  options: LabelPlanOptions,
): string | null {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  const active = options.states.filter((state) => labels.includes(labelName(state, namespace)));
  if (active.length > 1) {
    throw new Error(
      `labels violate the single-state invariant: ${active.join(", ")} are all present`,
    );
  }
  return active[0] ?? null;
}

export function isHeld(labels: readonly string[], namespace: string = DEFAULT_NAMESPACE): boolean {
  return labels.includes(labelName(HOLD, namespace));
}

export interface LabelDefinition {
  name: string;
  color: string;
  description: string;
}

/**
 * Label definitions live only in GitHub today, in no file anywhere (§8). The
 * installer provisions them from here instead.
 */
export function labelDefinitions(namespace: string = DEFAULT_NAMESPACE): LabelDefinition[] {
  const palette: Record<string, { color: string; description: string }> = {
    "awaiting-input": { color: "fbca04", description: "Waiting on a maintainer to answer the bot's questions" },
    "awaiting-approval": { color: "0e8a16", description: "A plan is posted and waiting for approval" },
    routed: { color: "1d76db", description: "Child issues have been filed" },
    refined: { color: "c5def5", description: "A spec has been posted for this issue" },
    "ready-to-build": { color: "0052cc", description: "Cleared to run the build stage" },
    "pr-open": { color: "5319e7", description: "A pull request is open for this issue" },
    "needs-human": { color: "b60205", description: "Automation stopped and needs a maintainer" },
    [HOLD]: { color: "d93f0b", description: "Operator brake: automation will not advance this issue" },
  };

  return [
    {
      name: assignmentLabel(namespace),
      color: "1d1b3a",
      description: "Assigned to aiswec, which takes this issue",
    },
    ...Object.entries(palette).map(([state, meta]) => ({
      name: labelName(state, namespace),
      color: meta.color,
      description: meta.description,
    })),
  ];
}
