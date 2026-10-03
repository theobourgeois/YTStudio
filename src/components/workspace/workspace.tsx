import { Suspense } from "react";
import { clientSuite } from "@/suites";
import { useProjects } from "@/stores/projects";
import { PlainWorkspace, WorkspaceLoading } from "./plain-workspace";

/** The main column while a project is open: its suite's workspace (the Home screen shows when none is). */
export function Workspace() {
  const suite = useProjects((s) => s.projects.find((p) => p.id === s.openId)?.suite);

  if (!suite) {
    return (
      <PlainWorkspace>
        <WorkspaceLoading />
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
