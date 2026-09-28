// Optional WebMCP integration: only page navigation, never data upload or external transmission.
export function registerNavigation(
  navigate: (page: string) => void,
  pages: string[],
) {
  const context = (document as any).modelContext;
  if (!context?.registerTool) return;
  const lifecycle = new AbortController();
  try {
    Promise.resolve(
      context.registerTool(
        {
          name: "navigate_trace_ledger",
          title: "Navigate Trace Ledger",
          description:
            "Open a workbench section without changing investigation data.",
          inputSchema: {
            type: "object",
            properties: { page: { type: "string", enum: pages } },
            required: ["page"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute(input: any) {
            if (
              !input ||
              Object.keys(input).length !== 1 ||
              !pages.includes(input.page)
            )
              throw Error("Unknown workbench section");
            navigate(input.page);
            return { page: input.page };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {});
  } catch {
    /* Optional capability; no impact on ordinary browsers. */
  }
  return () => lifecycle.abort();
}
