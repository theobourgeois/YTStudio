import { Suspense } from "react";
import { clientSuite } from "@/suites";
import { useProjects } from "@/stores/projects";
import { EmptyState } from "./empty-state";
import { PlainWorkspace, WorkspaceLoading } from "./plain-workspace";

/** The main column: the open project's suite's workspace, or an empty state when none is open. */
export function Workspace() {
  const openId = useProjects((s) => s.openId);
  const suite = useProjects((s) => s.projects.find((p) => p.id === s.openId)?.suite);

  if (!openId || !suite) {
    return (
      <PlainWorkspace>
        <EmptyState />
      </PlainWorkspace>
    );
  }
  const SuiteWorkspace = clientSuite(suite).Workspace;
  return (
    <Suspense
      fallback={
        <PlainWorkspace>
          <WorkspaceLoading />
        </PlainWorkspace>
      }
    >
      <SuiteWorkspace key={suite} />
    </Suspense>
  );
}
