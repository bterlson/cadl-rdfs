import { createCadlLibrary } from "@cadl-lang/compiler";

export const lib = createCadlLibrary({
  name: "cadl-rdf",
  diagnostics: {}, // no diagnostics yet
  emitter: {}, // no emitter options
});

export const { reportDiagnostic, createDiagnostic, createStateSymbol } = lib;