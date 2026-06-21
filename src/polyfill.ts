console.log("[Polyfill] Initializing V8 startupSnapshot mock...");
// Polyfill/mock v8.startupSnapshot.isBuildingSnapshot for older Bun compatibility (e.g. Bun <= 1.3.14)
if (typeof process !== "undefined" && typeof (process as any).getBuiltinModule === "function") {
  const origGetBuiltin = (process as any).getBuiltinModule;
  (process as any).getBuiltinModule = function (name: string) {
    if (name === "v8") {
      return {
        startupSnapshot: {
          isBuildingSnapshot: () => false,
          addSerializeCallback: () => {},
          addDeserializeCallback: () => {},
          setDeserializeMainFunction: () => {}
        }
      };
    }
    return origGetBuiltin.apply(this, arguments as any);
  };
}
