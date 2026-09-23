// Lets a script run the app's server-side code under plain Node: "server-only" resolves to its
// empty build. Use: node --import ./scripts/no-server-only.mjs --import tsx scripts/<script>.ts
// (CommonJS scripts only — .ts, not .mts — so the tenant context is the one instance the lib
// files share). The env comes from `railway variables` (DATABASE_URL = the PUBLIC address).
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
const empty = pathToFileURL(process.cwd() + "/node_modules/server-only/empty.js").href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: empty, format: "commonjs", shortCircuit: true };
    return next(specifier, context);
  },
});
