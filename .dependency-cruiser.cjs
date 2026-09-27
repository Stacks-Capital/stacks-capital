/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "no-undeclared-dependency",
      comment: "A package may only import what its own package.json declares.",
      severity: "error",
      from: { path: "^(packages|apps|prototypes)/" },
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"] },
    },
    {
      name: "core-has-no-internal-dependencies",
      comment: "core is the base every other package builds on.",
      severity: "error",
      from: { path: "^packages/core/" },
      to: { path: "^(packages|apps)/", pathNot: "^packages/core/" },
    },
    {
      name: "packages-do-not-import-apps",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "adapters-do-not-import-ui",
      comment: "Page 01: an adapter cannot import web UI.",
      severity: "error",
      from: { path: "^packages/adapters/" },
      to: { path: "^(apps/|packages/(ui|react)/)" },
    },
    {
      name: "web-does-not-import-adapters",
      comment: "Page 01: the web application calls public SDK methods, not adapter transaction builders.",
      severity: "error",
      from: { path: "^apps/web/" },
      to: { path: "^packages/(adapters|engine)/" },
    },
    {
      name: "sdk-does-not-import-adapters",
      comment: "Page 01: the browser SDK validates unsigned plans. Quote and plan minting stays in the engine/API.",
      severity: "error",
      from: { path: "^packages/sdk/src/", pathNot: "\\.test\\.ts$" },
      to: { path: "^packages/(adapters|engine)/" },
    },
    {
      name: "partner-program-does-not-import-engine",
      comment: "Page 01: the partner program calls the Capital API and the public SDK, not adapters or the engine.",
      severity: "error",
      from: { path: "^apps/partner-example/src/program\\.ts$" },
      to: { path: "^packages/(adapters|engine)/" },
    },
    {
      name: "embed-example-uses-public-packages-only",
      comment:
        "I16: a partner app is built from the client, the hooks and the ui, and nothing that holds keys or mints plans.",
      severity: "error",
      from: { path: "^apps/embed-example/" },
      to: { path: "^packages/", pathNot: "^packages/(client|react|ui|core)/" },
    },
    {
      name: "ui-stays-on-the-browser-side",
      comment: "I16: embeddable UI reads through the API, never through adapters, the engine or the database.",
      severity: "error",
      from: { path: "^packages/ui/" },
      to: { path: "^packages/(adapters|engine|database|config|fixtures)/" },
    },
    {
      name: "no-relative-import-into-another-package",
      comment: "Import other workspace packages by name so package exports stay the only entry point.",
      severity: "error",
      from: { path: "^(packages|apps)/([^/]+)/" },
      to: { path: "^(packages|apps)/", pathNot: "^$1/$2/", dependencyTypes: ["local"] },
    },
    {
      name: "browser-packages-avoid-node-builtins",
      comment: "Page 06: browser exports must not import Node only modules.",
      severity: "error",
      from: { path: "^packages/(core|sdk|client|wallets|react|ui)/src/", pathNot: "\\.test\\.ts$" },
      to: { dependencyTypes: ["core"] },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: {
      path: "(^|/)(dist|node_modules|playwright-report|test-results)/|^scripts/generate-production-plan-pdf\\.mjs$",
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".js", ".json"],
    },
  },
};
