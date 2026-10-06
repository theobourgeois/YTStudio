import { Suspense } from "react";
import { useProjects } from "@/stores/projects";
import { clientSuite } from "@/suites";

/** A suite's New window (`ClientSuite.NewProject`), on the app's desktop while it asks what to make. */
export function NewProjectWindow() {
  const choosing = useProjects((s) => s.choosing);
  const NewProject = choosing && clientSuite(choosing.suite).NewProject;
  if (!choosing || !NewProject) return null;
  const { suite, blank } = choosing;
  return (
    <Suspense fallback={null}>
      <NewProject
        key={suite}
        blank={blank}
        create={({ options, files }) => void useProjects.getState().create({ suite, blank, files, options: options ?? {} })}
        close={() => useProjects.getState().cancelNew()}
      />
    </Suspense>
  );
}
